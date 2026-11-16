import type { Permission } from '@app/shared/auth';
import type { ReactNode } from 'react';
import { useSession } from './context';

// Quyền là DỮ LIỆU do máy chủ trả (me.permissions): nơi duy nhất so sánh quyền/vai trò của web (FR-009).
// Ẩn/khóa theo quyền chỉ là tiện lợi – API vẫn tự chặn và giao diện xử lý 403.

export function useCan(permission: Permission): boolean {
  return useSession().me.permissions.includes(permission);
}

/** Vai trò CHỈ để hiển thị nhãn, không dùng để quyết định hiện/ẩn. */
export function useRole(): 'owner' | 'collaborator' {
  return useSession().me.role;
}

export interface CanState {
  locked: boolean;
  lockedReason?: string;
}

export interface CanProps {
  permission: Permission;
  /** `hide`: không render khi thiếu quyền. `locked`: render ở trạng thái khóa kèm lý do. */
  fallback?: 'hide' | 'locked';
  lockedReason?: string;
  children: ReactNode | ((state: CanState) => ReactNode);
}

export function Can({ permission, fallback = 'hide', lockedReason, children }: CanProps) {
  const allowed = useCan(permission);
  if (!allowed && fallback === 'hide') return null;
  if (typeof children === 'function') {
    return (
      <>
        {children(
          allowed ? { locked: false } : { locked: true, ...(lockedReason ? { lockedReason } : {}) },
        )}
      </>
    );
  }
  return allowed ? <>{children}</> : null;
}
