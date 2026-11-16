# Implementation Plan: Soạn bài tay theo kênh, duyệt, lên lịch, màn hình Lịch và Chờ duyệt

**Branch**: `impl/012-manual-compose-approval-calendar` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-manual-compose-approval-calendar/spec.md`

## Summary

Tạo khái niệm "bài viết" cho sản phẩm (FR-05 phần soạn tay, FR-06): bài + nội dung riêng từng kênh, vòng đời
Nháp → Chờ duyệt → Đã lên lịch, duyệt từng bài / nhiều bài (tất cả hoặc không theo cả bài), trả lại kèm ghi chú,
đổi giờ, sửa sau duyệt tự về Chờ duyệt, và 4 màn hình: Soạn / xem bài, Chờ duyệt, Lịch tuần/tháng, Bài viết.

Cách làm ([research.md](research.md)):

- **Chia trách nhiệm giữa ba module** theo ADD: `content` giữ bài, phiên bản kênh, lịch sử sự kiện và bộ giới hạn
  kênh; `publishing` giữ **mục lịch đăng** (`publish_attempts`) — 012 chỉ dựng phần *lên lịch / hủy / đổi giờ / đọc
  trạng thái*, việc thực thi 5 bước thuộc 013; `approval` **không có bảng**, chỉ là nơi điều phối mọi thao tác đổi
  trạng thái hoặc đụng tới lịch trong **một giao dịch** (R1, R2).
- Các hàm công khai của `content` / `publishing` nhận `tx: Db` (như `notifications.emit` của 005) để `approval` ghép
  nhiều module vào đúng một giao dịch mà không đọc bảng của nhau (R2).
- **Chống duyệt trùng và duyệt nhầm bản**: duyệt là `UPDATE … WHERE version = :đã_xem AND status IN (…)` + chèn
  `publish_attempts` có chỉ mục duy nhất `(post_id, channel_connection_id) WHERE status <> 'cancelled'` + tạo việc
  `publishing.run_attempt` khóa chống trùng `publish:{attemptId}` — cùng một giao dịch (R3, R4).
- **Kiểm tra trước, không gọi nền tảng trong giao dịch**: hạn mức kênh đọc từ bản đếm cục bộ (khóa advisory theo kênh)
  cộng `checkAccount.quotaRemaining` gọi **trước** giao dịch; quyết định cuối cùng vẫn ở bước "kiểm tra trước" của 013 (R5).
- **Duyệt hàng loạt = N giao dịch độc lập**, tối đa 100 bài, một bài lỗi không ảnh hưởng bài khác (R6).
- **Sửa sau duyệt** đi qua `approval.savePost`: cùng giao dịch đưa bài về Chờ duyệt, hủy mục lịch đăng + việc, phát
  thông báo "chờ duyệt" (R7).
- **Thông báo dùng nguyên danh mục 005** (`post_pending_review`, `post_returned`, `approved_post_rescheduled`); không
  loại mới. Gộp email theo `submissionId` (R8).
- **Lịch** là truy vấn theo khoảng giờ UTC + trạng thái đăng đọc từ `publishing`; không cache (R9).
- **Bộ thực thi tạm** `publishing.run_attempt`: chỉ chạy với bản giả lập (dev/test/staging); production hoãn việc lại
  15 phút và không đổi trạng thái, cho đến khi 013 thay thân hàm (R10).
- **Phía web** theo nền 011 (khung, biểu mẫu, chặn mất dữ liệu, khóa phiên bản, trạng thái bài) — xem Rủi ro R-A.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node.js 24 LTS – như 001–011

**Primary Dependencies**: có sẵn – NestJS 11, Drizzle 0.45, `pg`, pg-boss 12.38.0, Zod 4, React 19, Vite 8,
`react-router`, và bộ thành phần/biểu mẫu/quản lý dữ liệu của 011. **Không thêm gói chạy thật**. Kéo thả của Lịch
dùng sự kiện kéo thả gốc của trình duyệt + nút "Đổi giờ" (không thư viện lịch ngoài) — nếu 011 `library-suggestions`
đã chọn thư viện thì dùng theo đó (R11).

**Storage**: PostgreSQL. Schema `content`: 3 bảng tenant mới (`posts`, `channel_variants`, `post_events`) + 1 bảng
dùng chung (`channel_rules`). Schema `publishing`: 1 bảng tenant (`publish_attempts`). Schema `approval` vẫn **để
trống** ([data-model.md](data-model.md)). 2 migration chỉ thêm.

**Testing**: Vitest — đơn vị (`pnpm test`); tích hợp CSDL thật (`pnpm test:db`: truy cập chéo, RLS, đồng thời duyệt,
chạy lại); e2e API bằng supertest với `PLATFORM_DRIVER=fake`, `PUBLISH_EXECUTOR=fake`; hàng chờ theo bộ thử của 003;
web bằng Testing Library + `vitest-axe`.

**Target Platform**: Container Linux trên Kubernetes (API + Worker); SPA cùng site với API qua `/api`.

**Project Type**: Web application – monorepo `apps/server`, `apps/web`, `packages/shared`.

**Performance Goals**: duyệt 1 bài ≤ 300 ms phía máy chủ; duyệt 50 bài ≤ 10 giây (SC-006, ≈ 100 ms/bài tuần tự);
đổi giờ ≤ 2 giây từ lúc thả (SC-005); Lịch tháng 200 bài và Chờ duyệt 100 bài hiện nội dung đầu ≤ 2 giây (SC-008);
thông báo trong ứng dụng ≤ 1 phút (SC-007).

**Constraints**:
- Mã tài khoản chỉ từ phiên; không điểm cuối nào nhận `accountId`; id bài của tenant khác → 404 nhờ RLS.
- Không gọi nền tảng bên ngoài trong lúc đang giữ giao dịch (gọi `checkAccount` trước giao dịch); không cache hạn mức,
  trạng thái lượt đăng, quyền (Hiến pháp).
- Nội dung bài không vào nhật ký kỹ thuật, dữ liệu việc, tham số thông báo (chỉ mã bài, tiêu đề ≤ 60 ký tự trong
  thông báo theo khuôn 005).
- Không gọi Cổng AI; không trừ hạn mức 100 bài (FR-005, FR-032).
- Migration chỉ thêm; API và Worker cũ/mới chạy song song được.

**Scale/Scope**: ≤ 3.000 tài khoản × ≤ 100 bài AI/chu kỳ + bài tay không giới hạn cứng (gấp 10 lần vẫn nhẹ); ≈ 26
điểm cuối ([contracts/http-api.md](contracts/http-api.md)); 1 loại việc nền mới; 4 màn hình web; 2 migration.

Không còn NEEDS CLARIFICATION. Các điểm spec giao cho plan đã chốt: ranh giới `publish_attempts` (R2, R10), tên định
danh (data-model), kiểu thông báo gộp email (R8).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Áp dụng vào tính năng | Đánh giá |
|---|---|---|
| I. Cô lập tenant | 4 bảng tenant (`posts`, `channel_variants`, `post_events`, `publish_attempts`) là `tenantTable`: `account_id NOT NULL` đầu chỉ mục + RLS `tenant_isolation`, vào kiểm thử truy cập chéo của CI. `channel_rules` là `sharedTable` không dữ liệu khách. Mã tài khoản chỉ từ phiên; `post_id` lạ → 404. Việc `publishing.run_attempt` là việc tenant, Worker đặt lại ngữ cảnh. Không điểm cuối nào nhận `accountId` | ✅ Đạt |
| II. Đăng bài tin cậy | Mỗi cặp (bài, kênh) tối đa một mục hiệu lực — chỉ mục duy nhất có điều kiện làm chốt chặn cuối. Duyệt + tạo mục + tạo việc **một giao dịch**; mọi chuyển trạng thái là `UPDATE … WHERE status/version = :kỳ_vọng`. Hủy khi sửa/hủy lịch cũng cùng giao dịch với đổi trạng thái bài (không còn việc chạy với nội dung chưa duyệt). Dùng bộ hẹn giờ chung (việc `publish` có `runAfter`), không hẹn giờ nền tảng. 5 bước, thử lại, đối soát **không thuộc** tính năng này (013) | ✅ Đạt (phạm vi lên lịch) |
| III. Cổng AI | Không gọi AI; bài ghi `source = 'manual'` để tính năng AI trừ hạn mức sau. Không có số tiền ở màn hình/thông báo | ✅ Đạt |
| IV. Modular monolith | `content`, `publishing` chỉ chạm schema của mình; `approval` không bảng, gọi hai module qua `public-api` (hàm nhận `tx`); tham chiếu `connection_id`, `post_id`, `user_id` là mã tham chiếu, không khóa ngoại liên module (ADR-09). Thông báo ghi hàng chờ trong cùng giao dịch. Chỉ cần thêm **một** mũi tên vào tệp kê khai: `content → platform_gateway` (R2); `publishing → content` và `approval → content, publishing, notifications, account` đã có. Xem Theo dõi độ phức tạp | ⚠️ Đạt có điều kiện |
| V. Việc nền bền vững | 1 loại việc mới `publishing.run_attempt` (`publish`, tenant, `dedupeKey = publish:{attemptId}`), tạo trong giao dịch duyệt; bộ xử lý chạy lại an toàn (đọc trạng thái, bản tạm chỉ chạy khi `scheduled`). Không việc nền khác (thông báo do 005 lo) | ✅ Đạt |
| VI. Con người quyết định | `post.approve` kiểm ở API (cộng tác viên bị từ chối ở API); duyệt gắn **phiên bản đã xem** (FR-012); sửa sau duyệt → Chờ duyệt; đổi giờ không cần duyệt lại. Mọi lỗi có hành động khắc phục; mã gốc chỉ ở "Chi tiết cho hỗ trợ"; 4 màn hình ≥ 360 px, vùng chạm ≥ 44 px, trạng thái chữ + biểu tượng; không chặn khi AI khóa | ✅ Đạt |
| VII. Bí mật & dữ liệu cá nhân | Không chạm mã quyền nền tảng (chỉ qua `PlatformGatewayPublicApi`, không trả token). Nội dung bài là dữ liệu khách: xóa mềm 30 ngày → xóa hẳn; nằm trong phạm vi xóa tài khoản (FR-033). Không bên nhận mới ở nước ngoài | ✅ Đạt |
| VIII. Quan sát được | Mỗi thao tác duyệt / trả lại / hủy lịch / đổi giờ / sửa sau duyệt ghi `infra.audit_log` (12 tháng) kèm `trace_id`; nhật ký kỹ thuật chỉ mã bài. Việc `publish` mang `traceId` từ yêu cầu duyệt (013 nối tiếp). Chỉ số: số bài chờ duyệt, tỷ lệ xung đột phiên bản, thời gian duyệt hàng loạt | ✅ Đạt |
| IX. Đơn giản, chuẩn mở | Không dịch vụ, cache, thư viện chạy thật mới; bộ giới hạn kênh là cấu hình trong CSDL (đúng FR-002). Không cần ADR mới; **ghi nhận vào kiến trúc** v1.6 (mục 4: bảng của `content`/`publishing`; mục 11: thuật ngữ) | ✅ Đạt |

**Quy ước dữ liệu**: UUID v7 sinh ở ứng dụng ✅ · `timestamptz` UTC, hiển thị UTC+7 ✅ · không có tiền ✅ · cột `version`
trên `posts` và `channel_variants` ✅ · xóa mềm `deleted_at` trên bảng nghiệp vụ, `post_events` chỉ thêm ✅ · không bộ đếm hạn
mức mới (FR-032) ✅ · không cache gì mới ✅.

**Quy trình**: migration `chỉ thêm` ✅ · cổng CI 1 (truy cập chéo có 4 bảng mới), 2 (`db:check`), 3 (ranh giới — sửa
manifest có chủ đích), 4, 5 ✅ · kiểm thử "chạy lại hai lần" cho `run_attempt` ✅ · kiểm thử đồng thời duyệt ✅.

**Kiểm tra lại sau Phase 1** (data-model, contracts): mọi bảng có `account_id` là `tenantTable` ✅ · chỉ mục duy nhất của
`publish_attempts` đúng ADD ✅ · hàm công khai nhận `tx` và không trả bảng nội bộ ✅ · điểm cuối không nhận mã tài khoản ✅
· `post_events.data` không nội dung bài ✅ · khuôn việc không có trường cấm (`text`, `content`…) ✅ · không có điểm cuối nào
trả số tiền ✅. **Đạt.**

**Checklist kiến trúc** (`architecture.md` mục 13): module + giao diện công khai ✅ · bảng mới có `account_id` + RLS + truy cập
chéo ✅ · việc nền đúng loại, chạy lại an toàn, tạo cùng giao dịch ✅ · AI – không có ✅ · chuyển trạng thái có điều kiện +
ràng buộc CSDL ✅ · không thêm hạ tầng ✅ · `trace_id`, không log bí mật ✅ · migration tương thích ngược ✅.

## Điều chỉnh / ghi nhận so với spec

| Mục spec | Điều chỉnh | Lý do |
|---|---|---|
| FR-008, US7 bộ lọc "Đã hủy" | Trạng thái `cancelled` có trong CHECK nhưng **012 không có thao tác nào đưa bài vào đó** (hủy lịch → Nháp, xóa → xóa mềm). Bộ lọc "Đã hủy" ẩn khi không có bài; 013/tính năng sau dùng | Spec liệt kê trạng thái nhưng không có kịch bản tạo ra nó — không tự đặt thêm hành vi |
| FR-006 | Khóa lạc quan thực hiện ở **cấp bài** (`posts.version` tăng mỗi lần lưu bất kỳ phiên bản kênh, đổi giờ, đổi trạng thái); `channel_variants.version` tăng khi dòng đó đổi, để lịch sử/ghi nhận chi tiết, không dùng làm điều kiện riêng | Duyệt/đổi giờ cần một con số duy nhất cho "bản đã xem" (FR-012) |
| FR-016 "giữ 12 tháng" | `post_events` sống cùng bài (xóa khi bài bị xóa hẳn); bản **12 tháng** là `infra.audit_log` | Tránh thêm việc dọn định kỳ riêng; audit_log đã phân vùng 12 tháng |
| Assumptions "Tiêu đề bài" | `internal_name` ≤ 80 ký tự; tiêu đề thẻ = tên nội bộ hoặc 60 ký tự đầu của nội dung | Cụ thể hóa |

Không có điều chỉnh nào đổi hành vi nhìn từ người dùng; chỉ làm rõ chỗ spec để lửng. `spec.md` giữ nguyên.

## Ghi nhận khi thi công (T095) – lệch nhỏ so với kế hoạch

| Mục kế hoạch | Thực tế | Lý do |
|---|---|---|
| 2 migration `0017`, `0018` tách bảng | `0017_content_posts.sql` (sinh bằng drizzle-kit) chứa **cả** 5 bảng `content` + `publishing`; `0018_content_publishing_grants_seed.sql` (tay) là quyền + dữ liệu `channel_rules` | drizzle-kit sinh một tệp cho mọi lược đồ thay đổi; tách tay làm hỏng chuỗi snapshot |
| `internal/db/{posts,…}.table.ts` | một `internal/db/schema.ts` mỗi module | cấu hình `drizzle.config.ts` chỉ nạp `modules/*/internal/db/schema.ts` (khuôn của 006) |
| `GET /posts/:id`, `GET /calendar` trong `content` | nằm ở `approval.controller.ts` | cần `publishing.statusesByPosts`; `content` không được gọi `publishing` (tệp kê khai, tránh vòng) |
| `validation/` một tệp mỗi quy tắc | một `validation/rules.ts` | các quy tắc là hàm thuần ngắn |
| Kiểm tra gói còn hạn (`PLAN_EXPIRED`) qua `AccountPublicApi` | cổng `PLAN_GATE` tùy chọn (hiện `null` = còn hạn) | `account` chưa có mô hình gói; mã lỗi và thông điệp đã có sẵn cho khi gắn cổng |
| `PlatformGatewayPublicApi` giữ nguyên | thêm `listConnections()` | `content` cần "có kênh hoạt động nào không" khi tạo bài (`NO_ACTIVE_CHANNEL`); chỉ thêm, không đổi hàm có sẵn |
| `PlatformGatewayModule` không global | `global: true` | `content` và `publishing` tiêm `PLATFORM_GATEWAY` (như `account`, `notifications`) |
| Mục đã `running` khi hủy → `CHANNEL_ALREADY_PUBLISHING` | chỉ khi mục đã rời `scheduled`; mục còn `scheduled` mà việc đã được nhận thì hủy thắng | trạng thái trong CSDL là nguồn sự thật; bộ xử lý đổi `scheduled → processing` có điều kiện nên không đăng nội dung đã hủy |
| Hợp đồng `ErrorResponse` | thêm trường tùy chọn `extra` (`channelIssues`, `suggestedAt`, bài mới nhất khi `VERSION_CONFLICT`) | để giao diện hiện đủ kênh vướng cùng lúc (tất cả hoặc không) |
| Danh mục giải thích lỗi của web (011) | thêm 11 mã lỗi mới ở `apps/web/src/lib/catalogs/error-explanations.ts` | danh mục là `Record` đầy đủ theo `ERROR_CODES` (biên dịch bắt) |
| Kiểm thử tách theo tệp T037/T039/T060… | gom vào `test/e2e/posts-{compose,approve,workflow,security,performance}.e2e.spec.ts` và `test/db/{approval-atomicity,publishing-api.contract}.db.spec.ts` | cùng phạm vi, ít tệp mồi hơn; đồng thời/hạn mức/hoàn tác đều có ca riêng |
| Dữ liệu mẫu dev có sẵn 2 kênh giả lập | `seed-auth` in hướng dẫn kết nối kênh bằng OAuth giả | kho kết nối là nội bộ module Cổng nền tảng, không seed trực tiếp |

## Rủi ro và điều kiện tiên quyết

| Mã | Rủi ro | Cách xử lý |
|---|---|---|
| R-A | **011 (nền giao diện) và 010 (kênh kết nối) chưa merge vào `dev`** lúc lập plan — worktree `impl/012` chỉ thấy spec của chúng. Phần web và danh sách kênh phụ thuộc hai tính năng này | `tasks.md` tách pha **máy chủ** (không cần 010/011, dùng bản giả lập 005) khỏi pha **web**; `/speckit-implement` chạy `worktree-sync` để kéo `dev` về trước. Nếu 011 chưa merge, dừng ở hết pha máy chủ |
| R-B | Số migration (`0017`, `0018`) có thể trùng 010/011 đang làm song song | Đánh số lại theo `dev` ngay trước khi merge (`pnpm db:lint-migrations`); tên tệp chỉ là gợi ý |
| R-C | Hạn mức Zalo OA / Instagram: `quotaRemaining` của nền tảng chưa được kiểm chứng thật (POC-2) | Dùng bản đếm cục bộ làm chốt, `quotaRemaining` làm tín hiệu thêm; 013 kiểm tra lại lúc đăng. Ghi vào `open-questions` |
| R-D | Kéo thả trên Lịch khó đạt WCAG | Nút "Đổi giờ" và thao tác bàn phím là đường chính, kéo thả là phụ (đã có trong FR-024/FR-027) |

## Project Structure

### Documentation (this feature)

```text
specs/012-manual-compose-approval-calendar/
├── plan.md              # Tệp này
├── research.md          # R1–R12 + thuật ngữ mới
├── data-model.md        # bảng, ràng buộc, chuyển trạng thái, sự kiện, kiểm toán, migration
├── quickstart.md        # kịch bản kiểm chứng A–H
├── contracts/
│   ├── http-api.md      # điểm cuối, quyền, mã lỗi
│   └── module-api.md    # ContentPublicApi, PublishingPublicApi, ApprovalPublicApi, việc nền, cấu hình
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks) – KHÔNG do /speckit-plan tạo
```

### Source Code (repository root)

```text
apps/server/
├── drizzle/migrations/
│   ├── 0017_content_posts.sql            # posts, channel_variants, post_events, channel_rules + RLS + seed
│   └── 0018_publishing_attempts.sql      # publish_attempts + chỉ mục duy nhất có điều kiện
├── src/modules/
│   ├── modules.manifest.json             # + content → platform_gateway; approval giữ reservedSchema
│   ├── content/
│   │   ├── public-api.ts                 # ContentPublicApi (nhận tx)
│   │   ├── internal/
│   │   │   ├── db/{posts,channel-variants,post-events,channel-rules}.table.ts
│   │   │   ├── posts.repository.ts       # cập nhật có điều kiện theo version/status
│   │   │   ├── validation/               # kiểm tra theo kênh: chữ, hashtag, media, kênh hoạt động
│   │   │   ├── posts.controller.ts       # tạo nháp, đọc, danh sách, xóa nháp, lịch sử, channel-rules
│   │   │   └── calendar.controller.ts    # GET /calendar
│   │   └── …
│   ├── publishing/
│   │   ├── public-api.ts                 # PublishingPublicApi: schedule/cancel/reschedule/statuses
│   │   ├── jobs.ts                       # publishing.run_attempt (khai báo loại việc)
│   │   └── internal/
│   │       ├── db/publish-attempts.table.ts
│   │       ├── attempts.repository.ts    # chèn ON CONFLICT, đếm hạn mức, khóa advisory theo kênh
│   │       └── executor.stub.ts          # bộ thực thi tạm (R10)
│   └── approval/
│       ├── public-api.ts                 # ApprovalPublicApi: submit/approve/return/withdraw/unschedule/reschedule/savePost
│       └── internal/
│           ├── approval.service.ts       # điều phối giao dịch + thông báo + kiểm toán
│           ├── bulk.ts                   # N giao dịch độc lập, kết quả từng bài
│           ├── suggest-times.ts          # giờ gợi ý (giờ vàng, tránh trùng giờ)
│           └── approval.controller.ts    # /posts/:id/{submit,approve,return,…}, /approvals/*
packages/shared/src/modules/{content,approval,publishing}/   # khuôn Zod dùng chung web–server, mã lỗi, bảng trạng thái hiển thị

apps/web/src/features/
├── posts/        # Soạn / xem bài (tab theo kênh, xem trước, lịch sử), danh sách Bài viết
├── approvals/    # Chờ duyệt (xem nhanh, chọn nhiều, trả lại, dời giờ quá hạn)
└── calendar/     # Lịch tuần/tháng, thẻ bài, kéo thả + nút Đổi giờ, danh sách theo ngày trên điện thoại
```

**Structure Decision**: giữ bố cục modular monolith của 001; mọi thao tác **đổi trạng thái bài hoặc đụng tới lịch** đi qua
`approval` (kể cả `PUT /posts/:id` khi bài không còn là Nháp), còn `content` lo dữ liệu bài và đọc. Cách này tránh vòng phụ
thuộc `content ↔ approval` vì tệp kê khai đã cho `approval → content, publishing, notifications` (R1, R2).

## Complexity Tracking

| Điểm | Vì sao cần | Phương án đơn giản hơn bị loại vì |
|---|---|---|
| Hàm công khai nhận `tx: Db` giữa ba module | Hiến pháp II/IV: duyệt + tạo mục + tạo việc + sự kiện cùng giao dịch, mà vẫn không đọc bảng chéo module | Gọi tuần tự từng module có giao dịch riêng → có thể duyệt xong nhưng chưa có lượt đăng (trạng thái nửa chừng) |
| `publishing` có bảng trước khi 013 làm thực thi | `approval` cần nơi đặt mục lịch đăng và chỉ mục duy nhất ngay từ lúc duyệt; ADD giao bảng cho `publishing` | Đặt bảng ở `approval`/`content` → vi phạm ADD, 013 phải di chuyển dữ liệu |
| `content → platform_gateway` (thêm vào manifest) | Chọn kênh đang hoạt động và quy tắc media lúc soạn | Đi vòng qua `publishing` (đã được phép) làm `content` gọi ngược `publishing` → vòng phụ thuộc |
| Bộ thực thi tạm `executor.stub` | Chạy được đầu–cuối ở dev/staging và an toàn ở production trước khi có 013 | Không có bộ xử lý → loại việc lạ bị xử lý như lỗi (R22 của 008) hoặc mất việc |
| Duyệt hàng loạt là N giao dịch | Spec: từng bài độc lập (FR-014) | Một giao dịch lớn → một bài lỗi hoàn tác cả lô; đúng nghĩa "tất cả hoặc không" chỉ áp cho **một** bài |
