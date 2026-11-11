# Implementation Plan: Khung giao diện công khai + bản giả lập – Cổng nền tảng, Cổng AI, Thông báo, Kho tệp

**Branch**: `impl/005-gateway-contracts-fakes` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-gateway-contracts-fakes/spec.md`

## Summary

Chốt **hợp đồng** của 4 điểm phụ thuộc (WBS 1.8): Cổng nền tảng (7 thao tác ADR-05 + kết nối kênh), Cổng AI
(giữ chỗ → gọi → quyết toán – ADR-06), Thông báo (danh mục đóng, khóa chống trùng do Thông báo dựng), Kho tệp
(vị trí hợp kiểu theo tenant, đường dẫn ký sẵn). Mỗi hợp đồng có **bản giả lập** cục bộ, điều khiển được kịch
bản, với 2 kho trạng thái (`memory` cho kiểm thử, `sandbox` CSDL cho API + Worker chạy chung), và **bộ kiểm thử
hợp đồng** tham số hóa để bản thật sau này (WBS 2.3, 3.1, 4.3, 2.6) qua cùng bộ. Kho tệp (S3) và email (SMTP) có
luôn bản thật chạy trên MinIO/Mailpit ở dev.

Cách làm chính:
- Hợp đồng là `interface` TS + kết quả **hợp đóng** (`kind`), lỗi nghiệp vụ không ném (R1).
- Cổng nền tảng hai tầng: công khai theo `connectionId`, bộ chuyển đổi nội bộ nhận mã quyền đã giải mã từ
  `CredentialVault`; danh mục bộ chuyển đổi theo loại kênh; rẽ nhánh theo `capabilities` (R2, R3). Dấu nội dung
  chuẩn hóa `ch1:` (R4); phân loại mặc định + hàm áp đè thuần cho `publishing.error_mappings` (R5).
- Cổng AI: trình tự cố định, giữ chỗ bằng cập nhật có điều kiện + `CHECK`, kẹp trần khi quyết toán, sự kiện 80/100%
  tạo trong cùng giao dịch quyết toán (`settle` + `onCrossed`), ngân sách hệ thống theo tuần cho xu hướng (R7, R8).
- Thông báo: danh mục Zod trong `@app/shared/notifications`, `emit(tx, event)` qua hàng chờ `notify`; chế độ bộ nhớ
  dùng `memoryTx()` + hàng chờ trong bộ nhớ + `flush()` (R9b); `account` phát bằng `enqueueRegistered` mới của `queue`
  để tránh vòng phụ thuộc (R9, R9a).
- Kho tệp ở `core/storage` (S3 SDK + presigned POST), chỉ `media`/`context`/`account` được dùng; mọi khóa – kể cả tệp
  tạm `tenants/{acc}/tmp/{jobId}/…` – nằm trong tiền tố tài khoản, tệp tạm hết hạn theo nhãn (R13).
- Email: mở rộng `core/mail` của 004 bằng `deliver()` phân loại `sent/transient/permanent` (R14).
- Chọn bản cài đặt bằng biến môi trường chung API/Worker; staging/production từ chối mọi bản giả lập; endpoint
  quản trị giả lập chỉ dev/test (R11, R12).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node.js 24 LTS – như 001–004

**Primary Dependencies**:
- Có sẵn: NestJS 11.2.8, Drizzle 0.45.4, `pg`, Zod 4.6.7, pino, pg-boss 12.38.0 (sau `queue`), nodemailer
  10.4.0 (sau `core/mail`), `@opentelemetry/api` 1.9.0.
- Mới (khóa phiên bản chính xác, cùng một dòng phát hành): `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`,
  `@aws-sdk/s3-request-presigner` – chỉ trong `core/storage/s3/`.
- Ảnh dev mới: MinIO (khóa tag phát hành; cùng `minio/mc` cho `minio-init`).
- Không SDK AI nào (nhà cung cấp chưa chốt – POC-1/POC-4).

**Storage**: Không bảng nghiệp vụ mới. Schema `sandbox` (chỉ migration dev): 13 bảng giả lập
([data-model.md](data-model.md) mục 5). Kho tệp S3 (MinIO ở dev).

**Testing**: Vitest. `pnpm test` (đơn vị + hợp đồng bản giả lập bộ nhớ, ≤ 2 phút); `pnpm test:db` (hợp đồng chế
độ `sandbox`, truy cập chéo, giao dịch hủy); `pnpm test:infra` mới (S3→MinIO, SMTP→Mailpit); e2e API bằng
supertest với bản giả lập; `tooling` fixture ranh giới.

**Target Platform**: Container Linux trên Kubernetes (API + Worker cùng ảnh). Máy dev Windows/Linux + docker compose.

**Project Type**: Web application – monorepo `apps/server`, `apps/web` (không đổi), `packages/shared`, `tooling`.

**Performance Goals**: Kiểm tra ngân sách ≤ 50 ms (hiến pháp III) – giữ chỗ 1 câu lệnh; bộ hợp đồng giả lập
≤ 2 phút (SC-008); tải ảnh + email ở dev ≤ 10 giây (SC-011).

**Constraints**:
- Không tham số mã tài khoản trên thao tác của module; mã quyền không ra khỏi `platform_gateway`.
- `used + reserved ≤ cap` luôn đúng dưới đồng thời; tiền là số nguyên micro-USD; % cho khách, không số tiền.
- Bản giả lập và schema `sandbox` chỉ ở `development`/`test`; staging/production từ chối khởi động.
- Không thêm hạ tầng chạy thật mới (MinIO/Mailpit chỉ dev; S3/SES là thành phần đã chốt).
- Không đổi hành vi của 004 (`Mailer.send` giữ nguyên).

**Scale/Scope**: 4 hợp đồng; 7 + 5 thao tác Cổng nền tảng; 4 loại kênh giả; 6 loại việc AI; 10 loại thông báo;
5 khuôn vị trí tệp; 6 điểm cuối kết nối kênh; 10 route quản trị giả lập + 1 trang ủy quyền giả; 4 quy tắc ranh giới mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá | Bằng chứng |
|---|---|---|
| I. Cô lập tenant | ĐẠT | Không thao tác nào nhận `accountId`; vị trí tệp hợp kiểu dựng từ ngữ cảnh + kiểm lần hai, mọi khóa (kể cả tệp tạm) dưới `tenants/{acc}/`, không cấp đường dẫn tải lên cho tệp tạm (sửa sau /speckit-analyze C1); bảng `sandbox` dùng `tenantTable` (RLS); ma trận truy cập chéo kho tệp (SC-005) + bảng giả; endpoint giả lập gắn tài khoản trong phiên |
| II. Không đăng trùng | ĐẠT | `submit` hết thời gian → `unknown` không bao giờ `transient`; `reconcile` 3 kết quả phân biệt `not_found`/`unsupported`; dấu chuẩn hóa chống "đổi nhẹ"; kết quả lạ → `unknown`; bản giả lập không che đăng trùng; bộ chuyển đổi sau giao diện chung, thêm kênh = thêm adapter (US2) |
| III. Cổng AI + ngân sách | ĐẠT | Trình tự ước tính → giữ chỗ có điều kiện → đánh dấu `calling` → gọi → quyết toán/trả lại; giữ chỗ treo đã gọi được quyết toán theo ước tính (sổ `unsettled`), không bao giờ trả lại khi có thể đã tốn tiền (sửa sau /speckit-analyze C3); kẹp trần; ngưỡng 2 USD/4 USD; ledger micro-USD; % cho khách; xu hướng giữ chỗ vào ngân sách hệ thống; bộ kiểm thử bắt buộc (đồng thời, ngưỡng, chặn, trả lại) |
| IV. Modular monolith | ĐẠT (có thay đổi manifest – SA duyệt) | Thêm `notifications` vào `allowedDeps` của `ai_gateway`, `content`, `approval` (Clarifications); `account` không phụ thuộc `notifications`; `check:boundaries` chặn vòng; sự kiện `ai_usage_80/100` tạo trong cùng giao dịch quyết toán qua `settle(…, { onCrossed })` (sửa sau /speckit-analyze C2); bảng giả nằm ở `sandbox` (dev-only) – xem Complexity Tracking |
| V. Việc nền bền vững | ĐẠT | Thông báo qua hàng chờ `notify` trong giao dịch; bộ xử lý idempotent (unique `dedupe_key`); trả giữ chỗ treo bằng việc định kỳ; tải tệp thẳng lên S3 (presigned POST), không qua API |
| VI. AI đề xuất, người quyết | ĐẠT | Quyền `channel.manage`/`status.view` kiểm ở API; thông báo tiếng Việt, luôn có hành động khắc phục; hết AI không chặn chức năng tay |
| VII. Bí mật & dữ liệu cá nhân | ĐẠT | Mã quyền chỉ qua `CredentialVault` (kiểu có nhãn, `toJSON` che); không ghi lời nhắc/kết quả/nội dung bài vào nhật ký; quét bí mật với chuỗi canary; dữ liệu AI gửi ra tối thiểu (bản giả lập không gửi ra ngoài) |
| VIII. Quan sát được | ĐẠT | `trace_id` + `account_id` trên mọi thao tác, nhật ký có cấu trúc, span OTel; cảnh báo `ai.cost_anomaly`, `platform.unexpected_result`, `storage.access_denied` |
| IX. Đơn giản, chuẩn mở | ĐẠT | S3 + SMTP chuẩn, SDK bọc sau giao diện, khóa phiên bản; không thêm cache/broker; endpoint/bản giả lập không có ở production |

**Gate trước Phase 0**: ĐẠT. **Re-check sau Phase 1**: ĐẠT – thiết kế không thêm vi phạm; ràng buộc mới duy nhất là
thay đổi manifest đã được chốt ở Clarifications (chờ SA xác nhận khi review).

Checklist kiến trúc (architecture.md mục 13): module rõ (mỗi hợp đồng thuộc module chủ; kho tệp thuộc `core`); không
bảng nghiệp vụ mới; việc `notify` tạo trong giao dịch; AI qua Cổng AI, UI chỉ %; giữ chỗ/chuyển trạng thái có điều
kiện + `CHECK`; không hạ tầng thật mới; `trace_id` + nhật ký không bí mật; migration chỉ thêm (dev).

## Project Structure

### Documentation (this feature)

```text
specs/005-gateway-contracts-fakes/
├── plan.md
├── research.md            # R1–R18
├── data-model.md          # thực thể hợp đồng + bảng sandbox
├── quickstart.md
├── contracts/
│   ├── platform-gateway.md
│   ├── ai-gateway.md
│   ├── notifications.md   # + core/mail
│   ├── storage.md
│   └── runtime-config.md  # biến môi trường, chặn production, endpoint giả lập, compose
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
apps/server/src/
├── core/
│   ├── storage/                     # MỚI – ObjectStorage, StorageLocation, loc.*, lỗi
│   │   ├── index.ts · storage.ts · location.ts · storage.module.ts
│   │   ├── s3/                      # S3ObjectStorage (@aws-sdk/* chỉ ở đây)
│   │   └── memory/                  # MemoryObjectStorage + simulateBrowserUpload
│   ├── mail/                        # SỬA – Mailer.deliver(), MailDeliveryResult, outbox/failFor, phân loại SMTP
│   ├── config/                      # SỬA – biến *_DRIVER, S3_*, FAKE_STATE_STORE; MAIL_* chung
│   │   └── assert-no-fakes.ts       # MỚI – assertNoFakesInProduction
│   └── gateways/
│       ├── selection.ts             # MỚI – đọc lựa chọn, ghi `gateways.selected`, kiểm schema sandbox
│       └── op-log.ts                # MỚI – withGatewayOp: nhật ký có cấu trúc + span OTel cho mọi thao tác cổng
├── modules/
│   ├── platform_gateway/
│   │   ├── public-api.ts · index.ts · platform_gateway.module.ts      # SỬA
│   │   └── internal/
│   │       ├── gateway.service.ts            # tầng công khai → registry → vault → adapter
│   │       ├── adapters/{adapter.ts, registry.ts, content-hash.ts, classify.ts, media-rules.ts, result-shapes.ts}
│   │       ├── connections/{connections.controller.ts, connections.service.ts, oauth-state.ts}
│   │       ├── vault/credential-vault.ts
│   │       └── fake/{fake-adapter.ts, channels.ts, store.memory.ts, store.sandbox.ts, fake-oauth.controller.ts, scenarios.ts}
│   ├── ai_gateway/
│   │   ├── public-api.ts · index.ts · ai_gateway.module.ts · jobs.ts   # jobs: ai_gateway.release_stale
│   │   └── internal/
│   │       ├── gateway.service.ts · estimate.ts · tier.ts · errors.ts
│   │       ├── budget/{budget-store.ts, system-budget.ts}
│   │       ├── providers/provider.ts         # (SDK thật sau POC – chỉ ở đây)
│   │       ├── prices/price-book.ts
│   │       └── fake/{fake-provider.ts, store.memory.ts, store.sandbox.ts, prices.fake.json}
│   ├── notifications/
│   │   ├── public-api.ts · index.ts · notifications.module.ts · jobs.ts  # jobs: notifications.deliver
│   │   └── internal/{emit.ts, deliver.handler.ts, dedupe-keys.ts, recipients.ts, forbidden.ts, templates/,
│   │                 fake/{store.memory.ts, store.sandbox.ts}}
│   ├── account/public-api.ts        # SỬA – listActiveMembers()
│   ├── queue/                       # SỬA – enqueueRegistered() (internal/producer.ts, xuất qua public-api/index)
│   └── modules.manifest.json        # SỬA – notifications vào ai_gateway/content/approval
├── dev/                             # MỚI – chỉ đăng ký khi APP_ENV ∈ {development, test}
│   ├── sandbox/schema.ts            # bảng giả lập (drizzle.dev.config.ts nhận thêm tệp này)
│   ├── sandbox/scenario-store.ts    # ScenarioStore ×2 (memory | sandbox) trên fake_scenarios
│   ├── memory-tx.ts                 # memoryTx(): vật thế chỗ giao dịch cho chế độ memory (R9b)
│   └── fakes.controller.ts          # /dev/fakes/*
└── app/{api-app.module.ts, worker-app.module.ts}   # SỬA – nối module/controller có điều kiện

