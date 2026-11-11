import { z } from 'zod';

// Lược đồ đầu vào của các điểm cuối xác thực (contracts/auth-http-api.md), dùng chung web ↔ API.
// Chính sách mật khẩu đầy đủ (NFKC, danh sách cấm, không trùng email) chạy ở máy chủ; ở đây chỉ kiểm
// độ dài cơ bản để web báo lỗi sớm.

/** Email: cắt khoảng trắng, cho phép tên miền quốc tế. Chuẩn hóa (NFC, chữ thường) ở máy chủ. */
export const EmailInput = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .pipe(z.email({ pattern: z.regexes.unicodeEmail }));

/** Mật khẩu mới: 8–128 ký tự (kiểm cơ bản). */
export const NewPasswordInput = z.string().min(8).max(128);

/** Mật khẩu đã có (đăng nhập, mật khẩu hiện tại): không áp chính sách, chỉ chặn chuỗi quá dài. */
export const ExistingPasswordInput = z.string().min(1).max(256);

/** Tên hiển thị: 1–80 ký tự sau khi cắt khoảng trắng. */
export const DisplayNameInput = z.string().trim().min(1).max(80);

/** Mã một lần trong liên kết (base64url của 32 byte = 43 ký tự). */
export const OneTimeTokenInput = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const registerInput = z.object({
  displayName: DisplayNameInput,
  email: EmailInput,
  password: NewPasswordInput,
  /** Ô đồng ý điều khoản – web KHÔNG đặt sẵn (nguyên tắc VII). */
  acceptTerms: z.literal(true),
  termsVersion: z.string().min(1).max(40),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  email: EmailInput,
  password: ExistingPasswordInput,
});
export type LoginInput = z.infer<typeof loginInput>;

export const verifyEmailInput = z.object({ token: OneTimeTokenInput });
export type VerifyEmailInput = z.infer<typeof verifyEmailInput>;

/** Đã đăng nhập (chưa xác minh) thì máy chủ dùng email của phiên và bỏ qua `email`. */
export const resendInput = z.object({ email: EmailInput.optional() });
export type ResendInput = z.infer<typeof resendInput>;

export const changeEmailInput = z.object({ email: EmailInput });
export type ChangeEmailInput = z.infer<typeof changeEmailInput>;

export const forgotPasswordInput = z.object({ email: EmailInput });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInput>;

export const resetPasswordInput = z.object({
  token: OneTimeTokenInput,
  newPassword: NewPasswordInput,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const changePasswordInput = z.object({
  currentPassword: ExistingPasswordInput,
  newPassword: NewPasswordInput,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export const staffLoginInput = loginInput;
export type StaffLoginInput = LoginInput;
