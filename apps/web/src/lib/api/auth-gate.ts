import type { MeResponse } from '@app/shared/auth';
import type { SessionEndReason } from '@app/shared/core';
import { useSyncExternalStore } from 'react';
import { broadcastSessionEvent } from '../session/tab-sync';
import { clearAllAccountData } from '../session/clear-account-data';
import type { AuthGateHook } from './client';
import type { AppError } from './errors';

// Máy trạng thái xử lý phiên hết hạn GIỮA CHỪNG (contracts/app-shell-and-session.md mục 4, FR-011a):
//
//   idle ─401─► reauth_required ──đăng nhập lại cùng người──► resumed ─► idle
//                      │                    └─ khác người ──► switched
//                      └─ reason ∈ {password_changed, removed, locked, revoked} ─► ended
//
// Mọi lời gọi 401 cùng lúc gộp vào MỘT promise (một hộp thoại). Phát lại chỉ làm ở `client.ts` (GET / safeToReplay,
// mỗi lời gọi một lần). Mã phiên không bao giờ đi qua đây (cookie HttpOnly).

export type GateStatus = 'idle' | 'reauth_required' | 'switched' | 'ended';
export type GateOutcome = 'resumed' | 'switched' | 'ended';

export interface GateSnapshot {
  status: GateStatus;
  /** Lý do khi `ended`. */
  reason?: SessionEndReason | undefined;
}

export interface SessionIdentity {
  userId: string;
  accountId: string;
}

/** Lý do làm phiên KẾT THÚC hẳn – không có "tiếp tục". `expired`/thiếu lý do = có thể đăng nhập lại tại chỗ. */
const TERMINAL_REASONS: readonly SessionEndReason[] = [
  'password_changed',
  'removed',
  'locked',
  'revoked',
];

export interface AuthGateOptions {
  /** Lần đầu chưa có phiên nào được tải: chuyển /login?next=… (không có gì để giữ). */
  onNoSession: () => void;
  /** `EMAIL_NOT_VERIFIED`: giữ hành vi cũ – chuyển /verify-email. */
  onEmailNotVerified: () => void;
}

export interface AuthGate extends AuthGateHook {
  getSnapshot: () => GateSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Gọi khi `/auth/me` tải xong (hoặc đổi) – danh tính hiện tại của phiên. */
  setSession: (identity: SessionIdentity | null) => void;
  /** Hộp thoại đăng nhập lại thành công với `MeResponse` mới. */
  completeReauth: (me: MeResponse) => GateOutcome;
  /** Người dùng đóng hộp thoại / chọn về trang đăng nhập. */
  cancelReauth: () => void;
  /** Về trạng thái ban đầu (sau khi đã chuyển trang). */
  reset: () => void;
}

export function createAuthGate(options: AuthGateOptions): AuthGate {
  let snapshot: GateSnapshot = { status: 'idle' };
  let identity: SessionIdentity | null = null;
  let pending: { promise: Promise<GateOutcome>; resolve: (o: GateOutcome) => void } | null = null;
  const listeners = new Set<() => void>();

  const set = (next: GateSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const settle = (outcome: GateOutcome) => {
    pending?.resolve(outcome);
    pending = null;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSession: (next) => {
      identity = next;
    },

    onUnauthenticated: (error: AppError) => {
      if (identity === null) {
        options.onNoSession();
        return Promise.resolve('ended');
      }
      if (error.reason !== undefined && TERMINAL_REASONS.includes(error.reason)) {
        set({ status: 'ended', reason: error.reason });
        settle('ended');
        return Promise.resolve('ended');
      }
      // Gộp: mọi lời gọi thất bại cùng lúc dùng chung một lần đăng nhập lại.
      if (pending !== null) return pending.promise;
      let resolve!: (o: GateOutcome) => void;
      const promise = new Promise<GateOutcome>((r) => {
        resolve = r;
      });
      pending = { promise, resolve };
      set({ status: 'reauth_required' });
      return promise;
    },

    onEmailNotVerified: () => {
      options.onEmailNotVerified();
    },

    completeReauth: (me) => {
      const same =
        identity !== null && identity.userId === me.user.id && identity.accountId === me.account.id;
      if (same) {
        set({ status: 'idle' });
        settle('resumed');
        return 'resumed';
      }
      // Người/tài khoản khác: dọn sạch, KHÔNG hiển thị gì của tài khoản mới ở màn cũ.
      clearAllAccountData();
      broadcastSessionEvent('switched');
      identity = null;
      set({ status: 'switched' });
      settle('switched');
      return 'switched';
    },

    cancelReauth: () => {
      set({ status: 'ended', reason: undefined });
      settle('ended');
    },

    reset: () => {
      pending = null;
      set({ status: 'idle' });
    },
  };
}

/** Cổng dùng chung của ứng dụng; test tạo cổng riêng bằng `createAuthGate`. */
let current: AuthGate | null = null;

export function installAuthGate(gate: AuthGate | null): void {
  current = gate;
}

export function getAuthGate(): AuthGate | null {
  return current;
}

const IDLE: GateSnapshot = { status: 'idle' };

/** Đọc trạng thái cổng trong React (idle nếu chưa cài). */
export function useGateSnapshot(gate: AuthGate | null): GateSnapshot {
  return useSyncExternalStore(
    (listener) => (gate !== null ? gate.subscribe(listener) : () => undefined),
    () => (gate !== null ? gate.getSnapshot() : IDLE),
    () => IDLE,
  );
}
