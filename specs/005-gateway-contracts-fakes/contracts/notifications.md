# Hợp đồng – Thông báo (`notifications`) + bộ gửi email (`core/mail`)

Kiểu dữ liệu: [data-model.md](../data-model.md) mục 3. Module được phát (FR-046): `publishing`,
`platform_gateway`, `ai_gateway`, `content`, `approval` qua giao diện công khai; `account` qua hàng chờ (mục 3).

## 1. Danh mục dùng chung – `@app/shared/notifications`

```ts
export const NOTIFICATION_TYPES = ['post_pending_review', 'post_returned', 'approved_post_rescheduled',
  'batch_generation_done', 'publish_needs_action', 'channel_token_expiring', 'ai_usage_80', 'ai_usage_100',
  'plan_expiring', 'data_deletion_scheduled'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NotificationEventSchema: z.ZodDiscriminatedUnion<…>;  // strictObject theo từng `type`
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;
export const NOTIFY_DELIVER_JOB = 'notifications.deliver';
export const NOTIFICATION_RULES: Record<NotificationType, { recipients, channels, emailBatch, defaultActions }>;
```
Chỉ dùng `zod` (quy tắc `sharedAllowedPackages`). `dedupeKey(event)` **không** xuất cho bên phát – nằm ở server.

## 2. Giao diện công khai cho module (token `NOTIFICATIONS`)

```ts
export interface NotificationsPublicApi {
  /** Phát trong giao dịch nghiệp vụ hiện tại; giao dịch hủy → không có thông báo (FR-042). */
  emit(tx: Db, event: NotificationEvent): Promise<{ status: 'queued' | 'duplicate_pending' }>;
}
```
- Kiểu `event` bị ràng buộc bởi `NotificationEvent` → loại ngoài danh mục không qua kiểm tra kiểu (US4-AS3); lúc
  chạy `NotificationEventSchema.parse` + kiểm trường bị cấm → `NotificationEventInvalidError` (không tạo việc).
- `emit` gọi `enqueue(tx, notifyDeliverJob, { event }, { dedupeKey: 'notify:' + dedupeKey(event) })` (003).
- Không có tham số kênh gửi, người nhận, khóa chống trùng (FR-041, FR-043).

## 3. Lối phát của `account` (không phụ thuộc `notifications`)

```ts
import { NOTIFY_DELIVER_JOB, NotificationEventSchema } from '@app/shared/notifications';
import { enqueueRegistered } from '../queue';          // mới trong `queue`, chỉ `account` được dùng (quy tắc ranh giới)
await enqueueRegistered(tx, NOTIFY_DELIVER_JOB, { event: NotificationEventSchema.parse(e) });
```
`enqueueRegistered(tx, typeName, payload, opts?)`: tra `getJobType(typeName)`; chưa đăng ký → ném
`QUEUE_JOB_TYPE_UNKNOWN`. Khóa chống trùng hàng chờ do bộ xử lý tự kiểm ở mức sự kiện (mục 4), nên bỏ trống
`dedupeKey` vẫn an toàn.

## 4. Bộ xử lý việc `notifications.deliver` (Worker, hàng chờ `notify`)

1. Kiểm lại khuôn + trường bị cấm (dữ liệu từ hàng chờ không được tin).
2. Dựng `dedupeKey` theo loại; `INSERT … ON CONFLICT (account_id, dedupe_key) DO NOTHING` vào bảng sự kiện → trùng
   thì kết thúc (chạy lại an toàn – nguyên tắc V).
3. Tìm người nhận theo quy tắc qua `AccountPublicApi.listActiveMembers()` (phương thức mới: `{ userId, role, email,
   displayName }[]` của tài khoản trong ngữ cảnh); người không còn hoạt động → bỏ qua.
4. Mỗi người nhận × kênh: `in_app` → ghi bản ghi thông báo; `email` → bản giả lập gửi ngay qua `Mailer.deliver`
   (gộp 10 phút là việc của bản thật WBS 4.3, nhưng bản ghi giữ trường `emailBatch`).
5. Kết quả email: `sent` → ghi; `transient` → trả lỗi để 003 thử lại (chỉ phần email chưa gửi – đánh dấu theo người
   nhận); `permanent` → đánh dấu `email_failed_permanent`, không thử lại.
6. Nội dung thư/thông báo dựng từ mẫu tiếng Việt theo loại; luôn có ≥ 1 hành động (liên kết `WEB_BASE_URL/...`).

## 5. Bộ gửi email (`core/mail`, mở rộng 004)

