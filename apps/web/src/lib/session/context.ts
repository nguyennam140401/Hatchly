import type { MeResponse } from '@app/shared/auth';
import { createContext, useContext } from 'react';

// Phiên hiện tại trong web (đọc từ GET /auth/me). Web KHÔNG BAO GIỜ thấy mã phiên (cookie HttpOnly).
export interface SessionValue {
  me: MeResponse;
  /** Tải lại /auth/me (sau khi đổi email, đổi mật khẩu…). */
  refresh: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession() phải nằm trong <SessionProvider>');
  return value;
}
