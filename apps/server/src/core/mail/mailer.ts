// Giao diện gửi thư tối thiểu (004, R9). Module Thông báo dùng lại sau; khi có hàng chờ `notify` (003)
// thì việc gửi chuyển sang tạo việc trong cùng giao dịch.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Token NestJS của bộ gửi thư đang dùng (`smtp` hoặc `memory`). */
export const MAILER = Symbol('MAILER');