```ts
export type MailDeliveryResult =
  | { kind: 'sent'; messageId: string }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string };
export interface Mailer {
  deliver(message: MailMessage): Promise<MailDeliveryResult>;   // mới
  send(message: MailMessage): Promise<void>;                    // giữ cho 004: ném khi không 'sent'
}
```
`MemoryMailTransport`: `outbox()`, `failFor(address, kind, times?)`, `clear()`. `SmtpMailTransport`: phân loại theo
`responseCode` (5xx → `permanent`, 4xx/lỗi mạng → `transient`). Cấu hình `MAIL_*` chuyển sang cấu hình chung (API +
Worker).

## 6. Bản giả lập Thông báo

`FakeNotifications` (bộ xử lý + kho `memory` | `sandbox` – bảng `ntf_fake_*`). API lập trình: `fakeNotify.delivered(
filter?)`, `fakeNotify.events()`, `fakeNotify.reset()`. Ở dev, email thật đi qua `smtp` → Mailpit (SC-011).

**Chế độ `memory` (không CSDL – research R9b):**
- `memoryTx(): Db` (`apps/server/src/dev/memory-tx.ts`, dùng chung cho bản giả lập của mọi module) – vật thế chỗ giao dịch, đúng kiểu để truyền vào `emit`/`onCrossed`, **ném lỗi** nếu bị dùng chạy SQL.
- `emit(memoryTx(), event)`: kiểm khuôn + trường bị cấm như bản thật → đưa vào hàng chờ trong bộ nhớ (khóa `notify:` +
  `dedupeKey` đang chờ → `duplicate_pending`). Không có Worker: harness gọi `flush()` để chạy `deliver.handler`.
- `flush()` ở `sandbox`: khởi động **runtime Worker thật trong tiến trình kiểm thử** (một lần, chỉ hàng chờ `notify` – cách
  kiểm thử 003 khởi động Worker, xem `test/queue/helpers/worker-child.ts`) rồi `waitFor` tới khi không còn việc
  `notifications.deliver` ở trạng thái `created`/`retry`/`active` (`jobs()`, `waitFor()` của `test/queue/helpers/queue-db.ts`).
  Không gọi thẳng bộ xử lý, vì như vậy sẽ bỏ qua bước Worker dựng lại ngữ cảnh tenant từ dữ liệu việc (nguyên tắc I).
- Thành viên (người nhận): `memory` → `FakeAccountMembers` (cài `AccountPublicApi.listActiveMembers`, trong
  `internal/fake/fake-members.ts`), harness `setMembers([...])`/`removeMember(userId)`; `sandbox` → chủ + CTV thật tạo bằng
  helper của 004 (`test/auth/helpers/actors.ts`), gỡ CTV bằng thao tác của `account`.
- Ca cần giao dịch thật (giao dịch hủy → không thông báo) chỉ kiểm ở `sandbox`.

## 7. Bộ kiểm thử hợp đồng (`test/contracts/notifications/`, `test/contracts/mail/`)

Thông báo (chạy `memory` + `sandbox`; `describeNotificationsContract(make, harness)` với `harness = { tx(), flush(),
setMembers(), … }` – mỗi ca phát rồi `flush()` rồi khẳng định, giống nhau ở hai chế độ):
1. Mỗi loại trong danh mục → đúng người nhận + kênh + `emailBatch` theo bảng data-model (bảng lặp qua
   `NOTIFICATION_TYPES` – thêm loại mà không có dòng kiểm → thất bại).
2. Quy tắc khóa của **mọi** loại: hai sự kiện cùng tham chiếu → 1 thông báo; khác tham chiếu → 2. `ai_usage_80`
   chu kỳ mới → phát lại được.
3. Trường bị cấm (`amountMicroUsd`, `accessToken`, `password`, `content`, chuỗi `"$1.20"` trong params) → từ chối.
4. Giao dịch hủy sau `emit` → không việc, không thông báo (**chỉ** `sandbox` – `pnpm test:db`; ở `memory` bỏ qua có ghi
   lý do).
5. Cộng tác viên đã bị gỡ → bỏ qua, người khác vẫn nhận.
6. Không thông báo nào thiếu hành động; quét toàn bộ nội dung đã ghi: không số tiền, không mã quyền (SC-004).
7. Chạy lại bộ xử lý hai lần cùng việc → cùng kết quả.

Email (chạy `memory` + `smtp`→Mailpit ở `pnpm test:infra`): `sent` đọc lại được trong hộp thư; `transient` và
`permanent` phân biệt đúng (Mailpit: theo khả năng của tag đã khóa, nếu không thì kiểm thử đơn vị trên mã SMTP); ở
`smtp`→Mailpit thư đọc lại được trong ≤ 10 giây (SC-011).
