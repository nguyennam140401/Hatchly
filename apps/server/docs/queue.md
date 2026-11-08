# Lớp hàng chờ (module `queue`) – hướng dẫn cho lập trình viên module

Tính năng 003 (WBS 1.3). Hợp đồng đầy đủ: `specs/003-queue-layer-pgboss/contracts/queue-api.md`. Mọi thứ
nhập từ **`apps/server/src/modules/queue/index.ts`** – không bao giờ nhập `pg-boss` hay `internal/` (quy tắc
ranh giới `pgboss-only-in-queue`, `no-internal-cross-module`).

Ý tưởng chính: việc nền được **tạo trong cùng giao dịch** với dữ liệu nghiệp vụ (hoàn tác = không có việc),
Worker **đặt lại ngữ cảnh tenant** trước khi gọi bộ xử lý, mỗi việc chạy **tối đa một bản tại một thời điểm**,
lỗi được **thử lại theo bảng giãn cách** rồi vào **việc hỏng** để hỗ trợ tra cứu/chạy lại.

## 1. Khai báo loại việc

Đặt trong `modules/<module>/jobs.ts` (không nằm trong `internal/`), xuất qua `index.ts` nếu module khác cần
tạo việc đó.

```ts
import { z } from 'zod';
import { defineJobType } from '../queue';

export const executeAttempt = defineJobType({
  name: 'publishing.execute_attempt', // <module>.<action>, duy nhất
  queue: 'publish', // publish | media | ai_batch | trends | notify | scheduled
  scope: 'tenant', // 'system' cho việc không thuộc tài khoản nào
  version: 1, // tăng khi đổi khuôn dữ liệu (kèm migrate)
  payload: z.strictObject({ attemptId: z.uuid() }),
  allowGenericRetry: false, // BẮT BUỘC với hàng chờ publish (Clarifications Q1)
});
```

Quy tắc (kiểm khi khai báo – sai thì ném ngay lúc khởi động):

- Khuôn là `z.strictObject`. **Chỉ mã tham chiếu và tham số nhỏ**; tên trường bị cấm (không phân biệt hoa
  thường, bỏ `_`): `content`, `body`, `caption`, `text`, `prompt`, `message`, `token`, `accessToken`,
  `secret`, `password`, `accountId`, `tenantId`. Chuỗi phải có `.max()` ≤ 2048 (trừ định dạng tự giới hạn
  như `z.uuid()`); không dùng `z.record/z.any`.
- Phong bì ≤ 8 192 byte (`maxPayloadBytes` hạ thấp được).
- `retry: { maxRetries?, delaysSeconds? }` chỉ được **thấp hơn** mặc định của hàng chờ.
- Đổi khuôn: tăng `version`, trường mới luôn `.optional()`, cung cấp `migrate(payload, fromVersion)`.

## 2. Tạo việc trong giao dịch

```ts
import { tenantTx } from '../../core';
import { enqueue, enqueueMany } from '../queue';

await tenantTx(async (db) => {
  const [attempt] = await db.insert(publishAttempts).values({ ... }).returning();
  await enqueue(executeAttempt, { attemptId: attempt.id }, {
    dedupeKey: `publish:${attempt.id}`, // tùy chọn; mặc định `${type}:${jobId}`
    runAfter: scheduledAt,              // tùy chọn; so với giờ CSDL
  });
});
```

- **Không có tham số `accountId`** – lấy từ giao dịch; `traceId` lấy từ ngữ cảnh yêu cầu.
- Gọi ngoài `tenantTx`/`systemTx` → `QUEUE_TX_REQUIRED`; loại `tenant` trong `systemTx` không tenant →
  `QUEUE_TENANT_CONTEXT_REQUIRED`; loại `system` trong `tenantTx` → `QUEUE_SYSTEM_CONTEXT_REQUIRED`.
- Khóa trùng với việc đang chờ / chờ thử lại / đang chạy → `{ status: 'exists', jobId, state }` (không tạo
  thêm). Việc cũ đã xong thì tạo mới được.
- `enqueueMany(def, items)` ≤ 100 việc, một câu lệnh, tất cả hoặc không: trùng khóa trong lô hoặc với việc
  đang hiệu lực → `QUEUE_DUPLICATE_IN_BATCH`.
- Lỗi khi tạo việc (sai khuôn, quá lớn…) ném ra trong `fn` → **cả giao dịch hoàn tác**.

## 3. Hủy / đổi giờ việc chưa chạy

```ts
await tenantTx(() => cancelJob({ queue: 'publish', dedupeKey: `publish:${attemptId}` }));
await tenantTx(() => rescheduleJob({ jobId }, newTime));
```

