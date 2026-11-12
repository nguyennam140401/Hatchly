// Lỗi của Cổng AI (005, data-model.md mục 2). Thông điệp tiếng Việt đời thường, KHÔNG có số tiền.

export type AiErrorCode =
  | 'AI_BUDGET_EXHAUSTED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_INVALID_REQUEST'
  | 'AI_SYSTEM_BUDGET_EXHAUSTED';

const MESSAGES: Record<AiErrorCode, { messageVi: string; retryable: boolean }> = {
  AI_BUDGET_EXHAUSTED: { messageVi: 'Đã sử dụng hết giới hạn AI của chu kỳ', retryable: false },
  AI_PROVIDER_UNAVAILABLE: {
    messageVi: 'Dịch vụ AI tạm thời không phản hồi, vui lòng thử lại sau',
    retryable: true,
  },
  AI_INVALID_REQUEST: { messageVi: 'Yêu cầu không hợp lệ', retryable: false },
  AI_SYSTEM_BUDGET_EXHAUSTED: {
    messageVi: 'Đã hết ngân sách AI của việc hệ thống trong tuần',
    retryable: false,
  },
};

export class AiError extends Error {
  readonly messageVi: string;
  readonly retryable: boolean;

  constructor(readonly code: AiErrorCode) {
    const m = MESSAGES[code];
    super(m.messageVi);
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
