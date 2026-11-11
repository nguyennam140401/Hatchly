# Research: Lớp hàng chờ nội bộ bọc pg-boss (003)

Ngày: 2026-11-08 · Spec: [spec.md](spec.md) · Bản pg-boss khảo sát: **12.38.0** (tải về và đọc
`dist/types.d.ts`, `dist/plans.js`, `dist/manager.js`, `dist/adapters/drizzle.d.ts`).

Mỗi mục: **Quyết định** · **Lý do** · **Phương án đã loại**. Spec Assumptions yêu cầu xác minh từng khả
năng T3 trên phiên bản cố định – bảng tổng hợp ở R1.

---

## R1. Phiên bản pg-boss và đối chiếu khả năng T3

**Quyết định**: cố định `pg-boss@12.38.0` (phát hành 2026-10-13, > 2 tuần; bản mới nhất 12.38.1 ngày
2026-11-05 chưa đủ 2 tuần). Phụ thuộc kèm: `pg ^8.23.1` (đã có 8.23.1), `cron-parser`, `rrule-temporal`,
`serialize-error`; peer `@opentelemetry/api ^1.9.0` → thêm `@opentelemetry/api@1.9.0` (chỉ API, không
SDK – SDK thuộc WBS 1.6).

| Khả năng T3 | Có trong 12.38.0? | Cách dùng / bổ sung |
|---|---|---|
| Tạo việc trong giao dịch đang mở | Có – tùy chọn `db: IDatabase` trên `send/insert/cancel/update/fetch/complete/fail` | Bộ nối `IDatabase` tự viết trên `PoolClient` của `tenantTx`/`systemTx` (R4) |
| Giới hạn đồng thời theo nhóm phối hợp qua CSDL | Có một phần – `groupConcurrency` đếm việc `active` theo `group_id` ngay trong câu lệnh lấy việc | **Thiếu khóa**: hai bản Worker lấy việc cùng lúc (READ COMMITTED, `SKIP LOCKED`) có thể cùng thấy "còn chỗ" → vượt N tạm thời. Bổ sung khóa tư vấn theo hàng chờ quanh lệnh lấy việc (R6) |
| Hẹn giờ định kỳ | Có – `schedule()` (cron/rrule, `tz`, `missed: skip/once`) | Không dùng: cần khóa khung theo giờ địa phương, chống chồng lần chạy, một hàng chờ `scheduled` chung cho nhiều tên → tự làm bộ hẹn giờ mỏng (R9) |
| Thử lại giãn cách | Có – `retryLimit`, `retryDelay`, `retryBackoff`, `retryDelayMax` | Lịch giãn cách cố định theo bảng (1→5→15 phút) không phải hàm mũ → ghi đè `start_after` sau `fail` (R7) |
| Hàng chờ việc hỏng | Có – `deadLetter` (sao chép sang một hàng chờ khác) | Không dùng làm nơi lưu: việc hỏng lưu ở `infra.dead_jobs` (spec Assumptions); hàng chờ thứ 7 trái FR-004 (R8) |
| Gia hạn khóa / phát hiện Worker chết | Có – `heartbeatSeconds` của hàng chờ + `touch()`; `expireInSeconds` là trần cứng | Dùng (R5) |
| Khóa chống trùng | Có – chính sách hàng chờ `exclusive`: duy nhất `(name, singleton_key)` khi `state <= active` | Dùng; mọi việc luôn có khóa (R3) |
| Hủy / đổi giờ việc chưa chạy | Có – `cancel()`, `update()` (chỉ việc `created`/`retry`) | Dùng trong giao dịch (R4) |
| Sổ bản đang chạy | Có – `registerInstance` + `getInstances()` (`live`) | Chỉ số "số bản Worker đang sống" (R11) |
| Thống kê hàng chờ | Có – `getQueues()`/`getQueueStats()` | Kết hợp chỉ số tự đo (R11) |
| Xuất SQL dựng schema | Có – `getConstructionPlans(schema)`, `getMigrationPlans(schema, version)` | Cài schema bằng migration tay chạy bằng `owner` (R2) |

**Lý do**: bản mới nhất đủ 2 tuần; có heartbeat, `exclusive`, `groupConcurrency`, bộ nối giao dịch.

**Định dạng module**: pg-boss 12 là **ESM thuần** (`"type": "module"`), không có `await` cấp cao nhất.
`apps/server` build CommonJS (`module: Node16`) → TypeScript chặn `import` tĩnh. Nạp bằng
`await import('pg-boss')` trong một tệp bộ nối duy nhất (`internal/pgboss/boss-loader.ts`); kiểu dùng
`import type … with { 'resolution-mode': 'import' }`. Node 24 chạy được cả `require(esm)` lẫn `import()`.

