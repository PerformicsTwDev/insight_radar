import { Inject, Injectable } from '@nestjs/common';
import { CacheNamespace } from '../cache/cache-namespace';
import { CacheService } from '../cache/cache.service';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { canonicalStringify } from '../common/canonical-json';
import { sha256Hex } from '../common/sha256';
import { AzureOpenAiService } from '../intent/azure-openai.service';
import type { IntentLabeler, ParseChatResult } from '../intent/intent-labeler.port';
import type { FilterSpec } from '../keywords/filter-spec';
import { SnapshotQueryService } from '../keywords/snapshot-query.service';
import type { QueryRequest, ViewResult } from '../keywords/views';
import { scrubSecrets } from '../logger/redaction';
import { AiInsightGenerationError } from './ai-insight-generation.error';
import { buildAiInsightMessages } from './ai-insight.prompt';
import { type AiInsightPayload, aiInsightResponseFormat } from './ai-insight.schema';
import type { AiInsight, AiInsightRequest } from './ai-insight.types';

/** 上限 completion tokens（側欄總結為短段落；避免 `finish_reason=length` 截斷）。 */
const MAX_COMPLETION_TOKENS = 800;

/** DI token：`{ schemaVersion, deployment, cacheTtlMs }`（由 cache + azure config 組裝）。 */
export const AI_INSIGHT_CONFIG = Symbol('AI_INSIGHT_CONFIG');

export interface AiInsightConfig {
  /** 快取 namespace 版本（`ai_insight:v{ver}:...`；bump 整批失效，AC-32.2）。 */
  schemaVersion: string;
  /** Azure 部署名（cache namespace 的 `{deployment}` 段；換部署自然失效）。 */
  deployment: string;
  /** 快取 TTL（毫秒）。 */
  cacheTtlMs: number;
  /** table-grain view 洞察的有界代表樣本上限（top-N by volume；M12-R2/AC-32.1）。 */
  maxRows: number;
  /** `/query` 允許的最大 pageSize（= `QUERY_MAX_PAGE_SIZE`）；用於 clamp `maxRows`，避免超限被 400（#516）。 */
  queryMaxPageSize: number;
}

/**
 * per-view AI 洞察服務（T12.3，FR-32 / AC-32.1/32.2/32.4；Design §17.4）。**複用既有元件**：
 * - `SnapshotQueryService`（T5.5）：`resolveReadySnapshotId`（owner-scoped 404/409 單點，S8）+ `query`（view 的
 *   `/query` 聚合＝LLM 輸入，AC-32.1；unknown-view→400、feature-gating→409 亦於此單點沿用）。
 * - `AzureOpenAiService`（T2.1）：單次同步小完成（strict `json_schema`、temperature 0）。
 * - `CacheService`（cache-manager v6）：key `ai_insight:v{ver}:{dep}:{snapshotId}:{view}:sha256(canonical(filters))`；
 *   `filters-hash` 用**與 `/query` 同一** canonical 序列化（{@link canonicalStringify}，S9）；命中不重打 LLM。
 *
 * 流程：resolve snapshotId（owner/readiness）→ cache 命中即回（免載列/聚合/LLM）→ miss 取 `/query` 聚合 →
 * 單次 LLM → 快取。**LLM 失敗一律 {@link AiInsightGenerationError}**（不回半截、不快取、不污染他請求，AC-32.4）。
 * HTTP 端點（400/404/409 映射、DTO view 白名單）為 T12.4——本服務只做「service + cache」。
 */
@Injectable()
export class AiInsightService {
  constructor(
    @Inject(AzureOpenAiService) private readonly labeler: IntentLabeler,
    private readonly snapshotQuery: SnapshotQueryService,
    private readonly cache: CacheService,
    @Inject(AI_INSIGHT_CONFIG) private readonly config: AiInsightConfig,
  ) {}

