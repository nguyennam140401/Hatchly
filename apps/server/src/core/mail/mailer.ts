// Giao diện gửi thư (004 R9, mở rộng ở 005 R14). Module Thông báo gửi qua hàng chờ `notify` bằng
// `deliver()` (phân loại kết quả); mã của 004 dùng `send()` như cũ (ném khi không gửi được).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Kết quả gửi: `transient` → thử lại an toàn; `permanent` → không thử lại (vd địa chỉ không tồn tại). */
export type MailDeliveryResult =
  | { kind: 'sent'; messageId: string }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string };

export interface Mailer {
  deliver(message: MailMessage): Promise<MailDeliveryResult>;
  /** Giữ cho 004: ném `MAIL_SEND_FAILED:<mã>` khi không `sent`. */
  send(message: MailMessage): Promise<void>;
}

/** `send()` dựng từ `deliver()` – hành vi của 004 giữ nguyên. */
export async function sendViaDeliver(mailer: Pick<Mailer, 'deliver'>, message: MailMessage): Promise<void> {
  const r = await mailer.deliver(message);
  if (r.kind !== 'sent') throw new Error(`MAIL_SEND_FAILED:${r.code}`);
}

/** Token NestJS của bộ gửi thư đang dùng (`smtp` hoặc `memory`). */
export const MAILER = Symbol('MAILER');
