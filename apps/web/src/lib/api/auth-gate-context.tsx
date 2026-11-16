import { createContext, useContext } from 'react';
import type { AuthGate } from './auth-gate';

/** Cổng phiên của ứng dụng đang chạy (do `SessionGate` cung cấp) cho `ReauthDialog` ở khung ứng dụng. */
export const AuthGateContext = createContext<AuthGate | null>(null);

export function useAuthGate(): AuthGate | null {
  return useContext(AuthGateContext);
}