  async generate(
    analysisId: string,
    request: AiInsightRequest,
    actor: AuthenticatedUser,
  ): Promise<AiInsight> {
    // owner-scoped snapshot 解析（未知/越權→404、未就緒→409）——與讀取層共用單一強制點（S8）。
    const snapshotId = await this.snapshotQuery.resolveReadySnapshotId(analysisId, actor);

    // dynamic view 資料版本（M12-R3）：dynamic/gated view 的底層 per-run 資料重跑後 (snapshotId,view,filters) 不變、
    // 需另以 dataVersion（最新 completed run id）綁 key；static view 回 ''（免 DB round-trip、key 不變）。
    // actor 一併傳入：AI-search 分支的 dataVersion 必 owner-scoped，避免跨租戶 cache short-circuit（M15-R11，
    // S25.1/AC-32.2）——與下方 owner-scoped data path（`query`→`queryAiSearchView`）同一 owner 單點。
    const dataVersion = await this.snapshotQuery.resolveViewDataVersion(
      analysisId,
      request.view,
      actor,
    );

    const key = this.cacheKey(snapshotId, request.view, request.filters, dataVersion);
    const cached = await this.cache.get<AiInsight>(key);
    if (cached !== undefined) {
      return cached; // 命中：不重打 LLM、不重跑聚合（AC-32.2）
    }

    // 輸入 = 該 view 經 `/query` 產出的**聚合結果**（AC-32.1；非原始全表）。unknown-view→400 亦於此拋。
    // **只帶 `{ view, filters }` + 固定 `pagination`**：不轉請求的 `select`/`sort`（#476；聚合僅由 `(view, filters)`
    // 決定 → 與 filters-only 快取 key 一致）。table-grain view 的 `/query` 是分頁列（預設 50）→ 只帶 50 列會讓 LLM
    // 把有界樣本當全體（M12-R2）；故固定 `pageSize=maxRows`（常數、非請求衍生 → 不動快取 key）取 **top-N by volume**
    // （paginate 預設 sort=`avgMonthlySearches` desc）。chart-grain view 本即全集聚合、`pageSize` 對其 group 無截斷。
    // clamp 至 `/query` 允許的最大 pageSize（#516）：`SnapshotQueryService` 對 `pageSize > QUERY_MAX_PAGE_SIZE`
    // 是**拒絕 400**（非 clamp），故 `AI_INSIGHT_MAX_ROWS > QUERY_MAX_PAGE_SIZE`（誤設）會使所有 table view 洞察 400；
    // 取較小值 graceful degrade（至多取 query 允許的最大頁；預設兩者同 200 → 無 clamp）。
    const pageSize = Math.min(this.config.maxRows, this.config.queryMaxPageSize);
    const queryRequest: QueryRequest = {
      view: request.view,
      filters: request.filters,
      pagination: { pageSize },
    };
    const aggregate: ViewResult = await this.snapshotQuery.query(analysisId, queryRequest, actor);
    const insight = await this.summarize(request.view, aggregate);

    await this.cache.set(key, insight, this.config.cacheTtlMs);
    return insight;
  }

  /**
   * 洞察快取 key：filters-hash 用與 `/query` 同一 canonical 序列化（S9 / AC-32.2）。dynamic view 另附
   * `dataVersion`（最新 completed run id，M12-R3）綁底層可變資料版本；static view 的 `dataVersion=''` → 不附段，
   * 既有 key 形狀不變（不必要地失效 static 快取）。
   */
  private cacheKey(
    snapshotId: string,
    view: string,
    filters: FilterSpec | undefined,
    dataVersion: string,
  ): string {
    const segments: (string | number)[] = [
      this.config.schemaVersion,
      this.config.deployment,
      snapshotId,
      view,
      sha256Hex(canonicalStringify(filters ?? {})),
    ];
    if (dataVersion) {
      segments.push(dataVersion);
    }
    return this.cache.buildKey(CacheNamespace.AI_INSIGHT, ...segments);
  }

  /**
   * 單次同步小完成（strict schema、temperature 0）。**任何**失敗（拋錯 / refusal / malformed / 空摘要）→
   * {@link AiInsightGenerationError}（不回半截、不快取，AC-32.4）；錯誤映射保留 `cause`，訊息經 `scrubSecrets`
   * 清洗，非吞錯。
   */
  private async summarize(view: string, aggregate: ViewResult): Promise<AiInsight> {
    const responseFormat = aiInsightResponseFormat();
    let result: ParseChatResult<AiInsightPayload>;
    try {
      result = await this.labeler.parseChat<AiInsightPayload>({
        messages: buildAiInsightMessages(view, aggregate),
        jsonSchema: {
          name: responseFormat.json_schema.name,
          schema: responseFormat.json_schema.schema as Record<string, unknown>,
        },
        temperature: 0,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
      });
    } catch (error) {
      throw new AiInsightGenerationError(
        `AI insight generation failed: ${scrubSecrets(String(error))}`,
        { cause: error },
      );
    }

    const insight = result.parsed?.insight;
    if (result.refusal !== null || typeof insight !== 'string' || insight.trim() === '') {
      throw new AiInsightGenerationError('AI insight generation returned no usable summary');
    }
    return { view, insight, generatedAt: new Date().toISOString() };
  }
}
