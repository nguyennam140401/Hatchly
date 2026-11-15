import type { MeResponse } from '@app/shared/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ApiError, onAuthError } from '../lib/api-client';
import { createAuthGate, installAuthGate } from '../lib/api/auth-gate';
import { AuthGateContext } from '../lib/api/auth-gate-context';
import { setAuthGate } from '../lib/api/client';
import { sessionApi } from '../lib/api/endpoints/session';
import { AppError, toAppError } from '../lib/api/errors';
import { SessionProvider } from '../lib/session/SessionProvider';
import { InlineAlert } from '../ui/alert/InlineAlert';
import { Skeleton } from '../ui/feedback/Skeleton';

// Cổng phiên (004, T040; 011): gọi GET /auth/me khi MỞ ứng dụng. 401 lúc mở → /login?next=<đường dẫn hiện tại>;
// email chưa xác nhận → /verify-email. Từ đó về sau, 401 GIỮA CHỪNG KHÔNG chuyển trang: `AuthGate` mở hộp thoại đăng
// nhập lại tại chỗ, giữ nguyên màn hình và bản nháp (FR-011a). Đây chỉ là trải nghiệm – API vẫn tự chặn mọi yêu cầu.

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; me: MeResponse }
  | { kind: 'login' }
  | { kind: 'verify' }
  | { kind: 'error'; error: AppError };

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

  const gate = useMemo(
    () =>
      createAuthGate({
        onNoSession: () => {
          void navigate(loginPath(window.location), { replace: true });
        },
        onEmailNotVerified: () => {
          void navigate('/verify-email');
        },
      }),
    [navigate],
  );

  const load = useCallback(async () => {
    try {
      const me = await sessionApi.me();
      gate.setSession({ userId: me.user.id, accountId: me.account.id });
      setState(me.user.emailVerified ? { kind: 'ok', me } : { kind: 'verify' });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (err.code === 'UNAUTHENTICATED') setState({ kind: 'login' });
      else if (err.code === 'EMAIL_NOT_VERIFIED') setState({ kind: 'verify' });
      else setState({ kind: 'error', error: err });
    }
  }, [gate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tải phiên khi vào vùng cần đăng nhập
    void load();
  }, [load]);

  // Cài cổng cho lớp gọi API mới; lớp cũ (`apiRequest`, các trang 004/006/009 chưa chuyển) đi cùng một cổng.
  useEffect(() => {
    setAuthGate(gate);
    installAuthGate(gate);
    const off = onAuthError((err: ApiError) => {
      if (err.code === 'EMAIL_NOT_VERIFIED') gate.onEmailNotVerified(toAppError(err));
      else void gate.onUnauthenticated(toAppError(err));
    });
    return () => {
      off();
      setAuthGate(null);
      installAuthGate(null);
    };
  }, [gate]);

  switch (state.kind) {
    case 'loading':
      return (
        <main className="mx-auto max-w-phone p-gutter" aria-busy="true">
          <Skeleton shape="list" count={4} />
        </main>
      );
    case 'login':
      return <Navigate to={loginPath(location)} replace />;
    case 'verify':
      return <Navigate to="/verify-email" replace />;
    case 'error':
      return (
        <main className="mx-auto max-w-phone p-gutter">
          <InlineAlert
            tone="error"
            actions={state.error.actions}
            support={{ traceId: state.error.support.traceId, code: state.error.code }}
            onAction={() => {
              void load();
            }}
          >
            {state.error.message}
          </InlineAlert>
        </main>
      );
    case 'ok':
      if (state.me.account.status === 'unclaimed' && !DETACHED_PATHS.includes(location.pathname)) {
        return <Navigate to="/no-account" replace />;
      }
      return (
        <AuthGateContext.Provider value={gate}>
          <SessionProvider me={state.me} refresh={load}>
            <Outlet />
          </SessionProvider>
        </AuthGateContext.Provider>
      );
  }
}
