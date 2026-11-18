// Giao diện công khai DUY NHẤT của module Tài khoản & Gói.
export { AccountModule } from './account.module';
export {
  ACCOUNT_PUBLIC_API,
  type AccountPublicApi,
  type ActiveMember,
  type PublishingEligibility,
} from './public-api';
// Lệnh vận hành nhân viên (src/ops/staff.ts – 004, contracts/auth-ops.md mục 2).
export {
  createStaffOps,
  StaffInputError,
  type StaffOps,
  type StaffSummaryRow,
} from './internal/auth/staff-ops';
// 009: trang ủy quyền giả của Google/Facebook – tầng ghép CHỈ đăng ký khi OAUTH_DRIVER=fake.
export { FakeAuthorizeController } from './internal/auth/oauth/fake-authorize.controller';
