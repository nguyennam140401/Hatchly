---
type: howto
title: Chạy kiểm thử và cổng chất lượng
sources:
  [
    package.json,
    README.md,
    apps/server/docs/database.md,
    apps/server/docs/queue.md,
    specs/008-cicd-jenkins-pipeline/quickstart.md,
    docs/ci-cd/gates.md,
  ]
updated: 2026-11-14
status: current
related: [concepts/ci-cd.md, concepts/tenant-rls.md, concepts/queues.md, howto/add-migration.md]
---

# Chạy kiểm thử

Chuẩn bị một lần (PowerShell): `pnpm install`; `Copy-Item apps/server/.env.example apps/server/.env`; `pnpm db:up`;
`pnpm db:setup`; đặt `TEST_DATABASE_ADMIN_URL` (xem [README](../../../README.md) mục 3).

| Mục đích                                                      | Lệnh                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Mọi cổng như CI (máy cá nhân, bước thiếu điều kiện -> bỏ qua) | `pnpm verify`                                                                   |
| Đúng lệnh Jenkins (không "bỏ qua")                            | `pnpm verify --ci --report verify-report.json`                                  |
| Chỉ vài bước                                                  | `pnpm verify --only test:db,lint`                                               |
| Đơn vị mọi gói                                                | `pnpm test`                                                                     |
| Kiểu / lint / ranh giới / bí mật                              | `pnpm typecheck` · `pnpm lint` · `pnpm check:boundaries` · `pnpm check:secrets` |
| CSDL thật (RLS, truy cập chéo)                                | `pnpm db:check` rồi `pnpm test:db`                                              |
| Hàng chờ                                                      | `pnpm test:queue` (`pnpm test:queue-soak` để chạy dài)                          |
| Tương thích CSDL bản cũ/mới                                   | `pnpm test:compat`, `pnpm db:compat`                                            |
| Hạ tầng (007)                                                 | `pnpm test:infra`                                                               |
| E2E trình duyệt                                               | `pnpm test:e2e` (cần `pnpm exec playwright install chromium`)                   |
| Tắt Worker có kiểm soát trên Linux (máy Windows)              | `pnpm --filter @app/server test:linux` (cần Docker)                             |

Ghi chú: không chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080). Chi tiết từng cổng: `docs/ci-cd/gates.md`.

## Nguồn

- README.md (mục 2-4), package.json
- docs/ci-cd/gates.md
