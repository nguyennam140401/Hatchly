// Bộ giới hạn theo kênh (`content.channel_rules`, bảng dùng chung): đọc qua tenantTx (mọi yêu cầu/việc
// của khách hàng đều có ngữ cảnh), cache TRONG TIẾN TRÌNH 5 phút như các cấu hình khác – giới hạn là cấu
// hình ít đổi, đổi bằng cập nhật dòng, không cần phát hành (FR-002). KHÔNG cache dữ liệu khách.
import { tenantTx, type Db } from '../../../core';
import type { ChannelRule } from '../public-api';
import { channelRules } from './db/schema';

const TTL_MS = 5 * 60_000;
let cache: { at: number; rules: ChannelRule[] } | null = null;

function toRule(row: typeof channelRules.$inferSelect): ChannelRule {
  return {
    channelType: row.channel_type as ChannelRule['channelType'],
    maxTextLength: row.max_text_length,
    maxHashtags: row.max_hashtags,
    mediaRequired: row.media_required,
    maxPostsPer24h: row.max_posts_per_24h,
  };
}

export async function loadChannelRules(tx?: Db): Promise<ChannelRule[]> {
  const now = Date.now();
  if (cache !== null && now - cache.at < TTL_MS) return cache.rules;
  const read = async (db: Db) => (await db.select().from(channelRules)).map(toRule);
  const rules = await (tx === undefined ? tenantTx(read) : read(tx));
  cache = { at: now, rules };
  return rules;
}

export async function ruleFor(channelType: string, tx?: Db): Promise<ChannelRule | undefined> {
  return (await loadChannelRules(tx)).find((r) => r.channelType === channelType);
}

/** Chỉ cho kiểm thử: xóa cache để thấy giới hạn vừa đổi. */
export function resetChannelRulesCache(): void {
  cache = null;
}