Chỉ việc đang chờ / chờ thử lại; việc đang chạy hoặc đã xong → `{ status: 'not_pending', state }`; việc của
tenant khác → `not_found` (RLS).

## 4. Viết bộ xử lý (chỉ Worker)

```ts
import { registerJobHandler, retryAfter, noRetry, PermanentJobError } from '../queue';

registerJobHandler(executeAttempt, async ({ attemptId }, ctx) => {
  // ctx: { jobId, type, queue, attempt (1 = lượt đầu), maxRetries, accountId, traceId, signal }
  return tenantTx(async (db) => { ... });   // tự mở giao dịch khi cần – lớp hàng chờ không bọc
}, {
  onFinalFailure: async ({ attemptId }, info) => { /* báo người dùng – chạy MỘT lần khi vào việc hỏng */ },
});
```

- Bộ xử lý chạy trong ngữ cảnh của việc: `tenantTx` thấy đúng tài khoản của việc; việc hệ thống không có
  tài khoản (`tenantTx` → `TENANT_CONTEXT_MISSING`, dùng `systemTx`).
- **Phải chạy lại được an toàn** (hiến pháp V): có thể bị chạy lại khi Worker chết, mất kết nối. Ghi theo
  mã tham chiếu, kiểm "đã làm chưa" trước khi làm.
- **Tôn trọng `ctx.signal`**: bị hủy khi sắp hết thời gian khóa, khi mất khóa (việc đã bị trả lại hoặc tài
  khoản bị xóa), khi Worker tắt quá hạn. Sau khi hủy, kết quả **không** được ghi.
- Không giữ giao dịch/kết nối CSDL trong lúc gọi API ngoài.

Kết quả:

| Bộ xử lý                            | Lớp hàng chờ làm                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| trả về bình thường                  | hoàn tất                                                                       |
| `return retryAfter(seconds)`        | thử lại sau đúng `seconds` (tính một lượt) – vd nền tảng báo giới hạn tần suất |
| `return noRetry(reason)`            | kết thúc, không thử lại, **không** vào việc hỏng – vd hết ngân sách AI         |
| `throw new PermanentJobError(code)` | vào việc hỏng ngay                                                             |
| ném lỗi khác                        | lỗi tạm: thử lại theo `retry_delays_seconds` (±≤ 20%), hết lượt → việc hỏng    |

Hàng chờ `publish` (`retry_mode = 'handler'`, ADR-04): chỉ `retryAfter` của bộ xử lý quyết giờ thử lại; lỗi
không bắt được dùng phần tử đầu (60 giây). Loại việc không có bộ xử lý ở Worker = lỗi tạm, hết lượt →
`NO_HANDLER`.

### Kiểm thử bộ xử lý (`apps/server/test/support/queue-test-kit.ts`)

```ts
import { expectIdempotent, runJobInline } from '../../test/support/queue-test-kit';

await runJobInline(executeAttempt, { attemptId }, { accountId: a }); // không cần Worker thật
await expectIdempotent(
  executeAttempt,
  { attemptId },
  {
    accountId: a,
    snapshot: () => withAccount(a, () => tenantTx((db) => db.select().from(publishAttempts))),
  },
);
```

`startTestWorkers(1 | 2, { queues })` chạy 1–2 bản Worker thật trong tiến trình kiểm thử (mỗi bản một bể +
pg-boss riêng); `drain()` chờ hàng chờ rỗng. Kiểm thử tích hợp đặt ở `test/queue/*.queue.spec.ts`, chạy
`pnpm test:queue` (cần `TEST_DATABASE_ADMIN_URL`).

## 5. Việc định kỳ

```ts
const openCycles = defineJobType({
  name: 'account.open_cycles',
  queue: 'scheduled',
  scope: 'system',
  version: 1,
  payload: z.strictObject({}),
});
defineSchedule({ name: 'account.open_cycles', cron: '0 * * * *', jobType: openCycles });
registerJobHandler(openCycles, async () => {
  /* xử lý MỌI thứ đến hạn, không chỉ "khung này" */
});
```

- Cron 5 trường. Múi giờ mặc định: lịch phút/giờ → UTC; lịch ngày/tuần/tháng → `Asia/Ho_Chi_Minh`
  (ghi rõ `tz` khi cần). Cron 6 trường (giây) chỉ khi `APP_ENV=test`.