**Phương án đã loại**: pg-boss 10/11 (không có `groupConcurrency` toàn cụm, không có heartbeat);
12.38.1 (chưa đủ 2 tuần – nâng sau bằng migration pg-boss, R2).

---

## R2. Cài schema pg-boss: migration tay, không để thư viện tự sửa cấu trúc lúc chạy

**Quyết định**:

- Schema của thư viện tên **`pgboss`**, chủ `owner`. Migration tay `0005_pgboss_install.sql` chứa đầu ra
  `getConstructionPlans('pgboss', { createSchema: true })` của 12.38.0 (sinh bằng
  `pnpm queue:sql --construct`, tiêu đề ghi phiên bản; không sửa tay phần sinh ra) + quyền + RLS (R12).
- Ứng dụng khởi động pg-boss với `migrate: false`, `createSchema: false`; khi khởi động kiểm
  `schemaVersion()` bằng số phiên bản kỳ vọng của bản cố định, lệch → **chưa sẵn sàng** + nhật ký
  `queue.schema_version_mismatch` (không tự nâng).
- Tạo 6 hàng chờ: bước hậu-migration trong `src/db/migrate.ts` (`ensureQueues`, vai trò `owner`,
  idempotent – `createQueue` nếu chưa có, `updateQueue` theo `infra.queue_settings`).
- Nâng pg-boss sau này = migration tay mới từ `getMigrationPlans('pgboss', <bản cũ>)` + đổi số phiên bản
  kỳ vọng; pg-boss giữ tương thích giữa bản cũ/mới trong cùng major (phát hành song song API/Worker).

**Lý do**: hiến pháp – thay đổi cấu trúc chỉ bằng `owner` qua công cụ migration; `app`/`system` không có
quyền `CREATE` (quy tắc `g-app-privileges`). `db:lint-migrations` vẫn quét được tệp sinh ra.

**Phương án đã loại**: `migrate: true` lúc chạy (cần quyền DDL cho `system`); dùng schema `infra` cho bảng
pg-boss (lẫn bảng thư viện với bảng của mình, `db:check` quy tắc `j` báo bảng chưa đăng ký).

---

## R3. Một hàng chờ pg-boss cho mỗi hàng chờ nghiệp vụ; loại việc nằm trong phong bì dữ liệu

**Quyết định**:

- Đúng **6 hàng chờ pg-boss** (`publish`, `media`, `ai_batch`, `trends`, `notify`, `scheduled`), chính
  sách **`exclusive`** cho cả 6.
- Dữ liệu việc là **phong bì**: `{ type, v, accountId, traceId, payload, retriedFrom? }`. `type` là
  tên loại việc (vd `publishing.execute_attempt`), `v` là phiên bản khuôn dữ liệu.
- `group.id` của pg-boss = `accountId` (việc tenant); việc hệ thống không có nhóm.
- **Mọi việc đều có khóa chống trùng**: khóa người gọi đưa (vd `publish:{attemptId}`) hoặc mặc định
  `{type}:{jobId}` (UUID v7). Lý do: chỉ mục duy nhất của `exclusive` dùng
  `COALESCE(singleton_key, '')` – việc không khóa sẽ chặn nhau.

**Lý do**: giới hạn đồng thời/bản và tối đa/tenant là theo hàng chờ (bảng Key Entities). Một hàng chờ
pg-boss cho mỗi loại việc sẽ nhân số luồng và tách giới hạn tenant. `exclusive` cho đúng ngữ nghĩa
FR-010: duy nhất trong số việc *chờ · chờ thử lại · đang chạy* (enum `created < retry < active`).

**Phương án đã loại**: hàng chờ pg-boss theo loại việc (vượt giới hạn hàng chờ; Q2 vẫn chọn B nên không
cần lọc loại việc khi lấy); chính sách `standard` + tự kiểm trùng (đua giữa hai giao dịch).

---

## R4. Tạo/hủy/đổi giờ việc trong giao dịch của lớp CSDL

**Quyết định**:

- Bộ nối `txDatabase(db: Db): IDatabase` = `{ executeSql: (text, values) => db.$client.query(text,
  values) }` – chạy trên đúng `PoolClient` của giao dịch hiện hành (`tenantTx`/`systemTx`). Không dùng
  `fromDrizzle` (thêm một lớp dựng SQL không cần thiết).
