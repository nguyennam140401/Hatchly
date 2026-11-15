import type { MeResponse } from '@app/shared/auth';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createQueryClient } from '../api/query-client';
import { queryKeys } from '../api/query-keys';
import { clearAllAccountData } from './clear-account-data';
import { SessionContext, type SessionValue } from './context';
import { listenSessionEvents } from './tab-sync';

export interface SessionProviderProps {
  me: MeResponse;
  /** Tải lại /auth/me (sau đổi email, đổi mật khẩu…). */
  refresh: () => Promise<void>;
  /** Tab khác đăng xuất/đổi tài khoản: mặc định về /login. */
  onRemoteEnd?: () => void;
  children: ReactNode;
}

/** Cấp phiên + một QueryClient RIÊNG của phiên này (không dùng chung giữa các tài khoản). */
export function SessionProvider({ me, refresh, onRemoteEnd, children }: SessionProviderProps) {
  const [client] = useState(createQueryClient);

  useEffect(() => {
    client.setQueryData(queryKeys.session.me(), me);
  }, [client, me]);

  useEffect(
    () =>
      listenSessionEvents(() => {
        clearAllAccountData(client);
        if (onRemoteEnd !== undefined) onRemoteEnd();
        else window.location.assign('/login');
      }),
    [client, onRemoteEnd],
  );

  const value = useMemo<SessionValue>(() => ({ me, refresh }), [me, refresh]);
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  );
}
