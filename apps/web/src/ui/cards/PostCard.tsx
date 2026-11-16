import type { ReactNode } from 'react';
import { formatDateTime } from '../../lib/format/datetime';
import { StatusBadge } from '../badge/StatusBadge';
import { Icon } from '../icons/Icon';
import { Tooltip } from '../tooltip/Tooltip';
import { cn } from '../util/cn';
import { ChannelTag } from './ChannelTag';

export interface PostCardData {
  id: string;
  title: string;
  excerpt: string;
  /** Trạng thái hiển thị (đã đổi bằng `toDisplayStatus`); lạ → "Đang cập nhật". */
  status: string;
  channels: string[];
  scheduledAt?: string;
}

export interface PostCardProps {
  post: PostCardData;
  onOpen?: (post: PostCardData) => void;
  actions?: ReactNode;
  className?: string;
}

export function PostCard({ post, onOpen, actions, className }: PostCardProps) {
  const title = <span className="block min-w-0 truncate text-heading text-ink">{post.title}</span>;
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-line bg-surface-0 p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Tooltip content={post.title}>
            {onOpen !== undefined ? (
              <button
                type="button"
                className="min-h-touch w-full min-w-0 text-left focus-visible:ring-2 focus-visible:ring-brand"
                onClick={() => {
                  onOpen(post);
                }}
              >
                {title}
              </button>
            ) : (
              <h3 className="min-w-0">{title}</h3>
            )}
          </Tooltip>
        </div>
        <StatusBadge status={post.status} size="sm" />
      </div>
      <p className="line-clamp-2 text-body-sm text-ink-muted">{post.excerpt}</p>
      <div className="flex flex-wrap items-center gap-2">
        {post.channels.map((channel) => (
          <ChannelTag key={channel} channel={channel} />
        ))}
        {post.scheduledAt !== undefined && (
          <span className="flex items-center gap-1 text-caption text-ink-muted">
            <Icon name="clock" className="size-4" />
            {formatDateTime(post.scheduledAt)}
          </span>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
