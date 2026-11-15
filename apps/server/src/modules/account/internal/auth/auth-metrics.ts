// Chỉ số của đăng nhập nhà cung cấp, lời mời, tài khoản chờ (009 T086, contracts/module-api.md mục 6)
// qua OpenTelemetry API – no-op cho tới khi có SDK. Nhãn CHỈ gồm giá trị có số lượng nhỏ cố định
// (`provider`, `outcome`, `event`, `template`) – KHÔNG BAO GIỜ có `account_id`, `user_id`, email (FR-031).
//
// Tên Prometheus (dấu chấm → gạch dưới, bộ đếm thêm `_total`, histogram có `unit: 's'` thêm `_seconds`):
//   auth_oauth_total{provider, outcome}
//   account_invitations_total{event}
//   account_detached_purged_total
//   auth_oauth_callback_duration_seconds{provider}   (SC-002)
//   account_mail_send_duration_seconds{template}      (SC-004)
import { AsyncLocalStorage } from 'node:async_hooks';
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

/** `ok` = vòng chạy hết không lỗi (kể cả khi còn chờ người dùng bước tiếp); còn lại là lý do thất bại. */
export type OAuthOutcome =
  'ok' | 'cancelled' | 'state_mismatch' | 'expired' | 'provider_error' | 'account_unavailable';

export type InvitationEvent = 'sent' | 'resent' | 'cancelled' | 'accepted' | 'expired';

/** Giây – dải bucket phủ mục tiêu 5 giây (SC-002) và hết thời gian chờ nhà cung cấp 10 giây. */
const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

interface Instruments {
  oauth: Counter;
  invitations: Counter;
  detachedPurged: Counter;
  callbackDuration: Histogram;
  mailSendDuration: Histogram;
  mailFailed: Counter;
}

let cached: Instruments | undefined;

/** Tạo muộn (lần ghi đầu) để chọn đúng MeterProvider đã đăng ký; ProxyMeter của OTel xử lý phần còn lại. */
function instruments(): Instruments {
  if (cached !== undefined) return cached;
  const meter = metrics.getMeter('app.account');
  cached = {
    oauth: meter.createCounter('auth.oauth', {
      description: 'Số lượt quay về từ nhà cung cấp đăng nhập theo kết quả',
    }),
    invitations: meter.createCounter('account.invitations', {
      description: 'Số sự kiện lời mời cộng tác viên',
    }),
    detachedPurged: meter.createCounter('account.detached.purged', {
      description: 'Số người ở tài khoản chờ đã bị xóa sau 90 ngày',
    }),
    callbackDuration: meter.createHistogram('auth.oauth.callback.duration', {
      unit: 's',
      description: 'Từ lúc nhận callback của nhà cung cấp đến lúc trả 303 (giây)',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    }),
    mailSendDuration: meter.createHistogram('account.mail.send.duration', {
      unit: 's',
      description: 'Từ lúc giao dịch xác nhận đến lúc bên gửi thư nhận thư (giây)',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    }),
    mailFailed: meter.createCounter('account.mail.send_failed', {
      description: 'Số thư gửi trong tiến trình bị lỗi hoặc quá 10 giây',
    }),
  };
  return cached;
}

export function recordOAuth(provider: string, outcome: OAuthOutcome, seconds: number): void {
  const i = instruments();
  i.oauth.add(1, { provider, outcome });
  i.callbackDuration.record(seconds, { provider });
}

export function recordInvitation(event: InvitationEvent, count = 1): void {
  if (count > 0) instruments().invitations.add(count, { event });
}

export function recordDetachedPurged(count = 1): void {
  if (count > 0) instruments().detachedPurged.add(count);
}

export function recordMailSend(template: string, seconds: number): void {
  instruments().mailSendDuration.record(seconds, { template });
}

/** Thư gửi trong tiến trình thất bại (009 T065 – thao tác chính vẫn thành công, chỉ ghi chỉ số + nhật ký). */
export function recordMailFailed(template: string): void {
  instruments().mailFailed.add(1, { template });
}

// ---- Gom kết quả của MỘT lượt callback mà không đổi chữ ký các hàm bên trong -------------------

const callbackScope = new AsyncLocalStorage<{ outcome: OAuthOutcome }>();

/** Chạy `fn` với bộ ghi kết quả; trả về kết quả cuối (`ok` nếu không ai ghi lỗi). */
export async function withCallbackOutcome<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; outcome: OAuthOutcome }> {
  const scope: { outcome: OAuthOutcome } = { outcome: 'ok' };
  const value = await callbackScope.run(scope, fn);
  return { value, outcome: scope.outcome };
}

/** Gọi từ `failFlow`: đánh dấu lượt callback hiện tại đã thất bại với lý do này (ngoài callback → bỏ qua). */
export function markCallbackFailed(reason: OAuthOutcome): void {
  const scope = callbackScope.getStore();
  if (scope?.outcome === 'ok') scope.outcome = reason;
}
