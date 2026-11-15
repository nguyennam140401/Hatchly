---
type: feature
title: 007 Hạ tầng Terraform – staging và production
sources:
  [
    specs/007-terraform-infra-environments/spec.md,
    specs/007-terraform-infra-environments/plan.md,
    specs/007-terraform-infra-environments/tasks.md,
    specs/007-terraform-infra-environments/data-model.md,
    specs/007-terraform-infra-environments/research.md,
    specs/007-terraform-infra-environments/adr-11-nha-cung-cap-ha-tang.md,
    specs/007-terraform-infra-environments/quickstart.md,
    specs/007-terraform-infra-environments/contracts/provider-layer.md,
    specs/007-terraform-infra-environments/contracts/infra-cli.md,
    specs/007-terraform-infra-environments/contracts/handoff-outputs.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    concepts/infra-envs.md,
    concepts/ci-cd.md,
    concepts/tenant-rls.md,
    concepts/migrations.md,
    modules/queue.md,
    features/008-cicd-jenkins-pipeline.md,
  ]
---

# 007 Hạ tầng Terraform – staging và production

## Mục tiêu

Dựng hai môi trường `staging` (thử nghiệm) và `production` (phát hành) **tách hoàn toàn** trên VNG Cloud từ
một bộ định nghĩa Terraform, hai tệp tham số: Kubernetes, PostgreSQL (CloudNativePG), kho tệp S3, CDN, khóa mã
hóa, bí mật, HTTPS công khai. Người vận hành là một cá nhân nên mọi lớp an toàn nằm trong lệnh `pnpm infra …`.
Là cổng WBS H1 ("có môi trường thử nghiệm") và điều kiện nộp App Review của Meta.

## Mã FR/NFR

- FR-001…FR-034 và SC-001…SC-014 của chính spec (`specs/007-terraform-infra-environments/spec.md`); truy vết
  WBS H1, ADR-01/02/03/07a/08/10/11.
- NFR gốc: khả dụng 99,5%, mất dữ liệu ≤ 5 phút, khôi phục ≤ 1 giờ, chịu gấp 10 tải.
- Hiến pháp: I, V, VII, VIII, IX (plan.md mục Constitution Check; VII "đạt có điều kiện" theo V4/V7/V9).

## Trạng thái

`current`. tasks.md: 110/121 tác vụ xong. 11 tác vụ còn lại (T071–T074, T082–T084, T101, T110–T111, T117) đều
chờ P6 (tài khoản VNG Cloud) để dựng thật, không phải mã còn thiếu
(`specs/007-terraform-infra-environments/tasks.md`).

## Quyết định chính

- Hai stack mỗi môi trường: `cloud` (lớp nhà cung cấp) và `platform` (chỉ chuẩn Kubernetes); đổi nhà cung cấp
  = viết lại một module (plan.md, R4; `contracts/provider-layer.md`).
- VNG Cloud được chọn (ADR-11); iNET bị loại vì thiếu K8s/KMS/CDN/Terraform provider. Provider VNG thiếu tài
  nguyên IAM/KMS/CDN/kho ảnh/bucket → "danh sách khởi tạo một lần" làm tay, mỗi mục có phép kiểm tự động.
- Terraform không giữ giá trị bí mật; `pnpm infra secrets` tạo bí mật thẳng trong cụm (R8).
- CSDL: CloudNativePG, PostgreSQL 17, lưu nhật ký giao dịch ≤ 5 phút ra bucket riêng; production 2 bản,
  staging 1 bản; biến thể CSDL được quản lý chỉ khai hợp đồng.
- Giao diện tĩnh: CDN kéo từ `web` (nginx) trong cụm. Kho ảnh container dùng chung, cụm chỉ có quyền kéo.
- Tự duyệt có kiểm soát lên production: đã áp ở staging, bản xem trước lưu và chỉ áp đúng bản đó, bộ chặn
  xóa/thay tài nguyên chứa dữ liệu. Kiểm tra lệch hằng ngày chỉ phủ stack `cloud`, chạy GitHub Actions quyền chỉ đọc.
- Tắt staging = gỡ nhóm máy, giữ phần điều khiển, bí mật, chứng chỉ, địa chỉ.

## Chạm tới

- Thư mục: `infra/` (`stacks`, `modules`, `envs`, `smoke-deploy`, `docs`), CLI `tooling/infra/`.
- Module Terraform: `provider-vngcloud`, `platform-base`, `database-cnpg`; 19 lệnh `pnpm infra`.
- Không có bảng CSDL mới. Ứng dụng chỉ đổi `core/config` (biến `STAGING_ALLOW_FAKES`, R15).
- Hàng chờ pg-boss vẫn nằm trong PostgreSQL; `worker` có `terminationGracePeriodSeconds: 35`.

## Điểm cần biết khi sửa tiếp

- Ảnh container không khởi động với `APP_ENV=staging` nếu thiếu `STAGING_ALLOW_FAKES` (005 cấm bản giả lập).
- V4 (API mã hóa/giải mã của KMS VNG) chưa xác minh: nếu không đạt cần ADR mới trước khi có dữ liệu thật.
- Thay đổi hạ tầng phải qua staging trước; script chặn xóa tài nguyên chứa dữ liệu trừ khi xác nhận riêng.
- Chi phí staging ≤ 40% production (SC-012); phần `platform` không dùng tính năng riêng nhà cung cấp (FR-031).
- Spec 008 phụ thuộc đầu ra ở `contracts/handoff-outputs.md`; đổi đầu ra phải cập nhật hợp đồng đó.
- T117: chép spec sang `TaiLieuDacTa/` (thư mục bị gitignore) ở repo chính.

## Nguồn

`specs/007-terraform-infra-environments/spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`,
`quickstart.md`, `adr-11-nha-cung-cap-ha-tang.md`, `contracts/*`; vận hành: `infra/docs/`.
