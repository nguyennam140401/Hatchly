import type { MeResponse } from '@app/shared/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { authApi } from '../features/auth/auth-api';
import { SessionContext } from '../features/auth/session';
import { ErrorNotice, styles } from '../features/auth/ui';
import { ApiError, onAuthError } from '../lib/api-client';

// Cổng phiên (004, T040): gọi GET /auth/me khi vào vùng cần đăng nhập. 401 → /login?next=<đường dẫn
// hiện tại>; email chưa xác nhận → /verify-email. Lời gọi API sau đó gặp 401/EMAIL_NOT_VERIFIED cũng
// chuyển trang như vậy (onAuthError). Đây chỉ là trải nghiệm – API vẫn tự chặn mọi yêu cầu.

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; me: MeResponse }
  | { kind: 'login' }
  | { kind: 'verify' }
  | { kind: 'error'; error: ApiError };

/** 009: người ở tài khoản chờ chỉ vào được các trang này; mọi trang nghiệp vụ → /no-account. */
export const DETACHED_PATHS: readonly string[] = [
  '/no-account',
  '/settings/login-methods',
  '/settings/security',
];

export function loginPath(location: { pathname: string; search: string; hash: string }): string {
  const here = `${location.pathname}${location.search}${location.hash}`;
  return here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`;
}

export function SessionGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const me = await authApi.me({ silentAuth: true });
      setState(me.user.emailVerified ? { kind: 'ok', me } : { kind: 'verify' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') setState({ kind: 'login' });
      else if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED')
        setState({ kind: 'verify' });
      else if (err instanceof ApiError) setState({ kind: 'error', error: err });
      else throw err;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải phiên khi vào vùng cần đăng nhập
    void load();
  }, [load]);

  useEffect(
    () =>
      onAuthError((err) => {
        if (err.code === 'EMAIL_NOT_VERIFIED') void navigate('/verify-email');
        else void navigate(loginPath(window.location), { replace: true });
      }),
    [navigate],
  );

  const value = useMemo(
    () => (state.kind === 'ok' ? { me: state.me, refresh: load } : null),
    [state, load],
  );

  switch (state.kind) {
    case 'loading':
      return (
        <main style={styles.page} aria-busy="true">
          <p>Đang tải…</p>
        </main>
      );
    case 'login':
      return <Navigate to={loginPath(location)} replace />;
    case 'verify':
      return <Navigate to="/verify-email" replace />;
    case 'error':
      return (
        <main style={styles.page}>
          <ErrorNotice error={state.error}>
            <button type="button" style={styles.secondary} onClick={() => void load()}>
              Thử lại
            </button>
          </ErrorNotice>
        </main>
      );
    case 'ok':
      if (state.me.account.status === 'unclaimed' && !DETACHED_PATHS.includes(location.pathname)) {
        return <Navigate to="/no-account" replace />;
      }
      return (
        <SessionContext.Provider value={value}>
          <Outlet />
        </SessionContext.Provider>
      );
  }
}