- `enqueue(def, payload, opts)` **bắt buộc** có giao dịch đang mở (`currentTx()`), lấy `accountId` từ
  ngữ cảnh giao dịch, `traceId` từ `ExecutionContext`. Loại việc `tenant` mà giao dịch không có tenant →
  `QUEUE_TENANT_CONTEXT_REQUIRED`; loại `system` trong giao dịch tenant → `QUEUE_SYSTEM_CONTEXT_REQUIRED`.
- Khóa trùng: `send` trả `null` → tìm việc đang hiệu lực theo khóa (`findJobs({ key, queued })` trên cùng
  `db`) → trả `{ status: 'exists', jobId, state }`.
- `cancel`/`reschedule` theo `jobId` hoặc khóa: đọc trạng thái trên cùng `db`, chỉ đổi khi `created`/
  `retry`; còn lại trả `{ status: 'not_pending', state }` (FR-011).
- `enqueueMany` = `insert()` một câu lệnh; trùng khóa trong lô → cả lô lỗi `QUEUE_DUPLICATE_IN_BATCH`
  (tất cả hoặc không – FR-013). `insert` không báo từng dòng trùng, nên kiểm khóa trùng trong lô ở ứng
  dụng và trùng với việc đang có bằng một truy vấn trước khi chèn (cùng giao dịch, khóa chỉ mục bảo vệ).
- API có một thể hiện pg-boss **không chạy Worker** (`supervise/schedule/registerInstance: false`), bể
  riêng 2 kết nối vai trò `app` chỉ để đọc bộ nhớ đệm hàng chờ; lệnh ghi đi qua `db` của giao dịch.

**Lý do**: FR-007/008; spec US1 kịch bản 6 "giao dịch không bị âm thầm xác nhận một nửa" – lỗi ném ra
trong `fn` làm `runTx` hoàn tác.

**Phương án đã loại**: bảng outbox riêng rồi chuyển sang pg-boss (thêm một bước, trễ; pg-boss đã ghi
trong giao dịch được).

---

## R5. Khóa việc: heartbeat 30 giây + trần cứng = "thời gian khóa"

**Quyết định** (edge case "bộ xử lý chạy quá thời gian khóa"):

- `expireInSeconds` của hàng chờ = **thời gian khóa** của bảng (publish 120, media 900, ai_batch 180,
  trends 600, notify 60, scheduled 600) – trần cứng cho một lượt chạy.
- `heartbeatSeconds` = 30 (cấu hình, ≥ 10, < thời gian khóa); bộ chạy gọi `touch()` mỗi 10 giây trên bể
  điều khiển. Worker chết → monitor của pg-boss trả việc về `retry` sau ≤ 30 giây (+ chu kỳ monitor),
  **sớm hơn** thời gian khóa, đáp ứng SC-001 "không kẹt quá thời gian khóa + 1 phút".
- Bộ xử lý nhận `AbortSignal`, bị hủy khi: còn 5 giây tới trần cứng; `touch()` báo 0 dòng (việc đã bị
  trả lại/xóa); Worker hết 30 giây tắt có kiểm soát. Sau khi hủy, bộ chạy **không** ghi kết quả.
- Ghi kết quả bằng `JobAttempt { id, retryCount }`: lượt đã bị trả lại thì `complete/fail` không tác
  động (pg-boss bảo đảm) → bản cũ chạy chậm không ghi đè kết quả của bản mới.

**Lý do**: ADD Worker mục 2/5 "gia hạn khóa mỗi 30 giây"; FR-017 không có bản thứ hai trong khi khóa
còn hiệu lực – khóa chỉ mất hiệu lực khi heartbeat ngừng (tiến trình chết/mất CSDL), lúc đó bộ xử lý cũ
cũng bị hủy. Bộ xử lý vẫn phải chạy lại được an toàn (nguyên tắc V) cho khoảng chồng ngắn khi mất mạng.

**Phương án đã loại**: chỉ trần cứng lớn (Worker chết thì việc đăng chờ tới 2 phút, media 15 phút);
khóa tư vấn phiên (giữ kết nối suốt lượt chạy, 26 kết nối/bản).

---

## R6. Bộ chạy tự quản: lấy việc dưới khóa tư vấn theo hàng chờ

**Quyết định**: không dùng `work()`; mỗi hàng chờ một **vòng lấy việc** riêng trong Worker:

1. Còn chỗ trống `free = concurrency − đang chạy` và Worker đang `ready` → mở giao dịch trên **bể điều
   khiển** (vai trò `system`, pg-boss), `SELECT pg_advisory_xact_lock(hashtext('queue_fetch:' || q))`,
   rồi `fetch(q, { batchSize: free, groupConcurrency: maxPerTenant, includeMetadata: true, db })`, xác
   nhận. Câu lệnh lấy việc chạy **sau** khi giữ khóa nên đếm `active` theo nhóm luôn mới (READ COMMITTED
   lấy ảnh chụp theo câu lệnh) → không bao giờ vượt N trên mọi bản (FR-021, SC-004).
2. Mỗi việc chạy trong `ShutdownCoordinator.trackInFlight`, hết việc thì lấy tiếp ngay; rỗng thì chờ
   `pollIntervalMs` (publish 1 000, các hàng khác 2 000–5 000).
3. Hàng chờ không có giới hạn tenant (`notify`, `scheduled`) bỏ khóa tư vấn.

**Lý do**: R1 – `groupConcurrency` của pg-boss không có khóa; cần đổi giới hạn/bản lúc chạy (FR-006) mà
`work()` cần `offWork`/`work` lại; điều khiển hủy, kết quả, nhật ký, chỉ số theo đúng FR-014/015/033.
Tải nhỏ (≈ 5 lượt đăng/phút) → khóa tư vấn không gây tranh chấp đáng kể (một câu lệnh ngắn mỗi lần lấy).

**Ưu tiên `publish` (FR-005)**: vòng lấy việc, `touch`, ghi kết quả của **mọi** hàng chờ dùng bể điều
khiển riêng (không chung bể `app` của bộ xử lý) nên việc `media` nặng chiếm bể `app` không làm chậm việc
lấy `publish`; `publish` có vòng riêng 10 chỗ, chu kỳ hỏi 1 giây và chỉ mục pg-boss sắp `priority desc`
– việc `publish` tạo với `priority = 10`.

**Phương án đã loại**: `work()` + `localGroupConcurrency` (chỉ trong một bản); khóa tư vấn theo
`(hàng chờ, tài khoản)` sau khi lấy (việc đã `active` thì không trả lại được mà không tăng lượt thử).

---

## R7. Kết quả bộ xử lý và chính sách thử lại

**Quyết định**:

| Kết quả của bộ xử lý | Hành động (một giao dịch trên bể điều khiển) |
|---|---|
| trả về bình thường | `complete(attempt)` |
| `retryAfter(seconds)` | còn lượt → `fail(attempt)` rồi `update(startAfter = now + seconds)`; hết lượt → chôn (R8) |
| `noRetry(reason)` (kết quả nghiệp vụ, vd hết ngân sách AI) | `complete(attempt, { outcome: 'no_retry', reason })` – không vào việc hỏng |
| ném `PermanentJobError` | chôn ngay (R8) |
| ném lỗi khác / dữ liệu sai khuôn / không có bộ xử lý | lỗi tạm thời: còn lượt → `fail` + `update(startAfter = now + delay(lượt) × (1 ± ≤ 20%))`; hết lượt → chôn |

- Thông số: `max_retries` và `retry_delays_seconds` (mảng; lần thử lại thứ k dùng phần tử k, quá mảng thì
  dùng phần tử cuối) trong `infra.queue_settings`. Hàng chờ pg-boss đặt `retryLimit = max_retries`,
  `retryDelay = phần tử đầu` – chỉ dùng khi monitor trả việc do Worker chết.
- `retry_mode`: `schedule` (theo mảng), `handler` (`publish` – ADR-04: chỉ `retryAfter` của bộ xử lý quyết;
  lỗi không bắt được dùng phần tử đầu, mặc định 60 giây), `none` (`scheduled` – `max_retries = 0`).
- Cách hiểu bảng "Thử lại mặc định": **"N lần" = N lần thử lại sau lượt đầu**. Giá trị khởi tạo:
  publish `handler`, 5; media `[60, 300, 900]`; ai_batch 2 × `[30, 120]`; trends 3 × `[3600, 14400]`
  (lần 3 lặp 4 giờ – spec Assumptions "1 giờ rồi 4 giờ"); notify 5 × `[30, 60, 120, 300, 600]`;
  scheduled 0.
- Q2 (Clarifications): loại việc không có bộ xử lý = lỗi tạm thời, tính lượt, hết lượt thì chôn với lý do
  `NO_HANDLER`.

**Lý do**: FR-015; `fail` + `update` cùng giao dịch → không có trạng thái nửa vời. Giãn cách cố định
1 → 5 → 15 phút không biểu diễn được bằng `retryBackoff` của pg-boss.

