---
type: module
title: Module queue (Hàng chờ – hạ tầng)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/queue/public-api.ts,
    apps/server/src/modules/queue/index.ts,
    apps/server/src/modules/queue/jobs.ts,
    apps/server/src/modules/queue/internal/db/schema.ts,
    apps/server/docs/queue.md,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-14
status: current
related: [concepts/queues.md, concepts/module-boundaries.md, concepts/tenant-rls.md]
---

# queue – Hàng chờ (hạ tầng)

## Trách nhiệm

Bọc pg-boss sau giao diện riêng (không kiểu pg-boss nào lộ ra): tạo việc cùng giao dịch, giới hạn đồng thời theo tenant,
thử lại, việc hỏng, việc định kỳ, nhật ký phân vùng, dọn việc theo tài khoản.

## Schema/bảng

Schema `infra` (+ schema thư viện `pgboss` 12.38.0): `queue_settings`, `dead_jobs`, `schedule_slots`, `smoke_pings`
(008), `audit_log` (migration `0003`). Xem [concepts/queues.md](../concepts/queues.md).

## Giao diện công khai

`index.ts`: `defineJobType`, `enqueue`, `enqueueMany`, `cancelJob`, `rescheduleJob`, `registerJobHandler`, `noRetry`,
`retryAfter`, `PermanentJobError`, `defineSchedule`, `registerPartitionedLog`, `getDeadJob`, `searchDeadJobs`,
`requestDeadJobRetry`, `purgeAccountJobs`, `QueueModule`, `QueueLifecycle` + kiểu trong `public-api.ts` (`QUEUE_NAMES`:
publish, media, ai_batch, trends, notify, scheduled). Việc nội bộ: `queue.cleanup`, `queue.partitions`,
`queue.sweep_failed`, `queue.dead_job_retries`.

## Phụ thuộc cho phép

Không (`allowedDeps: []`); mọi module khác phụ thuộc vào nó.

## Chạy ở

api (tạo việc, tra việc hỏng) + worker (xử lý, hẹn giờ).

## Tính năng liên quan

[003](../features/003-queue-layer-pgboss.md), [002](../features/002-db-layer-tenant-rls.md) (RLS trên `pgboss.job_common`),
[008](../features/008-cicd-jenkins-pipeline.md) (`infra.smoke_pings`).

## Nguồn

- apps/server/src/modules/queue/public-api.ts
- apps/server/docs/queue.md
