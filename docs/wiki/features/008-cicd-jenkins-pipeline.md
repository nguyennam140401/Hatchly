---
type: feature
title: 008 CI/CD Jenkins cho test và release
sources:
  [
    specs/008-cicd-jenkins-pipeline/spec.md,
    specs/008-cicd-jenkins-pipeline/plan.md,
    specs/008-cicd-jenkins-pipeline/tasks.md,
    specs/008-cicd-jenkins-pipeline/data-model.md,
    specs/008-cicd-jenkins-pipeline/research.md,
    specs/008-cicd-jenkins-pipeline/quickstart.md,
    specs/008-cicd-jenkins-pipeline/contracts/deploy-pipeline.md,
    specs/008-cicd-jenkins-pipeline/contracts/quality-gates.md,
    specs/008-cicd-jenkins-pipeline/contracts/jenkins-platform.md,
    specs/008-cicd-jenkins-pipeline/contracts/environment-inputs.md,
    docs/ci-cd/gates.md,
    docs/ci-cd/branching-and-release.md,
    docs/ci-cd/rollback.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    concepts/ci-cd.md,
    concepts/infra-envs.md,
    concepts/migrations.md,
    concepts/tenant-rls.md,
    concepts/module-boundaries.md,
    features/007-terraform-infra-environments.md,
  ]
---

# 008 CI/CD Jenkins cho test và release

## Mục tiêu

Biến `pnpm verify` thành cổng chất lượng bắt buộc chặn hợp nhất vào `dev`/`master`, và tự triển khai sau hợp
nhất (`dev` → staging, `master` → production) do Jenkins điều phối (WBS H2).

## Mã FR/NFR

- FR-001…FR-047 và SC-001…SC-014 của spec (`specs/008-cicd-jenkins-pipeline/spec.md`); bốn user story: cổng
  chặn merge (P1), tự cập nhật test (P2), tự cập nhật release an toàn (P3), thông tin triển khai kín và tách
  môi trường (P4).
- Hiến pháp: cổng CI bắt buộc (truy cập chéo RLS, phụ thuộc module, strict TS/lint, quét bí mật), migration
  tương thích ngược, API và Worker phát hành cùng nhau.

## Trạng thái

`current`. tasks.md: 81/99 xong. 18 tác vụ mở là bước làm tay hoặc chờ môi trường thật: ADR Jenkins (T037),
quyết định chi phí (T038), dựng máy ảo (T039, T052), ruleset GitHub (T060), quickstart trên staging/production
(T080–T090, chờ 007), diễn tập SC-013/SC-014 (T097–T098) (`specs/008-cicd-jenkins-pipeline/tasks.md`).

## Quyết định chính

- Một nguồn sự thật cho cổng: `tooling/verify.mjs` (thêm `--ci`, `--only`, `--report`, ngoại lệ); `Jenkinsfile`
  chỉ gọi lệnh và đăng GitHub Checks. Năm cổng mới: `check:release-source`, `db:immutable`, `db:compat`,
  `check:image`, `check:pipeline`.
- Jenkins ở một máy ảo riêng ngoài hai cụm, cấu hình bằng mã (JCasC + Job DSL), hai tác nhân tách người dùng
  OS: `ci` (mã chưa review, không có thông tin triển khai) và `deploy` (mã đã hợp nhất). Credential đặt theo
  thư mục job nên test/release không dùng chéo.
- Chuỗi triển khai: ảnh mỗi commit (thẻ = SHA, triển khai theo digest) → Job migration vai trò `owner` →
  `helm upgrade --atomic` cho `api`+`worker` → web (`index.html` cuối) → smoke qua HTTPS → GitHub Deployment +
  Telegram. Hỏng thì quay về ứng dụng trước; CSDL chỉ đi tới.
- Kho mã GitHub; merge vào `master` triển khai ngay, không chờ xác nhận thêm; `hotfix/*` vào thẳng `master` rồi
  Jenkins mở PR đưa ngược về `dev`. Khi chỉ có một người, việc chủ dự án bấm merge là bước duyệt
  (spec.md, mục Clarifications).
- `provisioned: false` cho phép làm US1 trước khi 007 xong (`contracts/environment-inputs.md`).

## Chạm tới

- `tooling/verify.mjs`, `Jenkinsfile`, `ops/ci/`, `ops/deploy/env/{staging,production}.yaml`, `infra/ci/`.
- Bảng mới duy nhất: `infra.smoke_pings` (data-model.md mục 8); `infra.schema_migrations` đã có.
- Lịch sử triển khai = GitHub Deployments; nhật ký Jenkins giữ 400 ngày; ngoại lệ cổng ở
  `ops/ci/exceptions/*.yml` (hiệu lực ≤ 7 ngày).
- Không thêm phụ thuộc chạy nào vào `api`/`worker`.

## Điểm cần biết khi sửa tiếp

- Thêm kiểm tra mới = thêm vào `tooling/verify.mjs`, không viết riêng trong `Jenkinsfile`.
- Migration phải bất biến và tương thích ngược (`db:immutable`, `db:compat`); xem
  `docs/ci-cd/backward-compatible-migrations.md`.
- Quay về (`docs/ci-cd/rollback.md`) chỉ lùi ứng dụng, không lùi CSDL.
- Phần mở rộng nạp `Jenkinsfile` từ nhánh tin cậy (T053, rủi ro R-6) chưa chốt.
- Phiên bản Jenkins/plugin cố định ở `ops/ci/versions.env`, `plugins.txt`; không ghi số trong plan.

## Nguồn

`specs/008-cicd-jenkins-pipeline/` (spec, plan, tasks, research, data-model, quickstart, contracts/*);
tài liệu vận hành `docs/ci-cd/`.
