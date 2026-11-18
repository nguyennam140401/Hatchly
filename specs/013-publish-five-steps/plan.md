# Implementation Plan: Đăng bài 5 bước

**Branch**: `impl/013-publish-five-steps` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Đặc tả tính năng `specs/013-publish-five-steps/spec.md` (đã làm rõ 3 câu ngày 2026-11-16)

## Summary

Thay bản giả lập tạm bằng **module Đăng bài (`publishing`) thật**: lượt đăng duy nhất cho mỗi (bài, kênh), bộ thực thi 5
bước chạy ở Worker qua hàng chờ `publish`, phân loại ba loại lỗi, thử lại, đối soát, "Cần kiểm tra", bộ chuyển đổi
Facebook Page / Instagram và khu vực **Tiến trình đăng** trên giao diện.

Cách tiếp cận kỹ thuật (chi tiết ở [research.md](./research.md)):

- Một **máy trạng thái lượt đăng** nằm trọn trong `publishing`; mọi chuyển trạng thái là `UPDATE … WHERE status = :expected`
  (kiểm tra số dòng ảnh hưởng). Chỉ mục duy nhất một phần `(account_id, post_id, connection_id) WHERE status <> 'cancelled'`.
- **Một loại việc `publishing.execute_attempt`** (hàng chờ `publish`, khóa `publish:{attemptId}`, `allowGenericRetry:
  false`). Bộ xử lý đọc trạng thái rồi **rẽ nhánh theo giai đoạn** (`phase`): chưa gửi → chạy bước 1–3; đã ghi "Đã gửi, chờ
  phản hồi" → đối soát, **không bao giờ** gửi lại; đã chờ nền tảng xử lý → bước 4–5. Giờ thử lại/đối soát đặt bằng
  `retryAfter(seconds)` của lớp hàng chờ (chế độ `handler`, ADR-04).
- **Ghi nhật ký 5 bước** vào `publish_steps` (chỉ thêm, phân vùng tháng, giữ 12 tháng) bằng giao dịch riêng ngắn, **không
  giữ giao dịch CSDL trong lúc gọi nền tảng**.
- **Bộ chuyển đổi Facebook/Instagram** đặt trong module `platform_gateway` (đã có giao diện `PlatformAdapter` 005); tính năng
  này hiện thực `submit`, `checkStatus`, `reconcile`, `classifyError` và bảng lỗi mặc định. Cổng đọc dòng ánh xạ lỗi do
  `publishing` sở hữu (`error_mappings`) và đưa vào `applyErrorMapping` (đã có).
- **API cho `approval`/012** là giao diện công khai của `publishing` (tạo/hủy/đổi giờ/đọc trạng thái); cho web là
  các điểm cuối "Tiến trình đăng", "Đăng lại", "Đã đăng".
- **Giao diện** (apps/web): khu vực Tiến trình đăng trong chi tiết bài; trạng thái tự cập nhật bằng thăm dò định kỳ
  (không thêm hạ tầng đẩy; Hiến pháp IX).

## Technical Context

**Language/Version**: TypeScript (Node.js LTS theo `package.json` gốc), NestJS, React + Vite — đúng ngăn xếp đã chốt.

**Primary Dependencies**: NestJS, Drizzle ORM, pg-boss (chỉ qua module `queue`), zod, `@app/shared`. Không thêm thư viện
mới ở máy chủ; gọi Graph API của Meta bằng `fetch` có sẵn của Node bọc trong bộ chuyển đổi (không SDK ngoài – dễ cố định
phiên bản và dễ giả lập; ghi ở research R9).

**Storage**: PostgreSQL – schema `publishing` (`publish_attempts`, `publish_steps` phân vùng tháng, `error_mappings`); kho
tệp S3 chỉ để đọc đường dẫn công khai ≤ 24 giờ do `media` cấp. Không cache trạng thái lượt đăng và mã quyền (Hiến pháp).

**Testing**: Vitest theo cấu hình hiện có (`vitest.config.mts`, `vitest.db.config.mts`, `vitest.queue.config.mts`);
`runJobInline`, `expectIdempotent`, `startTestWorkers(2)` của `test/support/queue-test-kit.ts`; bản giả lập `FakePlatform` của
005 với kịch bản `timeout_after_publish` v.v.; kiểm thử hợp đồng chạy chung cho Facebook, Instagram và bản giả lập; kiểm
thử truy cập chéo mọi bảng mới (CI bắt buộc).

