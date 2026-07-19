import type { MapperInput, MapResult, SocialPostCanonical } from './canonical.types';
import {
  asRecord,
  capturedAtToIso,
  coerceString,
  collectUnknownFields,
  pickAlias,
} from './coalesce';
import { failResult } from './map-result';
import { normalizeCount } from './normalize-count';
import { normalizeChineseDateTime } from './normalize-datetime';
import { normalizePostKey } from './post-key';

/**
 * Social 線 mapper 骨架（FR-37/46/51；Design §18.5）——raw payload → `SocialPost` 中立形狀（純函式）。
 *
 * 核心欄位 = `content` + `postKey`（`normalize(permalink/url)`，S13）；任一缺 → failed。author 收斂異名欄位
 * （`author|channelName|name|…`）；metrics 經 `normalizeCount`（`"8K"→8000`；缺 → null，S14 缺值≠0）；
 * `publishedAt` 經 `normalizeChineseDateTime`（中文時間 → ISO）。present-但-不可解析（metrics/publishedAt）或未知欄位
 * → partial（漂移預警，AC-37.4）。`raw` 恆保留（INV-4）。
 *
 * ⚠ 邊界（T13.4 ↔ T13.5/T16.5）：此為**平台層骨架**，recognized-field 白名單刻意精簡；per-platform 實欄位、golden
 * fixture（extension `type.ts` 權威）、以及跨來源 merge（metrics 取 extension / 全文取較長 / `source=merged`）屬 T13.5/T16.5。
 */
const AUTHOR_ALIASES = ['author', 'channelName', 'name', 'username', 'displayName'] as const;
const CONTENT_ALIASES = ['content', 'text', 'body', 'caption', 'fullText', 'full_text'] as const;
const PERMALINK_ALIASES = ['permalink', 'url', 'link', 'postUrl', 'post_url', 'href'] as const;
const PUBLISHED_ALIASES = [
  'publishedAt',
  'published_at',
  'timestamp',
  'time',
  'date',
  'createdAt',
  'created_at',
  'postedAt',
  'datetime',
] as const;
const PROFILE_ALIASES = [
  'profileLink',
  'profileUrl',
  'profile_url',
  'authorUrl',
  'author_url',
] as const;
const LIKES_ALIASES = ['likes', 'likesCount', 'likeCount', 'likes_count'] as const;
const COMMENTS_ALIASES = [
  'comments',
  'commentsCount',
  'commentCount',
  'replies',
  'repliesCount',
  'comments_count',
] as const;
const REPOSTS_ALIASES = [
  'reposts',
  'repostsCount',
  'repostCount',
  'retweets',
  'reposts_count',
] as const;
const SHARES_ALIASES = ['shares', 'shareCount', 'sharesCount', 'shares_count'] as const;

const RECOGNIZED = new Set<string>([
  ...AUTHOR_ALIASES,
  ...CONTENT_ALIASES,
  ...PERMALINK_ALIASES,
  ...PUBLISHED_ALIASES,
  ...PROFILE_ALIASES,
  ...LIKES_ALIASES,
  ...COMMENTS_ALIASES,
  ...REPOSTS_ALIASES,
  ...SHARES_ALIASES,
]);

/** metric 收斂：缺（絕無此欄）→ null（無 issue，S14）；present 但不可解析 → null + `unparseable:<name>` issue。 */
function mapMetric(
  record: Record<string, unknown>,
  aliases: readonly string[],
  name: string,
  reasons: string[],
): number | null {
  const raw = pickAlias(record, aliases);
  if (raw === undefined) {
    return null;
  }
  const count = normalizeCount(raw);
  if (count === null) {
    reasons.push(`unparseable:${name}`);
  }
  return count;
}

export function mapSocialPost(input: MapperInput): MapResult<SocialPostCanonical> {
  const raw = input.payload;
  if (!input.platform) {
    return failResult(raw, 'missing_platform');
  }
  const record = asRecord(raw);
  if (!record) {
    return failResult(raw, 'payload_not_object');
  }

  const reasons: string[] = [];
  const author = coerceString(pickAlias(record, AUTHOR_ALIASES));
  const profileLink = coerceString(pickAlias(record, PROFILE_ALIASES));
  const content = coerceString(pickAlias(record, CONTENT_ALIASES));
  const postKey = normalizePostKey(pickAlias(record, PERMALINK_ALIASES));

  const publishedRaw = pickAlias(record, PUBLISHED_ALIASES);
  const publishedAt = normalizeChineseDateTime(publishedRaw);
  if (publishedRaw !== undefined && publishedAt === null) {
    reasons.push('unparseable:publishedAt');
  }

  const likes = mapMetric(record, LIKES_ALIASES, 'likes', reasons);
  const comments = mapMetric(record, COMMENTS_ALIASES, 'comments', reasons);
  const reposts = mapMetric(record, REPOSTS_ALIASES, 'reposts', reasons);
  const shares = mapMetric(record, SHARES_ALIASES, 'shares', reasons);

  for (const field of collectUnknownFields(record, RECOGNIZED)) {
    reasons.push(`unknown_field:${field}`);
  }

  if (content === null || postKey === null) {
    const missing: string[] = [];
    if (content === null) {
      missing.push('missing:content');
    }
    if (postKey === null) {
      missing.push('missing:postKey');
    }
    return { mapStatus: 'failed', canonical: null, raw, reasons: [...missing, ...reasons] };
  }

  const canonical: SocialPostCanonical = {
    source: input.source,
    platform: input.platform,
    schemaVersion: input.schemaVersion,
    postKey,
    author,
    profileLink,
    content,
    publishedAt,
    likes,
    comments,
    reposts,
    shares,
    capturedAt: capturedAtToIso(input.capturedAt),
  };
  return { mapStatus: reasons.length === 0 ? 'ok' : 'partial', canonical, raw, reasons };
}
