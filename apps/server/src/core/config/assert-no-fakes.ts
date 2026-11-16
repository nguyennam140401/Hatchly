import type { AppConfig } from './config.schema';
import { ConfigError, type ConfigIssue } from './config-error';

// Chọn bản cài đặt của 4 điểm phụ thuộc + email và chặn bản giả lập ở môi trường chính thức
// (005, contracts/runtime-config.md mục 1–2, research R11). Gọi trong `loadConfig` – API và Worker đọc
// cùng biến nên luôn cùng lựa chọn.

const PRODUCTION_LIKE = new Set<AppConfig['APP_ENV']>(['staging', 'production']);

/** staging/production phải giống nhau: không bản giả lập, không kho trong bộ nhớ, không schema sandbox. */
export function isProductionLike(appEnv: AppConfig['APP_ENV']): boolean {
  return PRODUCTION_LIKE.has(appEnv);
}

/**
 * Điền giá trị mặc định ở development/test (bản giả lập, kho bộ nhớ) và kiểm biến bắt buộc:
 * - staging/production: `*_DRIVER`, `STORAGE_DRIVER` bắt buộc (thiếu → `ConfigError` nêu tên biến).
 * - `FAKE_STATE_STORE` bắt buộc khi có driver `fake` (dev/test: mặc định `memory`).
 * - `STORAGE_DRIVER=s3` → `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, khóa truy cập bắt buộc.
 */
export function resolveGatewayDefaults(config: AppConfig): AppConfig {
  const strict = isProductionLike(config.APP_ENV);
  const issues: ConfigIssue[] = [];
  const out: AppConfig = { ...config };

  if (!strict) {
    out.PLATFORM_GATEWAY_DRIVER ??= 'fake';
    out.AI_GATEWAY_DRIVER ??= 'fake';
    out.NOTIFICATIONS_DRIVER ??= 'fake';
    out.STORAGE_DRIVER ??= 'memory';
    // Hiện mọi driver cổng chỉ có `fake` → luôn cần kho trạng thái (bản thật thêm giá trị `real` sau).
    out.FAKE_STATE_STORE ??= 'memory';
    // 009: nhà cung cấp đăng nhập giả lập (không gọi ra ngoài).
    out.OAUTH_DRIVER ??= 'fake';
  } else {
    for (const variable of [
      'PLATFORM_GATEWAY_DRIVER',
      'AI_GATEWAY_DRIVER',
      'NOTIFICATIONS_DRIVER',
      'STORAGE_DRIVER',
    ] as const) {
      if (out[variable] === undefined) issues.push({ variable, reason: 'bắt buộc' });
    }
  }

  if (out.STORAGE_DRIVER === 's3') {
    for (const variable of [
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (out[variable] === undefined) issues.push({ variable, reason: 'bắt buộc' });
    }
  }
  if (out.DETACHED_NOTICE_DAYS >= out.DETACHED_RETENTION_DAYS) {
    issues.push({
      variable: 'DETACHED_NOTICE_DAYS',
      reason: 'phải nhỏ hơn DETACHED_RETENTION_DAYS',
    });
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return out;
}

/** Các biến chọn bản giả lập / bộ nhớ đang được đặt (dạng `TÊN=giá trị`, không có bí mật). */
export function fakeSelections(config: AppConfig): string[] {
  const found: string[] = [];
  if (config.PLATFORM_GATEWAY_DRIVER === 'fake') found.push('PLATFORM_GATEWAY_DRIVER=fake');
  if (config.AI_GATEWAY_DRIVER === 'fake') found.push('AI_GATEWAY_DRIVER=fake');
  if (config.NOTIFICATIONS_DRIVER === 'fake') found.push('NOTIFICATIONS_DRIVER=fake');
  if (config.STORAGE_DRIVER === 'memory') found.push('STORAGE_DRIVER=memory');
  if (config.MAIL_TRANSPORT === 'memory') found.push('MAIL_TRANSPORT=memory');
  // 012: bộ thực thi tạm của việc đăng bài – cùng cơ chế ngoại lệ thử nghiệm như ba cổng.
  if (config.PUBLISH_EXECUTOR === 'fake') found.push('PUBLISH_EXECUTOR=fake');
  // 009: bản giả lập cho phép đăng nhập bằng danh tính tùy ý → KHÔNG nằm trong ngoại lệ thử nghiệm.
  if (config.OAUTH_DRIVER === 'fake') found.push('OAUTH_DRIVER=fake');
  if (config.FAKE_STATE_STORE !== undefined) {
    found.push(`FAKE_STATE_STORE=${config.FAKE_STATE_STORE}`);
  }
  return found;
}

/** Ba driver cổng + kho trạng thái `sandbox` – các thứ duy nhất ngoại lệ thử nghiệm cho phép (007, R15). */
const STAGING_ALLOWED_FAKES = new Set([
  'PLATFORM_GATEWAY_DRIVER=fake',
  'AI_GATEWAY_DRIVER=fake',
  'NOTIFICATIONS_DRIVER=fake',
  'FAKE_STATE_STORE=sandbox',
  'PUBLISH_EXECUTOR=fake',
]);

/**
 * Ngoại lệ thử nghiệm: `APP_ENV=staging` + `STAGING_ALLOW_FAKES=true` cho phép driver `fake` của ba cổng
 * và `FAKE_STATE_STORE=sandbox`. `STORAGE_DRIVER=memory`, `MAIL_TRANSPORT=memory`, `FAKE_STATE_STORE=memory`
 * vẫn bị từ chối; `production` bỏ qua biến.
 */
function isAllowedStagingFake(config: AppConfig, entry: string): boolean {
  return (
    config.APP_ENV === 'staging' && config.STAGING_ALLOW_FAKES && STAGING_ALLOWED_FAKES.has(entry)
  );
}

/** Tên driver `fake` đang được ngoại lệ thử nghiệm cho phép (rỗng nếu không áp dụng). */
export function stagingFakesInUse(config: AppConfig): string[] {
  if (config.APP_ENV !== 'staging' || !config.STAGING_ALLOW_FAKES) return [];
  return fakeSelections(config).filter((entry) => isAllowedStagingFake(config, entry));
}

/**
 * staging/production có bất kỳ thành phần giả nào → `ConfigError` liệt kê ĐỦ biến vi phạm, vd
 * `Môi trường production không được dùng bản giả lập: PLATFORM_GATEWAY_DRIVER=fake, AI_GATEWAY_DRIVER=fake`.
 * Tiến trình (API hay Worker) in thông điệp và thoát mã 1 (SC-006).
 */
export function assertNoFakesInProduction(config: AppConfig): void {
  if (!isProductionLike(config.APP_ENV)) return;
  const found = fakeSelections(config).filter((entry) => !isAllowedStagingFake(config, entry));
  if (found.length === 0) return;
  throw new ConfigError(
    found.map((entry) => {
      const [variable = entry] = entry.split('=');
      return { variable, reason: `bản giả lập không dùng được ở ${config.APP_ENV}` };
    }),
    `Môi trường ${config.APP_ENV} không được dùng bản giả lập: ${found.join(', ')}`,
  );
}