**Phương án đã loại**: `retryBackoff` (hàm mũ, không khớp bảng); tự đặt việc mới cho mỗi lần thử (mất
`retryCount`, đổi `jobId`).

---

## R8. Việc hỏng ở `infra.dead_jobs`; "chôn" một chỗ, quét định kỳ cho việc hết lượt do Worker chết

**Quyết định**:

- Hàm nội bộ `buryJob(job, cause)` (một giao dịch bể điều khiển): chèn `infra.dead_jobs` (duy nhất theo
  `original_job_id` → idempotent), xóa việc pg-boss (`deleteJob(attempt)`), rồi gọi `onFinalFailure` của
  loại việc **trong ngữ cảnh của việc** (`tenantTx`/`systemTx` – giao dịch riêng, lỗi chỉ ghi nhật ký
  `queue.final_failure_callback_failed` và đặt `final_failure_notified = false` để quét gọi lại).
- Việc hết lượt do Worker chết/heartbeat mất do monitor pg-boss chuyển `failed` (không qua bộ xử lý) →
  việc định kỳ nội bộ `queue.sweep_failed` mỗi phút: chôn mọi việc `failed` của 6 hàng chờ. Cũng gọi lại
  `onFinalFailure` cho dòng `final_failure_notified = false` (tối đa 5 lần).
- Lỗi cuối lưu qua bộ lược bí mật (R13), cắt ≤ 2 KB; `payload` giữ nguyên (chỉ mã tham chiếu – FR-012).
- Cờ `generic_retry_allowed` sao từ đăng ký loại việc lúc chôn (Clarifications Q1: loại việc `publish`
  là `false`).

**Lý do**: spec Assumptions – không phụ thuộc cấu trúc nội bộ của thư viện để tra cứu/kiểm toán/giữ
90 ngày; không thêm hàng chờ thứ 7 (`deadLetter`).

**Phương án đã loại**: `deadLetter` của pg-boss (thêm hàng chờ, sao chép cả cấu hình thử lại); giữ việc
`failed` trong bảng pg-boss (xóa theo `deleteAfterSeconds` 30 ngày, không phải 90).

---

## R9. Bộ hẹn giờ định kỳ tự làm trên bảng khung `infra.schedule_slots`

**Quyết định**:

- Đăng ký: `defineSchedule({ name, cron, tz?, jobType })`; `cron` 5 trường (6 trường giây chỉ cho kiểm
  thử, `APP_ENV=test`); `tz` mặc định `Asia/Ho_Chi_Minh` cho lịch theo ngày/tuần/tháng, `UTC` cho lịch
  phút/giờ (FR-026). Tính bằng `cron-parser` (phụ thuộc trực tiếp, cố định phiên bản bằng bản pg-boss
  12.38.0 dùng).
- Mọi bản Worker chạy nhịp 10 giây: lấy **giờ CSDL** (`SELECT now()`), tính khung gần nhất `slot ≤ now`;
  khung chưa có trong bảng → một giao dịch `system`: `INSERT INTO infra.schedule_slots(name, slot) … ON
  CONFLICT DO NOTHING`; chèn được mới `send('scheduled', …, { singletonKey: 'scheduled:{name}' })`.
- `slot` là chuỗi giờ địa phương ISO (vd `2026-11-09T05:00+07:00`), khóa chính `(name, slot)` → mỗi khung
  đúng một lần trên mọi bản (FR-027). Đây là "khóa khung" `scheduled:{name}:{slot}` của spec, đặt ở
  bảng vì chỉ mục `exclusive` của pg-boss chỉ chặn trùng khi việc còn hiệu lực, không chặn sau khi xong.
- Chống chồng (FR-028): khóa pg-boss `scheduled:{name}` (`exclusive`) → lần trước còn chờ/chạy thì
  `send` trả `null` → khung ghi `status = 'skipped_overlap'`.
- Khung bị lỡ: chỉ xét **khung gần nhất**; khi khởi động lại sau khi khung đã qua và khung mới chưa tới,
  khung gần nhất (đã lỡ giờ) chạy **một lần** và ghi `late_seconds` – không bao giờ bù nhiều khung (tương
  đương `missed: 'once'`). Việc định kỳ viết kiểu "xử lý mọi thứ đến hạn".
- "Hằng tháng ngày 31" = cron `0 0 1 * *` (đầu khung tháng) – không phụ thuộc ngày tồn tại.

**Lý do**: `schedule()` của pg-boss gửi vào hàng chờ trùng tên lịch (mâu thuẫn một hàng chờ `scheduled`
chung), không có bảng khung để tra cứu và không chặn chồng theo tên.

