# Nghiên cứu (Phase 0) — Cổng AI thật

Không còn mục `NEEDS CLARIFICATION`. Dưới đây là các quyết định thiết kế; mỗi mục: **Quyết định · Lý do · Phương án đã
loại**. Căn cứ: hiến pháp III, ADR-06, `.specify/memory/architecture.md` mục 7.2/8, 005 (`contracts/ai-gateway.md`,
`research.md` R7–R8) và mã hiện có ở `apps/server/src/modules/ai_gateway/`.

## R-01 Chiến lược: chuyển logic đã kiểm chứng của bản `sandbox` sang bảng thật

- **Quyết định**: giữ nguyên `AiGatewayService`, `pickTier`, `estimate`, bộ việc nền trả giữ chỗ treo và giao diện
  `BudgetStore`/`PriceSource`/`AiProviderAdapter`. Viết `DbBudgetStore` bằng cách chuyển `SandboxBudgetStore` sang bảng
  của schema `ai_gateway`, thêm: mã yêu cầu logic, chu kỳ theo ngày kích hoạt, ngưỡng/trần đọc từ cấu hình.
- **Lý do**: 005 đã chốt trình tự và có bộ kiểm thử hợp đồng 14 mục chạy được cả chế độ bộ nhớ lẫn CSDL (FR-028). Đổi tên
  bảng + thêm cột ít rủi ro hơn viết lại; bất kỳ lệch hành vi nào bị bộ hợp đồng bắt ngay.
- **Đã loại**: viết lại cổng từ đầu (rủi ro hồi quy ở phần đồng thời, đã được 100×25 vòng kiểm); dùng ORM
  "upsert + đọc lại" thay cho cập nhật có điều kiện (không nguyên tử).

## R-02 Bảng dữ liệu: tách tenant / hệ thống, sổ chi phí phân vùng

- **Quyết định**:
  - Tenant (`tenantTable`, RLS): `ai_budgets`, `ai_reservations`, `ai_cost_ledger` (phân vùng tháng), `ai_trend_allocations`.
  - Hệ thống (`sharedTable`, chỉ vai trò `system`): `system_budgets`, `system_reservations`, `system_cost_ledger`.
  - Cấu hình dùng chung: `model_prices`, `model_routes`, `task_fallback`, `ai_settings`, `provider_invoices`.
  - Tên bảng theo bảng thuật ngữ kiến trúc (`ai_budgets`, `ai_cost_ledger`, `model_prices`); tên thực thể trong spec
    (`ai_budget`…) là dạng số ít của cùng bảng.
- **Lý do**: giống cách 005 tách để dòng hệ thống không có `account_id` mà không phá RLS. Sổ chi phí tài khoản phân vùng
  theo tháng (kiến trúc mục 8, giữ 12 tháng) theo khuôn `publish_steps` của 013: định nghĩa Drizzle `*.log-table.ts`, DDL
  viết tay trong migration, RLS chỉ-thêm.
- **Đã loại**: một bảng chung `account_id` nullable (RLS với NULL phức tạp, dễ lộ chéo); không phân vùng sổ (trái kiến
  trúc, dọn dữ liệu 12 tháng khó).
- **Ghi chú**: `ai_cost_ledger` phân vùng nên không đặt khóa duy nhất toàn cục trên `reservation_id`; bảo đảm "một dòng
  sổ mỗi giữ chỗ" bằng chuyển trạng thái có điều kiện `held|calling → settled` trong cùng giao dịch ghi sổ.

## R-03 Giữ chỗ nguyên tử và bất biến

- **Quyết định**: giữ nguyên SQL của 005 — `UPDATE ai_budgets SET reserved = reserved + :est WHERE account_id =
  account.current_account_id() AND cycle_start = :c AND used + reserved + :est <= cap RETURNING …`, rồi chèn
  `ai_reservations` và hẹn việc `ai_gateway.release_stale` (+15 phút) **trong cùng giao dịch**. `CHECK (used >= 0 AND
  reserved >= 0 AND used + reserved <= cap)` là chốt chặn cuối. Quyết toán: khóa dòng giữ chỗ + dòng ngân sách `FOR
  UPDATE`, `used = min(used + actual, cap - reserved')`, cờ 80/100 bằng cập nhật có điều kiện `= false`, ghi sổ,
  `→ settled`, rồi `onCrossed` (phát thông báo) trong cùng giao dịch.
