# Cổng AI thật (015)

Mã: `src/modules/ai_gateway/`. Bộ chuyển đổi nhà cung cấp, STT, bộ đệm lời nhắc: xem [ai-gateway-providers.md](./ai-gateway-providers.md). Truy cập DB: [database.md](./database.md). Hàng chờ: [queue.md](./queue.md). Mô hình dữ liệu và ánh xạ thuật ngữ Việt→Anh (mục 1): `specs/015-real-ai-gateway/data-model.md`.

## Chọn driver và cấu hình

`AI_GATEWAY_DRIVER=fake|real`. `assert-no-fakes` từ chối `fake` ở production (staging được phép). `real` dựng bộ chuyển đổi cho MỌI nhà cung cấp có trong tuyến `model_routes` đang bật (`buildAdapters`); thiếu khóa hoặc nhà cung cấp chưa có bộ chuyển đổi → dừng khởi động, thông báo chỉ nêu TÊN biến. Nhà cung cấp admin trỏ tuyến tới sau khi khởi động được dựng lười nếu khóa đã nạp; thiếu khóa → `AI_NOT_CONFIGURED`. Dữ liệu seed migration 0030 (giá, tuyến, cấu hình) là GIẢ ĐỊNH chờ POC-1/POC-3/POC-4, phải thay bằng giá thật qua đường admin trước ngày ra mắt.

| Biến                                  | Ý nghĩa                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `AI_GATEWAY_DRIVER`                   | `fake` hoặc `real`                                                                         |
| `AI_PRICE_CACHE_TTL_MS`               | TTL đệm giá, tuyến, cấu hình trong tiến trình; mặc định và tối đa 60 000                   |
| `AI_TOKEN_ESTIMATE_SAFETY_PERCENT`    | Hệ số an toàn khi ước tính token đầu vào trước giữ chỗ (mặc định 20, 0 đến 500)            |
| `AI_PROVIDER_TIMEOUT_MS`              | Hết giờ một lời gọi nhà cung cấp (mặc định 40 000)                                         |
| `AI_FIRST_TOKEN_TIMEOUT_MS`           | Hết giờ chờ chữ đầu tiên khi truyền luồng (mặc định 5 000)                                 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Bí mật nhà cung cấp (tùy chọn ở lược đồ; bắt buộc theo tuyến đã bật khi `real`)            |
| `AI_STT_ALLOWED_HOSTS`                | Danh sách host cách nhau dấu phẩy, thêm vào host kho tệp S3 được phép tải âm thanh cho STT |
| `AI_SYSTEM_WEEKLY_CAP_MICRO_USD`      | Trần tuần TẠM của ngân sách hệ thống (mặc định 2 000 000), chỉ dùng khi thiếu nguồn ngành  |

Bí mật: không in, không ghi nhật ký/chỉ số/lỗi; nằm trong Secret `api-secrets` (API) và `worker-secrets` (Worker), xem `infra/docs/06-bi-mat-va-khoa.md`. Đổi khóa = cập nhật cả hai Secret rồi khởi động lại API và Worker.

## Mã yêu cầu (`requestId`)

Bên gọi cấp mã logic ổn định (1–128 ký tự `A-Za-z0-9:_.-`), ví dụ `media:{mediaId}:label`. Gọi lại cùng mã: đã quyết toán → `AI_DUPLICATE_REQUEST` (`settled`, không gọi/tính phí lại); đang xử lý → `AI_DUPLICATE_REQUEST` (`in_progress`). Nhờ đó bộ xử lý việc nền chạy lại an toàn; bộ xử lý nền dùng `noRetryOnAiError` để không thử lại các lỗi `AI_BUDGET_EXHAUSTED`, `AI_SYSTEM_BUDGET_EXHAUSTED`, `AI_DUPLICATE_REQUEST`, `AI_NOT_CONFIGURED`.

## Chu kỳ ngân sách

