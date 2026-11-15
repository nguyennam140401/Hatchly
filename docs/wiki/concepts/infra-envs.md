---
type: concept
title: Hạ tầng và môi trường (Terraform, VNG Cloud)
sources:
  [
    infra/docs/00-tong-quan.md,
    infra/docs/05-quy-trinh-thay-doi.md,
    infra/docs/06-bi-mat-va-khoa.md,
    infra/docs/09-tat-bat-thu-nghiem.md,
    infra/docs/11-phu-thuoc-nha-cung-cap.md,
    infra/README.md,
    .specify/memory/architecture.md,
    specs/007-terraform-infra-environments/quickstart.md,
  ]
updated: 2026-11-14
status: current
related: [concepts/ci-cd.md, howto/deploy-and-rollback.md, decisions/index.md]
---

# Hạ tầng và môi trường (007, ADR-10)

**Đã hiện thực dạng mã Terraform + CLI**; chưa chắc đã dựng trên cloud thật (xem `infra/docs/ket-qua-kiem-chung.md`).

- Hai môi trường tách biệt hoàn toàn (project, mạng, cụm, kho tệp, khóa): `staging` (1 máy, tắt được, sao lưu 3 ngày) và
  `production` (2 máy, 2 bản CSDL, sao lưu 30 ngày). Cùng một mã, khác `infra/envs/<env>.tfvars`.
- Hai stack: `infra/stacks/cloud` (mạng, cụm VKS, cân bằng tải, S3 - chỉ lớp nhà cung cấp
  `infra/modules/provider-vngcloud` biết VNG Cloud) và `infra/stacks/platform` (ingress HTTPS, chứng chỉ, CSDL qua
  `database-cnpg`, chính sách mạng, quyền - chuẩn mở). Đổi nhà cung cấp = viết module mới đúng hợp đồng.
- **Không gọi `terraform` trực tiếp**: dùng `pnpm infra <lệnh> <env>` (`check`, `plan`, `apply`, `drift`, `secrets`, `smoke`,
  `dns-check`, `power`, `drill`, `outputs`, `records`, `up`).
- Quy trình: commit -> `check` -> `plan staging` -> `apply staging` -> `plan production` -> `apply production` (gõ lại tên môi
  trường). Ba lớp chặn lên production: đã áp dụng ở staging, đúng bản xem trước đã lưu (≤ 24 giờ), không xóa tài nguyên chứa
  dữ liệu.
- **Terraform không giữ bí mật**: `pnpm infra secrets` tạo `Secret` trong cụm theo thành phần (`api-secrets`, `worker-secrets`,
  `migrate-secrets`...). `staging` dùng driver `fake` khi `STAGING_ALLOW_FAKES=true`; production từ chối bản giả.
- Tắt/bật staging: `pnpm infra power staging off|on` (giữ IP, đĩa, bucket).
- Dữ liệu đặt trong nước (hiến pháp VII, ADR-10); khôi phục CSDL diễn tập mỗi quý (`infra/docs/07-khoi-phuc-csdl.md`).

## Nguồn

- infra/docs/00-tong-quan.md
- infra/docs/05-quy-trinh-thay-doi.md
- .specify/memory/architecture.md (mục 3, "Hình thái triển khai thật")
