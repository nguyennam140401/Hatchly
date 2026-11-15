import type { MembersResponse } from '@app/shared/auth';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from '../auth/AuthLayout';
import { useSession } from '../auth/session';
import { ErrorNotice, InfoNotice, styles, TextField } from '../auth/ui';
import { membersApi } from './members-api';

// Cài đặt → Thành viên (009 – US3, US4). Chỉ chủ tài khoản (`members.manage`); API vẫn tự chặn. Tối đa
// 2 cộng tác viên, tính cả lời mời đang chờ. Trạng thái bằng chữ + biểu tượng.

type Collaborator = MembersResponse['collaborators'][number];

function dateVi(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function MembersPage() {
  const { me } = useSession();
  const allowed = me.permissions.includes('members.manage');
  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [confirmRemove, setConfirmRemove] = useState<Collaborator | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await membersApi.list());
    } catch (err) {
      if (err instanceof ApiError) setError(err);
      else throw err;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải danh sách khi mở trang
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) {
    return (
      <AuthLayout title="Thành viên">
        <p role="alert">
          <span role="img" aria-label="Cảnh báo">
            ⚠
          </span>{' '}
          Chỉ chủ tài khoản mới mời hoặc gỡ được cộng tác viên.
        </p>
        <Link to="/" style={styles.link}>
          Về trang chính
        </Link>
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
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: SyntheticEvent) {
    e.preventDefault();
    setEmailError(undefined);
    if (email.trim() === '') {
      setEmailError('Vui lòng nhập email của người bạn muốn mời.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await membersApi.invite(email);
      setNotice(`Đã gửi lời mời tới ${email.trim()}.`);
      setEmail('');
      await load();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const fields = err.fieldErrors();
      if (fields.email !== undefined || err.code === 'INVITE_SELF') {
        setEmailError(fields.email ?? err.message);
      } else setError(err);
    } finally {
      setBusy(false);
    }
  }

  const free = data === null ? 0 : data.seats.total - data.seats.used;

  return (
    <AuthLayout title="Thành viên">
      {notice !== null && <InfoNotice>{notice}</InfoNotice>}
      {error !== null && (
        <ErrorNotice error={error}>
          <button type="button" style={styles.secondary} onClick={() => void load()}>
            Tải lại
          </button>
        </ErrorNotice>
      )}
      {data === null && error === null && <p aria-busy="true">Đang tải…</p>}

      {data !== null && (
        <>
          <p>
            Còn {free}/{data.seats.total} chỗ cho cộng tác viên.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li style={{ borderTop: '1px solid #d1d5db', padding: '12px 0' }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{data.owner.displayName}</p>
              <p style={{ margin: '4px 0 0' }}>
                <span aria-hidden="true">★ </span>Chủ tài khoản · {data.owner.email}
              </p>
            </li>
            {data.collaborators.map((c) => (
              <li key={c.userId} style={{ borderTop: '1px solid #d1d5db', padding: '12px 0' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{c.displayName}</p>
                <p style={{ margin: '4px 0 8px' }}>
                  <span aria-hidden="true">✓ </span>Cộng tác viên · {c.email} · tham gia{' '}
                  {dateVi(c.joinedAt)}
                </p>
                <button
                  type="button"
                  style={styles.secondary}
                  onClick={() => {
                    setConfirmRemove(c);
                  }}
                >
                  Gỡ {c.displayName}
                </button>
              </li>
            ))}
            {data.invitations.map((inv) => (
              <li key={inv.id} style={{ borderTop: '1px solid #d1d5db', padding: '12px 0' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{inv.email}</p>
                <p style={{ margin: '4px 0 8px' }}>
                  <span aria-hidden="true">⏳ </span>Đang chờ · hết hạn {dateVi(inv.expiresAt)}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    style={styles.secondary}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => membersApi.resend(inv.id),
                        `Đã gửi lại lời mời tới ${inv.email}.`,
                      )
                    }
                  >
                    Gửi lại
                  </button>
                  <button
                    type="button"
                    style={styles.secondary}
                    disabled={busy}
                    onClick={() =>
                      void act(() => membersApi.cancel(inv.id), `Đã hủy lời mời tới ${inv.email}.`)
                    }
                  >
                    Hủy lời mời
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {confirmRemove !== null && (
            <div
              role="alertdialog"
              aria-modal="false"
              aria-labelledby="remove-title"
              style={{ border: '1px solid #b45309', borderRadius: 8, padding: 12, marginTop: 16 }}
            >
              <p id="remove-title" style={{ marginTop: 0 }}>
                Gỡ {confirmRemove.displayName}? {confirmRemove.displayName} sẽ không vào được tài
                khoản này nữa. Bài và media họ đã tạo vẫn được giữ lại.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  style={styles.primary}
                  disabled={busy}
                  onClick={() => {
                    const target = confirmRemove;
                    setConfirmRemove(null);
                    void act(
                      () => membersApi.remove(target.userId),
                      `Đã gỡ ${target.displayName} khỏi tài khoản.`,
                    );
                  }}
                >
                  Gỡ khỏi tài khoản
                </button>
                <button
                  type="button"
                  style={styles.secondary}
                  onClick={() => {
                    setConfirmRemove(null);
                  }}
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          <section aria-labelledby="invite-title" style={{ marginTop: 32 }}>
            <h2 id="invite-title" style={{ fontSize: 18 }}>
              Mời cộng tác viên
            </h2>
            <form onSubmit={(e) => void invite(e)} noValidate>
              <TextField
                label="Email của người được mời"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="off"
                error={emailError}
              />
              <button
                type="submit"
                style={{
                  ...styles.primary,
                  ...(free > 0 ? {} : { opacity: 0.6, cursor: 'not-allowed' }),
                }}
                disabled={free <= 0 || busy}
              >
                Mời
              </button>
              {free <= 0 && (
                <p style={{ fontSize: 14, color: '#4b5563' }}>
                  Đã đủ 2 cộng tác viên. Gỡ một người hoặc hủy một lời mời để mời người khác.
                </p>
              )}
            </form>
          </section>
        </>
      )}

      <p style={{ marginTop: 32 }}>
        <Link to="/" style={styles.link}>
          Về trang chính
        </Link>
      </p>
    </AuthLayout>
  );
}
