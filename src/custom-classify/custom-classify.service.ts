import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/authenticated-user';
import { AzureOpenAiService } from '../intent/azure-openai.service';
import type { IntentLabeler, ParseChatResult } from '../intent/intent-labeler.port';
import type { SnapshotRowData } from '../keyword-analysis/result-snapshot.checksum';
import { PrismaService } from '../prisma';
import { SnapshotQueryService } from '../keywords/snapshot-query.service';
import { scrubSecrets } from '../logger/redaction';
import { CustomClassifyGenerationError } from './custom-classify.error';
import { buildCustomLabelMessages } from './custom-classify.prompt';
import { type CustomLabelSet, customLabelResponseFormat } from './custom-classify.schema';
import type { CustomClassification, CustomClassifyRequest } from './custom-classify.types';

/** 上限 completion tokens（≤12 標籤 × 短 description；避免 `finish_reason=length`）。 */
const MAX_COMPLETION_TOKENS = 1000;

/** 送進 LLM 設計標籤的樣本關鍵字上限（依 rowIndex 序取前 N；只為讓標籤涵蓋語料、非全表）。 */
const SAMPLE_SIZE = 200;

/** DI token：`{ maxLabels }`（自 azure config 的 `customClassifyMaxLabels` 組裝）。 */
export const CUSTOM_CLASSIFY_CONFIG = Symbol('CUSTOM_CLASSIFY_CONFIG');

export interface CustomClassifyConfig {
  /** 標籤數量上限（後處理截斷；structured-outputs 無法強制 `maxItems`）。 */
  maxLabels: number;
}

/**
 * 自訂分類**階段一**服務（T12.7，FR-34 / AC-34.1；Design §17.5）。使用者給「分類指令 + 名稱」，服務依 snapshot
 * 樣本關鍵字讓 LLM **設計一組互斥標籤**（HITL 待確認），存入 `custom_classifications`。逐字指派＝階段二（T12.8）。
 *
 * **複用既有元件**（與 ai-insight T12.3 同構）：
 * - `SnapshotQueryService.resolveReadySnapshotId`：owner-scoped 404/409 單點（S8）——owner 來自 `@CurrentActor()`，
 *   不可由參數繞過；未知/越權→404、未就緒→409。
 * - `AzureOpenAiService`：單次同步小完成（strict `json_schema`、temperature 0）。
 * - `PrismaService`：載樣本（`snapshot_rows`）＋落定義（`custom_classifications`）。
 *
 * **不覆寫** `keyword_intents`（分表互補）；**不快取**（建立為 mutation、非 idempotent 讀）。**LLM 失敗一律**
 * {@link CustomClassifyGenerationError}（不落半成品、訊息經 `scrubSecrets`，AC-34.1），非吞錯。
 */
@Injectable()
export class CustomClassifyService {
  constructor(
    @Inject(AzureOpenAiService) private readonly labeler: IntentLabeler,
    private readonly snapshotQuery: SnapshotQueryService,
    private readonly prisma: PrismaService,
    @Inject(CUSTOM_CLASSIFY_CONFIG) private readonly config: CustomClassifyConfig,
  ) {}

  async generateLabels(
    analysisId: string,
    request: CustomClassifyRequest,
    actor: AuthenticatedUser,
  ): Promise<CustomClassification> {
    // owner-scoped snapshot 解析（未知/越權→404、未就緒→409）——與讀取層共用單一強制點（S8）。
    const snapshotId = await this.snapshotQuery.resolveReadySnapshotId(analysisId, actor);
    const samples = await this.loadSamples(snapshotId);
    const labels = await this.designLabels(request.instruction, samples);

    const row = await this.prisma.customClassification.create({
      data: {
        analysisId,
        snapshotId,
        name: request.name,
        instruction: request.instruction,
        labels,
      },
    });
    return {
      id: row.id,
      name: request.name,
      instruction: request.instruction,
      labels,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 讀不可變 snapshot 的關鍵字原字樣本（依 rowIndex 序取前 {@link SAMPLE_SIZE}）。 */
  private async loadSamples(snapshotId: string): Promise<string[]> {
    const rows = await this.prisma.snapshotRow.findMany({
      where: { snapshotId },
      orderBy: { rowIndex: 'asc' },
      take: SAMPLE_SIZE,
    });
    return rows.map((row) => (row.data as unknown as SnapshotRowData).text);
  }

  /**
   * 單次同步小完成（strict schema、temperature 0）→ 去重（label 大小寫不敏感）＋濾空＋截斷至 ≤ `maxLabels`。
   * **任何**失敗（拋錯 / refusal / malformed / 去重後為空）→ {@link CustomClassifyGenerationError}。
   */
  private async designLabels(
    instruction: string,
    samples: string[],
  ): Promise<CustomLabelSet['labels']> {
    const responseFormat = customLabelResponseFormat();
    let result: ParseChatResult<CustomLabelSet>;
    try {
      result = await this.labeler.parseChat<CustomLabelSet>({
        messages: buildCustomLabelMessages(instruction, samples, this.config.maxLabels),
        jsonSchema: {
          name: responseFormat.json_schema.name,
          schema: responseFormat.json_schema.schema as Record<string, unknown>,
        },
        temperature: 0,
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
      });
    } catch (error) {
      throw new CustomClassifyGenerationError(
        `Custom classification label generation failed: ${scrubSecrets(String(error))}`,
        error,
      );
    }

    if (result.refusal !== null || !Array.isArray(result.parsed?.labels)) {
      throw new CustomClassifyGenerationError(
        'Custom classification label generation returned no usable labels',
      );
    }

    const labels = dedupeLabels(result.parsed.labels).slice(0, this.config.maxLabels);
    if (labels.length === 0) {
      throw new CustomClassifyGenerationError(
        'Custom classification label generation returned no usable labels',
      );
    }
    return labels;
  }
}

/** 去重（label 以 lowercase(trim) 為 key，保留首見）＋濾掉空白 label。 */
function dedupeLabels(labels: CustomLabelSet['labels']): CustomLabelSet['labels'] {
  const seen = new Set<string>();
  const out: CustomLabelSet['labels'] = [];
  for (const item of labels) {
    const key = item.label.trim().toLowerCase();
    if (key === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ label: item.label, description: item.description });
  }
  return out;
}
