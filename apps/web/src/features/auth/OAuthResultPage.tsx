import type { OAuthPendingResponse } from '@app/shared/auth';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { TermsCheckbox } from './ConsentNotice';
import { PasswordField } from './PasswordField';
import { ProviderButtons } from './ProviderButtons';
import { PROVIDER_LABELS, socialApi } from './social-api';
import { ErrorNotice, InfoNotice, styles, TextField } from './ui';

// Trang kết quả sau khi quay về từ Google/Facebook (009 – US1, US2, US5). Đường quay về của máy chủ
// luôn chuyển tới đây KHÔNG kèm tham số; trang đọc trạng thái lượt bằng `GET /auth/oauth/pending`
// (cookie `__Host-oauth`) rồi hiện đúng bước tiếp theo. Không có mã nào nằm trên thanh địa chỉ.

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; error: ApiError }
  | { kind: 'pending'; pending: OAuthPendingResponse }
  | { kind: 'check_email'; email: string | null };

const METHODS_PATH = '/settings/login-methods';

export function OAuthResultPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    socialApi.oauthPending().then(
      (pending) => {
        const { stage, purpose } = pending;
        if (purpose === 'link' || purpose === 'reauth') {
          // Quay lại trang Cách đăng nhập kèm kết quả (không có dữ liệu nhạy cảm trong trạng thái này).
          void navigate(METHODS_PATH, {
            replace: true,
            state: {
              oauthResult:
                stage === 'completed'
                  ? { ok: true, purpose, provider: pending.provider }
                  : { ok: false, message: pending.error?.message ?? null },
            },
          });
          return;
        }
        if (stage === 'signed_in' || stage === 'completed') {
          void navigate('/', { replace: true });
          return;
        }
        setState(
          stage === 'awaiting_email'
            ? { kind: 'check_email', email: null }
            : { kind: 'pending', pending },
        );
      },
      (err: unknown) => {
        if (err instanceof ApiError) setState({ kind: 'invalid', error: err });
      },
    );
  }, [navigate]);

  switch (state.kind) {
    case 'loading':
      return (
        <AuthLayout title="Đang đăng nhập">
          <p aria-busy="true">Đang tải…</p>
        </AuthLayout>
      );
    case 'invalid':
      return (
        <AuthLayout title="Chưa đăng nhập được">
          <ErrorNotice error={state.error}>
            <Link to="/login" style={styles.link}>
              Về đăng nhập
            </Link>
          </ErrorNotice>
        </AuthLayout>
      );
    case 'check_email':
      return <CheckEmail email={state.email} />;
    case 'pending': {
      const { pending } = state;
      const done = (email: string | null) => {
        setState({ kind: 'check_email', email });
      };
      if (pending.stage === 'failed') return <Failed pending={pending} />;
      if (pending.stage === 'needs_link_confirm') {
        return (
          <LinkConfirm
            pending={pending}
            onEmailSent={() => {
              done(null);
            }}
          />
        );
      }
      return <Signup pending={pending} onCheckEmail={done} />;
    }
  }
}

function Failed({ pending }: { pending: OAuthPendingResponse }) {
  const provider = PROVIDER_LABELS[pending.provider];
  return (
    <AuthLayout title="Chưa đăng nhập được">
      <div
        role="alert"
        style={{ border: '1px solid #b91c1c', borderRadius: 8, padding: 12, marginBottom: 16 }}
      >
        <p style={{ margin: 0 }}>
          <span role="img" aria-label="Lỗi">
            ⚠
          </span>{' '}
          {pending.error?.message ?? `Chưa đăng nhập được bằng ${provider}.`}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Mỗi lỗi có ít nhất một hành động: thử lại bằng chính nhà cung cấp đó, hoặc dùng email. */}
        <ProviderButtons only={[pending.provider]} label={(name) => `Thử lại với ${name}`} />
        <Link to="/login" style={styles.link}>
          Đăng nhập bằng email
        </Link>
      </div>
    </AuthLayout>
  );
}