**Phương án đã loại**: chọn bản chính (leader) – spec yêu cầu không cần; `singletonSeconds` (chỉ khung đều
nhau theo UTC, không biểu diễn tuần/tháng giờ địa phương).

---

## R10. Thông số hàng chờ trong CSDL, đọc lại mỗi 60 giây

**Quyết định**: bảng dùng chung `infra.queue_settings` (6 dòng, khởi tạo bằng migration), có `CHECK`
cho từng cột (đồng thời ≥ 1, tối đa/tenant NULL hoặc ≥ 1, heartbeat ≥ 10 và < thời gian khóa…). Worker
đọc lại mỗi 60 giây (≤ 5 phút – FR-006); kiểm thêm bằng Zod; dòng không hợp lệ → giữ giá trị cũ +
`queue.settings_invalid` (cảnh báo). Đổi `expire/retry/heartbeat` → `updateQueue` (bể điều khiển, idempotent
– nhiều bản cùng làm vô hại). Đổi đồng thời/bản → vòng lấy việc dùng giá trị mới ở lần lấy kế tiếp; việc
đang chạy không bị ngắt. `system` có `SELECT` + `UPDATE` (cho công cụ quản trị sau này qua module); `app`
chỉ `SELECT`.

**Lý do**: kiến trúc mục 3 "cache trong tiến trình 5 phút"; `CHECK` là chốt chặn cuối, Zod cho thông
điệp rõ.

---

## R11. Quan sát: OpenTelemetry API + nhật ký có cấu trúc

**Quyết định**:

- Chỉ số qua `@opentelemetry/api` (meter `app.queue`), nhãn `queue` (+ `job_type`, `outcome` cho bộ
  đếm – tập hữu hạn); **không** gắn `account_id` (FR-031). Không SDK → no-op cho tới WBS 1.6; kiểm thử
  gắn `MeterProvider` của `@opentelemetry/sdk-metrics` (devDependency, cố định phiên bản) + bộ đọc bộ nhớ.
- Sáu chỉ số – tên và nguồn ở [contracts/queue-observability.md](contracts/queue-observability.md):
  đang chờ và tuổi chờ lâu nhất (truy vấn `pgboss.job_common` mỗi 30 giây; mọi bản đều xuất – quy tắc
  cảnh báo dùng `max by (queue)` nên không cần chọn bản thu), thời gian xử lý (histogram), thành công/lỗi (bộ đếm), việc hỏng (đếm
  `infra.dead_jobs` theo hàng chờ), số bản Worker sống (`getInstances()` có `live = true`).
- Quy tắc cảnh báo Prometheus trong `ops/alerts/queue.rules.yml` (FR-032); kiểm thử cấu trúc
  (`test/queue/alert-rules.spec.ts`) đối chiếu đủ 10 quy tắc của US6 kịch bản 2; nạp vào Prometheus ở
  WBS 1.5/1.6.
- Nhật ký `queue.job_finished` một dòng mỗi lượt (gộp bắt đầu/kết thúc; `queue.job_started` ở mức
  `debug`) – trường ở contracts. Không ghi `payload`, chỉ `payload_ref` (giá trị các trường có tên
  `*Id`).

**Lý do**: nguyên tắc VIII; số bản Worker từ sổ bản của pg-boss không cần thêm bảng.

---

## R12. Quyền và RLS trên bảng pg-boss (phòng thủ hai lớp)

**Quyết định** (mạnh hơn spec Assumptions, vẫn tương thích):

- `app` (API + bộ xử lý): `SELECT, INSERT, UPDATE, DELETE` trên `pgboss.job`, `pgboss.job_common`;
  `SELECT` trên `pgboss.queue`, `pgboss.version`; `EXECUTE` các hàm pg-boss mà lệnh `send/insert/cancel/
  update/findJobs` gọi. Bật RLS trên `job` và `job_common` với chính sách
  `queue_tenant_jobs FOR ALL TO app USING (group_id = account.current_account_id()::text) WITH CHECK
  (same)` → API/bộ xử lý chỉ tạo/thấy/hủy việc của đúng tenant; không thấy việc hệ thống.
- `system` (bể điều khiển Worker): quyền đọc/ghi trên mọi bảng pg-boss cần cho lấy việc, monitor, bảo
  trì, sổ bản; chính sách `queue_runtime_all FOR ALL TO system USING (true) WITH CHECK (true)`.
