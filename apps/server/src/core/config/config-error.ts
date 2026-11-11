// Lỗi cấu hình dùng chung (tách khỏi load-config.ts để tránh vòng phụ thuộc).

/** Một biến cấu hình thiếu/sai – chỉ có tên biến và lý do, KHÔNG có giá trị. */
export interface ConfigIssue {
  variable: string;
  reason: string;
}

/** Lỗi cấu hình khi khởi động. Thông điệp chỉ chứa tên biến + lý do (nguyên tắc VII). */
export class ConfigError extends Error {
  constructor(
    readonly issues: ConfigIssue[],
    /** Thông điệp thay cho dạng liệt kê mặc định (vẫn chỉ được chứa tên biến + giá trị không bí mật). */
    message?: string,
  ) {
    super(
      message ??
        `Cấu hình môi trường chưa hợp lệ:\n${issues.map((i) => `  - ${i.variable}: ${i.reason}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}
