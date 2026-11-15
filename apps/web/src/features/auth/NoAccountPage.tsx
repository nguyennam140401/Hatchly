import type { MyInvitationsResponse } from '@app/shared/auth';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { authApi } from './auth-api';
import { TermsCheckbox } from './ConsentNotice';
import { socialApi } from './social-api';
import { ErrorNotice, styles } from './ui';

// Màn hình của người không còn thuộc tài khoản nào (009 – US4): nhận lời mời đang chờ, tự tạo tài
// khoản kinh doanh của riêng mình, quản lý cách đăng nhập, hoặc đăng xuất. Không chặn vô cớ – luôn có
// lối đi tiếp (nguyên tắc VI).

type Invitation = MyInvitationsResponse['invitations'][number];

function dateVi(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function NoAccountPage() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    socialApi.myInvitations().then(
      (r) => {
        setInvitations(r.invitations);
      },
      (err: unknown) => {
        setInvitations([]);
        if (err instanceof ApiError && err.code !== 'UNAUTHENTICATED') setError(err);
      },
    );
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      // Phiên mới đã được cấp – tải lại toàn bộ để cổng phiên đọc tài khoản mới.
      void navigate('/', { replace: true });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Bạn không còn là thành viên của tài khoản nào">
      <p>Bạn vẫn đăng nhập được. Hãy chọn một trong các cách dưới đây để tiếp tục dùng ứng dụng.</p>
      {error !== null && <ErrorNotice error={error} />}

      <section aria-labelledby="invites">
        <h2 id="invites" style={{ fontSize: 18 }}>
          Lời mời đang chờ
        </h2>
        {invitations === null && <p aria-busy="true">Đang tải…</p>}
        {invitations !== null && invitations.length === 0 && (
          <p>Chưa có lời mời nào gửi tới email của bạn.</p>
        )}
        {invitations !== null && invitations.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {invitations.map((inv) => (
              <li key={inv.id} style={{ borderTop: '1px solid #d1d5db', padding: '12px 0' }}>
                <p style={{ margin: '0 0 8px' }}>
                  <strong>{inv.inviterName}</strong> mời bạn tham gia {inv.accountLabel} (đến hết
                  ngày {dateVi(inv.expiresAt)}).
                </p>
                <button
                  type="button"
                  style={styles.primary}
                  disabled={busy}
                  onClick={() =>
                    void run(() => socialApi.acceptExistingInvitation({ invitationId: inv.id }))
                  }
                >
                  Tham gia {inv.accountLabel}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="claim" style={{ marginTop: 32 }}>
        <h2 id="claim" style={{ fontSize: 18 }}>
          Tạo tài khoản kinh doanh của riêng tôi
        </h2>
        <p>Bạn sẽ là chủ tài khoản mới và giữ nguyên cách đăng nhập hiện tại.</p>
        <TermsCheckbox checked={accepted} onChange={setAccepted} />
        <button
          type="button"
          style={{
            ...styles.secondary,
            ...(accepted ? {} : { opacity: 0.6, cursor: 'not-allowed' }),
          }}
          disabled={!accepted || busy}
          onClick={() => void run(() => socialApi.claimAccount())}
        >
          Tạo tài khoản kinh doanh của riêng tôi
        </button>
      </section>

      <p style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Link to="/settings/login-methods" style={styles.link}>
          Cách đăng nhập
        </Link>
        <button
          type="button"
          style={styles.secondary}
          onClick={() => {
            void authApi.logout().finally(() => void navigate('/login', { replace: true }));
          }}
        >
          Đăng xuất
        </button>
      </p>
    </AuthLayout>
  );
}
