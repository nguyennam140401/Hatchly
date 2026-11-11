// Giao diện công khai DUY NHẤT của module Tài khoản & Gói.
export { AccountModule } from './account.module';
export { ACCOUNT_PUBLIC_API, type AccountPublicApi } from './public-api';
// Lệnh vận hành nhân viên (src/ops/staff.ts – 004, contracts/auth-ops.md mục 2).
export {
  createStaffOps,
  StaffInputError,
  type StaffOps,
  type StaffSummaryRow,
} from './internal/auth/staff-ops';