**Target Platform**: Kubernetes (api ×2, worker ×2), cùng một ảnh container; Worker chạy hàng chờ `publish`.

**Project Type**: Web (monorepo `apps/server` + `apps/web` + `packages/shared`).

**Performance Goals**: lệch lịch ≤ 5 phút (SC-003 ≥ 95% trong 5 phút); tải màn hình Tiến trình đăng ≤ 1 giây; trạng thái đổi
hiển thị ≤ 15 giây; ≥ 98% thành công; 0 trùng.

**Constraints**: giới hạn đồng thời `publish` = 10/bản, ≤ 3/tenant, khóa 2 phút (heartbeat gia hạn); không giữ giao dịch
trong lúc gọi ngoài; không log bí mật; mọi giờ UTC; khóa chính UUID v7; migration tương thích ngược.

**Scale/Scope**: ~1.000 lượt đăng/ngày (đỉnh ~5/phút), chịu gấp 10 lần; `publish_steps` ≈ 5–12 dòng/lượt → ≤ 12 triệu
dòng/năm ở gấp 10 lần (phân vùng tháng).

## Constitution Check

*GATE: đạt trước Phase 0; đánh giá lại sau Phase 1 (cuối tài liệu).*

| # | Nguyên tắc | Đánh giá | Cách đáp ứng |
|---|---|---|---|
| I | Cô lập tenant | **Đạt** | 2 bảng tenant (`publish_attempts`, `publish_steps`) có `account_id` đầu chỉ mục + RLS `tenant_isolation`; `error_mappings` là bảng dùng chung không chứa dữ liệu tài khoản. `accountId` lấy từ phiên; việc nền mang `accountId` ở phong bì. Kiểm thử truy cập chéo + đường dẫn ký sẵn đúng tiền tố `tenants/{id}/`. |
| II | Đăng bài không trùng | **Đạt (trọng tâm)** | Chỉ mục duy nhất một phần; UPDATE có điều kiện; ghi `phase = submitted_awaiting_response` + `content_hash` **trước** `submit`; ba loại lỗi; đối soát trước khi gửi lại; "Cần kiểm tra"; 5 bước; bộ chuyển đổi sau giao diện chung; hẹn giờ chung. |
| III | AI qua Cổng AI | **Không áp dụng** | Không gọi AI. SC-012: khi AI khóa, đăng vẫn chạy (kiểm thử). |
| IV | Modular monolith | **Đạt – cần sửa kê khai** | Chỉ ghi schema `publishing`; gọi `content`, `media`, `platform_gateway`, `notifications`, `queue` qua giao diện công khai. **Thêm `account` vào `allowedDeps` của `publishing`** (kiểm tra gói còn hạn ở bước 1, FR-013) – ghi ở ADR-12. Khóa ngoại chỉ tới `accounts`; bài/kênh là mã tham chiếu. |
| V | Việc nền bền vững | **Đạt** | Hàng chờ `publish`; bộ xử lý idempotent theo `phase`; giới hạn tenant 3; tắt Worker có kiểm soát 30 giây; việc quá hạn quét mỗi phút. |
| VI | AI đề xuất, người quyết | **Đạt** | Hệ thống không tự quyết "Đã đăng/Đăng lại" ở "Cần kiểm tra"; quyền kiểm ở API; mỗi lỗi kèm hành động khắc phục; mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ"; WCAG/360 px. |
| VII | Bảo vệ bí mật | **Đạt** | Chỉ `platform_gateway` giải mã mã quyền; mã quyền/nội dung bài không vào log, chỉ số, thông báo, phản hồi giao diện; phản hồi API dùng danh sách trường cho phép (không `select *`). |
| VIII | Quan sát | **Đạt** | `trace_id` xuyên suốt; nhật ký 5 bước tách khỏi nhật ký kỹ thuật; chỉ số + 4 cảnh báo ở FR-032 (xem `contracts/observability.md`). |
| IX | Đơn giản, có ADR | **Đạt – có 1 ADR mới** | Không thêm hạ tầng; cập nhật giao diện bằng thăm dò. **ADR-12** (mới, nhỏ): `publishing` phụ thuộc `account`; thiết kế lại ranh giới 012↔013 (không đi ngược ADD). |