- **Lý do**: nguyên văn hiến pháp III; đã qua kiểm thử đồng thời. Ba câu lệnh một giao dịch giữ p95 ≪ 50 ms (đo ở bộ test).
- **Đã loại**: khóa tư vấn theo tài khoản (nối tiếp hóa mọi lời gọi của một tài khoản, không cần); cache số dư (cấm).

## R-04 Mã yêu cầu logic (FR-037a, Clarifications Q4)

- **Quyết định**: thêm `requestId?: string` (tối đa 128 ký tự, ký tự an toàn) vào `AiRequest`/`TranscribeRequest`. Cột
  `request_id` trên `ai_reservations`; **chỉ mục duy nhất từng phần** `(account_id, cycle_start, request_id) WHERE
  request_id IS NOT NULL AND state <> 'released'`. Trình tự: chèn giữ chỗ → vi phạm duy nhất ⇒ tra dòng hiện có: nếu
  `settled` ném `AiError('AI_DUPLICATE_REQUEST', { status: 'settled' })`, nếu `held|calling` ném `status: 'in_progress'`;
  không giữ chỗ, không gọi nhà cung cấp, không ghi sổ.
- **Lý do**: `released` (lỗi nhà cung cấp đã trả lại) phải cho thử lại cùng mã — vì vậy bỏ `released` khỏi chỉ mục. Mỗi mã
  tối đa một dòng sổ là hệ quả của một giữ chỗ không `released`.
