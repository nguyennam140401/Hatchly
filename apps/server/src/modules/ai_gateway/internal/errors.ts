// Lỗi của Cổng AI (005, data-model.md mục 2). Thông điệp tiếng Việt đời thường, KHÔNG có số tiền.

export type AiErrorCode =
  | 'AI_BUDGET_EXHAUSTED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_INVALID_REQUEST'
  | 'AI_SYSTEM_BUDGET_EXHAUSTED'
  | 'AI_DUPLICATE_REQUEST'
  | 'AI_NOT_CONFIGURED';

/** Trạng thái của yêu cầu trùng (`AI_DUPLICATE_REQUEST`). */
export type AiDuplicateStatus = 'settled' | 'in_progress';

const MESSAGES: Record<AiErrorCode, { messageVi: string; retryable: boolean }> = {
  AI_DUPLICATE_REQUEST: {
    messageVi:
      'Yêu cầu này đã được xử lý hoặc đang xử lý. Hãy đợi ít phút rồi tải lại trang để xem kết quả, đừng bấm lại nhiều lần.',
    retryable: false,
  },
  AI_NOT_CONFIGURED: {
    messageVi:
      'Tính năng AI tạm thời chưa sẵn sàng. Bạn vẫn có thể soạn tay, hoặc thử lại sau ít phút.',
    retryable: false,
  },
  AI_BUDGET_EXHAUSTED: {
    messageVi:
      'Đã dùng hết giới hạn AI của chu kỳ này. Bạn vẫn có thể tự soạn, duyệt, lên lịch và đăng bài; AI dùng lại được từ chu kỳ mới hoặc liên hệ hỗ trợ để nâng gói.',
    retryable: false,
  },
  AI_PROVIDER_UNAVAILABLE: {
    messageVi: 'AI đang bận hoặc tạm gián đoạn. Hãy thử lại sau ít phút hoặc tự soạn bài.',
    retryable: true,
  },
  AI_INVALID_REQUEST: {
    messageVi:
      'Yêu cầu chưa hợp lệ. Hãy kiểm tra lại nội dung đã nhập rồi thử lại, hoặc tự soạn bài.',
    retryable: false,
  },
  // Nội bộ (việc hệ thống), không tới khách: giữ ngắn, kèm gợi ý vận hành.
  AI_SYSTEM_BUDGET_EXHAUSTED: {
    messageVi:
      'Đã hết ngân sách AI của việc hệ thống trong tuần. Chờ tuần mới hoặc nâng trần cấu hình.',
    retryable: false,
  },
};

export class AiError extends Error {
  readonly messageVi: string;
  readonly retryable: boolean;
  /** Chỉ có với `AI_DUPLICATE_REQUEST`. */
  readonly status: AiDuplicateStatus | undefined;

  constructor(
    readonly code: AiErrorCode,
    opts?: { status?: AiDuplicateStatus },
  ) {
    const m = MESSAGES[code];
    super(m.messageVi);
    this.status = opts?.status;
    this.name = 'AiError';
    this.messageVi = m.messageVi;
    this.retryable = m.retryable;
  }
}

/** `system.generate` gọi trong ngữ cảnh có tài khoản (lỗi lập trình – FR-038). */
export class SystemContextRequiredError extends Error {
  constructor() {
    super('system.generate chỉ gọi được ngoài ngữ cảnh tài khoản');
    this.name = 'SystemContextRequiredError';
  }
}