Mốc chu kỳ lấy từ `AccountPublicApi.getAiCycleAnchor(accountId)` (ngày kích hoạt gói; ngày 29–31 rơi vào tháng ngắn → ngày cuối tháng; ranh giới tính theo UTC+7, lưu `date`). Mỗi chu kỳ một dòng `ai_budgets`, chụp trần/ngưỡng lúc tạo. Trần 4 USD, ngưỡng mềm 2 USD, mức mỗi ngành mỗi tuần 1 USD là giá trị khởi đầu của `ai_settings`, đổi qua `PUT admin/ai/settings` (chỉ áp cho chu kỳ tạo sau). Chưa có mốc chu kỳ (gói hết hạn/chưa kích hoạt): `getUsage` trả `percent: 100`, `state: blocked`, không ném và không tạo ngân sách.

## Luồng một lời gọi

1. Giữ chỗ (một UPDATE có điều kiện trên `ai_budgets`, theo chi phí tối đa ước tính) trong giao dịch riêng.
2. Đánh dấu "đang gọi" (`held → calling`).
3. Gọi nhà cung cấp (NGOÀI mọi `tenantTx`/`systemTx`: không giữ giao dịch DB khi gọi mạng).
4. Quyết toán chi phí thực + ghi sổ + trả phần giữ chỗ dư; lỗi/hết giờ/hủy → trả lại giữ chỗ. `release_stale` dọn giữ chỗ mồ côi.

## Cờ 80%/100% và trạng thái `blocked`

- Cờ 80%: khi quyết toán, `used × 100 >= cap × 80` (theo số ĐÃ QUYẾT TOÁN), bật một lần/chu kỳ (`notified_80`) và phát `ai_usage_80` trong cùng giao dịch quyết toán.
- Cờ 100% (`notified_100`, `ai_usage_100`): `isBudgetExhaustedSettled` = `cap − used <= minEstimate` hoặc `used >= cap`, chỉ tính số đã quyết toán, không tính giữ chỗ.
- `getUsage().state = blocked` (`isBudgetBlocked`): tính cả giữ chỗ đang chạy, `cap − (used + reserved) <= minEstimate` hoặc `used + reserved >= cap`; có thể tạm thời. `cheap_model` khi `used + reserved >= soft_limit`; còn lại `normal`. `percent` = phần nguyên của `(used + reserved) × 100 / cap`, kẹp 0–100.
- `minEstimate` = `minCallEstimate(cheap_vision)`: `MIN_CALL_INPUT_TOKENS` = 1000 token vào + `MIN_CALL_OUTPUT_TOKENS` = 500 token ra theo giá `cheap_vision` hiện hành, làm tròn lên (một nguồn cho `getUsage` và cờ 100%; thiếu giá → 0 kèm cảnh báo `ai.price_missing`).

Chỉ phần trăm trên trần được hiển thị cho khách, không bao giờ số USD.

## Bậc mô hình và dự phòng

Bậc: gán nhãn → `cheap_vision`; `trend_summary` → `cheap`; STT → `stt`; `post_generation`/`topic_suggestion` → `default` khi `used + reserved < soft_limit`, ngược lại `cheap`. Từ trần cứng (4 USD) giữ chỗ bị từ chối → `AI_BUDGET_EXHAUSTED` (soạn tay, duyệt, đăng… vẫn dùng được).

Tuyến theo `model_routes`: `RouteBook.attemptsFor(task, tier)` (`selectAttempts`) trả rank 1 đang bật làm lượt chính; rank 2 chỉ thêm khi tuyến rank 2 bật VÀ `task_fallback[task].enabled`. Tối đa 2 lượt. Lượt chính lỗi/hết giờ → trả giữ chỗ, giữ chỗ lại theo giá lượt dự phòng, gọi đúng một lần; hết lượt → `AI_PROVIDER_UNAVAILABLE`. Truyền luồng đã gửi chữ ra rồi mới đứt: không chuyển dự phòng, trả phần đã sinh kèm `interrupted`. Thiếu tuyến chính hoặc giá lượt chính → `AI_NOT_CONFIGURED` (kèm `ai.route_missing`/`ai.price_missing`, không gọi); thiếu giá/tuyến lượt dự phòng → bỏ lượt, ra `AI_PROVIDER_UNAVAILABLE`. Seed: dự phòng chỉ bật cho `post_generation`, `topic_suggestion`.