- **Không lưu kết quả văn bản** (hiến pháp VII, FR-017): "trả lại kết quả đã ghi" nghĩa là trả **trạng thái** đã ghi
  (`AI_DUPLICATE_REQUEST` + `status`), không phát lại nội dung. Module nền (đã idempotent theo nghiệp vụ: "chủ đề đã có bài
  thì bỏ qua") coi `settled` là đã xong, `in_progress` là thử lại sau. Mã lỗi mới là **cộng thêm** vào `AiError`.
- **Đã loại**: băm nội dung lời nhắc làm khóa (hai lần tạo lại hợp lệ cùng lời nhắc bị chặn nhầm); lưu kết quả để phát
  lại (lưu nội dung nhà cung cấp trả – trái nguyên tắc tối thiểu dữ liệu và tăng bề mặt dữ liệu cá nhân).

## R-05 Chu kỳ theo ngày kích hoạt (FR-014)

- **Quyết định**: `budget/cycle.ts` tính `cycle_start` hiện hành từ **mốc** `anchorDate` (ngày trong tháng) theo quy tắc
  hiến pháp: lặp hằng tháng, tháng không có ngày đó → ngày cuối tháng; giờ tính theo UTC+7 rồi lưu `date`. Mốc lấy từ
  phương thức cộng thêm `AccountPublicApi.getAiCycleAnchor(): Promise<{ anchorDate: string } | null>` (chạy trong ngữ cảnh
  tài khoản; `null` = chưa kích hoạt/hết hạn → lời gọi AI bị từ chối như hết hạn mức). Hiện thực tạm ở `account`: `accounts` chưa có cột kích hoạt nên lấy **ngày (UTC+7) của `created_at`** khi
  `status = 'active'`, các trạng thái khác (`suspended`, `expired`, `deleting`, `unclaimed`) → `null` (ADR-12 chờ SA); khi có `subscriptions`/`usage_cycles`, đổi phần hiện thực bên trong `account`,
  `ai_gateway` không đổi.
- Dòng ngân sách của chu kỳ mới tạo **lười** ở lần giữ chỗ đầu: `INSERT … ON CONFLICT (account_id, cycle_start) DO
  NOTHING` → hai yêu cầu đầu chu kỳ đồng thời không tạo hai dòng; cờ 80/100 và `used/reserved` về 0 tự nhiên (FR-014).
- **Lý do**: không cần việc "mở chu kỳ" cho ngân sách AI; tránh phụ thuộc vào module gói chưa có; ngày 29–31 xử lý ở một
  hàm thuần, kiểm thử bảng ngày (hiến pháp: kiểm thử ngày 29–31, tháng ngắn).
- **Đã loại**: việc định kỳ tạo sẵn dòng cho mọi tài khoản (tốn, tạo cả cho tài khoản không dùng AI); lưu mốc chu kỳ trong
  `ai_gateway` (nhân đôi nguồn sự thật với module gói).

## R-06 Bảng giá (FR-019/020/022, Clarifications Q3)

- **Quyết định**: `model_prices(provider, model_id, unit 'token'|'audio_minute', input/output/cached_input per M token,
  per_minute, billing_granularity_sec, effective_from, created_by)`. `DbPriceSource` hiện thực giao diện `ModelPriceSource.priceFor(provider, modelId, unit, at)` (trả `PriceRecord` kèm `priceId` hoặc `null`); đệm TTL `AI_PRICE_CACHE_TTL_MS` ≤ 60000 ms; `PriceBook` giữ
  bộ nhớ đệm trong tiến trình **TTL 60 giây** (cấu hình) và chọn dòng `effective_from <= at` mới nhất tại thời điểm giữ
  chỗ (đã có trong 005). Giá của giữ chỗ được **ghi vào dòng giữ chỗ** (`price_id`) để quyết toán dùng đúng giá đó dù giá
  đổi giữa chừng.
- Bảo đảm SC-007 (mọi lời gọi sau T dùng giá mới): dòng mới phải có `effective_from ≥ now() + TTL` (kiểm khi thêm), nên
  khi đến T mọi bản đệm đã nạp lại. Giá cũ không bao giờ bị sửa — chỉ thêm dòng mới (chỉ-thêm, trigger chặn UPDATE/DELETE).
- **Kiểm tra bất hợp lý (FR-019a)**: từ chối nếu giá ≤ 0, hoặc lệch hơn 10× (lên hoặc xuống) so với dòng hiện hành của
  cùng `(provider, model_id, unit)`; dòng đầu tiên của một mô hình chỉ kiểm `> 0`. Kiểm ở dịch vụ **và** `CHECK`/hàm CSDL
  cho phần `> 0` (chốt cuối).
- Thiếu giá hợp lệ → ném `AI_NOT_CONFIGURED` (mã cộng thêm, thông điệp tiếng Việt, không đoán giá), **không** gọi nhà cung
  cấp, phát `ai.price_missing` (FR-022); người dùng vẫn làm tay được.
- **Đã loại**: cache vô hạn + xóa cache khi ghi (không có hạ tầng phát thông báo giữa các bản); đọc bảng giá mỗi lần gọi
  (thêm một truy vấn vào đường giữ chỗ 50 ms không cần thiết); duyệt hai người (đã chốt ở Clarifications là không cần).

## R-07 Định tuyến và dự phòng theo loại việc (FR-023/024/024a, Clarifications Q2)

- **Quyết định**: `model_routes(tier, rank 1|2, provider, model_id, enabled)` cho biết bậc nào do mô hình nào phục vụ ở lượt
  chính/dự phòng; `task_fallback(task PK, enabled)` bật dự phòng **riêng từng loại việc** (6 dòng). Dự phòng chỉ thử khi
  `task_fallback.enabled` **và** có `model_routes` rank 2 cho bậc đó. Không đủ → trả `AI_PROVIDER_UNAVAILABLE` ngay (đã trả
  giữ chỗ), không thử. `AiGatewayService.callWithFallback` hiện thử cứng `[primary, fallback]`; sửa thành danh sách lượt
  do `RouteBook.attemptsFor(task, tier)` (bất đồng bộ; thuật toán thuần ở `selectAttempts`) trả (1 hoặc 2 phần tử) — giữ nguyên "đúng một lần dự phòng".
- Giá dự phòng tra theo `(provider, model_id)` của lượt đó; giữ chỗ lại theo giá dự phòng (FR-024); sổ ghi nhà cung cấp
  thực sự trả kết quả.
- **Đã loại**: dự phòng bật toàn cục (STT/nhãn có thể chưa có nhà cung cấp thứ hai); danh sách nhà cung cấp trong biến môi
  trường (phải phát hành mới đổi).

## R-08 Ngưỡng 2 / 4 USD và mức USD mỗi ngành (FR-011/012/013/019a/032a)

- **Quyết định**: `ai_settings` một dòng: `account_cap_micro_usd` (4 000 000), `account_soft_limit_micro_usd` (2 000 000),
  `per_industry_weekly_micro_usd`. Ràng buộc `soft < cap` bằng `CHECK`. Giá trị được **chụp vào dòng ngân sách lúc tạo**
  (`cap`, `soft_limit` đã có ở 005), nên đổi ngưỡng áp cho chu kỳ/tuần tạo sau đó, không đổi `CHECK` của dòng đang chạy. Đổi
  qua dịch vụ quản trị, ghi `infra.audit_log` (`ai.settings.change`, metadata chỉ giá trị cũ/mới và mã người đổi).
- **Lý do**: kiểm tra `used + reserved + est <= cap` không đọc bảng cấu hình trong đường nóng; ngưỡng đổi giữa chu kỳ không
  làm một số tài khoản bị chặn bất ngờ.
- **Đã loại**: đọc `ai_settings` mỗi lần giữ chỗ; áp ngưỡng mới ngay cho chu kỳ đang chạy (khó giải thích với khách).

## R-09 Ước tính token cục bộ (FR-003, FR-009)

- **Quyết định**: `countInputTokens` **không gọi mạng** trước khi giữ chỗ. Dùng bộ ước tính cục bộ chặn trên:
  `ceil(utf8Bytes / 3) × (100 + AI_TOKEN_ESTIMATE_SAFETY_PERCENT) / 100` (+ hằng số theo khung hình như 005), hệ số an toàn
  cấu hình. Sau lời gọi so token thực của nhà cung cấp với ước tính để hiệu chỉnh (chỉ số `ai_gateway_estimate_ratio`).
- **Lý do**: ước tính là chi phí **tối đa**, tính dư không hại (giữ chỗ được trả sau quyết toán); gọi API đếm token của nhà
  cung cấp thêm 100–300 ms và một điểm lỗi vào đường giữ chỗ ≤ 50 ms.
- **Rủi ro**: tiếng Việt có dấu tốn nhiều token hơn tiếng Anh; hệ số cần xác nhận ở POC-1. Bù bằng cờ `over_estimate` + kẹp trần
  (đã có) và cảnh báo vận hành.
- **Đã loại**: gọi `count_tokens` của nhà cung cấp trước mỗi lần giữ chỗ.

## R-10 Chuyển giọng nói theo phút (FR-021, SC-009)

- **Quyết định**: ước tính = `ceil(min(duration, 300 s) / granularity) × granularity × per_minute / 60` (làm tròn **lên** theo
  `billing_granularity_sec` của dòng giá); chi phí thực = cùng công thức trên **thời lượng nhà cung cấp báo đã xử lý** (kẹp
  `≤ 300 s`, và không vượt ước tính). Bản 005 quyết toán đúng bằng ước tính; bản thật sửa để chi phí thực theo thời lượng
  thực (US5-AS2). `ProviderResult` thêm `audioSeconds` (tùy chọn).
- Tệp trùng dấu tệp không gọi lại được bảo đảm ở module `media` (014); Cổng AI không nhận biết tệp. Mã yêu cầu logic của
  `media` cho mỗi tệp gán nhãn là lớp phòng thủ thứ hai.
- **Đã loại**: tính theo token cho STT (đơn vị tính của nhà cung cấp là giây/phút); tính tiền theo `durationSec` khách khai
  (không đáng tin → luôn kẹp ≤ 300 s và ưu tiên số của nhà cung cấp).

## R-11 Ngân sách hệ thống theo ngành và phân bổ chi phí (FR-032/032a/033, Clarifications Q1)

- **Quyết định**:
  - Trần tuần = `industriesWithActiveAccounts × per_industry_weekly_micro_usd`, **tính một lần khi tạo dòng
    `system_budgets` của tuần** (thứ Hai 00:00 UTC+7) và chụp vào dòng.
  - Nguồn số ngành là **cổng đảo ngược** `ActiveIndustriesSource` (định nghĩa trong `ai_gateway`, `trends`/`context` cung cấp
    hiện thực qua token Nest) — `ai_gateway` không thêm phụ thuộc mới vào module khác. Chưa có hiện thực → dùng
    `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` hiện có làm trần tạm (hành vi 005), ghi cảnh báo `ai.industry_source_missing`.
  - Phân bổ: việc `ai_gateway.allocate_trend_cost` (queue `trends`, `scope: 'system'`) chạy sau lần thu thập tuần (khóa
    `ai_alloc:{weekStart}:{industryId}`), tra tài khoản cùng ngành qua cổng `IndustryAccountsSource`, chia **đều theo số
    nguyên** (phần dư rải 1 micro-USD cho các tài khoản đầu theo thứ tự mã, tổng luôn bằng chi phí), ghi `ai_trend_allocations`
    (tenant, chỉ nội bộ). **Không** cộng vào `used` của tài khoản → % khách thấy không đổi (FR-032).
- **Lý do**: giữ ranh giới module (hiến pháp IV) mà vẫn đáp ứng "theo ngành".
- **Đã loại**: `ai_gateway` đọc bảng `trends.industries`/`context.business_profiles` (vi phạm ranh giới); chia bằng số thực (cấm).

## R-12 Nhà cung cấp và giá khởi đầu (POC-1, POC-4, POC-3) — chưa chốt

- **Quyết định tạm của SA** (FR-027, Giả định): hai bộ chuyển đổi `AnthropicAdapter` (văn bản + thị giác + trả dần) và
  `OpenAiAdapter` (văn bản + thị giác + trả dần + chuyển giọng nói), chọn chính/dự phòng **bằng dữ liệu** `model_routes` — đổi
  nhà cung cấp là đổi dòng cấu hình. Mặc định khởi đầu: chính = Anthropic cho `default`/`cheap`/`cheap_vision`, dự phòng =
  OpenAI; STT = OpenAI, chưa bật dự phòng (`task_fallback.transcription = false`). Giá ban đầu là **giá giả định** được nạp ở migration
  `0030`, thay bằng giá thật sau POC-1 bằng một dòng `model_prices` mới (không phát hành).
- SDK: cố định phiên bản chính xác khi thi công; chỉ nhập trong `internal/providers/`; kiểu SDK không rò ra ngoài (FR-008 của
  005, quy tắc `aiProviderPackagePatterns` trong manifest).
- **Rủi ro mở**: chất lượng/chi phí tiếng Việt và STT chưa kiểm chứng → mọi thứ ở trên là cấu hình, không nằm trong mã nghiệp vụ.
  Thay đổi nhà cung cấp cuối cùng sau POC không cần ADR mới (đã nằm trong bảng ngăn xếp "Chốt sau POC-1/POC-4").
- **Mức USD mỗi ngành** (POC-3): khởi đầu do SA chốt tạm trong migration `0030`, chỉnh qua cấu hình.

## R-13 Phụ thuộc chưa có

| Phụ thuộc | Hiện trạng | Cách xử lý ở 015 |
|---|---|---|
| Mô hình gói/chu kỳ (`account`) | Chưa có `subscriptions`, `usage_cycles` | Mốc chu kỳ tạm theo ngày kích hoạt qua `getAiCycleAnchor()` (R-05); ghi vào `open-questions` khi ingest |
| Số ngành / tài khoản theo ngành | `trends`/`context` chưa cung cấp | Cổng đảo ngược + trần cấu hình tạm (R-11) |
| Bộ đếm "số bài / 100" | Thuộc `account`/gói (Clarifications Q5) | `getUsage()` chỉ trả %; ghép số bài ở lớp hiển thị sau |
| Màn hình quản trị đầy đủ | WBS 4.7 | Chỉ điểm cuối tối thiểu (R-15) |

## R-14 Cảnh báo và đối soát (FR-034, SC-013)

- **Quyết định**:
  - `ai_gateway.check_thresholds` (queue `scheduled`, mỗi giờ): đếm tài khoản có dòng ngân sách chu kỳ hiện hành đạt `used + reserved >=
    soft_limit` so với tài khoản đang hoạt động (lọc `status <> 'unclaimed'`); > 5% → cảnh báo `ai.threshold_ratio_high`.
    Đếm tổng hợp bằng hàm `SECURITY DEFINER` hẹp (không đọc dữ liệu từng tài khoản).
  - `ai_gateway.reconcile_invoices` (hằng ngày): so `SUM(cost)` của sổ theo `(provider, ngày)` với `provider_invoices` do vận
    hành nhập; lệch > 5% → `ai.invoice_mismatch` kèm nhà cung cấp và mức lệch. Không có dòng hóa đơn → bỏ qua (không báo
    sai).
  - Tỷ lệ lỗi nhà cung cấp > 5%/15 phút: **chỉ số OpenTelemetry** `ai_gateway_provider_calls_total{provider,outcome}` + quy
    tắc cảnh báo ở cấu hình giám sát (Prometheus) — không thêm bảng. Các cảnh báo còn lại (`ai.cost_anomaly`,
    `ai.settle_failed`, `ai.unsettled_reservation`, `ai.system_budget_exhausted`, `ai.price_missing`) là nhật ký cảnh báo có cấu
    trúc đã có/mới, gắn quy tắc cảnh báo cùng chỗ.
- **Lý do**: dùng đúng hạ tầng quan sát đã có (hiến pháp VIII); không thêm thành phần.

## R-15 Quản trị và hỗ trợ (FR-019a, FR-035, Clarifications Q3)

- **Quyết định**: quyền mới `ai.pricing.manage` (chỉ `admin`) và `ai.cost.view` (`support`, `admin`) trong danh mục quyền dùng chung;
  điểm cuối `@StaffAccess(...)`: `POST /admin/ai/prices`, `PUT /admin/ai/settings`, `PUT /admin/ai/routes`, `PUT
  /admin/ai/task-fallback`, `POST /admin/ai/provider-invoices`; `GET /support/ai/budget/:accountId` (qua `supportViewAccount` + lý do
  + kiểm toán) và `GET /support/ai/summary` (tổng hợp FR-018). Mọi thay đổi cấu hình ghi `infra.audit_log` cùng giao dịch.
- **Đã loại**: giao diện quản trị đầy đủ (WBS 4.7); duyệt hai người.

## R-16 Hiển thị cho khách (FR-029–031)

- **Quyết định**: `getUsage()` không đổi hình dạng; dữ liệu mới đọc từ `ai_budgets` (không cache). Khóa 100%/`blocked` đã suy ra từ
  `cap - spent < minCallEstimate(giá cheap_vision hiện hành)`. Thông báo 80/100% dùng danh mục `ai_usage_80/100` của 005
  (khóa chống trùng `ai_usage_80:{cycleStart}` + tài khoản). Quét tự động (như hợp đồng 005 mục 8) áp cho `getUsage()`,
  thông báo và email để chứng minh không có số tiền (SC-004).

## R-17 Chọn driver, cấu hình, bí mật

- **Quyết định**: `AI_GATEWAY_DRIVER ∈ {fake, real}`. `real` yêu cầu `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (theo định tuyến đã bật) —
  thiếu → `ConfigError` khi khởi động. `assert-no-fakes.ts` không đổi (production cấm `fake`; staging cho `real`). Khóa nằm ở
  `Secret` theo thành phần (`api-secrets`, `worker-secrets`), không vào nhật ký/sổ/thông báo lỗi (FR-026). Nhà cung cấp mới ở nước
  ngoài được thêm vào danh sách chuyển dữ liệu xuyên biên giới (tài liệu `Kiến trúc dữ liệu mục 9`) trước khi bật ở production.
- **Ghi nhận (T049a)**: Anthropic và OpenAI cần có dòng ở `TaiLieuDacTa/Kien_truc_Du_lieu_Cache_App_AI_Content_MXH.md` mục 9 (hook chặn
  agent SA ghi tệp này; PM/chủ sở hữu thêm: dữ liệu gửi = lời nhắc tối thiểu, khung hình thu nhỏ, âm thanh 5 phút đầu cho OpenAI STT).
  OpenAI gọi với `store:false`; Anthropic không có cờ kỹ thuật không-huấn-luyện, chỉ có cam kết hợp đồng (hiến chương VII) và phải
  vào hồ sơ chuyển dữ liệu xuyên biên giới (Q-D3) trước ngày ra mắt.
- Dữ liệu gửi ra: chỉ phần hồ sơ cần thiết do module gọi chuẩn bị; Cổng AI bổ sung kiểm tra rằng `AiRequest` không chứa email/số
  điện thoại ở các trường đã biết (lớp phòng thủ rẻ, test).

## R-18 Chiến lược kiểm thử

1. **Hợp đồng**: chạy lại `describeAiGatewayContract` (005) trên `DbBudgetStore` — thêm mục: mã yêu cầu logic (trùng/đang xử lý/đã
   trả lại cho thử lại), chu kỳ ngày 29–31/tháng ngắn, dự phòng theo loại việc, STT theo thời lượng thực, giá đổi giữa chừng.
2. **Đồng thời**: 100 vòng × 25 lời gọi sát trần (SC-001) trên CSDL thật; quan sát bất biến sau mỗi thao tác.
3. **Truy cập chéo**: tài khoản A đọc/sửa/xóa mọi bảng tenant mới của B → thất bại (hiến pháp CI #1); `db:check` bắt bảng thiếu RLS.
4. **Việc nền**: `release_stale`, `allocate_trend_cost`, `check_thresholds`, `reconcile_invoices` chạy hai lần cho cùng kết quả.
5. **Quét "không có tiền"** trên mọi bề mặt hướng khách; **quét bí mật/lời nhắc** trong nhật ký mẫu.
6. **Nhà cung cấp thật**: kiểm thử hợp đồng bộ chuyển đổi bằng máy chủ giả cục bộ (không gọi mạng ở CI); chạy tay với khóa thật nằm ở
   `quickstart.md` mục 6 (staging, sau POC).
