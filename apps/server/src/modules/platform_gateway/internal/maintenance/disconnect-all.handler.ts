import type { ConnectionsService } from '../connections/connections.service';

// Việc `disconnect_all` (010 T074, contracts/jobs-and-notifications.md 1.4): chạy trong ngữ cảnh tenant của phong bì. Với mỗi kết
// nối chưa ngắt: giải mã → ngắt + xóa bản mã (cùng giao dịch hủy lượt chưa gửi) → thu hồi phía nền tảng (≤ 5 giây, lỗi không chặn,
// song song ≤ 5) → kiểm toán `channel.disconnect` (`reason: account_deletion`). Gọi lại ⇒ không còn gì để làm (idempotent).
// Điểm nối cho luồng xóa tài khoản: xem docs/wiki (tính năng xóa tài khoản FR-14 chưa có).

export function createDisconnectAllHandler(service: Pick<ConnectionsService, 'disconnectAll'>) {
  return async (): Promise<{ disconnected: number }> => service.disconnectAll();
}
