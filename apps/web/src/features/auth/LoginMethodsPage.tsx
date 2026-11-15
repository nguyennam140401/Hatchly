import type { LoginMethod, LoginMethodsResponse } from '@app/shared/auth';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { AuthLayout } from './AuthLayout';
import { PasswordField } from './PasswordField';
import { ProviderButtons } from './ProviderButtons';
import { browser, PROVIDER_LABELS, socialApi, type Provider } from './social-api';
import { ErrorNotice, InfoNotice, styles } from './ui';

// Cài đặt → Cách đăng nhập (009 – US5). Luôn ba dòng: mật khẩu, Google, Facebook. Liên kết, gỡ, tạo
// mật khẩu đòi "mới xác nhận lại đây là bạn" trong 10 phút: máy chủ trả REAUTH_REQUIRED → trang mở hộp
// xác nhận lại rồi TỰ làm lại thao tác đang dở. Dùng được cho chủ, cộng tác viên, người ở tài khoản chờ.

type Kind = LoginMethod['kind'];
const LABELS: Record<Kind, string> = {
  password: 'Mật khẩu',
  google: 'Google',
  facebook: 'Facebook',
};

type OAuthResult =
  | { ok: true; purpose: 'link' | 'reauth'; provider: Provider }
  | { ok: false; message: string | null };

/** Thao tác đang dở, làm lại sau khi xác nhận lại danh tính. */
interface Pending {
  label: string;
  run: () => Promise<void>;
}

export function LoginMethodsPage() {
  const location = useLocation();
  const [data, setData] = useState<LoginMethodsResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauthFor, setReauthFor] = useState<Pending | null>(null);
  const shown = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await socialApi.loginMethods());
    } catch (err) {
      if (err instanceof ApiError) setError(err);
      else throw err;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải danh sách khi mở trang
    void load();
    if (shown.current) return;
    shown.current = true;
    // Kết quả sau vòng nhà cung cấp (OAuthResultPage chuyển về đây kèm trạng thái điều hướng).
    const result = (location.state as { oauthResult?: OAuthResult } | null)?.oauthResult;
    if (result === undefined) return;
    if (result.ok) {
      setNotice(
        result.purpose === 'link'
          ? `Đã liên kết ${PROVIDER_LABELS[result.provider]}.`
          : 'Đã xác nhận đây là bạn. Bạn có thể tiếp tục thao tác.',
      );
    } else {
      setNotice(result.message ?? 'Chưa thực hiện được. Hãy thử lại.');
    }
  }, [load, location.state]);

  /** Chạy một thao tác; gặp REAUTH_REQUIRED thì mở hộp xác nhận lại và nhớ thao tác để làm lại. */
  async function attempt(action: Pending) {
    setError(null);
    setNotice(null);
    try {
      await action.run();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.code === 'REAUTH_REQUIRED') setReauthFor(action);
      else setError(err);
    }
  }

  const link = (provider: Provider): Pending => ({
    label: `liên kết ${PROVIDER_LABELS[provider]}`,
    run: async () => {
      const { authorizationUrl } = await socialApi.loginMethodStart(provider, 'link');
      browser.assign(authorizationUrl);
    },
  });
  const remove = (kind: Kind): Pending => ({
    label: `gỡ ${LABELS[kind]}`,
    run: async () => {
      await socialApi.removeLoginMethod(kind);
      setNotice(`Đã gỡ cách đăng nhập bằng ${LABELS[kind]}.`);
      await load();
    },
  });
  const createPassword: Pending = {
    label: 'tạo mật khẩu',
    run: async () => {
      await socialApi.requestPassword();
      setNotice('Chúng tôi đã gửi thư tạo mật khẩu tới email của bạn.');
    },
  };

  const linked = data?.methods.filter((m) => m.linked) ?? [];

  return (
    <AuthLayout title="Cách đăng nhập">
      <p>Bạn có thể đăng nhập bằng bất kỳ cách nào đã liên kết dưới đây.</p>
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
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {data.methods.map((method) => (
            <li
              key={method.kind}
              style={{ borderTop: '1px solid #d1d5db', padding: '12px 0' }}
              aria-label={LABELS[method.kind]}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>{LABELS[method.kind]}</p>
              {/* Trạng thái bằng chữ + biểu tượng – không chỉ dựa vào màu. */}
              <p style={{ margin: '4px 0 8px' }}>
                <span aria-hidden="true">{method.linked ? '✓ ' : '○ '}</span>
                {method.linked ? 'Đã liên kết' : 'Chưa liên kết'}
                {method.linked && method.kind !== 'password' && (
                  <>
                    {' · '}
                    {[method.providerDisplayName, method.providerEmail]
                      .filter((v) => v !== undefined)
                      .join(' – ')}
                  </>
                )}
              </p>
              {method.linked ? (
                <button
                  type="button"
                  style={styles.secondary}
                  onClick={() => void attempt(remove(method.kind))}
                >
                  Gỡ {LABELS[method.kind]}
                </button>
              ) : method.kind === 'password' ? (
                <button
                  type="button"
                  style={styles.secondary}
                  onClick={() => void attempt(createPassword)}
                >
                  Tạo mật khẩu
                </button>
              ) : (
                <button
                  type="button"
                  style={styles.secondary}
                  onClick={() => void attempt(link(method.kind as Provider))}
                >
                  Liên kết {LABELS[method.kind]}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {reauthFor !== null && (
        <ReauthDialog
          action={reauthFor}
          linked={linked.map((m) => m.kind)}
          onDone={() => {
            const action = reauthFor;
            setReauthFor(null);
            void attempt(action);
          }}
          onCancel={() => {
            setReauthFor(null);
          }}
        />
      )}

      <p style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Link to="/settings/security" style={styles.link}>
          Bảo mật
        </Link>
        <Link to="/" style={styles.link}>
          Về trang chính
        </Link>
      </p>
    </AuthLayout>
  );
}

/** Hộp "Hãy xác nhận lại đây là bạn": ô mật khẩu nếu có mật khẩu, nút nhà cung cấp đã liên kết. */
function ReauthDialog({
  action,
  linked,
  onDone,
  onCancel,
}: {
  action: Pending;
  linked: Kind[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const providers = linked.filter((k): k is Provider => k !== 'password');

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setFieldError(undefined);
    setError(null);
    try {
      await socialApi.reauth(password);
      onDone();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setPassword('');
      if (err.code === 'INVALID_CREDENTIALS') setFieldError(err.message);
      else setError(err);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="reauth-title"
      style={{ border: '1px solid #b45309', borderRadius: 8, padding: 12, marginTop: 16 }}
    >
      <h2 id="reauth-title" style={{ fontSize: 18, marginTop: 0 }}>
        Hãy xác nhận lại đây là bạn
      </h2>
      <p>Để {action.label}, bạn cần xác nhận lại danh tính. Sau đó thao tác sẽ tự tiếp tục.</p>
      {error !== null && <ErrorNotice error={error} />}
      {linked.includes('password') && (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <PasswordField
            label="Mật khẩu"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            error={fieldError}
          />
          <button type="submit" style={styles.primary} disabled={password === ''}>
            Xác nhận
          </button>
        </form>
      )}
      {providers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <ProviderButtons
            only={providers}
            label={(name) => `Xác nhận bằng ${name}`}
            start={(provider) => socialApi.loginMethodStart(provider, 'reauth')}
          />
        </div>
      )}
      <button type="button" style={{ ...styles.secondary, marginTop: 12 }} onClick={onCancel}>
        Hủy
      </button>
    </div>
  );
}