- `support`: không có quyền trên `pgboss`.
- **Rủi ro cần kiểm khi làm**: bảng con phân vùng mà pg-boss truy cập trực tiếp phải có cùng chính sách
  (hàng chờ đặt `partition: false` → chỉ `job_common`). Danh sách quyền chính xác chốt bằng kiểm thử
  `queue-privileges.db.spec.ts` (chạy đủ lệnh với từng vai trò). Nếu nội bộ pg-boss xung đột với RLS
  cho `app`, lùi về spec Assumptions (không RLS trên bảng thư viện, ngoại lệ ghi trong `db:check`) và
  ghi vào mục "Theo dõi độ phức tạp".
- `db:check`: thêm `pgboss` vào danh sách schema ngoài module được phép (không áp quy tắc `b`, `j`; quy
  tắc `a` kiểm `job_common` có RLS; `f` – mọi đối tượng thuộc `owner`).

**Lý do**: nguyên tắc I – hai lớp chặn; `group_id` đã là mã tài khoản (R3) nên chính sách rẻ.

---

## R13. Kiểm khuôn dữ liệu việc và lược bí mật

**Quyết định**:

- Khuôn dữ liệu là Zod `z.strictObject`; khi đăng ký loại việc, duyệt cây khuôn và **từ chối** tên
  trường bị cấm (không phân biệt hoa thường, bỏ `_`): `content`, `body`, `caption`, `text`, `prompt`,
  `message`, `token`, `accesstoken`, `secret`, `password`, `accountid`, `tenantid`. Trường chuỗi phải có
  `.max()` (≤ 2 048); kích thước phong bì sau `JSON.stringify` ≤ 8 192 byte (cấu hình theo loại việc,
  không vượt 8 KB – FR-012).
- Kiểm khuôn khi tạo (lỗi → `QUEUE_PAYLOAD_INVALID`, `AppError` 500 – lỗi lập trình) và khi xử lý (lỗi →
  lỗi tạm thời theo R7, hết lượt thì chôn với `PAYLOAD_INVALID`).
- Tương thích ngược: `v` tăng khi đổi khuôn; bộ xử lý nhận `v` cũ qua `migrate?: (old) => new`; trường mới
  luôn `.optional()`.
- Lược bí mật (`redactError`): bỏ chuỗi kết nối `postgres(ql)?://…`, `Bearer …`, tham số
  `access_token=…`, giá trị khóa `password|secret|token`, chuỗi dài ≥ 32 ký tự base64/hex liền; giữ `name`,
  `code`, thông điệp đã lược. Dùng cho `dead_jobs.last_error` và nhật ký. SC-011 kiểm bằng quét nhật ký mẫu.

---

## R14. Chạy lại việc hỏng từ màn hình hỗ trợ: yêu cầu qua hàm `SECURITY DEFINER`, Worker thực hiện

**Quyết định**:

- Vai trò `support` chỉ đọc (hiến pháp I) và API không có bể `system` (002 R15). Thao tác công khai
  `requestDeadJobRetry(actor, deadJobId, reason)` gọi hàm `infra.request_dead_job_retry(id, staff, reason)`
  (`SECURITY DEFINER`, chủ `owner`, `EXECUTE` chỉ cho `support`) – trong **một** câu lệnh: kiểm
  `generic_retry_allowed` (Q1), kiểm không có yêu cầu đang chờ/việc mới còn hiệu lực, đặt `retry_status =
  'requested'`, ghi `infra.audit_log` (`dead_job.retry_requested` hoặc `dead_job.retry_rejected` kèm lý do
  từ chối). Trả `requested | rejected_not_allowed | rejected_already_active | not_found`.
- Việc định kỳ nội bộ `queue.dead_job_retries` (mỗi phút, Worker): mỗi dòng `requested` → tạo việc mới
  cùng loại/dữ liệu/khóa chống trùng, lượt thử đặt lại, `traceId` mới + `retriedFrom = originalTraceId`,
  trong ngữ cảnh của việc (`systemTx` from-context); cập nhật `retry_status = 'retried'`, `new_job_id`,
  `retried_at`. Khóa trùng → `rejected_already_active`.
- Tra cứu: khung nhìn `infra.support_dead_jobs_search` (không có `payload`, `last_error`) cho
  `supportSearch`, `infra.support_dead_jobs_detail` (có, lọc `account_id = current_account_id()`) cho
  `supportViewAccount`; việc hệ thống xem qua khung nhìn tìm kiếm (không có dữ liệu khách hàng).

**Lý do**: SC-009 "một thao tác" (nhân viên bấm một lần; việc chạy trong ≤ 1 phút); giữ nguyên ranh giới
vai trò CSDL của 002; kiểm toán cùng câu lệnh với yêu cầu.