function CheckEmail({ email }: { email: string | null }) {
  const [resent, setResent] = useState(false);
  return (
    <AuthLayout title="Hãy kiểm tra email">
      <InfoNotice>
        {email !== null ? (
          <>
            Chúng tôi đã gửi thư tới <strong>{email}</strong>.
          </>
        ) : (
          'Chúng tôi đã gửi thư cho bạn.'
        )}{' '}
        Mở thư và bấm liên kết để tiếp tục. Nếu chưa thấy, hãy xem cả mục Thư rác.
      </InfoNotice>
      {resent && <p role="status">Đã gửi lại thư.</p>}
      <button
        type="button"
        style={styles.secondary}
        onClick={() => {
          void socialApi.oauthLinkSendEmail().then(
            () => {
              setResent(true);
            },
            () => {
              setResent(true);
            },
          );
        }}
      >
        Gửi lại
      </button>
      <p>
        <Link to="/login" style={styles.link}>
          Về đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}

/** `needs_signup` (email do nhà cung cấp xác minh) và `needs_email` (tự nhập email). */
function Signup({
  pending,
  onCheckEmail,
}: {
  pending: OAuthPendingResponse;
  onCheckEmail: (email: string) => void;
}) {
  const navigate = useNavigate();
  const provider = PROVIDER_LABELS[pending.provider];
  const needsEmail = pending.emailRequired;
  const [displayName, setDisplayName] = useState(pending.suggestedDisplayName ?? '');
  const [email, setEmail] = useState(needsEmail ? (pending.suggestedEmail ?? '') : '');
  const [accepted, setAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (displayName.trim() === '') local.displayName = 'Vui lòng nhập tên hiển thị.';
    if (needsEmail && email.trim() === '') local.email = 'Vui lòng nhập email.';
    setFieldErrors(local);
    setError(null);
    if (Object.keys(local).length > 0 || !accepted) return;
    setBusy(true);
    try {
      const result = await socialApi.oauthSignup({
        displayName,
        ...(needsEmail ? { email } : {}),
      });
      if ('status' in result) onCheckEmail(email.trim());
      else void navigate('/', { replace: true });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setFieldErrors(err.fieldErrors());
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Tạo tài khoản">
      <p>
        {needsEmail
          ? `${provider} không cho chúng tôi biết email của bạn. Hãy nhập email để nhận liên kết hoàn tất đăng ký.`
          : `Bạn đang tạo tài khoản bằng ${provider} với email ${pending.suggestedEmail ?? ''}.`}
      </p>
      {error !== null && Object.keys(fieldErrors).length === 0 && <ErrorNotice error={error} />}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label="Tên hiển thị"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          error={fieldErrors.displayName}
        />
        {needsEmail && (
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            error={fieldErrors.email}
          />
        )}
        <TermsCheckbox checked={accepted} onChange={setAccepted} />
        {/* Khóa tới khi tích ô đồng ý – ô không bao giờ được đặt sẵn. */}
        <button
          type="submit"
          style={{
            ...styles.primary,
            ...(accepted ? {} : { opacity: 0.6, cursor: 'not-allowed' }),
          }}
          disabled={!accepted || busy}
        >
          {busy ? 'Đang tạo…' : needsEmail ? 'Gửi liên kết hoàn tất' : 'Tạo tài khoản'}
        </button>
        {!accepted && (
          <p style={{ fontSize: 14, color: '#4b5563' }}>Hãy tích ô đồng ý ở trên để tiếp tục.</p>
        )}
      </form>
      <p>
        <Link to="/login" style={styles.link}>
          Đã có tài khoản? Đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}

/** Email này đã có tài khoản: xác nhận bằng mật khẩu hoặc liên kết gửi qua email (US2). */
function LinkConfirm({
  pending,
  onEmailSent,
}: {
  pending: OAuthPendingResponse;
  onEmailSent: () => void;
}) {
  const navigate = useNavigate();
  const provider = PROVIDER_LABELS[pending.provider];
  const canUsePassword = pending.methods.includes('password');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const hint =
    pending.hint === 'login_with_google'
      ? 'Google'
      : pending.hint === 'login_with_facebook'
        ? 'Facebook'
        : null;

  async function confirmWithPassword(e: SyntheticEvent) {
    e.preventDefault();
    setPasswordError(undefined);
    setError(null);
    setBusy(true);
    try {
      await socialApi.oauthLinkPassword(password);
      void navigate('/', { replace: true });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setPassword('');
      // Sai mật khẩu: báo ngay cạnh ô nhập; lỗi khác (bị chặn, lượt hết hạn) hiện ở hộp lỗi.
      if (err.code === 'INVALID_CREDENTIALS') setPasswordError(err.message);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    setError(null);
    try {
      await socialApi.oauthLinkSendEmail();
      onEmailSent();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err);
    }
  }

  return (
    <AuthLayout title="Email này đã có tài khoản">
      <p>
        Email {pending.suggestedEmail ?? 'này'} đã có tài khoản. Hãy xác nhận đây là bạn để liên kết{' '}
        {provider} với tài khoản đó.
      </p>
      {error !== null && (
        <ErrorNotice error={error}>
          <Link to="/login" style={styles.link}>
            Về đăng nhập
          </Link>
        </ErrorNotice>
      )}
      {canUsePassword && (
        <form onSubmit={(e) => void confirmWithPassword(e)} noValidate>
          <PasswordField
            label="Mật khẩu của tài khoản"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            error={passwordError}
          />
          <button type="submit" style={styles.primary} disabled={busy || password === ''}>
            {busy ? 'Đang xác nhận…' : `Xác nhận và liên kết ${provider}`}
          </button>
          <p style={{ textAlign: 'center', color: '#4b5563' }}>hoặc</p>
        </form>
      )}
      <button type="button" style={styles.secondary} onClick={() => void sendEmail()}>
        Gửi liên kết qua email
      </button>
      {hint !== null && (
        <p style={{ color: '#4b5563' }}>
          Hoặc đăng nhập bằng {hint} rồi thêm {provider} trong Cài đặt → Cách đăng nhập.
        </p>
      )}
      <p>
        <Link to="/login" style={styles.link}>
          Về đăng nhập
        </Link>
      </p>
    </AuthLayout>
  );
}