- Bộ hẹn giờ chạy trên **mọi** bản Worker, khung tính bằng **giờ CSDL**; mỗi khung đúng một lần
  (`infra.schedule_slots`). Lần trước chưa xong → khung mới ghi `skipped_overlap`. Worker tắt qua nhiều khung
  → chỉ khung gần nhất chạy một lần (không bù hàng loạt) – vì vậy bộ xử lý phải xử lý mọi thứ đến hạn.
- Bảng nhật ký phân vùng theo tháng: `registerPartitionedLog({ table, ensureFunction, monthsAhead,
retentionMonths?, dropFunction? })` – việc `queue.partitions` tạo trước / bỏ phân vùng (đã đăng ký sẵn
  `infra.audit_log`: trước 2 tháng, giữ 12 tháng).

Việc định kỳ nội bộ của module `queue`: `queue.cleanup` (03:30 UTC+7 – việc hỏng và khung > 90 ngày),
`queue.partitions` (04:00 ngày 1 hằng tháng + một lần khi Worker khởi động), `queue.sweep_failed` (mỗi phút –
chôn việc hết lượt do Worker chết, gọi lại `onFinalFailure` chưa thành công ≤ 5 lần), `queue.dead_job_retries`
(mỗi phút – thực hiện yêu cầu chạy lại của hỗ trợ). Việc xong/hủy > 30 ngày do pg-boss tự xóa.

### Danh sách việc định kỳ chờ module đăng ký (FR-030)

| Việc (kiến trúc mục 6)                                                      | Tần suất              | Module sở hữu      |
| --------------------------------------------------------------------------- | --------------------- | ------------------ |
| Mở chu kỳ mới (ngân sách AI + hạn mức bài)                                  | Mỗi giờ               | `account`          |
| Kiểm tra gói hết hạn                                                        | Mỗi giờ               | `account`          |
| Làm mới token kênh; còn < 7 ngày → nhắc người dùng                          | Hằng ngày             | `platform_gateway` |
| Thu thập xu hướng theo ngành                                                | Thứ Hai 05:00 (UTC+7) | `trends`           |
| Chia đều chi phí xu hướng cho các tài khoản cùng ngành                      | Sau mỗi lần thu thập  | `trends`           |
| Trả lại giữ chỗ ngân sách treo > 15 phút                                    | Mỗi 10 phút           | `ai_gateway`       |
| Đối soát sổ chi phí AI với nhà cung cấp                                     | Hằng ngày             | `ai_gateway`       |
| Xóa tài khoản (hết hạn > 90 ngày / theo yêu cầu) – gọi `purgeAccountJobs()` | Hằng ngày             | `account`          |
| Dọn tệp tạm, bản ghi tải lên dở > 1 giờ, tệp mồ côi                         | Hằng ngày / tuần      | `media`            |
| Phát hiện lượt đăng quá giờ > 5 phút                                        | Mỗi phút              | `publishing`       |
| Báo cáo tham chiếu giữa module bị hỏng                                      | Hằng ngày             | từng module        |

## 6. Việc hỏng – tra cứu và chạy lại (màn hình hỗ trợ WBS 4.7, chỉ API)

```ts
await searchDeadJobs(actor, { queue: 'media', retryStatus: 'none', limit: 50 }); // không có dữ liệu việc
await getDeadJob(actor, accountId, deadJobId, 'khách báo ảnh không lên'); // lý do ≥ 5 ký tự
await requestDeadJobRetry(actor, deadJobId, 'khách đã tải lại tệp');
// → 'requested' | 'rejected_not_allowed' | 'rejected_already_active' | 'not_found'
```

- Mọi thao tác ghi `infra.audit_log` (`support.search`, `support.view_account`, `dead_job.retry_requested`,
  `dead_job.retry_rejected`, `dead_job.retried`). Phân quyền hỗ trợ/quản trị kiểm ở guard máy chủ trước khi gọi.
- Yêu cầu được Worker thực hiện trong ≤ 1 phút: việc mới cùng loại/dữ liệu/khóa, lượt thử đặt lại,
  `traceId` mới nối với mã cũ (`retriedFrom`).
- **Việc `publish` không chạy lại chung** (`rejected_not_allowed`): thông điệp cho WBS 4.7 – _"Lượt đăng cần
  đối soát trước – dùng 'Đăng lại' trong màn hình lượt đăng."_

## 7. Xóa mọi việc của tài khoản (FR-037)

```ts
await systemTx(() => purgeAccountJobs(), { tenant: 'from-context' }); // luồng xóa tài khoản ở Worker
// → { jobs, deadJobs } – idempotent; kiểm toán queue.account_jobs_purged chỉ ghi số lượng
```

