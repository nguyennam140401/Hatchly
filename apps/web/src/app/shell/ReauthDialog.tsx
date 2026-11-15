import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { useGateSnapshot } from '../../lib/api/auth-gate';
import { useAuthGate } from '../../lib/api/auth-gate-context';
import { sessionApi } from '../../lib/api/endpoints/session';
import { AppError } from '../../lib/api/errors';
import { t } from '../../lib/i18n/t';
import { useSession } from '../../lib/session/context';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import { Modal } from '../../ui/alert/Modal';
import { Button } from '../../ui/button/Button';
import { Field } from '../../ui/field/Field';

// Hộp thoại đăng nhập lại TẠI CHỖ khi phiên hết hạn giữa chừng: màn hình và bản nháp phía sau còn nguyên.
// Chỉ dùng mật khẩu/thư của điểm cuối xác thực sẵn có; không đọc/giữ mã phiên, không localStorage.
// (Đăng nhập Google/Facebook qua cửa sổ phụ chưa làm trong 011 – xem ghi chú "việc còn mở" của tasks.md T040.)

const END_MESSAGES = {
  password_changed: 'session.password_changed',
  removed: 'session.removed',
  locked: 'session.locked',
  revoked: 'session.revoked',
} as const;

export function ReauthDialog() {
  const gate = useAuthGate();
  const snapshot = useGateSnapshot(gate);
  const navigate = useNavigate();
  const { me, refresh } = useSession();
  const [email, setEmail] = useState(me.user.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  if (gate === null) return null;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await sessionApi.login({ email, password });
      setPassword('');
      const outcome = gate.completeReauth(next);
      if (outcome === 'switched') {
        // Người/tài khoản khác: dữ liệu cũ đã dọn; tải lại phiên mới rồi về Tổng quan.
        await refresh();
        void navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof AppError ? err : null);
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    gate.reset();
    void navigate('/login', { replace: true });
  };

  // Phiên đã kết thúc hẳn (đổi mật khẩu ở nơi khác, bị gỡ/khóa…): chỉ còn đường về đăng nhập.
  if (snapshot.status === 'ended') {
    const reason = snapshot.reason;
    const key = reason !== undefined && reason in END_MESSAGES ? END_MESSAGES[reason as keyof typeof END_MESSAGES] : 'session.expired.body';
    return (
      <Modal open dismissible={false} title={t('session.expired.title')} description={t(key)}>
        <Button onClick={leave}>{t('session.signOut')}</Button>
      </Modal>
    );
  }

  return (
    <Modal
      open={snapshot.status === 'reauth_required'}
      dismissible={false}
      title={t('session.expired.title')}
      description={t('session.expired.body')}
    >
      <form
        noValidate
        onSubmit={(e) => {
          void submit(e);
        }}
        className="flex flex-col gap-4"
      >
        {error !== null && (
          <InlineAlert
            tone="error"
            actions={error.actions}
            support={{ traceId: error.support.traceId, code: error.code }}
          >
            {error.message}
          </InlineAlert>
        )}
        <Field label="Email" required>
          {(c) => (
            <input
              {...c}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Mật khẩu" required>
          {(c) => (
            <input
              {...c}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          )}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={leave}>
            {t('session.signOut')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('session.signIn')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