Không có vi phạm cần ghi ở "Theo dõi độ phức tạp".

## Project Structure

### Documentation (this feature)

```text
specs/013-publish-five-steps/
├── plan.md              # Tệp này
├── research.md          # Phase 0 – 12 quyết định
├── data-model.md        # Phase 1 – bảng, máy trạng thái, chỉ mục, RLS
├── quickstart.md        # Phase 1 – kịch bản kiểm chứng chạy được
├── contracts/
│   ├── publishing-public-api.md   # Giao diện công khai cho approval/012, notifications, media
│   ├── publishing-http-api.md     # Điểm cuối cho web (Tiến trình đăng, Đăng lại, Đã đăng)
│   ├── platform-adapters.md       # Bổ sung hợp đồng bộ chuyển đổi Facebook/Instagram
│   ├── jobs-and-schedules.md      # Loại việc, việc định kỳ, giãn cách, cấu hình
│   └── observability.md           # Chỉ số, cảnh báo, nhật ký
├── checklists/requirements.md
└── tasks.md             # Do /speckit-tasks tạo (không thuộc plan)
```

### Source Code (repository root)

```text
packages/shared/src/modules/
├── publishing/
│   ├── index.ts                    # xuất kiểu cho web ↔ API
│   ├── attempt.ts                  # PublishAttemptView, trạng thái hiển thị, bảng ánh xạ trạng thái nội bộ → hiển thị
│   └── internal-support.ts         # kiểu cho đường hỗ trợ (đủ trạng thái, mã lỗi gốc)
└── notifications/events.ts         # SỬA: publish_needs_action thêm refs tùy chọn (reason, channelType)

apps/server/src/modules/
├── modules.manifest.json           # SỬA: publishing.allowedDeps += account
├── publishing/
│   ├── index.ts · public-api.ts · publishing.module.ts · jobs.ts
│   └── internal/
│       ├── db/                     # publish-attempts.table.ts, publish-steps.log-table.ts, error-mappings.table.ts
│       ├── state-machine.ts        # bảng chuyển trạng thái hợp lệ + hàm transition() (UPDATE có điều kiện)
│       ├── attempts.service.ts     # tạo/hủy/đổi giờ/đăng lại/"Đã đăng"/đọc trạng thái
│       ├── executor/               # execute-attempt.handler.ts, precheck.ts, prepare-media.ts, submit.ts, await-processing.ts, confirm.ts, reconcile.ts
│       ├── step-log.ts             # ghi bước (giao dịch riêng, chỉ thêm)
│       ├── error-mapping.service.ts# nạp error_mappings, cache 5 phút, đưa vào gateway
│       ├── retry-policy.ts         # giãn cách 5 lần/30 phút, đối soát 2/10 phút (đọc cấu hình)
│       ├── overdue.sweeper.ts      # việc định kỳ mỗi phút: quá hạn > 5 phút, "Cần kiểm tra", chỉ số
│       ├── attempts.controller.ts  # điểm cuối web
│       └── metrics.ts
├── platform_gateway/internal/adapters/
│   ├── facebook/ (facebook.adapter.ts, facebook.errors.ts, graph-client.ts)
│   └── instagram/ (instagram.adapter.ts, instagram.errors.ts)      # đăng ký ở registry.ts
apps/server/drizzle/migrations/     # NNNN_publishing_tables.sql (+ phân vùng, RLS, chỉ mục)
apps/server/test/publishing/        # unit, db, queue, contract, cross-tenant

apps/web/src/features/publish-progress/
├── PublishProgress.tsx             # khu vực Tiến trình đăng theo kênh
├── StepTimeline.tsx                # dòng thời gian 5 bước (ngang ≥ 768 px, dọc 360 px)
├── ChannelStatusBadge.tsx          # chữ + biểu tượng
├── SupportDetails.tsx              # "Chi tiết cho hỗ trợ" thu gọn
└── usePublishProgress.ts           # thăm dò 5–10 giây khi còn trạng thái chưa kết thúc
```

**Structure Decision**: giữ nguyên bố cục monorepo hiện có (apps/server, apps/web, packages/shared). Mọi mã Đăng bài ở
`apps/server/src/modules/publishing`; riêng hai bộ chuyển đổi nền tảng nằm trong `platform_gateway` vì đó là module
duy nhất giải mã mã quyền (Hiến pháp VII).

