import type { ReactNode } from 'react';
import { ErrorNotice } from '../lib/api/ErrorNotice';
import type { ApiQueryResult } from '../lib/api/hooks';
import { formatDate } from '../lib/format/datetime';
import { t } from '../lib/i18n/t';
import { EmptyState } from '../ui/feedback/EmptyState';
import { Skeleton, type SkeletonProps } from '../ui/feedback/Skeleton';
import { InlineAlert } from '../ui/alert/InlineAlert';

// Mô hình trạng thái hiển thị (Story 5): MỌI danh sách/màn dùng một cách thể hiện cho 5 tình huống – tải, trống, lỗi, khóa,
// một phần. Màn hình mới KHÔNG tự viết các nhánh này.

export interface LockedInfo {
  locked: boolean;
  reason?: string | undefined;
  reopensAt?: Date | undefined;
}

export interface PartialInfo {
  /** "Đã đăng: 3" … */
  done: string;
  /** "Cần bạn xử lý: 1" … */
  attention: string;
}

export interface AsyncBoundaryProps<T> {
  query: ApiQueryResult<T>;
  /** Dữ liệu coi là trống (mặc định: mảng rỗng). */
  isEmpty?: (data: T) => boolean;
  empty: { message: string; action?: ReactNode };
  /** Tính năng đang bị khóa (hết hạn mức…): giải thích + ngày mở lại, thay cho nội dung. */
  lockedBy?: LockedInfo;
  /** Kết quả một phần (một số kênh lỗi): hiện dòng tóm tắt phía trên nội dung. */
  partial?: (data: T) => PartialInfo | null;
  skeleton?: SkeletonProps;
  children: (data: T) => ReactNode;
}

function defaultEmpty(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}

export function AsyncBoundary<T>({
  query,
  isEmpty = defaultEmpty,
  empty,
  lockedBy,
  partial,
  skeleton,
  children,
}: AsyncBoundaryProps<T>) {
  // 1. khóa
  if (lockedBy?.locked === true) {
    return (
      <InlineAlert tone="warning" title={t('state.locked')}>
        {lockedBy.reason}
        {lockedBy.reopensAt !== undefined && ` ${t('state.reopensAt', { date: formatDate(lockedBy.reopensAt.toISOString()) })}`}
      </InlineAlert>
    );
  }
  // 2. đang tải lần đầu
  if (query.isPending) return <Skeleton {...skeleton} />;
  // 3. lỗi (chưa có dữ liệu để hiện)
  if (query.isError && query.data === undefined) {
    return (
      <ErrorNotice
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const data = query.data as T;
  // 4. trống
  if (isEmpty(data)) return <EmptyState message={empty.message} {...(empty.action !== undefined ? { action: empty.action } : {})} />;
  // 5. một phần (+ nội dung)
  const part = partial?.(data) ?? null;
  return (
    <div className="flex flex-col gap-4">
      {query.isError && (
        <ErrorNotice
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}
      {part !== null && (
        <InlineAlert tone="warning">
          {`${part.done} · ${part.attention}`}
        </InlineAlert>
      )}
      {children(data)}
      {query.isFetching && <span className="sr-only">{t('common.loading')}</span>}
    </div>
  );
}
