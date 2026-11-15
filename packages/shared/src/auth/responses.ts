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
    /** `unclaimed` (009): tài khoản chờ của người không thuộc tài khoản nào – `permissions` rỗng. */
    status: z.enum(['active', 'suspended', 'expired', 'deleting', 'unclaimed']),
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

// ----- 009: đăng nhập Google/Facebook, cách đăng nhập, thành viên, lời mời -----

const ErrorActionSchema = z.object({
  kind: z.string(),
  label: z.string().min(1),
  href: z.string().optional(),
});

export const OAUTH_STAGES = [
  'signed_in',
  'needs_signup',
  'needs_email',
  'needs_link_confirm',
  'awaiting_email',
  'completed',
  'failed',
] as const;
export type OAuthStage = (typeof OAUTH_STAGES)[number];

/** Trạng thái lượt đăng nhập đọc bằng cookie `__Host-oauth`. Không có mã nhà cung cấp, `state`, `sub`. */
export const OAuthPendingResponse = z.object({
  provider: z.enum(['google', 'facebook']),
  purpose: z.enum(['login', 'link', 'reauth', 'invite']),
  stage: z.enum(OAUTH_STAGES),
  suggestedDisplayName: z.string().nullable(),
  /** Đầy đủ ở `needs_signup`/`needs_email`; che bớt ở `needs_link_confirm`. */
  suggestedEmail: z.string().nullable(),
  /** `needs_email`: người dùng phải nhập email. */
  emailRequired: z.boolean(),
  /** `needs_link_confirm`: `['password','email']` hoặc `['email']` (FR-011). */
  methods: z.array(z.enum(['password', 'email'])),
  hint: z.enum(['login_with_google', 'login_with_facebook']).nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), actions: z.array(ErrorActionSchema) })
    .nullable(),
});
export type OAuthPendingResponse = z.infer<typeof OAuthPendingResponse>;

/** `POST /auth/oauth/signup`: đã vào (hồ sơ phiên) hoặc "hãy kiểm tra email" (giai đoạn `needs_email`). */
export const OAuthSignupResponse = z.union([MeResponse, CheckEmailResponse]);
export type OAuthSignupResponse = z.infer<typeof OAuthSignupResponse>;

export const OAuthStartResponse = z.object({ authorizationUrl: z.string().min(1) });
export type OAuthStartResponse = z.infer<typeof OAuthStartResponse>;

export const LoginMethod = z.object({
  kind: z.enum(['password', 'google', 'facebook']),
  linked: z.boolean(),
  providerEmail: z.string().optional(),
  providerDisplayName: z.string().optional(),
  linkedAt: z.string().optional(),
});
export type LoginMethod = z.infer<typeof LoginMethod>;

/** Luôn đủ ba dòng (mật khẩu, Google, Facebook). */
export const LoginMethodsResponse = z.object({
  methods: z.array(LoginMethod),
  reauthFresh: z.boolean(),
});
export type LoginMethodsResponse = z.infer<typeof LoginMethodsResponse>;

export const InvitationView = z.object({
  id: z.string().min(1),
  email: z.string(),
  sentAt: z.string(),
  expiresAt: z.string(),
});
export type InvitationView = z.infer<typeof InvitationView>;

export const MembersResponse = z.object({
  owner: z.object({ userId: z.string(), displayName: z.string(), email: z.string() }),
  collaborators: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      email: z.string(),
      joinedAt: z.string(),
    }),
  ),
  invitations: z.array(InvitationView),
  seats: z.object({ used: z.number().int(), total: z.number().int() }),
});
export type MembersResponse = z.infer<typeof MembersResponse>;

/**
 * `new_user`: đặt tên + mật khẩu hoặc Google/Facebook · `login_required`: email đã có người dùng ở tài
 * khoản chờ – đăng nhập rồi mở lại liên kết · `in_use`: email đang thuộc tài khoản khác.
 */
export const InvitationPreviewResponse = z.object({
  accountLabel: z.string(),
  inviterName: z.string(),
  email: z.string(),
  expiresAt: z.string(),
  mode: z.enum(['new_user', 'login_required', 'in_use']),
});
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponse>;

export const MyInvitationsResponse = z.object({
  invitations: z.array(
    z.object({
      id: z.string().min(1),
      accountLabel: z.string(),
      inviterName: z.string(),
      expiresAt: z.string(),
    }),
  ),
});
export type MyInvitationsResponse = z.infer<typeof MyInvitationsResponse>;

/** Trang trạng thái công khai của yêu cầu xóa dữ liệu từ Meta – không có dữ liệu cá nhân. */
export const DataDeletionStatusResponse = z.object({
  status: z.enum(['completed', 'no_data']),
  receivedAt: z.string(),
});
export type DataDeletionStatusResponse = z.infer<typeof DataDeletionStatusResponse>;