## Chuyển giọng nói (STT)

`transcribe` từ chối `AI_INVALID_REQUEST` khi `durationSec` không hữu hạn hoặc `<= 0`, hoặc ngôn ngữ khác `vi`. Ước tính giữ chỗ: `billedSttSeconds` = `min(durationSec, 300)` làm tròn lên theo `billing_granularity_sec` (kẹp lại ≤ 300). Quyết toán: `billedSttSecondsActual` theo số giây nhà cung cấp báo, làm tròn lên theo độ chi tiết, KHÔNG kẹp 300; vượt ước tính thì kho kẹp theo trần; báo `> 300` s → sổ `anomaly='over_estimate'`; nhà cung cấp không báo → quyết toán theo ước tính, `anomaly='missing_usage'`.

URL âm thanh: chỉ `https`, không chứa tài khoản/mật khẩu, host trùng hoặc là tên miền con của host cho phép. Host cho phép = host của `S3_PUBLIC_ENDPOINT` và `S3_ENDPOINT` + `AI_STT_ALLOWED_HOSTS`; danh sách rỗng → từ chối mọi URL. Chi tiết: tệp providers.

## Ngân sách hệ thống và chi phí xu hướng

Tóm tắt xu hướng chạy theo tuần trên `system_budgets` với giữ chỗ riêng, dọn bởi `release_stale_system`. Trần tuần = số ngành đang hoạt động (`ActiveIndustriesSource`) × mức mỗi ngành mỗi tuần của `ai_settings`; thiếu nguồn hoặc số ngành 0 → dùng `AI_SYSTEM_WEEKLY_CAP_MICRO_USD` và phát `ai.industry_source_missing`. Việc `allocate_trend_cost` (hàng chờ `trends`, khóa chống trùng `ai_alloc:{weekStart}:{industryId}`) chia từng dòng `system_cost_ledger` của (tuần, ngành) cho các tài khoản cùng ngành (`IndustryAccountsSource`): phần dư 1 micro-USD gán cho các mã tài khoản nhỏ nhất; mỗi tài khoản một `runForAccount` + `systemTx` ghi `ai_trend_allocations` (`ON CONFLICT DO NOTHING`), không cộng vào `ai_budgets.used`. Thiếu nguồn → bỏ qua kèm `ai.industry_source_missing`.

## Quản trị giá và cấu hình

Controller `admin/ai`, quyền staff `ai.pricing.manage` (chỉ admin; chủ, cộng tác viên, hỗ trợ → 403):

| Điểm cuối                         | Hàm SQL (`SECURITY DEFINER`, 0031)   |
| --------------------------------- | ------------------------------------ |
| `POST admin/ai/prices`            | `ai_gateway.admin_add_price`         |
| `PUT admin/ai/settings`           | `ai_gateway.admin_set_settings`      |
| `PUT admin/ai/routes`             | `ai_gateway.admin_set_route`         |
| `PUT admin/ai/task-fallback`      | `ai_gateway.admin_set_task_fallback` |
| `POST admin/ai/provider-invoices` | `ai_gateway.admin_enter_invoice`     |

Hàm đọc kèm theo: `admin_get_current_price`, `admin_get_settings`, `admin_model_has_price`, `admin_get_route`. Giá chỉ-thêm (trigger 0029 chặn sửa/xóa); giá mới lệch quá 10× so với dòng liền trước HOẶC liền sau bị từ chối (`AI_PRICE_IMPLAUSIBLE`); `effective_from` phải `>= now() + 60 s` (`AI_PRICE_EFFECTIVE_TOO_SOON`). Mỗi lần ghi có dòng kiểm toán `infra.audit_log` cùng giao dịch. Giá đổi không cần phát hành.

## Hỗ trợ xem chi phí

