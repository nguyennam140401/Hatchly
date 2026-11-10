import type { AuthConfig, StaffRole } from '../../../../core';
import { SessionCache } from '../../../../core/auth/session-cache';
import { PasswordHasher } from './password/password-hasher';
import { StaffInputError, StaffService } from './staff.service';
import { ThrottleService } from './throttle.service';

// Thao tác nhân viên cho lệnh vận hành `pnpm staff …` (004, contracts/auth-ops.md mục 2) – chạy ngoài
// NestJS, chỉ cần bể `app` đã khởi tạo (setActiveDatabase). Kiểm toán ghi actor `system`/`ops-cli`.

export { StaffInputError };

export interface StaffSummaryRow {
  email: string;
  displayName: string;
  role: StaffRole;
  status: 'active' | 'disabled';
}

export interface StaffOps {
  create(input: {
    email: string;
    displayName: string;
    role: StaffRole;
    password: string;
  }): Promise<{ id: string }>;
  disable(email: string): Promise<void>;
  resetPassword(email: string, password: string): Promise<void>;
  list(): Promise<StaffSummaryRow[]>;
}

export function createStaffOps(config: AuthConfig): StaffOps {
  const service = new StaffService(
    config,
    new SessionCache(),
    new PasswordHasher({ memoryCost: config.argon2MemoryKib, timeCost: config.argon2TimeCost }),
    new ThrottleService(config),
  );
  return {
    create: async (input) => ({ id: (await service.create(input)).id }),
    disable: (email) => service.disable(email),
    resetPassword: (email, password) => service.resetPassword(email, password),
    list: async () =>
      (await service.list()).map((s) => ({
        email: s.email,
        displayName: s.displayName,
        role: s.role,
        status: s.status,
      })),
  };
}
