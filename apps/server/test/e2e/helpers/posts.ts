// Trợ giúp kiểm thử e2e của 012: kết nối kênh GIẢ LẬP bằng đường thật (OAuth giả → chọn Page → lưu), tạo
// bài qua API, giờ đăng hợp lệ. ApiAppModule THẬT trên CSDL kiểm thử (`pnpm test:db`).
import { expect } from 'vitest';
import type { Agent } from '../../auth/helpers/app';

const WEB = 'http://app.test';

export type ChannelKind = 'facebook_page' | 'instagram';

/** Kết nối một kênh giả lập; `nth` chọn ứng viên đủ điều kiện thứ n (để có nhiều kênh khác nhau). */
export async function connectChannel(
  owner: Agent,
  channelType: ChannelKind = 'facebook_page',
  nth = 0,
): Promise<string> {
  const start = await owner.post('/api/v1/channels/connect', { channelType });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(
    (start.body as { authorizeUrl: string }).authorizeUrl,
    WEB,
  ).searchParams.get('state');
  const cb = await owner.get(
    `/api/v1/channels/callback/${channelType}?state=${encodeURIComponent(state ?? '')}&code=fake_code_${nth}`,
  );
  expect(cb.status).toBe(302);
  const selectionId = new URL(cb.headers.location!).searchParams.get('selection');
  const sel = await owner.get(`/api/v1/channels/selections/${selectionId}`);
  const eligible = (
    sel.body as { candidates: { externalId: string; check: { kind: string } }[] }
  ).candidates.filter((c) => c.check.kind === 'eligible');
  const pick = eligible[nth];
  if (pick === undefined) throw new Error(`Không có ứng viên đủ điều kiện thứ ${nth}`);
  const saved = await owner.post('/api/v1/channels', { selectionId, externalId: pick.externalId });
  expect([200, 201]).toContain(saved.status);
  return (saved.body as { connectionId: string }).connectionId;
}

export const P = '/api/v1/posts';

export interface VariantBody {
  connectionId: string;
  customized?: boolean;
  text?: string;
  hashtags?: string[];
  media?: { mediaId: string; kind: 'image' | 'video' }[];
}

export function postBody(
  variants: VariantBody[],
  over: { sharedText?: string; internalName?: string | null; scheduledAt?: string | null } = {},
) {
  return {
    sharedText: over.sharedText ?? 'Khuyến mãi cuối tuần, giảm 20% toàn bộ áo dài.',
    ...(over.internalName !== undefined ? { internalName: over.internalName } : {}),
    ...(over.scheduledAt !== undefined ? { scheduledAt: over.scheduledAt } : {}),
    variants: variants.map((v) => ({
      connectionId: v.connectionId,
      customized: v.customized ?? false,
      text: v.text ?? '',
      hashtags: v.hashtags ?? [],
      media: v.media ?? [],
    })),
  };
}

/** Giờ đăng hợp lệ: `minutes` phút kể từ bây giờ (mặc định 2 giờ). */
export const inMinutes = (minutes = 120): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export interface PostBody {
  id: string;
  status: string;
  version: number;
  scheduledAt: string | null;
  labels: { returned: { note: string } | null; editedAfterApproval: boolean; timePassed: boolean };
  variants: { connectionId: string; issues: { rule: string }[] }[];
}

export async function createDraft(
  agent: Agent,
  variants: VariantBody[],
  over: Parameters<typeof postBody>[1] = {},
): Promise<PostBody> {
  const res = await agent.post(P, postBody(variants, over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as PostBody;
}
