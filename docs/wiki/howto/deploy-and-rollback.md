---
type: howto
title: Triển khai và quay về bản trước
sources:
  [
    docs/ci-cd/branching-and-release.md,
    docs/ci-cd/rollback.md,
    docs/ci-cd/emergency-deploy.md,
    docs/ci-cd/rebuild-jenkins.md,
    infra/docs/05-quy-trinh-thay-doi.md,
    infra/docs/04-trien-khai-anh-va-kiem-tra-khoi.md,
    specs/008-cicd-jenkins-pipeline/quickstart.md,
  ]
updated: 2026-11-14
status: draft
related: [concepts/ci-cd.md, concepts/infra-envs.md, concepts/migrations.md, howto/run-tests.md]
---

# Triển khai và quay về

Trạng thái `draft`: quy trình đã viết nhưng chưa diễn tập trên môi trường thật (emergency-deploy ghi rõ chưa diễn tập).

**Triển khai thường (tự động)**: mở PR vào `dev` (kiểm tra `ci/gates` xanh) -> merge -> Jenkins tự triển khai `staging`; PR phát hành
`dev` -> `master` -> tự triển khai `production`. Không đẩy thẳng vào `dev`/`master`. Chi tiết: `docs/ci-cd/branching-and-release.md`.

**Sửa nóng**: tách `hotfix/*` từ `master` -> PR vào `master`; Jenkins mở `backmerge/<sha12>` về `dev`.

**Quay về**: tự động khi `rollout`/`web`/`smoke` hỏng (`helm upgrade --atomic`, `helm rollback app <bản trước> --wait`, khôi phục
`releases/<sha trước>/index.html`), ≤ 10 phút. CSDL **không** hoàn tác. Quay về bản đã triển khai thành công: job
`deploy/<môi trường>/redeploy` (tham số `VERSION`, `REASON`, `ACK_OLDER_THAN_PREVIOUS` nếu cũ hơn bản liền trước) - `docs/ci-cd/rollback.md`.

**Jenkins ngừng**: `docs/ci-cd/emergency-deploy.md` (chạy đúng các tập lệnh `ops/deploy/scripts/*` bằng tay: verify -> ảnh -> migrate
-> helm -> web -> `ops/deploy/smoke/smoke.mjs`); dựng lại Jenkins ≤ 4 giờ: `docs/ci-cd/rebuild-jenkins.md`.

**Hạ tầng**: đổi Terraform qua `pnpm infra check|plan|apply <env>`, staging trước ([infra-envs](../concepts/infra-envs.md)); bí mật:
`pnpm infra secrets`; tắt/bật staging: `pnpm infra power staging off|on`.

## Nguồn

- docs/ci-cd/rollback.md, docs/ci-cd/emergency-deploy.md
- infra/docs/05-quy-trinh-thay-doi.md
