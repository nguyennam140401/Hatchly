// Khi nào được dùng schema `sandbox` và bản giả lập (005 + 007 R15). Không phụ thuộc mô-đun nào để
// `core/db`, script migration và cấu hình cùng dùng được.

type Env = Record<string, string | undefined>;

/** `STAGING_ALLOW_FAKES=true` (chỉ chuỗi `true` đúng nghĩa; giá trị khác = tắt). */
export function stagingFakesRequested(env: Env): boolean {
  return env.STAGING_ALLOW_FAKES === 'true';
}

/**
 * Schema `sandbox` hợp lệ ở development/test, và ở `staging` khi bật `STAGING_ALLOW_FAKES`.
 * `production` không bao giờ.
 */
export function sandboxAllowed(appEnv: string | undefined, env: Env): boolean {
  if (appEnv === 'development' || appEnv === 'test') return true;
  return appEnv === 'staging' && stagingFakesRequested(env);
}
