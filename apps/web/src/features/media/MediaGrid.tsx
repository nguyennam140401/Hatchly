import type { MediaItem } from '@app/shared/media';
import { MediaCard } from './MediaCard';

/** Lưới ảnh/video: danh sách có tên truy cập, 2 cột ở 360 px, nhiều cột hơn khi rộng. */
export function MediaGrid({
  items,
  onOpen,
  onDelete,
}: {
  items: readonly MediaItem[];
  onOpen: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}) {
  return (
    <ul aria-label="Ảnh và video" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} onOpen={onOpen} onDelete={onDelete} />
      ))}
    </ul>
  );
}