Controller `support/ai`, quyền `ai.cost.view` (support, admin; chủ/cộng tác viên → 403):

- `GET support/ai/budget/:accountId?reason=` đọc ba khung nhìn `ai_gateway.support_ai_budget_detail`, `support_ai_cost_ledger`, `support_ai_trend_allocations` (0030) qua `supportViewAccount`, bắt buộc có lý do và ghi `support.view_account` (không ghi số tiền).
- `GET support/ai/summary?cycle=` gọi hàm `ai_gateway.admin_cost_summary` (0032), chỉ số tổng, không mã tài khoản.

Chỉ nội bộ; khách không thấy USD.

## Việc nền (pg-boss, đều idempotent)

| Việc                              | Hàng chờ    | Lịch                                     | Vai trò                                                                                                                               |
| --------------------------------- | ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_gateway.release_stale`        | `ai_batch`  | hẹn riêng từng giữ chỗ, chạy sau 15 phút | Trả/quyết toán theo ước tính giữ chỗ tenant treo > 15 phút                                                                            |
| `ai_gateway.release_stale_system` | `scheduled` | cron `* * * * *` (UTC), mỗi phút         | Như trên cho ngân sách hệ thống                                                                                                       |
| `ai_gateway.allocate_trend_cost`  | `trends`    | theo yêu cầu (module xu hướng tạo việc)  | Phân bổ chi phí xu hướng                                                                                                              |
| `ai_gateway.check_thresholds`     | `scheduled` | cron `*/5 * * * *` (UTC), mỗi 5 phút     | Phát `ai.threshold_ratio_high` khi > 5% tài khoản hoạt động chạm ngưỡng mềm                                                           |
| `ai_gateway.reconcile_invoices`   | `scheduled` | cron `0 2 * * *` (`Asia/Ho_Chi_Minh`)    | Đối soát sổ ngày hôm qua với `provider_invoices`, lệch > 5% phát `ai.invoice_mismatch` (thiếu hóa đơn: `ai.invoice_missing` mức info) |

Hàm SQL hỗ trợ Worker: `ai_gateway.threshold_ratio`, `invoice_ledger_total`, `invoice_providers_for_day` (0032); `account.count_active_accounts`, `ai_gateway.open_reservations_count` (0033). Sổ `ai_cost_ledger` phân vùng theo tháng, tạo trước 2 tháng, giữ 12 tháng.

## Chỉ số và cảnh báo

Chỉ số (meter `app.ai_gateway`): `ai_gateway_reserve_duration_ms`, `ai_gateway_calls_total{task,tier,outcome}`, `ai_gateway_fallback_total{task}`, `ai_gateway_blocked_total{reason}`, `ai_gateway_estimate_ratio{task}` (thực/ước tính, không phải tiền), `ai_gateway_open_reservations`, `ai_gateway_provider_calls_total{provider,outcome}`, `ai_gateway_provider_latency_ms{provider}`, `ai_gateway_events_total{event}`. Không chỉ số nào mang số tiền.

Quy tắc cảnh báo `ops/alerts/ai_gateway.rules.yml`: `AiProviderErrorRatioHigh`, `AiSystemBudgetExhausted`, `AiOpenReservationsStuck`, `AiCostAboveEstimate`, `AiThresholdRatioHigh`, `AiInvoiceMismatch`, `AiSettleFailed`, `AiPriceMissing`, `AiRouteMissing`, `AiIndustrySourceMissing`.

## Quy ước

- Không gọi Cổng AI bên trong `tenantTx`/`systemTx` (không giữ giao dịch khi chờ mạng).
- Mã tài khoản lấy từ phiên hoặc payload việc nền, không từ tham số; việc hệ thống cần ngữ cảnh một tài khoản dùng `runForAccount` (`modules/queue`), từ chối khi đã có tài khoản khác hoặc đang trong giao dịch (`TENANT_CONTEXT_CONFLICT`).
- Module khác chỉ dùng `ai_gateway/public-api.ts`; SDK nhà cung cấp chỉ ở `internal/providers/`.
