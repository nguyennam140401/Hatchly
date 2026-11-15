---
type: concept
title: CI/CD với Jenkins và cổng chất lượng
sources:
  [
    docs/adr/ADR-11-jenkins-cicd.md,
    docs/ci-cd/gates.md,
    docs/ci-cd/branching-and-release.md,
    docs/ci-cd/rollback.md,
    docs/ci-cd/emergency-deploy.md,
    docs/ci-cd/gate-exceptions.md,
    docs/ci-cd/rebuild-jenkins.md,
    ops/ci/gate-lanes.json,
    ops/ci/Jenkinsfile.ci,
    ops/ci/Jenkinsfile.deploy,
    README.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    concepts/migrations.md,
    concepts/infra-envs.md,
    howto/deploy-and-rollback.md,
    howto/run-tests.md,
    decisions/index.md,
  ]
---

# CI/CD (008, ADR-11)

**Đã hiện thực phần mã/tài liệu**; một số phần chờ môi trường thật (xem "Còn thiếu").

- **Cổng**: `pnpm verify` là nguồn duy nhất; máy cá nhân và Jenkins chạy cùng danh sách. `--ci` không cho "bỏ qua"
  (thiếu điều kiện = không đạt). Cổng: `build:shared`, `typecheck`, `lint`, `check:boundaries`, `check:secrets`,
  `check:pipeline`, `check:release-source`, `test`, `check:web-bundle`, `db:lint-migrations`, `db:immutable`, `db:compat`,
  `test:db`, `test:queue`... theo làn trong `ops/ci/gate-lanes.json`. Ngoại lệ có hạn: `docs/ci-cd/gate-exceptions.md`
  (không cho ngoại lệ với `check:secrets`, `check:release-source`, `db:immutable`).
- **Nhánh**: `impl/*`/`feature/*` -> PR -> `dev` (tự triển khai `staging`) -> PR phát hành -> `master` (`production`);
  `hotfix/*` tách từ `master`, Jenkins mở `backmerge/<sha12>` về `dev`. Kiểm tra bắt buộc duy nhất: `ci/gates`.
- **Triển khai** (`Jenkinsfile.deploy`): gates -> ảnh (theo digest, quét Trivy) -> Job `migrate-<sha12>` -> `helm upgrade
--atomic` -> web (`releases/<sha>/`) -> kiểm tra khói; hỏng ở `rollout`/`web`/`smoke` tự quay về ≤ 10 phút. Thông báo Telegram.
- **Jenkins** tự vận hành trên một máy ảo trong nước, cấu hình bằng mã (JCasC + Job DSL), hai tác nhân tách quyền;
  dựng lại ≤ 4 giờ (`rebuild-jenkins.md`). Khi Jenkins chết: `emergency-deploy.md` (chưa diễn tập).
- Lệnh chi tiết: [deploy-and-rollback](../howto/deploy-and-rollback.md); tương thích CSDL: [migrations](migrations.md).

**Còn thiếu / lưu ý**: ruleset bảo vệ nhánh chỉ tồn tại dạng tệp (gói GitHub miễn phí, kho riêng tư không áp được);
ADR-11 vẫn ghi "Đề xuất"; emergency-deploy chưa diễn tập (chờ môi trường 007).

## Nguồn

- docs/ci-cd/gates.md, docs/ci-cd/branching-and-release.md
- docs/adr/ADR-11-jenkins-cicd.md
