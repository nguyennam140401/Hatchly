// Lỗi ném của Cổng nền tảng (lỗi lập trình/hạ tầng – mọi lỗi nghiệp vụ là kết quả có `kind`).

/** Kết nối không thuộc tài khoản trong ngữ cảnh HOẶC không tồn tại – cố ý không phân biệt (nguyên tắc I). */
export class ConnectionNotFoundError extends Error {
  readonly code = 'CONNECTION_NOT_FOUND';
  constructor() {
    super('Không tìm thấy kết nối kênh');
    this.name = 'ConnectionNotFoundError';
  }
}

/** Vượt số kết nối tối đa mỗi nền tảng (010 FR-007). Bên gọi đổi thành `409 LIMIT_REACHED`. */
export class ConnectionLimitError extends Error {
  readonly code = 'LIMIT_REACHED';
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super('Đã đủ số kết nối cho nền tảng này');
    this.name = 'ConnectionLimitError';
  }
}

/** Page/tài khoản đã được kết nối ở MỘT TÀI KHOẢN KHÁC (chỉ mục duy nhất toàn cục – FR-006). Không lộ thêm chi tiết. */
export class ChannelOwnedByAnotherAccountError extends Error {
  readonly code = 'OWNED_BY_ANOTHER_ACCOUNT';
  constructor() {
    super('Kênh này đang được kết nối ở tài khoản khác');
    this.name = 'ChannelOwnedByAnotherAccountError';
  }
}

/** Loại kênh chưa có bộ chuyển đổi đăng ký – không có hành vi mặc định ngầm (US2-AS3). */
export class ChannelNotSupportedError extends Error {
  readonly code = 'CHANNEL_NOT_SUPPORTED';
  constructor() {
    super('Kênh này chưa được hỗ trợ');
    this.name = 'ChannelNotSupportedError';
  }
}

/** Yêu cầu sai (vd `contentHash` không khớp chữ, `from > to`). Thông điệp không chứa dữ liệu bài. */
export class InvalidRequestError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(reason: string) {
    super(`Yêu cầu không hợp lệ: ${reason}`);
    this.name = 'InvalidRequestError';
  }
}
