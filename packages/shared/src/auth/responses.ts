import { z } from 'zod';
import { PERMISSION_LIST, type Permission } from './permissions.js';

// Phản hồi của điểm cuối xác thực (contracts/auth-http-api.md). Không bao giờ chứa băm mật khẩu,
// mã phiên hay token_hash.

const PermissionSchema = z.enum(PERMISSION_LIST as [Permission, ...Permission[]]);

export const MeResponse = z.object({
  user: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
  }),
  account: z.object({
    id: z.string().min(1),
    status: z.enum(['active', 'suspended', 'expired', 'deleting']),
  }),
  role: z.enum(['owner', 'collaborator']),
  permissions: z.array(PermissionSchema),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const StaffMeResponse = z.object({
  staff: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    email: z.string(),
  }),
  role: z.enum(['support', 'admin']),
  permissions: z.array(PermissionSchema),
});
export type StaffMeResponse = z.infer<typeof StaffMeResponse>;

/** Phản hồi luôn như nhau của đăng ký, gửi lại thư, quên mật khẩu (chống dò email – FR-008b). */
export const CheckEmailResponse = z.object({ status: z.literal('check_email') });
export type CheckEmailResponse = z.infer<typeof CheckEmailResponse>;
