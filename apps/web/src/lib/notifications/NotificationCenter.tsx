import { useApiQuery } from '../api/hooks';
import { MUTATIONS, useMutationOf } from '../api/mutations';
import { queryKeys } from '../api/query-keys';
import { formatRelative } from '../format/datetime';
import { t } from '../i18n/t';
import { Button } from '../../ui/button/Button';
import { EmptyState } from '../../ui/feedback/EmptyState';
import { Skeleton } from '../../ui/feedback/Skeleton';
import { Icon } from '../../ui/icons/Icon';
import { cn } from '../../ui/util/cn';

// Khung trung tâm thông báo (FR-030): danh sách `notifications.list` (lớp `counter`); số chưa đọc nối vào `NavItem.badge`
// qua `useNavCounts`; đánh dấu đã đọc lạc quan. Điểm cuối do tính năng Thông báo cung cấp (nguồn được truyền vào).

export interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  /** ISO UTC. */
  createdAt: string;
  read: boolean;
}

export interface NotificationSource {
  list: () => Promise<NotificationItem[]>;
  markRead: (id: string) => Promise<unknown>;
}

export function NotificationCenter({ source }: { source: NotificationSource }) {
  const query = useApiQuery(queryKeys.notifications.list(), source.list, { freshness: 'counter' });
  const markRead = useMutationOf(
    MUTATIONS.markRead,
    (vars: unknown) => source.markRead(String(vars)),
    {
      apply: (client, vars) => {
        const previous = client.getQueryData<NotificationItem[]>(queryKeys.notifications.list());
        client.setQueryData<NotificationItem[]>(queryKeys.notifications.list(), (items) =>
          items?.map((n) => (n.id === vars ? { ...n, read: true } : n)),
        );
        return previous;
      },
      rollback: (client, _vars, previous) => {
        client.setQueryData(queryKeys.notifications.list(), previous);
      },
    },
  );

  if (query.isPending) return <Skeleton shape="list" count={3} />;
  if (query.isError) {
    return (
      <EmptyState
        message={query.error.message}
        icon="alert"
        action={<Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>}
      />
    );
  }
  if (query.data.length === 0) return <EmptyState message="Chưa có thông báo." icon="bell" />;

  return (
    <ul aria-label="Thông báo" className="flex flex-col gap-2">
      {query.data.map((n) => (
        <li
          key={n.id}
          className={cn(
            'flex items-start gap-3 rounded-lg border p-4',
            n.read ? 'border-line bg-surface-0' : 'border-brand bg-brand-soft',
          )}
        >
          <Icon name="bell" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className={cn('text-body', n.read ? 'text-ink' : 'font-bold text-ink')}>
              {!n.read && <span className="sr-only">Chưa đọc: </span>}
              {n.title}
            </p>
            {n.body !== undefined && <p className="text-body-sm text-ink-muted">{n.body}</p>}
            <p className="text-caption text-ink-muted">{formatRelative(n.createdAt)}</p>
          </div>
          {!n.read && (
            <Button
              variant="ghost"
              onClick={() => {
                markRead.mutate(n.id);
              }}
            >
              Đã đọc
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
