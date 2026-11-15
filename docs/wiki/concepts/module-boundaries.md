---
type: concept
title: Ranh giới module (modular monolith)
sources:
  [
    .specify/memory/constitution.md,
    apps/server/src/modules/modules.manifest.json,
    README.md,
    .specify/memory/architecture.md,
    docs/sample-module.md,
  ]
updated: 2026-11-14
status: current
related: [modules/queue.md, concepts/tenant-rls.md, howto/add-module.md, decisions/index.md]
---

# Ranh giới module (hiến pháp IV, ADR-01/09)

- Một mã nguồn, hai đơn vị triển khai (API, Worker) từ cùng một ảnh. 11 module trong `modules.manifest.json` (`kind`:
  business | gateway | infra), mỗi module một schema, `runsIn`, `allowedDeps`. Manifest là nguồn duy nhất.
- Khuôn thư mục: `index.ts` (export công khai) · `<tên>.module.ts` · `public-api.ts` · `jobs.ts` (nếu có) · `internal/`.
- `pnpm check:boundaries` (luật sinh từ manifest bởi `tooling/boundaries/build-rules.cjs`): không import `internal/` của module
  khác, chỉ dùng module có trong `allowedDeps`, không SQL sang schema khác, `pg-boss` chỉ trong `queue`, SDK AI chỉ
  trong Cổng AI, `bind-account` bị hạn chế.
- Khóa ngoại chỉ trong nội bộ module và tới bảng tài khoản; giữa module dùng mã tham chiếu kiểm khi ghi (ADR-09).
- Sự kiện giữa module = việc ghi vào hàng chờ cùng giao dịch ([queues](queues.md)).
- `approval` chỉ chạy ở API, schema dành sẵn rỗng.
- Hợp đồng web <-> API dùng chung ở `packages/shared/src/modules/<tên>/`, nhập bằng `@app/shared/<tên>`.

## Nguồn

- .specify/memory/constitution.md (nguyên tắc IV)
- README.md (mục 6, 8)
