---
type: feature
title: 006 – Module mẫu "Hồ sơ kinh doanh" (lát dọc màn hình → CSDL)
sources:
  [
    specs/006-sample-module-business-profile/spec.md,
    specs/006-sample-module-business-profile/plan.md,
    specs/006-sample-module-business-profile/tasks.md,
    specs/006-sample-module-business-profile/data-model.md,
    specs/006-sample-module-business-profile/research.md,
    specs/006-sample-module-business-profile/quickstart.md,
    specs/006-sample-module-business-profile/contracts/context-http-api.md,
    specs/006-sample-module-business-profile/contracts/context-public-api.md,
    specs/006-sample-module-business-profile/contracts/business-profile-ui.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    modules/context.md,
    modules/account.md,
    modules/queue.md,
    concepts/tenant-rls.md,
    concepts/auth-rbac.md,
    concepts/queues.md,
    concepts/module-boundaries.md,
  ]
---

# 006 – Module mẫu "Hồ sơ kinh doanh"

## Mục tiêu

Lát dọc nghiệp vụ đầu tiên chạy trọn màn hình → API → module `context` → CSDL → hàng chờ → Worker, để đội
**chép theo** khi làm module mới (WBS K6, chuẩn bị T7). Chức năng: xem, sửa, lưu thành phiên bản mới, xem lịch
sử phiên bản; chủ sửa, cộng tác viên chỉ xem. Kèm bộ kiểm thử mẫu và hướng dẫn `docs/sample-module.md`
(`specs/006-sample-module-business-profile/spec.md`).

## Mã FR/NFR

WBS K6, chuẩn bị T7; FR-01; UI/UX mục 5 F1 bước 2, 7, 9; hiến pháp I, IV, VI, VII, VIII; ADR-02, ADR-09.
Yêu cầu nội bộ: FR-001…FR-024 (FR-015 không cache, FR-023 kiểm thử truy cập chéo tự nhận diện bảng mới,
FR-024 migration chỉ thêm).

## Trạng thái

Đã merge vào `dev`. `tasks.md`: 73/74 xong; còn T074 (diễn tập SC-008 theo `quickstart.md` mục 4, ghi vào "Lịch
sử diễn tập" của `docs/sample-module.md`; có thể làm sau merge).

## Quyết định chính

- Một dòng `business_profiles` + bảng phiên bản chỉ-thêm `profile_versions` (R1); khóa lạc quan bằng cột
  `version` (qua `updateVersioned`), thông điệp xung đột theo ngữ cảnh (R3); "không có thay đổi" không tạo
  phiên bản (R4).
- Cạnh tranh tạo hồ sơ lần đầu được xử lý ở R2.
- Danh mục ngành là hằng số dùng chung `INDUSTRIES`, giới hạn độ dài `PROFILE_LIMITS` một nguồn ở
  `@app/shared/context` dùng cho cả hai lớp (R5, R6).
- Người lưu chỉ là mã tham chiếu; tên người lưu lấy qua giao diện công khai của `account` (R7, ADR-09).
- Quyền tách `context.view` / `context.edit` (R9); sự kiện `context.profile_changed` tạo trong cùng
  `tenantTx` bằng `enqueue`, bộ xử lý mẫu ở Worker (R8).
- Kiểm thử trình duyệt dùng Playwright + axe (R12).

## Chạm tới

- Schema `context`: `business_profiles`, `profile_versions` (`data-model.md`).
- API: `GET`/`PUT /context/profile`, `GET /context/profile/versions?page=`,
  `GET /context/profile/versions/:versionId` (`contracts/context-http-api.md`).
- Module `context` (`apps/server/src/modules/context`: `public-api.ts`, `jobs.ts`), thêm 1 hàm vào
  `AccountPublicApi` (`contracts/context-public-api.md`); web: 2 tuyến (`contracts/business-profile-ui.md`).
- Việc nền: `context.profile_changed`.

## Điểm cần biết khi sửa tiếp

- Đây là khuôn mẫu: module mới chép theo `docs/sample-module.md` (danh sách bước và điểm bắt buộc).
- Không cache hồ sơ; không ghi nội dung hồ sơ vào nhật ký; payload việc chỉ chứa mã tham chiếu.
- Bảng mới có `account_id` tự được phủ bởi kiểm thử truy cập chéo và công cụ phát hiện bảng thiếu RLS; module
  khác không được đọc schema `context`.
- Ngoài phạm vi, làm ở T7: tải tệp ngữ cảnh (`context_files`), AI tóm tắt hồ sơ qua Cổng AI
  ([005](005-gateway-contracts-fakes.md)), dùng hồ sơ khi tạo nội dung, khôi phục phiên bản cũ.
- Phụ thuộc xác thực/quyền từ [004](004-minimal-auth-rbac.md).

## Nguồn

`specs/006-sample-module-business-profile/spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `research.md`,
`quickstart.md`, `contracts/context-http-api.md`, `contracts/context-public-api.md`,
`contracts/business-profile-ui.md`.
