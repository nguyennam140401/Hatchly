# Rà soát mã Phase 1–2 (015-real-ai-gateway)

Phạm vi: T001–T017 và T001a, T003a, T006b/c, T008a, T009a, T016a (working tree so với `dev`, bỏ `specs/`).
Kết quả: **cần-sửa** (không có lỗi nghiêm trọng; 2 lỗi chặn CI ở lint/typecheck cần dọn trước khi vào Phase 3).

## Kiểm tra tĩnh
| Lệnh | Kết quả |
|---|---|
| `pnpm check:boundaries` | Đạt (737 module, không vi phạm; no-cross-schema-sql đạt) |
| `pnpm check:secrets` | Đạt (1902 tệp) |
| `pnpm typecheck` | Thất bại duy nhất ở `tooling/test/check-wiki.spec.ts(38,41)` (`sources` không có trên `{}`). Tệp này KHÔNG nằm trong thay đổi của 015 (có sẵn trên `dev`); `apps/server` và `apps/web` đạt |
| `pnpm lint` | 5 lỗi, cả 5 trong tệp test mới của 015 (xem F-01) |

## Phát hiện

### F-01 CAO – Lint đỏ trong 3 tệp test mới (chặn CI)
- `apps/server/test/account/ai-cycle-anchor.spec.ts:11` – ép kiểu thừa (`no-unnecessary-type-assertion`).
- `apps/server/test/ai_gateway/support-views.db.spec.ts:115` ép kiểu thừa; `:157` dùng `endsWith` thay vì so sánh cắt chuỗi.
- `apps/server/test/ai_gateway/token-estimate.spec.ts:28,35` – spread trên chuỗi (`no-misused-spread`).
- Dev sở hữu: qa (test/**). Sửa: bỏ ép kiểu, dùng `endsWith`, thay `[...str]` bằng `Array.from(str)` hoặc `Intl.Segmenter`/đếm bằng `for…of`.

### F-02 TRUNG BÌNH – TTL đệm giá và tuyến cho phép tới 1 giờ
- `apps/server/src/core/config/config.schema.ts` (`AI_PRICE_CACHE_TTL_MS` max 3_600_000), dùng ở `ai_gateway.module.ts` cho `DbPriceSource`, `RouteBook`; chỉ `AiSettings` tự kẹp 60 s (`settings/ai-settings.ts` `MAX_TTL_MS`).
- Hậu quả: thêm giá mới (nâng giá) hoặc tắt tuyến lỗi/lộ khóa mà vẫn dùng bản cũ tới 1 giờ → sổ chi phí thấp hơn hóa đơn (nguyên tắc III, cảnh báo lệch hóa đơn 5%), tắt tuyến chậm.
- Dev: backend (ai_gateway) + config. Sửa: hạ `max` về 60_000–300_000 hoặc kẹp như `AiSettings`; ghi rõ trong `.env.example`.

### F-03 TRUNG BÌNH – Giá giả định được seed vào CSDL với `effective_from = 2026-01-01`
- `apps/server/drizzle/migrations/0030_ai_gateway_seed_support.sql:36-45`. Số liệu khớp bảng giá công khai nhưng mã mô hình là giả định (comment đã nói). `model_prices` chỉ-thêm nên không sửa/xóa được; nếu chạy production trước POC-1/POC-4, mọi dòng sổ trước ngày giá thật có hiệu lực dùng giá giả định, và tuyến `model_routes` seed đang bật Anthropic/OpenAI.
- Dev: data-dev. Sửa: ghi vào quickstart/runbook "không bật `AI_GATEWAY_DRIVER=real` ở production trước khi thêm giá thật bằng dòng mới"; cân nhắc seed `enabled=false` cho route khi chưa POC. (Hiện driver `real` còn dừng khi khởi động nên chưa có rủi ro thực.)

### F-04 TRUNG BÌNH – `.specify/ownership.json` bị mở rộng trong chính nhánh tính năng
- `.specify/ownership.json`: thêm `apps/server/drizzle/migrations/meta/_journal.json` vào vùng dùng chung, `.dependency-cruiser.cjs` cho devops, `apps/server/vitest*.mts` cho qa.
- Thay đổi tệp phân quyền ghi phải có xác nhận của PM/người dùng, không do agent tự nới. Dev: pm. Đề xuất: PM xác nhận thay đổi này là có chủ đích (câu hỏi gửi lại PM), vì hook chặn ghi dựa trên tệp này.

### F-05 THẤP – Sổ `ai_cost_ledger` không có ràng buộc duy nhất theo `reservation_id`
- `0029_ai_gateway_tables.sql:231-254`. Bảng phân vùng buộc khóa duy nhất phải chứa `created_at`, nên không chặn được 2 dòng sổ cho một giữ chỗ. Tính idempotent (nguyên tắc V) hoàn toàn dựa vào `UPDATE … WHERE state IN ('held','calling')` cùng giao dịch với INSERT sổ.
- Dev: backend (T025 DbBudgetStore). Đề xuất: bắt buộc INSERT sổ chỉ chạy khi UPDATE trạng thái trả đúng 1 dòng, và có test chạy `settle` hai lần/đồng thời (đã nêu trong hiến pháp).

### F-06 THẤP – Bảng phân vùng chỉ dựa vào Worker tạo trước tháng
- `0029:337` tạo 3 tháng khi migrate; `jobs.ts` đăng ký `monthsAhead: 2`. Nếu lịch hẹn ngừng > 2 tháng, INSERT sổ lỗi → quyết toán lỗi (`ai.settle_failed`) và có nguy cơ giữ chỗ treo (nguyên tắc III). Đề xuất: thêm cảnh báo "thiếu phân vùng tháng sau" vào `jobs-and-alerts`, hoặc phân vùng DEFAULT; dev: data-dev/devops.

### F-07 THẤP – Chỉ mục thừa trên `ai_budgets`
- `0029:191-193`: `ai_budgets_account_id_idx` (quy ước), `ai_budgets_account_cycle_key` (unique) và `ai_budgets_account_cycle_idx` (DESC) cùng tiền tố `account_id, cycle_start`. Bảng được ghi nóng mỗi lời gọi AI; 2 chỉ mục dư làm tăng chi phí ghi. Dev: data-dev. Sửa: bỏ `ai_budgets_account_cycle_idx` (unique index đã phục vụ tra cứu chu kỳ mới nhất bằng quét ngược).

### F-08 THẤP – Khung nhìn hỗ trợ không đặt `security_barrier`
- `0030:63-78`. Nhất quán với `support_channel_view` (0025) và vai trò `support` do ứng dụng điều khiển, nhưng với khung nhìn thuộc owner, hàm của người truy vấn có thể bị đẩy xuống trước bộ lọc `account_id`. Đề xuất: `WITH (security_barrier = true)` cho 3 khung nhìn mới (không lộ cột bí mật: đã kiểm, không có lời nhắc/văn bản/khóa). Dev: data-dev.

### F-09 THẤP – `GatewayEventFields.reason: string` tự do
- `internal/events.ts`. `SAFE_ATTR_KEYS` chỉ cắt 120 ký tự, không lọc nội dung; một lần gọi sai có thể đưa thông điệp lỗi nhà cung cấp (có thể chứa đoạn lời nhắc) vào nhật ký. Đề xuất: kiểu hợp (union) các mã lý do cố định. Dev: backend.

### F-10 THẤP – Trùng kiểu và rò chi tiết nội bộ
- `AiCycleAnchor` khai 2 lần: `modules/account/internal/ai-cycle-anchor.ts:6` và `public-api.ts`. Dùng một định nghĩa từ `public-api`.
- `AI_REAL_PARTS` được export từ module kèm kiểu `DbPriceSource/RouteBook/AiSettings` (nội bộ). Chỉ dùng trong module; không đưa vào `exports` nếu không cần.
- `DbPriceSource.loadFromDb` đổi `input_per_mtok` null thành 0 cho đơn vị `audio_minute` (`db-price-source.ts` `?? 0n`); nên giữ `null` để lỡ dùng nhầm không thành "giá 0".
- `SandboxBudgetStore` bỏ qua `requestId` (`store.sandbox.ts:101`): đã ghi chú, chấp nhận; chống trùng thật ở T025.

## Đối chiếu trọng tâm yêu cầu

| Hạng mục | Kết luận |
|---|---|
| Migration 0029/0030: RLS | OK: `ai_budgets`, `ai_reservations`, `ai_trend_allocations`, `ai_cost_ledger` đều ENABLE RLS + chính sách `tenant_isolation` theo `account.current_account_id()` cho `app`, `system`; phân vùng bật RLS không chính sách |
| CHECK/ràng buộc | OK: `used+reserved<=cap`, `soft<cap`, state/task/tier enum, `model_prices_positive_matches_unit`, `ai_settings_single_row`; tiền đều `bigint` micro-USD |
| Trigger `model_prices` | OK: chặn UPDATE/DELETE/TRUNCATE, kể cả owner; `app` bị thu INSERT/UPDATE/DELETE, `system` chỉ INSERT |
| Sổ phân vùng | OK: PK `(created_at,id)`, thu UPDATE/DELETE/TRUNCATE, hàm tạo/bỏ phân vùng SECURITY DEFINER, `search_path` cố định, chỉ `system` EXECUTE; hàm drop có kiểm khoảng 1–120 |
| Quyền app/system | OK: bảng hệ thống (`system_*`, `provider_invoices`, `ai_trend_allocations`) thu hết quyền của `app`; cấu hình chung `app` chỉ đọc |
| Khung nhìn hỗ trợ | OK: lọc theo ngữ cảnh tenant, chỉ cấp cho `support`, thu `app/system`; không có cột bí mật (xem F-08) |
| Tương thích ngược | OK: chỉ thêm bảng/hàm/khung nhìn, không chạm bảng cũ |
| `schema.ts` sau sed `(t) =>` | OK: đối chiếu từng bảng với 0029, 7 bảng dùng `t` đều còn đúng chỉ mục (kể cả `sql\`${t.cycle_start} DESC\``, unique có `where`); các bảng không dùng `t` chuyển `() =>` đúng |
| `config.schema.ts` | OK: 2 khóa bọc `secret()`, tùy chọn, không có giá trị mặc định; test xác nhận lỗi không in giá trị khóa. Yếu: test "bí mật theo lược đồ" chỉ kiểm tên khóa, chưa kiểm `secretRegistry.has` (THẤP, qa) |
| `cycle.ts` | OK: mốc 29/30/31, tháng 2 (28/29), chuyển năm, UTC+7; `cycleEnd > cycleStart`, khớp CHECK. Mốc ở tương lai vẫn trả chu kỳ hợp lệ |
| `getAiCycleAnchor` | OK: không cache, mã tài khoản từ ngữ cảnh, lấy ngày UTC+7 từ `created_at`; `null` khi không `active`/đã xóa. Hiện thực tạm đã ghi vào Theo dõi độ phức tạp |
| `ai-settings`, `db-price-source`, `route-book` | Chỉ đệm cấu hình/giá, không đệm số dư ngân sách (đúng III). Xem F-02 về TTL; không chống "dồn truy vấn" khi hết TTL nhưng tải thấp (THẤP) |
| `events.ts` + `SAFE_ATTR_KEYS` | Không có trường tiền/lời nhắc/khóa; khóa mới đều định danh. Xem F-09 |
| `ReserveResult.duplicate` | OK: union rõ ràng, kho bộ nhớ kiểm trước khi kiểm ngân sách, bỏ qua giữ chỗ `released`; `requestId` kiểm `[A-Za-z0-9:_.-]{1,128}` ở cả generate/stream/transcribe |
| `assert-no-fakes` | Không đổi; `real` hợp lệ ở production nhưng module còn dừng khởi động có chủ đích (T017, không rơi lặng lẽ về giả). Cần gỡ khi T025/T049 xong |
| Nguyên tắc I | Đạt ở mức schema; kiểm thử chéo tài khoản đã thêm fixture `ai_budgets`, `ai_reservations`, `ai_cost_ledger` |
| Nguyên tắc III | Đạt: micro-USD số nguyên, quyền `ai.cost.view` chỉ nội bộ, thông điệp từ chối quyền không chứa số tiền, không số tiền trong sự kiện |
| Nguyên tắc IV | Đạt: SDK AI chỉ cho `internal/providers/` (quy tắc mới có fixture kiểm cả hai chiều); `ai_gateway` không import ngược module khác (cổng đảo ngược qua token) |
| Nguyên tắc VII | Đạt: khóa API là secret, không log; dữ liệu cá nhân không vào sổ/khung nhìn |
| Phụ thuộc | `@anthropic-ai/sdk` 1.7.0, `openai` 7.54.0 cố định phiên bản đúng (IX); chưa được dùng ngoài Phase 1–2 |

## Việc cần làm ngay
1. F-01 (qa): sửa 5 lỗi lint.
2. F-02 (backend/config): hạ trần TTL.
3. F-04 (pm): xác nhận việc sửa `.specify/ownership.json`.
4. Lỗi typecheck của `tooling/test/check-wiki.spec.ts` có sẵn trên `dev`, ngoài phạm vi 015; báo PM để xử lý riêng.
