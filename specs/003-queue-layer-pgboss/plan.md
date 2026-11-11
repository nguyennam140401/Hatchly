# Implementation Plan: Lớp hàng chờ nội bộ – 6 hàng chờ, giới hạn theo tenant, việc hỏng, việc định kỳ

**Branch**: `impl/003-queue-layer-pgboss` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-queue-layer-pgboss/spec.md`

## Summary

Module `queue` (WBS 1.3) bọc **pg-boss 12.38.0** (cố định chính xác, nạp bằng `import()` vì thư viện là
ESM) sau một giao diện công khai không lộ kiểu thư viện. Schema `pgboss` được cài bằng **migration tay**
sinh từ `getConstructionPlans` và chạy bằng `owner`; 6 hàng chờ pg-boss chính sách `exclusive` được tạo
bằng bước hậu-migration. Việc là một **phong bì** `{ type, v, accountId, traceId, payload }`; `group_id`
= mã tài khoản, dùng cho cả giới hạn tenant lẫn **RLS trên `pgboss.job_common`** (vai trò `app` chỉ thấy
việc của tenant hiện hành).

Tạo/hủy/đổi giờ việc chạy **trên chính kết nối của `tenantTx`/`systemTx`** (bộ nối `IDatabase`), lấy
`accountId` từ giao dịch. Worker không dùng `work()` mà có **bộ chạy tự quản**: mỗi hàng chờ một vòng lấy
việc trên **bể điều khiển** riêng (vai trò `system`), lệnh lấy việc chạy dưới **khóa tư vấn theo hàng chờ**
để `groupConcurrency` không bị vượt khi hai bản Worker lấy cùng lúc; khóa việc = **heartbeat 30 giây** +
trần cứng bằng "thời gian khóa"; kết quả bộ xử lý (`retryAfter`, `noRetry`, `PermanentJobError`, lỗi tạm)
ánh xạ sang `complete`/`fail`+`update(start_after)`/chôn. Việc hỏng lưu ở `infra.dead_jobs` (RLS, cho phép
`account_id` NULL), chạy lại từ hỗ trợ qua hàm `SECURITY DEFINER` ghi kiểm toán rồi Worker thực hiện; loại
việc `publish` không cho chạy lại chung (Q1). Bộ hẹn giờ định kỳ chạy trên mọi bản, khóa khung bằng bảng
`infra.schedule_slots`, chống chồng bằng khóa `scheduled:{name}`. Thông số hàng chờ ở
`infra.queue_settings`, đọc lại mỗi 60 giây. Chỉ số qua OpenTelemetry API, quy tắc cảnh báo Prometheus
trong kho mã, `/readyz` cho Worker.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict) trên Node.js 24 LTS – như 001/002

**Primary Dependencies**: thêm `pg-boss@12.38.0`, `cron-parser` (cùng bản pg-boss 12.38.0 khai báo, cố
định chính xác), `@opentelemetry/api@1.9.0`; dev: `@opentelemetry/sdk-metrics` (cố định) cho kiểm thử chỉ
số, `yaml` (cố định) cho kiểm thử quy tắc cảnh báo. Dùng lại NestJS 11, Drizzle 0.45, `pg` 8.23, Zod 4,
pino, `core/db` của 002 (R1).

**Storage**: PostgreSQL 17 cục bộ (≥ 13 ở môi trường thật); schema mới `pgboss` (thư viện); bảng mới
`infra.queue_settings`, `infra.dead_jobs`, `infra.schedule_slots`; hàm `SECURITY DEFINER` mới trong `infra`

**Testing**: Vitest. Đơn vị trong `pnpm test`; tích hợp `apps/server/test/queue/**/*.queue.spec.ts` bằng
`pnpm test:queue` (PostgreSQL thật, dùng chung `global-setup` của 002, tuần tự); chịu tải
`pnpm test:queue-soak` chạy tay/hằng đêm (R17)

**Target Platform**: Container Linux trên Kubernetes (2 bản `worker`, 2 bản `api`); máy phát triển Windows
10/11 và Linux

**Project Type**: Web application – monorepo; thay đổi ở `apps/server` (module `queue`, `core/db`,
`core/health`, `src/db`, `worker.ts`, `api.ts`), `ops/alerts/`, `tooling/` (ranh giới, verify),
`.dependency-cruiser.cjs`, `.specify/memory/architecture.md` (thuật ngữ)

**Performance Goals**: `publish` đến giờ được lấy ≤ 30 giây p99 khi `media` đầy (SC-003; chu kỳ hỏi
1 giây); tạo việc thêm ≤ 10 ms p95 vào giao dịch (SC-007); tắt ≤ 35 giây (SC-008); thông số mới có hiệu
lực ≤ 5 phút (đọc lại mỗi 60 giây)

**Constraints**: không thêm hạ tầng (không Redis/broker/dịch vụ – ADR-03/08); `accountId` chỉ từ ngữ
cảnh; dữ liệu việc ≤ 8 KB chỉ mã tham chiếu; mọi giờ so sánh lấy từ CSDL; không lộ kiểu pg-boss ra ngoài
module; thay đổi CSDL tương thích ngược

**Scale/Scope**: tải GĐ1 ≈ 1 000 lượt đăng/ngày (đỉnh ≈ 5/phút), vài nghìn việc media/AI/ngày; chịu ×10
không đổi kiến trúc. 26 luồng/bản Worker, 2 bản

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá | Bằng chứng trong thiết kế |
|---|---|---|
| **I. Cô lập tenant** (KTL) | ĐẠT | `enqueue` không có tham số `accountId` – lấy từ giao dịch (R4); Worker đặt lại ngữ cảnh bằng `runWithJobContext` trước bộ xử lý (FR-014); RLS trên `pgboss.job_common` cho `app` theo `group_id` và trên `infra.dead_jobs` (R12, data-model §5); hỗ trợ chỉ đọc qua khung nhìn + kiểm toán, chạy lại qua hàm ghi kiểm toán (R14); `purgeAccountJobs` (FR-037); kiểm thử `queue-privileges`, `dead-jobs-support` |
| **II. Đăng bài tin cậy, không trùng** (KTL) | ĐẠT | Tạo việc cùng giao dịch với lượt đăng (R4); khóa `publish:{attemptId}` + `exclusive` (R3); không bản thứ hai khi khóa còn hiệu lực, ghi kết quả theo `JobAttempt` (R5); `publish` thử lại theo bộ xử lý – ADR-04 (R7); loại việc `publish` cấm chạy lại chung (Q1, R14); bộ hẹn giờ chung của hệ thống |
| **III. Cổng AI, chặn ngân sách** (KTL) | KHÔNG ÁP DỤNG trực tiếp | Không gọi AI. `noRetry(reason)` cho phép `ai_batch` kết thúc khi hết ngân sách mà không vào việc hỏng (FR-015) |
| **IV. Modular monolith** | ĐẠT | Chỉ `modules/queue/internal/**` nhập `pg-boss` (quy tắc ranh giới mới); `queue` sở hữu `infra` + `pgboss`, không phụ thuộc module nghiệp vụ; module khác chỉ dùng `index.ts`; sự kiện giữa module = việc tạo trong giao dịch |
| **V. Việc nền bền vững, idempotent** | ĐẠT | pg-boss trong PostgreSQL; 6 hàng chờ tách, giới hạn/bản + /tenant phối hợp qua CSDL (R6); tắt có kiểm soát 30 giây (R16); khuôn `expectIdempotent` (FR-035); `buryJob` idempotent theo `original_job_id` |
| **VI. AI đề xuất, con người quyết** | ĐẠT (phần liên quan) | Quyền chạy lại việc hỏng kiểm ở máy chủ (actor bắt buộc, guard WBS 4.7); thông điệp từ chối `publish` kèm hành động khắc phục; không màn hình khách hàng |
| **VII. Bí mật & dữ liệu cá nhân** | ĐẠT | Khuôn dữ liệu cấm trường nội dung/prompt/token (R13); lược bí mật trước khi lưu lỗi/nhật ký; dữ liệu trong PostgreSQL trong nước; xóa tài khoản xóa việc + việc hỏng (Q3, FR-037); `audit_log` chỉ ghi số lượng |
| **VIII. Quan sát được** | ĐẠT | `traceId` trong phong bì, khôi phục ở Worker, nối khi chạy lại; OTel API; nhật ký có cấu trúc một dòng/lượt; 10 quy tắc cảnh báo gồm `publish` quá hạn > 5 phút (contracts/queue-observability.md) |
| **IX. Đơn giản, chuẩn mở, có truy vết** | ĐẠT | pg-boss đã chốt (T3, ADR-03); cố định phiên bản, bọc sau giao diện; phần thiếu (khóa lấy việc, bộ hẹn giờ, việc hỏng) bổ sung bằng PostgreSQL trong module (spec Assumptions) – không cần ADR mới; không thêm thành phần hạ tầng |

**Cổng chất lượng CI** liên quan: (1) truy cập chéo – thêm cho `infra.dead_jobs` và việc pg-boss; (2)
`db:check` – `pgboss.job_common` có RLS, `nullableTenant`; (3) ranh giới – `pgboss-only-in-queue`; (4)
strict TS/lint; (5) quét bí mật nhật ký – `secrets-in-logs.queue.spec.ts`. Kiểm thử bắt buộc theo vùng rủi
ro "bộ xử lý việc nền chạy lại hai lần" → `expectIdempotent`.

**Kết quả cổng trước Phase 0**: ĐẠT, không vi phạm cần biện minh.

**Kiểm tra lại sau Phase 1**: ĐẠT. Hai điểm cần theo dõi khi implement (không phải vi phạm):
(a) R12 – nếu RLS trên bảng pg-boss xung đột với nội bộ thư viện thì lùi về phương án của spec
Assumptions và ghi vào "Theo dõi độ phức tạp"; (b) R8/R14 – việc định kỳ nội bộ `queue.sweep_failed`,
`queue.dead_job_retries` chạy mỗi phút: chạy lại việc hỏng có độ trễ ≤ 1 phút sau khi nhân viên bấm.

## Project Structure

### Documentation (this feature)

```text
specs/003-queue-layer-pgboss/
├── plan.md              # Tệp này
├── research.md          # Phase 0 – R1…R17 + thuật ngữ
├── data-model.md        # Phase 1 – hàng chờ, phong bì, queue_settings, dead_jobs, schedule_slots
├── quickstart.md        # Phase 1 – chạy & kiểm chứng
├── contracts/
│   ├── queue-api.md            # giao diện công khai TypeScript của module queue
│   ├── queue-observability.md  # chỉ số, nhật ký, quy tắc cảnh báo
│   └── queue-commands.md       # lệnh, biến môi trường, /readyz
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/server/
├── drizzle/migrations/
│   ├── 0005_pgboss_install.sql          # tay: SQL sinh từ getConstructionPlans + quyền + RLS (R2, R12)
│   ├── 0006_queue_settings.sql          # drizzle-kit + seed 6 dòng + REVOKE (data-model §4)
│   ├── 0007_dead_jobs.sql               # tay: bảng, RLS 2 chính sách, hàm SECURITY DEFINER, khung nhìn hỗ trợ
│   └── 0008_schedule_slots_partitions.sql # schedule_slots + drop_audit_log_partitions_before
├── src/
│   ├── modules/queue/
│   │   ├── index.ts                     # xuất giao diện công khai (contracts/queue-api.md)
│   │   ├── public-api.ts                # kiểu công khai: QueueName, EnqueueResult, JobContext, …
│   │   ├── queue.module.ts              # NestJS: QueueRuntime ở worker, QueueProducer ở api
│   │   ├── job-types.ts                 # defineJobType, registry, kiểm tên trường (R13)
│   │   ├── schedules.ts                 # defineSchedule, registerPartitionedLog
│   │   ├── results.ts                   # retryAfter, noRetry, PermanentJobError
│   │   ├── jobs.ts                      # loại việc + lịch nội bộ (queue.cleanup, partitions, sweep, retries)
│   │   └── internal/
│   │       ├── pgboss/boss-loader.ts    # import('pg-boss') duy nhất, tạo thể hiện api/worker
│   │       ├── pgboss/tx-database.ts    # IDatabase trên PoolClient của giao dịch (R4)
│   │       ├── producer.ts              # enqueue, enqueueMany, cancel, reschedule
│   │       ├── runtime/consumer-loop.ts # vòng lấy việc + khóa tư vấn (R6)
│   │       ├── runtime/job-runner.ts    # ngữ cảnh, heartbeat, AbortSignal, ánh xạ kết quả (R5, R7)
│   │       ├── runtime/bury.ts          # buryJob, sweep_failed (R8)
│   │       ├── runtime/settings.ts      # đọc/kiểm queue_settings, updateQueue (R10)
│   │       ├── scheduler/scheduler.ts   # nhịp 10 giây, tính slot bằng giờ CSDL (R9)
│   │       ├── dead-jobs.ts             # tra cứu, yêu cầu chạy lại, thực hiện chạy lại (R14)
│   │       ├── purge.ts                 # purgeAccountJobs (R15)
│   │       ├── observability.ts         # meter, nhật ký queue.job_finished (R11)
│   │       ├── redact.ts                # lược bí mật (R13)
│   │       ├── readiness.ts             # kiểm tra 'queue' (R16)
│   │       └── db/schema.ts             # Drizzle: queue_settings, dead_jobs, schedule_slots
│   ├── core/db/table-registry.ts        # + nullableTenant
│   ├── core/db/table-builders.ts        # + sharedTable primaryKey ghép (nếu thiếu)
│   ├── core/health/worker-health-server.ts # + GET /readyz
│   ├── core/config/config.schema.ts     # + QUEUE_* (contracts/queue-commands.md)
│   ├── db/migrate.ts                    # + ensureQueues sau migration
│   ├── db/check-conventions.ts          # + schema pgboss, nullableTenant
│   ├── db/queue-sql.ts                  # pnpm queue:sql
│   └── worker.ts                        # khởi động QueueRuntime, log worker.ready với 6 hàng chờ
├── test/
│   ├── queue/                           # *.queue.spec.ts (quickstart §3), soak/
│   ├── support/queue-test-kit.ts        # runJobInline, expectIdempotent, startTestWorkers (FR-035)
│   └── unit/queue/                      # slot, giãn cách, redact, kiểm khuôn, alert rules
├── vitest.queue.config.mts
└── docs/queue.md                        # tài liệu tiếng Việt (FR-036)
ops/alerts/queue.rules.yml               # 10 quy tắc (FR-032)
.dependency-cruiser.cjs                  # + pgboss-only-in-queue, cron-parser-only-in-queue
.specify/memory/architecture.md          # mục 11 thuật ngữ, mục 6 ghi chú hiện thực
```

**Structure Decision**: giữ bố cục monorepo của 001/002; toàn bộ mã hàng chờ nằm trong
`apps/server/src/modules/queue` (giao diện ở gốc module, thực thi trong `internal/`); thay đổi lõi chỉ là
mở rộng nhỏ (sổ đăng ký bảng, `/readyz`, cấu hình, migrate/check). Migration mới đánh số tiếp 0005–0008.

## Complexity Tracking

| Độ lệch | Vì sao cần | Phương án đơn giản hơn đã loại |
|---|---|---|
| `infra.dead_jobs.account_id` cho phép NULL (hiến pháp I: bảng khách hàng `account_id NOT NULL`) | Việc hệ thống (định kỳ, không thuộc tài khoản) cũng phải vào việc hỏng để tra cứu/chạy lại một chỗ (FR-023) | Hai bảng việc hỏng (tenant / hệ thống): nhân đôi khung nhìn, hàm, việc định kỳ. Lớp bù: RLS `system_scoped` (dòng NULL chỉ thấy khi giao dịch không tenant), `app` không bao giờ thấy dòng NULL, quy tắc `l` của `db:check` bắt buộc khai báo `nullableTenant.reason`, kiểm thử truy cập chéo `test/db/dead-jobs-isolation.db.spec.ts` |

Ngoài độ lệch trên, không có vi phạm hiến pháp khác. Các phần tự làm thay vì dùng sẵn của thư viện (đã ghi lý do ở
research): vòng lấy việc + khóa tư vấn (R6 – `groupConcurrency` không có khóa giữa các bản), bộ hẹn giờ
trên bảng khung (R9), việc hỏng ở bảng riêng (R8, spec Assumptions).

**Kết quả khi implement (T028):** RLS trên `pgboss.job` / `pgboss.job_common` KHÔNG xung đột với lệnh của
pg-boss 12.38.0 (send/insert/findJobs/cancel/update chạy được bằng `app` trong `tenantTx`) – áp dụng đầy đủ
R12, **không** dùng phương án lùi. Điều chỉnh nhỏ so với thiết kế: `infra.request_dead_job_retry` nhận thêm
`p_audit_id` (UUID v7 sinh ở ứng dụng) và `p_trace_id`; thêm hàm `infra.pending_final_failures(int)` cho
`queue.sweep_failed`; `core/db/support.ts` thêm `supportCommand` (gọi hàm tự ghi kiểm toán, không chèn dòng
`support.search`); `core/lifecycle/shutdown-signals.ts` thoát theo `process.exitCode` (hàng chờ đặt 1 khi
hủy việc vì tắt quá hạn); bộ gác truy vấn không chặn bảng `nullableTenant`.
Worker lấy mã tài khoản từ `group_id` của việc (đã qua RLS `WITH CHECK`), không tin `data.accountId`; hai giá
trị lệch → chôn `PERMANENT_ERROR` (`ACCOUNT_MISMATCH`), không chạy bộ xử lý (rà hiến pháp T075).
