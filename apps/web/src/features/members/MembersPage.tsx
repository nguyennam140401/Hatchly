import type { MembersResponse } from '@app/shared/auth';
import { useCallback, useEffect, useState } from 'react';
import { membersApi } from '../../lib/api/endpoints/members';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { formatDate } from '../../lib/format/datetime';
import { useSession } from '../../lib/session/context';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Button } from '../../ui/button/Button';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from '../auth/AuthLayout';
import { InviteForm, type InviteValues } from './InviteForm';

// Cài đặt → Thành viên (009 – US3, US4). Chỉ chủ tài khoản (`members.manage`); API vẫn tự chặn. Tối đa
// 2 cộng tác viên, tính cả lời mời đang chờ. Trạng thái bằng chữ + biểu tượng.

type Collaborator = MembersResponse['collaborators'][number];

export function MembersPage() {
  const { me } = useSession();
  const allowed = me.permissions.includes('members.manage');
  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Collaborator | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await membersApi.list());
    } catch (err) {
      if (err instanceof AppError) setError(err);
      else throw err;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải danh sách khi mở trang
    if (allowed) void load();
  }, [allowed, load]);

  const free = data === null ? 0 : data.seats.total - data.seats.used;

  const inviteOnSubmit = async (values: InviteValues) => {
    setError(null);
    setNotice(null);
    try {
      await membersApi.invite(values.email);
    } catch (err) {
      // Mời chính mình: báo cạnh ô email như lỗi theo ô.
      if (err instanceof AppError && err.code === 'INVITE_SELF') {
        throw new AppError({
          kind: 'validation',
          status: err.status,
          code: err.code,
          message: err.message,
          actions: err.actions,
          fieldErrors: { email: err.message },
          support: err.support,
        });
      }
      throw err;
    }
    setNotice(`Đã gửi lời mời tới ${values.email.trim()}.`);
    await load();
  };

  if (!allowed) {
    return (
      <AuthLayout title="Thành viên">
        <InlineAlert
          tone="error"
          actions={[{ kind: 'navigate', label: 'Về trang chính', href: '/' }]}
        >
          Chỉ chủ tài khoản mới mời hoặc gỡ được cộng tác viên.
        </InlineAlert>
      </AuthLayout>
    );
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
      setNotice(done);
      await load();
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Thành viên">
      {notice !== null && <InlineAlert tone="info">{notice}</InlineAlert>}
      {error !== null && (
        <ErrorNotice
          error={error}
          actions={[{ kind: 'retry', label: 'Tải lại' }]}
          onRetry={() => {
            void load();
          }}
        />
      )}
      {data === null && error === null && <p aria-busy="true">Đang tải…</p>}

      {data !== null && (
        <>
          <p>
            Còn {free}/{data.seats.total} chỗ cho cộng tác viên.
          </p>
          <ul className="flex flex-col">
            <li className="flex flex-col gap-1 border-t border-line py-3">
              <p className="text-label">{data.owner.displayName}</p>
              <p>
                <span aria-hidden="true">★ </span>Chủ tài khoản · {data.owner.email}
              </p>
            </li>
            {data.collaborators.map((c) => (
              <li key={c.userId} className="flex flex-col gap-2 border-t border-line py-3">
                <p className="text-label">{c.displayName}</p>
                <p>
                  <span aria-hidden="true">✓ </span>Cộng tác viên · {c.email} · tham gia{' '}
                  {formatDate(c.joinedAt)}
                </p>
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setConfirmRemove(c);
                    }}
                  >
                    Gỡ {c.displayName}
                  </Button>
                </div>
              </li>
            ))}
            {data.invitations.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 border-t border-line py-3">
                <p className="text-label">{inv.email}</p>
                <p>
                  <span aria-hidden="true">⏳ </span>Đang chờ · hết hạn {formatDate(inv.expiresAt)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={busy}
                    onClick={() =>
                      void act(
                        () => membersApi.resend(inv.id),
                        `Đã gửi lại lời mời tới ${inv.email}.`,
                      )
                    }
                  >
                    Gửi lại
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busy}
                    onClick={() =>
                      void act(() => membersApi.cancel(inv.id), `Đã hủy lời mời tới ${inv.email}.`)
                    }
                  >
                    Hủy lời mời
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <ConfirmDialog
            open={confirmRemove !== null}
            role="alertdialog"
            onOpenChange={(open) => {
              if (!open) setConfirmRemove(null);
            }}
            tone="danger"
            title={`Gỡ ${confirmRemove?.displayName ?? ''}?`}
            body={`${confirmRemove?.displayName ?? ''} sẽ không vào được tài khoản này nữa. Bài và media họ đã tạo vẫn được giữ lại.`}
            confirmLabel="Gỡ khỏi tài khoản"
            cancelLabel="Hủy"
            loading={busy}
            onConfirm={() => {
              const target = confirmRemove;
              setConfirmRemove(null);
              if (target === null) return;
              void act(
                () => membersApi.remove(target.userId),
                `Đã gỡ ${target.displayName} khỏi tài khoản.`,
              );
            }}
          />

          <InviteForm
            onSubmit={inviteOnSubmit}
            {...(free <= 0
              ? {
                  lockedReason:
                    'Đã đủ 2 cộng tác viên. Gỡ một người hoặc hủy một lời mời để mời người khác.',
                }
              : {})}
          />
        </>
      )}

      <TextLink to="/">Về trang chính</TextLink>
    </AuthLayout>
  );
}
