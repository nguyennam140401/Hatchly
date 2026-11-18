// Biến môi trường xác thực tối thiểu để dựng API trong kiểm thử (004, contracts/auth-ops.md mục 1).
// `memory`: thư giữ trong bộ nhớ; argon2 tham số nhỏ để kiểm thử chạy nhanh.
export const TEST_AUTH_ENV = {
  WEB_BASE_URL: 'http://app.test',
  WEB_ORIGINS: 'http://app.test',
  AUTH_THROTTLE_SECRET: 'test_only_auth_throttle_secret_0123456789',
  TERMS_VERSION: '2026-11',
  MAIL_TRANSPORT: 'memory',
  ARGON2_MEMORY_KIB: '64',
  ARGON2_TIME_COST: '1',
  // 009: nhà cung cấp đăng nhập giả lập – kiểm thử không gọi ra ngoài.
  OAUTH_DRIVER: 'fake',
} as const;

/** Nguồn (Origin) hợp lệ cho yêu cầu thay đổi dữ liệu trong kiểm thử. */
export const TEST_ORIGIN = 'http://app.test';