apps/server/drizzle/migrations-dev/  # migration bảng sandbox mới
apps/server/test/
├── contracts/{platform, ai, notifications, mail, storage}/   # describe*Contract + *.fake/.sandbox/.infra.contract.spec.ts
├── e2e/fakes-flow.e2e.spec.ts                                # luồng SC-007
├── unit/gateway-selection.spec.ts
└── helpers/deny-egress.cjs
apps/server/vitest.infra.config.mts                           # MỚI – pnpm test:infra

packages/shared/src/modules/
├── notifications/{index.ts, events.ts}        # NOTIFICATION_TYPES, NotificationEventSchema, NOTIFY_DELIVER_JOB
└── platform_gateway/index.ts                  # DTO HTTP kết nối kênh, ChannelType, ChannelConnection

tooling/
├── boundaries/build-rules.cjs                 # SỬA – 4 quy tắc mới (R17)
├── boundaries/fixtures/{n-storage-outside-allowed, o-enqueue-registered-outside-account, p-dev-imported-by-module, q-aws-sdk-outside-storage}/
└── scan-secrets.mjs                           # SỬA – mẫu canary

docker-compose.yml                              # SỬA – minio, minio-init, biến mới
apps/server/.env.example                        # SỬA
apps/server/docs/gateways.md                    # MỚI – hướng dẫn dùng hợp đồng + dàn kịch bản
.specify/memory/architecture.md                 # SỬA – mục 7.2 (ngân sách hệ thống, kẹp trần), mục 11 (thuật ngữ)
```

**Structure Decision**: Giữ bố cục monorepo của 001–004. Hợp đồng nằm ở module chủ (`public-api.ts`/`index.ts`);
bản giả lập ở `internal/fake/` của chính module nên không lộ ra ngoài; kho tệp ở `core/storage` theo cùng khuôn
`core/mail`; mọi thứ chỉ-dev (bảng `sandbox`, endpoint quản trị) gom ở `src/dev/` và chỉ được ghép khi `APP_ENV ∈
{development, test}`.

## Phases (cho /speckit-tasks)

0. **Nền**: `git merge dev`; cấu hình + chặn production + `gateways.selected`; quy tắc ranh giới mới + fixture;
   bảng `sandbox` + migration dev; `enqueueRegistered`; `listActiveMembers`; manifest.
1. **US1 + US2 (P1)** – Cổng nền tảng: kiểu + public API, registry, content hash, phân loại + `applyErrorMapping`,
   `validateMedia`, vault, adapter giả ×4, kho ×2, bộ hợp đồng adapter + cổng, luồng kết nối + HTTP + trang ủy quyền giả.
2. **US3 (P1)** – Cổng AI: kiểu + public API, ước tính/chọn hạng, kho ngân sách ×2 + hệ thống, nhà cung cấp giả,
   trả dần/hủy, dự phòng, kẹp trần, phát 80/100%, việc `release_stale`, bộ hợp đồng (gồm đồng thời).
3. **US4 (P2)** – Thông báo + email: danh mục shared, `emit`, bộ xử lý `deliver`, khóa, trường bị cấm, người nhận,
   `Mailer.deliver` + phân loại SMTP, kho ×2, bộ hợp đồng thông báo + email.
4. **US5 (P2)** – Kho tệp: vị trí, bộ nhớ + S3 (POST policy), bộ hợp đồng + ma trận truy cập chéo, MinIO compose.
5. **US6 (P3)** – Chạy cục bộ: endpoint `/dev/fakes`, compose đầy đủ, e2e luồng SC-007 + chặn egress, kiểm 404 ở
   production.
6. **Hoàn thiện**: tài liệu `apps/server/docs/gateways.md`, architecture.md, sửa tài liệu "chia đều" (R18 – ở repo
   chính), `pnpm verify`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Bảng trạng thái giả của 3 module nằm chung schema `sandbox` (không phải schema của module chủ) | Clarifications Q2 chốt `sandbox`; migration dev đã có sẵn cơ chế chỉ áp ở dev/test, nên bảng giả **không thể** lọt vào production | Đặt trong schema module chủ: cần migration dev ghi vào schema production-owned, rủi ro lọt bảng giả vào migration chính; tiền tố tên + quy tắc ranh giới giữ quyền sở hữu |
| `queue` thêm `enqueueRegistered` (tạo việc theo tên) | `account` phải phát thông báo mà không phụ thuộc `notifications` (tránh vòng) | `account → notifications`: tạo vòng (notifications cần `account` để tra người nhận); bảng outbox riêng: thêm thành phần. Hạn chế: quy tắc ranh giới chỉ cho `account` dùng |
