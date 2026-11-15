// Danh mục kênh (Facebook, Instagram, TikTok, Zalo). Kênh nhận diện bằng CHỮ, không dùng màu riêng của kênh.
export const CHANNEL_IDS = ['facebook', 'instagram', 'tiktok', 'zalo'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  order: number;
}

export const CHANNELS: readonly ChannelMeta[] = [
  { id: 'facebook', label: 'Facebook', order: 1 },
  { id: 'instagram', label: 'Instagram', order: 2 },
  { id: 'tiktok', label: 'TikTok', order: 3 },
  { id: 'zalo', label: 'Zalo', order: 4 },
];

export function channelLabel(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id;
}
