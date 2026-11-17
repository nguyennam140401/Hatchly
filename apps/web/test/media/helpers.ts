import type { MediaItem, Quota } from '@app/shared/media';

// Dữ liệu mẫu cho kiểm thử giao diện thư viện media (014). Mã là UUID v7 hợp lệ để qua lược đồ dùng chung.

export const uuid = (n: number): string => `0193e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export function mediaItem(n: number, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: uuid(n),
    kind: 'image',
    displayName: `anh-${String(n)}.jpg`,
    status: 'ready',
    originalBytes: 2 * 1024 * 1024,
    width: 1600,
    height: 1200,
    durationMs: null,
    createdAt: '2026-11-17T03:00:00.000Z',
    uploadedBy: { userId: uuid(900), displayName: 'Chủ tiệm hoa' },
    thumbUrl: `https://cdn.example.test/thumb-${String(n)}.jpg`,
    failure: null,
    canDelete: true,
    ...over,
  };
}

export function quota(usedGb: number, reservedGb = 0, limitGb = 5): Quota {
  const GB = 1024 ** 3;
  const used = Math.round(usedGb * GB);
  const reserved = Math.round(reservedGb * GB);
  const limit = limitGb * GB;
  const total = used + reserved;
  const percent = Math.min(100, Math.floor((total * 100) / limit));
  return {
    usedBytes: used,
    reservedBytes: reserved,
    limitBytes: limit,
    percent,
    state: total >= limit ? 'full' : percent >= 80 ? 'near_full' : 'ok',
  };
}

export const listOf = (
  items: MediaItem[],
  q: Quota = quota(1.2),
  nextCursor: string | null = null,
) => ({
  items,
  nextCursor,
  quota: q,
});

export const LIST = '/api/v1/media';
