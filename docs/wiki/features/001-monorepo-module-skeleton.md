---
type: feature
title: 001 – Kho mã nguồn chung chia module
sources:
  [
    specs/001-monorepo-module-skeleton/spec.md,
    specs/001-monorepo-module-skeleton/plan.md,
    specs/001-monorepo-module-skeleton/tasks.md,
    specs/001-monorepo-module-skeleton/research.md,
    specs/001-monorepo-module-skeleton/contracts/module-manifest.md,
    specs/001-monorepo-module-skeleton/contracts/http-api.md,
    specs/001-monorepo-module-skeleton/contracts/repo-commands.md,
    specs/001-monorepo-module-skeleton/quickstart.md,
  ]
updated: 2026-11-14
status: current
related: [concepts/module-boundaries.md, concepts/ci-cd.md, modules/queue.md, modules/account.md]
---

# 001 – Kho mã nguồn chung chia module

## Mục tiêu

Nền móng cho đội dev: một monorepo (web, server, gói dùng chung) trong đó `apps/server` chạy
thành hai đơn vị **API** và **Worker** từ cùng mã nguồn/ảnh container, có sẵn 11 module đúng ranh
giới (ADD mục 6) để mọi tính năng sau có chỗ đặt mã ngay từ đầu. Không có màn hình cho khách hàng.
Truy vết: WBS 1.1, ADR-01, ADR-09, hiến pháp IV, IX (`specs/001-monorepo-module-skeleton/spec.md`).

## Mã FR/NFR

Chỉ có FR-001…FR-023 nội bộ của spec (không phải FR sản phẩm). Nhóm chính:

- FR-001/002/012: monorepo, hai điểm khởi động `api.ts` / `worker.ts`, module đăng ký vào cả hai.
- FR-003…006: health live/ready, Worker không mở cổng nghiệp vụ, tắt có kiểm soát, cấu hình kiểm tra khi khởi động.
- FR-007…011a: 11 module, một điểm công khai/module, schema riêng, kiểm tra ranh giới + `allowedDeps`.
- FR-013…: lược đồ kiểm tra dùng chung (`@app/shared`), API bắt buộc validate đầu vào.

## Trạng thái

`tasks.md`: 64/64 việc xong (`specs/001-monorepo-module-skeleton/tasks.md`). Đã merge vào `dev`.

## Quyết định chính

- Kê khai module ở một nơi: `apps/server/src/modules/modules.manifest.json` (`name`, `kind`,
  `schema`, `runsIn`, `allowedDeps`, `reservedSchema`) – sinh quy tắc `.dependency-cruiser.cjs`
  (`contracts/module-manifest.md`). `approval` là schema dành sẵn, chưa có bảng.
- `platform_gateway` có schema riêng (không dùng chung `publishing`) – clarify 2026-11-07.
- Lược đồ kiểm tra chạy thật dùng chung, kiểu suy ra từ lược đồ (`@app/shared`).
- Worker: kiểm tra sống + tắt có kiểm soát (ngừng nhận việc, chờ ≤ 30 s) (`research.md` R5).
- Cấu hình bằng biến môi trường, kiểm tra khi khởi động; nhật ký có cấu trúc tối thiểu (R6, R7).
- Một ảnh container, khác lệnh khởi động (R14).

## Chạm tới

- Module: tất cả 11 module (khung rỗng) – xem [module-boundaries](../concepts/module-boundaries.md).
- Thư mục: `apps/server/src/{api.ts,worker.ts,core,modules}`, `apps/web`, gói shared.
- API: liveness/readiness, định dạng lỗi, CORS (`contracts/http-api.md`).
- Lệnh gốc repo (`contracts/repo-commands.md`): kiểm tra kiểu, lint, kiểm ranh giới, test.

## Điểm cần biết khi sửa tiếp

- Thêm module/đổi phụ thuộc = sửa manifest trước; đồ thị `allowedDeps` không được có vòng,
  `infra` không phụ thuộc module nghiệp vụ.
- Module chỉ import điểm công khai (`index.ts`) của module khác; vi phạm làm hỏng kiểm tra CI.
- Đổi nền tảng ngăn xếp cần ADR mới (constitution IX).
- Tên module VN → EN theo bảng trong `.specify/memory/architecture.md`.

## Nguồn

- `specs/001-monorepo-module-skeleton/spec.md` · `plan.md` · `tasks.md` · `research.md` · `data-model.md`
- `specs/001-monorepo-module-skeleton/contracts/module-manifest.md` · `http-api.md` · `repo-commands.md`
- `specs/001-monorepo-module-skeleton/quickstart.md`
