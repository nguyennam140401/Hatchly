import { isIP } from 'node:net';
import { z } from 'zod';

// Lược đồ biến môi trường (data-model.md mục 3, R6). Kiểm tra một lần khi khởi động.

/** Sổ đánh dấu biến bí mật: giá trị không bao giờ được ghi nhật ký hay đưa vào thông điệp lỗi. */
export const secretRegistry = z.registry<{ secret: true }>();

/** Đánh dấu một biến là bí mật (vd mật khẩu CSDL – WBS 1.2 thêm). */
export function secret<T extends z.ZodType>(schema: T): T {
  secretRegistry.add(schema, { secret: true });
  return schema;
}

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

/** Chuỗi kết nối PostgreSQL (`postgres://` hoặc `postgresql://`, có máy chủ). */
export const postgresUrl = () =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname !== ''
      );
    } catch {
      return false;
    }
  });

export const AppConfigSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  API_PORT: port(3000),
  WORKER_HEALTH_PORT: port(3001),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((raw) =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(z.url())),

  // ----- CSDL (002, contracts/db-commands.md mục 2) – mọi URL là bí mật -----
  /** Vai trò `app` – API và Worker, chịu RLS. */
  DATABASE_APP_URL: secret(postgresUrl()),
  /** Vai trò `system` – chỉ Worker (bắt buộc ở Worker, xem `assertWorkerDatabaseConfig`). */
  DATABASE_SYSTEM_URL: secret(postgresUrl().optional()),
  /** Vai trò `support` – chỉ API, tùy chọn. */
  DATABASE_SUPPORT_URL: secret(postgresUrl().optional()),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  DATABASE_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),

  // ----- Xác thực (004, contracts/auth-ops.md mục 1) -----
  // Biến "bắt buộc ở API" khai báo tùy chọn ở đây vì Worker không dùng; `resolveAuthConfig` (gọi khi
  // dựng ApiAppModule) kiểm tra đủ và dừng API khởi động khi thiếu – thông báo chỉ nêu tên biến.
  /** URL gốc của SPA để dựng liên kết trong thư. Bắt buộc ở API. */
  WEB_BASE_URL: z.url().optional(),
  /** Nguồn được gửi yêu cầu thay đổi dữ liệu (CSRF, R3); mặc định = gốc của WEB_BASE_URL. */
  WEB_ORIGINS: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(z.url()))
    .optional(),
  /** Số proxy tin cậy; mặc định 0 ở development/test, 1 ở staging/production. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
  /** Khóa HMAC cho `auth_throttle`, ≥ 32 byte. Bắt buộc ở API. */
  AUTH_THROTTLE_SECRET: secret(
    z
      .string()
      .refine((v) => Buffer.byteLength(v, 'utf8') >= 32, 'phải dài ít nhất 32 byte')
      .optional(),
  ),
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  STAFF_SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  STAFF_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** Dải mạng được vào lối nội bộ; rỗng = không giới hạn. */
  STAFF_ALLOWED_CIDRS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(z.string().refine(isCidr, 'phải là danh sách CIDR, vd 10.0.0.0/8'))),
  LOGIN_MAX_FAILURES_PER_EMAIL: z.coerce.number().int().min(1).max(1000).default(5),
  LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().min(1).max(100000).default(30),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LOGIN_BLOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** argon2id (R2). Kiểm thử dùng giá trị nhỏ để chạy nhanh. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8).max(1048576).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
  /** Phiên bản điều khoản hiện hành. Bắt buộc ở API. */
  TERMS_VERSION: z.string().min(1).max(40).optional(),
  /** `smtp` | `memory` (`memory` bị từ chối khi production). Bắt buộc ở API. */
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).optional(),
  /** Bắt buộc khi `MAIL_TRANSPORT=smtp`. */
  SMTP_URL: secret(
    z
      .string()
      .refine((v) => /^smtps?:\/\/[^/]+/.test(v))
      .optional(),
  ),
  /** Bắt buộc khi `MAIL_TRANSPORT=smtp`. */
  MAIL_FROM: z.string().min(3).optional(),

  // ----- Hàng chờ (003, contracts/queue-commands.md mục 2) – không có biến bí mật mới -----
  /** `false`: Worker khởi động nhưng không lấy việc (gỡ lỗi). */
  QUEUE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Bể điều khiển của Worker (vai trò `system`): lấy việc, heartbeat, ghi kết quả. */
  QUEUE_CONTROL_POOL_MAX: z.coerce.number().int().min(2).max(20).default(6),
  /** Bể của thể hiện pg-boss phía API (vai trò `app`) – chỉ đọc bộ nhớ đệm hàng chờ. */
  QUEUE_API_POOL_MAX: z.coerce.number().int().min(1).max(5).default(2),
  // Mã kiểm tra khói sau triển khai (008 FR-032): bật điểm cuối /ops/smoke. Không đặt = điểm cuối trả 404.
  SMOKE_TOKEN: z.string().min(16).max(256).optional(),
  /** Chu kỳ đọc lại `infra.queue_settings` (≤ 5 phút – FR-006). */
  QUEUE_SETTINGS_REFRESH_MS: z.coerce.number().int().min(10_000).max(300_000).default(60_000),
  /** Nhịp bộ hẹn giờ việc định kỳ. */
  QUEUE_SCHEDULER_TICK_MS: z.coerce.number().int().min(1000).max(30_000).default(10_000),

  // ----- Cổng + bản giả lập (005, contracts/runtime-config.md mục 1) -----
  // Bắt buộc ở staging/production (bản thật thêm giá trị `real` ở WBS 2.3/3.1/4.3); ở development/test
  // thiếu thì `resolveGatewayDefaults` (load-config.ts) đặt bản giả lập / bộ nhớ.
  PLATFORM_GATEWAY_DRIVER: z.enum(['fake']).optional(),
  AI_GATEWAY_DRIVER: z.enum(['fake']).optional(),
  NOTIFICATIONS_DRIVER: z.enum(['fake']).optional(),
  STORAGE_DRIVER: z.enum(['memory', 's3']).optional(),
  /** Nơi bản giả lập giữ trạng thái; bắt buộc khi có driver `fake` (mặc định `memory` ở dev/test). */
  FAKE_STATE_STORE: z.enum(['memory', 'sandbox']).optional(),
  /**
   * Chỉ có hiệu lực khi APP_ENV=staging; production bỏ qua (007, R15). Cho phép bản giả lập của ba cổng
   * ở thử nghiệm với `FAKE_STATE_STORE=sandbox`, cho đến khi có bản thật.
   */
  STAGING_ALLOW_FAKES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // ----- Bài viết, duyệt, lịch (012, contracts/module-api.md mục 6) -----
  /** Giờ đăng tối thiểu kể từ bây giờ, tính bằng phút (FR-011). */
  POST_MIN_LEAD_MINUTES: z.coerce.number().int().min(0).max(1440).default(5),
  /** "Giờ vàng" gợi ý, giờ UTC+7, dạng `HH:MM` ngăn cách bằng dấu phẩy. */
  POST_SUGGEST_HOURS: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(,([01]\d|2[0-3]):[0-5]\d)*$/, 'dạng HH:MM,HH:MM')
    .default('09:00,12:00,19:00'),
  /** Tối đa số bài mỗi lần duyệt / trả lại hàng loạt. */
  POST_BULK_APPROVE_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  /** Tối đa số bài mỗi lần gửi duyệt (khớp `postIds ≤ 50` của thông báo). */
  POST_BULK_SUBMIT_LIMIT: z.coerce.number().int().min(1).max(50).default(50),
  /**
   * Bộ thực thi 5 bước của `publishing.run_attempt` (013): `run` chạy đăng thật qua Cổng nền tảng (bộ chuyển đổi
   * thật hay giả do cấu hình cổng quyết định); `none` (mặc định) hoãn việc 15 phút và không đổi trạng thái;
   * `fake` = bí danh cũ của 012 (chạy như `run`, vẫn bị từ chối ở production).
   */
  PUBLISH_EXECUTOR: z.enum(['none', 'run', 'fake']).default('none'),
  // ----- Thư viện media (014, data-model.md mục 5) -----
  /** Hạn mức dung lượng media mỗi tài khoản, byte (mặc định 5 GiB). Lúc tạo dòng `storage_quotas` mới. */
  MEDIA_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1024 ** 4)
    .default(5 * 1024 ** 3),
  /** Hạn đường dẫn CÔNG KHAI cho nền tảng tải media, giây (mặc định và trần 24 giờ). */
  MEDIA_PUBLIC_URL_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(86_400),
  /** Hạn đường dẫn XEM TRƯỚC cho giao diện, giây (mặc định và trần 1 giờ). */
  MEDIA_PREVIEW_URL_TTL_SEC: z.coerce.number().int().min(60).max(3_600).default(3_600),
  /** Bắt buộc khi `STORAGE_DRIVER=s3`. */
  S3_ENDPOINT: z.url().optional(),
  /** Địa chỉ ký đường dẫn cho trình duyệt/nền tảng; mặc định = S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).max(64).optional(),
  S3_BUCKET: z.string().min(3).max(63).optional(),
  S3_ACCESS_KEY_ID: secret(z.string().min(1).optional()),
  S3_SECRET_ACCESS_KEY: secret(z.string().min(1).optional()),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // ----- Đăng nhập Google/Facebook, lời mời, tài khoản chờ (009, contracts/module-api.md mục 6) -----
  /**
   * `real` | `fake`. development/test: thiếu → `fake`. staging/production: `fake` bị từ chối; thiếu →
   * đăng nhập qua nhà cung cấp chưa bật (điểm cuối trả 503, đăng nhập bằng email vẫn chạy).
   */
  OAUTH_DRIVER: z.enum(['real', 'fake']).optional(),
  /** Bắt buộc ở API khi `OAUTH_DRIVER=real`. */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: secret(z.string().min(1).optional()),
  FACEBOOK_APP_ID: z.string().min(1).optional(),
  /** Cũng dùng để kiểm `signed_request` của Meta (FR-009a). */
  FACEBOOK_APP_SECRET: secret(z.string().min(1).optional()),
  /** Phiên bản Graph API cho lời gọi `/me` (vd `v21.0`). */
  FACEBOOK_GRAPH_VERSION: z
    .string()
    .regex(/^v\d{1,3}\.\d{1,2}$/)
    .default('v21.0'),
  OAUTH_FLOW_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  LINK_CONFIRM_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
  INVITE_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  INVITE_MAX_PER_ACCOUNT_PER_DAY: z.coerce.number().int().min(1).max(1000).default(10),
  DETACHED_RETENTION_DAYS: z.coerce.number().int().min(2).max(3650).default(90),
  DETACHED_NOTICE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  /** Trần chi phí AI việc hệ thống (xu hướng) mỗi tuần, micro-USD. */
  AI_SYSTEM_WEEKLY_CAP_MICRO_USD: z.coerce.number().int().min(0).default(2_000_000),
  /** Hết thời gian chờ phản hồi `submit` → kết quả `unknown` (không bao giờ `transient`). */
  /**
   * 013: `real` đăng ký bộ chuyển đổi THẬT của Facebook Page/Instagram (thay bản giả cùng loại kênh); bỏ trống =
   * theo `PLATFORM_GATEWAY_DRIVER`. Production KHÔNG được dùng bản giả (xem assert-no-fakes).
   */
  PLATFORM_ADAPTER_MODE: z.enum(['real', 'fake']).optional(),
  /** Phiên bản Graph API cố định của Meta. */
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v21.0'),
  META_GRAPH_BASE_URL: z.url().default('https://graph.facebook.com'),
  /** Hết thời gian chờ một lời gọi Graph (ms) – PHẢI nhỏ hơn `PLATFORM_SUBMIT_TIMEOUT_MS`. */
  META_GRAPH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
  /** Đối soát bằng đọc lại bài gần đây: mặc định tắt cho tới khi POC-2 xác nhận (tắt → "Cần kiểm tra"). */
  META_FACEBOOK_RECONCILE: z.enum(['true', 'false']).default('false'),
  META_INSTAGRAM_RECONCILE: z.enum(['true', 'false']).default('false'),
  /** Giới hạn dung lượng một video Facebook (byte): 1 GB theo quyết định của PO (2026-11-16). */
  FACEBOOK_VIDEO_MAX_BYTES: z.coerce.number().int().min(1_000_000).default(1_000_000_000),
  PLATFORM_SUBMIT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(40_000),
  AI_FIRST_TOKEN_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
});

/** Cú pháp CIDR IPv4/IPv6 (`địa chỉ/độ dài tiền tố`). */
export function isCidr(value: string): boolean {
  const slash = value.lastIndexOf('/');
  if (slash <= 0) return false;
  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  const family = isIP(address);
  if (family === 4) return prefix <= 32;
  if (family === 6) return prefix <= 128;
  return false;
}

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Token NestJS để tiêm cấu hình đã kiểm tra. */
export const APP_CONFIG = Symbol('APP_CONFIG');