## Ranh giới với các tính năng khác (quyết định kế hoạch)

| Với | Quyết định |
|---|---|
| **012** (soạn/duyệt/lịch) – *chưa có mã* | 013 cung cấp **giao diện công khai thật** của `publishing`; 012 chỉ gọi giao diện này (không đọc bảng). Trong lúc `content`/`approval` còn là khung, 013 dựng kiểm thử bằng cổng đọc nội dung giả (`ContentReader` port) – xem R6. Hợp đồng `schedule/cancel/reschedule/getStatus` giữ **đúng tên và nghĩa** 012 đã nêu (FR-022 của 012). |
| **010** (kết nối kênh) – *chưa có mã* | 010 giao OAuth, `checkAccount`, `refreshToken`, bảng `channel_connections`. 013 chỉ bổ sung `submit/checkStatus/reconcile/classifyError` cho Facebook/Instagram và **dùng** kết nối qua `PLATFORM_GATEWAY`. Nếu 010 chưa merge khi làm 013, bộ chuyển đổi thật nằm sau cờ cấu hình, mặc định dùng bản giả lập (R10). |
| **Thư viện media (FR-03)** – *khung rỗng* | Bước 2 gọi `MediaPublicApi.getPublishableMedia(mediaIds)` (hợp đồng đề xuất ở `contracts/publishing-public-api.md`). Chưa có `media` thật → bản giả lập của 005 (Assumptions của spec). |
| **Giới hạn video 1 GB** | Chỉ là **tham số quy tắc media của kênh**; lệch FR-03 (500 MB) đã ghi ở spec. Hợp đồng không cứng 500 MB hay 1 GB: đọc từ `mediaRules()`. Việc cập nhật FR-03 là việc của tài liệu yêu cầu/tính năng media. |

## Rủi ro và việc cần kiểm chứng

| Rủi ro | Giảm thiểu |
|---|---|
| Khả năng đối soát của Facebook/Instagram chưa kiểm chứng (POC-2) | `capabilities.reconcile` khai báo bằng cấu hình; chưa chắc → `unsupported` → "Cần kiểm tra" (hướng an toàn). Ngưỡng 2/10 phút cấu hình ở `infra.queue_settings`/bảng cấu hình, không hằng số. |
| Instagram video xử lý rất lâu | Bước 4 có trần thời gian (cấu hình, mặc định 10 phút cho ảnh, 30 phút cho video); quá → `unknown` → đối soát. |
| Giới hạn video 1 GB vượt khả năng nền tảng | Kiểm ở bước 1–2 qua `mediaRules`; POC-2 chốt số thật. |
| Phụ thuộc 010/012/media chưa có mã | Cổng (port) + bản giả lập + cờ cấu hình; kiểm thử hợp đồng chạy cho cả hai. |
| Bảng `error_mappings` sai → đăng trùng | Mã lạ luôn `unknown`; `transient` chỉ khi mã nằm trong bảng và đã qua kiểm thử hợp đồng; thay đổi bảng có nhật ký kiểm toán. |

## Kiểm tra hiến pháp sau thiết kế (Phase 1)

Đã đối chiếu lại sau khi viết `data-model.md` và `contracts/`: không phát sinh vi phạm mới.

- Bảng mới đều khai báo bằng `tenantTable` / `partitionedLogTable` / `sharedTable` nên bị công cụ `pnpm db:check` kiểm RLS.
- Mọi chuyển trạng thái đi qua một hàm `transition()` duy nhất, có kiểm thử bảng chuyển (chuyển sai bị từ chối).
- Bộ xử lý không giữ giao dịch khi gọi nền tảng; ghi `phase` trước `submit` bằng một giao dịch **đã commit** rồi mới gọi.
- Phản hồi API/web không chứa `content_hash`, mã quyền, `raw payload`; mã lỗi gốc chỉ trả khi có `status.view` **và** ở vùng
  "Chi tiết cho hỗ trợ" (người dùng thường thấy mã lỗi gốc đã lọc theo FR-028/spec – xem `contracts/publishing-http-api.md`).
- ADR-12 cần PO/SA duyệt trước khi merge (thay đổi kê khai phụ thuộc module – SA duyệt theo Hiến pháp "Governance").

## Complexity Tracking

Không có vi phạm hiến pháp cần biện minh.