Việc đang chạy của tài khoản bị hủy ở nhịp heartbeat kế tiếp, không ghi kết quả, không thử lại.

## 8. Thông số hàng chờ (`infra.queue_settings`) – đổi không cần phát hành

| Cột                                                   | Ý nghĩa                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `concurrency_per_worker`                              | số việc chạy cùng lúc mỗi bản Worker (1–50)                                  |
| `max_per_tenant`                                      | tối đa việc đang chạy của MỘT tài khoản trên mọi bản (NULL = không giới hạn) |
| `lock_seconds`                                        | trần cứng một lượt chạy (30–3600)                                            |
| `heartbeat_seconds`                                   | mất heartbeat quá chừng này → việc được trả lại (≥ 10, `× 2 ≤ lock_seconds`) |
| `retry_mode` / `max_retries` / `retry_delays_seconds` | `schedule` (theo mảng) · `handler` (publish) · `none`                        |
| `poll_interval_ms`                                    | chu kỳ hỏi việc khi hàng chờ rỗng                                            |

```sql
UPDATE infra.queue_settings SET concurrency_per_worker = 4, updated_by = 'staff-007', updated_at = now()
 WHERE queue = 'media';
```

Worker đọc lại mỗi `QUEUE_SETTINGS_REFRESH_MS` (60 giây): đồng thời mới áp ở lần lấy việc kế tiếp; khóa /
heartbeat / thử lại → cập nhật hàng chờ pg-boss. Giá trị vi phạm CHECK bị CSDL từ chối; vi phạm quy tắc
liên cột → Worker giữ giá trị cũ, ghi `queue.settings_invalid`, cảnh báo `QueueSettingsInvalid`.

Biến môi trường: `QUEUE_ENABLED`, `QUEUE_CONTROL_POOL_MAX` (6), `QUEUE_API_POOL_MAX` (2),
`QUEUE_SETTINGS_REFRESH_MS` (60000), `QUEUE_SCHEDULER_TICK_MS` (10000). Worker nên có
`DATABASE_POOL_MAX ≥ 20`.

## 9. Chỉ số, nhật ký, cảnh báo, sẵn sàng

- Chỉ số (meter `app.queue`, nhãn `queue` – không bao giờ `account_id`): `queue.jobs.waiting`,
  `queue.jobs.oldest_wait_seconds`, `queue.job.duration`, `queue.jobs.finished`, `queue.dead_jobs.created`,
  `queue.dead_jobs.last_24h`, `queue.workers.live`, `queue.settings.invalid`.
- Nhật ký `queue.job_finished` một dòng mỗi lượt (`trace_id`, `account_id`, `queue`, `job_type`, `job_id`,
  `attempt`, `duration_ms`, `wait_ms`, `outcome`, `error_code`, `payload_ref` – chỉ trường `*Id`). Lỗi đã lược
  bí mật (chuỗi kết nối, Bearer, access_token, mật khẩu).
- 10 quy tắc cảnh báo: `ops/alerts/queue.rules.yml` (ngưỡng đổi trong tệp).
- Worker: `GET /healthz` (sống), `GET /readyz` (CSDL + hàng chờ: phiên bản schema đúng, lấy việc/heartbeat
  thành công < 30 giây, không đang tắt).
- Tắt: SIGTERM → ngừng lấy việc ngay, chờ việc đang chạy ≤ `SHUTDOWN_TIMEOUT_MS`; quá hạn → hủy
  `ctx.signal`, thoát mã 1, việc được bản khác chạy lại sau heartbeat.

## 10. Nâng phiên bản pg-boss

1. Cố định phiên bản mới (≥ 2 tuần) trong `apps/server/package.json`; đọc ghi chú phát hành.
2. `pnpm db:generate:custom --name pgboss_upgrade_<bản>` rồi dán `pnpm -s queue:sql --migrate-from 46`
   (46 = schema của 12.38.0) – không sửa tay phần sinh; giữ quyền/RLS cho bảng mới nếu có.
3. Đổi `EXPECTED_SCHEMA_VERSION` trong `internal/pgboss/boss-loader.ts`; chạy `pnpm db:check`,
   `pnpm test:queue`, `pnpm test:queue-soak`.
4. Phát hành API + Worker cùng nhau (Worker lệch phiên bản schema → `/readyz` 503, không tự nâng).

## Lịch sử diễn tập (SC-012 – lập trình viên mới thêm một loại việc ≤ 30 phút)

| Ngày | Người | Việc diễn tập | Thời gian | Ghi chú |
| ---- | ----- | ------------- | --------- | ------- |
|      |       |               |           |         |
