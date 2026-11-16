// Vùng "Chi tiết cho hỗ trợ" (FR-028): mã lỗi gốc đã lọc + mã theo dõi để gửi cho hỗ trợ. KHÔNG có trạng thái nội bộ
// (`retry_wait`, `unknown` – người dùng thường không bao giờ thấy), KHÔNG có mã quyền hay nội dung bài.
export interface SupportAttemptDetails {
  attemptId: string;
  channelType: string;
  rawCode: string | null;
  errorCategoryLabel: string | null;
  traceId: string;
  runNo: number;
  updatedAt: string;
}