**Phương án đã loại**: cấp `system` cho API; cho `support` ghi `pgboss.job` (vượt "chỉ đọc", lộ việc mọi
tenant).

---

## R15. Xóa mọi việc của tài khoản (FR-037)

**Quyết định**: `purgeAccountJobs()` chạy trong `systemTx({ tenant: 'from-context' })` (luồng xóa tài
khoản ở Worker): `DELETE FROM pgboss.job_common WHERE group_id = account.current_account_id()::text`
(mọi trạng thái, gồm `active`), `DELETE FROM infra.dead_jobs` (RLS lọc tài khoản), ghi một dòng
`infra.audit_log` `queue.account_jobs_purged` với `metadata = { jobs: n, dead_jobs: m }`. Việc đang chạy
bị xóa: `touch()` kế tiếp báo 0 dòng → bộ xử lý bị hủy, không ghi kết quả, không thử lại – đúng ý "không
thử lại, xóa khi kết thúc" của FR-037 mà không cần cột đánh dấu. Idempotent.

---

## R16. Tắt có kiểm soát, mất kết nối, sẵn sàng

**Quyết định**:

- `ShutdownCoordinator.onStopping` → dừng mọi vòng lấy việc và nhịp hẹn giờ; việc đang chạy đã nằm trong
  `trackInFlight`; sau khi xả xong (≤ 30 giây) `boss.stop({ graceful: false, close: true })`. Quá hạn →
  hủy `AbortSignal`, thoát mã 1; việc chưa xong trả lại theo R5. SC-008 ≤ 35 giây.
- Mất CSDL: lỗi `DbConnectionError` trong vòng lấy việc → chờ giãn cách 1 → 2 → 4 … ≤ 30 giây, không
  thoát; kiểm tra sẵn sàng `queue` = lần lấy việc/heartbeat thành công gần nhất < 30 giây và phiên bản
  schema đúng. `WorkerHealthServer` thêm `GET /readyz` dùng `ReadinessRegistry` (FR-019); `/healthz` giữ
  nguyên (sống).
- Kết quả không bao giờ được ghi "xong" khi chưa chạy xong: `complete` chỉ gọi sau khi bộ xử lý trả về.

---

## R17. Kiểm thử

**Quyết định**:

- Tích hợp `test/queue/**/*.queue.spec.ts`, cấu hình `vitest.queue.config.mts`, lệnh `pnpm test:queue`,
  dùng chung `global-setup` của 002 (CSDL tạm). "Hai bản Worker" = hai `QueueRuntime` độc lập trong cùng
  tiến trình (bể, thể hiện pg-boss riêng); "Worker chết" = tiến trình con (`child_process.fork` +
  `tsx`) bị `SIGKILL`.
- Bộ chịu tải `pnpm test:queue-soak` (SC-001 1 000 việc + 5 lần giết, SC-006 60 khung với lịch 6 trường
  "mỗi 5 giây", SC-004) – không chạy mặc định, chạy trước khi hợp nhất bằng tay và hằng đêm (WBS 1.4).
- Khuôn dùng lại (FR-035): `queueTestKit` trong `apps/server/test/support/queue-test-kit.ts` –
  `runJobInline(def, payload, { accountId })` và `expectIdempotent(def, payload, snapshot)` (chạy hai lần,
  so ảnh chụp do module cung cấp).

---

## Thuật ngữ mới (bổ sung `architecture.md` mục 11)

| Tài liệu / spec | Mã nguồn |
|---|---|
| loại việc | `job type` – `JobTypeDefinition`, tên `<module>.<action>` |
| việc tenant / việc hệ thống | `tenant job` / `system job` (`scope: 'tenant' \| 'system'`) |
| khóa chống trùng | `dedupeKey` (API) → `singleton_key` (pg-boss) |
| giờ chạy sớm nhất | `runAfter` (API) → `start_after` (pg-boss) |
| thời gian khóa | `lock_seconds` → `expireInSeconds`; nhịp gia hạn `heartbeat_seconds` |
| khung thời gian | `slot` (bảng `infra.schedule_slots`) |
| việc định kỳ | `schedule` (`defineSchedule`) |
| cấu hình hàng chờ | `infra.queue_settings` |
| việc hỏng / chôn việc | `infra.dead_jobs` / `buryJob` |
| chạy lại việc hỏng | `retry dead job` (`requestDeadJobRetry`) |
| bể điều khiển hàng chờ | `queue control pool` (vai trò `system`, chỉ Worker) |
| phong bì việc | `job envelope` |
| schema thư viện hàng chờ | `pgboss` |
