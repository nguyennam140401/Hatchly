import type { MyInvitationsResponse } from '@app/shared/auth';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { authApi, socialApi } from '../../lib/api/endpoints/auth';
import { AppError } from '../../lib/api/errors';
import { ErrorNotice } from '../../lib/api/ErrorNotice';
import { formatDate } from '../../lib/format/datetime';
import { isChecked, objectSchema } from '../../lib/forms/rules';
import { useAppForm } from '../../lib/forms/useAppForm';
import { Button } from '../../ui/button/Button';
import { Form } from '../../ui/form/Form';
import { TextLink } from '../../ui/nav/TextLink';
import { AuthLayout } from './AuthLayout';
import { TermsField } from './ConsentNotice';

// Màn hình của người không còn thuộc tài khoản nào (009 – US4): nhận lời mời đang chờ, tự tạo tài
// khoản kinh doanh của riêng mình, quản lý cách đăng nhập, hoặc đăng xuất. Không chặn vô cớ – luôn có
// lối đi tiếp (nguyên tắc VI).

type Invitation = MyInvitationsResponse['invitations'][number];

export interface ClaimValues extends Record<string, unknown> {
  acceptTerms: boolean;
}

export function NoAccountPage() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const claim = useAppForm<ClaimValues>({
    schema: objectSchema<ClaimValues>({
      acceptTerms: isChecked('Bạn cần đồng ý điều khoản để tạo tài khoản.'),
    }),
    defaultValues: { acceptTerms: false },
    onSubmit: async () => {
      await socialApi.claimAccount();
      // Phiên mới đã được cấp – cổng phiên đọc tài khoản mới.
      void navigate('/', { replace: true });
    },
  });
  const accepted = claim.methods.watch('acceptTerms');

  useEffect(() => {
    socialApi.myInvitations().then(
      (r) => {
        setInvitations(r.invitations);
      },
      (err: unknown) => {
        setInvitations([]);
        if (err instanceof AppError && err.code !== 'UNAUTHENTICATED') setError(err);
      },
    );
  }, []);

  async function join(invitationId: string) {
    setError(null);
    setJoining(invitationId);
    try {
      await socialApi.acceptExistingInvitation({ invitationId });
      void navigate('/', { replace: true });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      setError(err);
    } finally {
      setJoining(null);
    }
  }

  return (
    <AuthLayout title="Bạn không còn là thành viên của tài khoản nào">
      <p>Bạn vẫn đăng nhập được. Hãy chọn một trong các cách dưới đây để tiếp tục dùng ứng dụng.</p>
      {error !== null && <ErrorNotice error={error} />}

      <section aria-labelledby="invites" className="flex flex-col gap-3">
        <h2 id="invites" className="text-heading">
          Lời mời đang chờ
        </h2>
        {invitations === null && <p aria-busy="true">Đang tải…</p>}
        {invitations !== null && invitations.length === 0 && (
          <p>Chưa có lời mời nào gửi tới email của bạn.</p>
        )}
        {invitations !== null && invitations.length > 0 && (
          <ul className="flex flex-col gap-3">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 border-t border-line pt-3">
                <p>
                  <strong>{inv.inviterName}</strong> mời bạn tham gia {inv.accountLabel} (đến hết
                  ngày {formatDate(inv.expiresAt)}).
                </p>
                <div>
                  <Button loading={joining === inv.id} onClick={() => void join(inv.id)}>
                    Tham gia {inv.accountLabel}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Form
        form={claim}
        title="Tạo tài khoản kinh doanh của riêng tôi"
        submitLabel="Tạo tài khoản kinh doanh của riêng tôi"
        {...(!accepted ? { submitLocked: 'Hãy tích ô đồng ý ở trên để tiếp tục.' } : {})}
        errorActions={(e) => e.actions}
      >
        <p>Bạn sẽ là chủ tài khoản mới và giữ nguyên cách đăng nhập hiện tại.</p>
        <TermsField />
      </Form>

      <div className="flex flex-wrap items-center gap-4">
        <TextLink to="/settings/login-methods">Cách đăng nhập</TextLink>
        <Button
          variant="secondary"
          onClick={() => {
            void authApi.logout().finally(() => void navigate('/login', { replace: true }));
          }}
        >
          Đăng xuất
        </Button>
      </div>
    </AuthLayout>
  );
}
