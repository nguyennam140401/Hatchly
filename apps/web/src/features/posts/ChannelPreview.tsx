import type { ChannelType } from '@app/shared/content';

// Xem trước nội dung theo kênh (012 T035): THUẦN hiển thị theo `channelType` – đoạn văn, hashtag, số ảnh/video. Không gọi
// nền tảng, không dùng màu riêng của kênh (kênh nhận diện bằng CHỮ).

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  facebook_page: 'Facebook',
  instagram: 'Instagram',
  zalo_oa: 'Zalo OA',
  test_channel: 'Kênh thử',
};

export interface ChannelPreviewProps {
  channelType: ChannelType;
  displayName?: string | null;
  text: string;
  hashtags: readonly string[];
  mediaCount: number;
}

export function ChannelPreview({
  channelType,
  displayName,
  text,
  hashtags,
  mediaCount,
}: ChannelPreviewProps) {
  return (
    <section
      aria-label={`Xem trước ${CHANNEL_TYPE_LABELS[channelType]}`}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-0 p-4"
    >
      <p className="text-caption text-ink-muted">
        {CHANNEL_TYPE_LABELS[channelType]}
        {displayName !== undefined && displayName !== null ? ` · ${displayName}` : ''}
      </p>
      {mediaCount > 0 && <p className="text-label text-ink">{mediaCount} ảnh/video đính kèm</p>}
      <p className="whitespace-pre-wrap text-body text-ink">
        {text.trim() === '' ? 'Chưa có nội dung.' : text}
      </p>
      {hashtags.length > 0 && (
        <p className="text-body text-brand">{hashtags.map((h) => `#${h}`).join(' ')}</p>
      )}
    </section>
  );
}
