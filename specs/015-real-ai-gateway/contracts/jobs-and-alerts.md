# Hợp đồng — việc nền, khóa chống trùng, cảnh báo, chỉ số

Mọi việc đi qua lớp hàng chờ 003 (pg-boss), phong bì `{ type, v, accountId, traceId, payload }`, chạy lại hai lần cho cùng kết quả (hiến pháp V). Việc tenant chạy
trong ngữ cảnh tài khoản của việc (RLS); việc hệ thống chạy ngoài ngữ cảnh tài khoản.

## 1. Loại việc

| Loại việc | Hàng chờ | Phạm vi | Kích hoạt | Khóa chống trùng | Hành vi |
|---|---|---|---|---|---|
| `ai_gateway.release_stale` (có từ 005) | `ai_batch` | tenant | hẹn trong **giao dịch giữ chỗ**, chạy +15 phút | `ai_release_stale:{reservationId}` | `held` quá hạn → `released`; `calling` quá hạn → quyết toán theo ước tính (kẹp trần), sổ `anomaly='unsettled'`, cảnh báo; chạy lại = không đổi |
| `ai_gateway.release_stale_system` (có từ 005) | `scheduled` | system | mỗi phút | `scheduled:ai_gateway.release_stale_system:{slot}` | Như trên cho `system_reservations`; **bản thật tự khai báo lịch** (hết phụ thuộc `defineStaleSystemSchedule` của sandbox) |
| `ai_gateway.allocate_trend_cost` | `trends` | system | sau lần thu thập tuần của `trends` (thứ Hai 05:00 UTC+7), `trends` gửi khi xong | `ai_alloc:{weekStart}:{industryId}` | Tổng `system_cost_ledger` của ngành/tuần chia đều cho tài khoản cùng ngành (R-11); upsert theo khóa duy nhất → chạy lại không nhân đôi |
| `ai_gateway.check_thresholds` | `scheduled` | system | mỗi 5 phút (`*/5 * * * *`), quy tắc cửa sổ [10m] for 0m (≈ 11 phút) | `scheduled:ai_gateway.check_thresholds:{slot}` | Tỷ lệ tài khoản đạt ngưỡng mềm > 5% → `ai.threshold_ratio_high` |
| `ai_gateway.reconcile_invoices` | `scheduled` | system | hằng ngày 02:00 UTC+7 (ngày hôm trước) | `scheduled:ai_gateway.reconcile_invoices:{slot}` | So sổ với `provider_invoices`; lệch > 5% → `ai.invoice_mismatch` |

Quy tắc đồng thời: `ai_batch` đã giới hạn ≤ 3 việc/tenant (003); việc cảnh báo/đối soát đồng thời 1.

## 2. Cảnh báo vận hành (FR-034, hiến pháp VIII)

Phát bằng nhật ký có cấu trúc mức `warn` (`gatewayEvent('warn', …)`) + chỉ số đếm; quy tắc cảnh báo đặt ở cấu hình giám sát hiện có (Grafana/Prometheus).
**Không** nhật ký/cảnh báo nào chứa lời nhắc, văn bản kết quả hoặc số tiền theo tài khoản nhận dạng được.

| Sự kiện/chỉ số | Điều kiện | Nguồn |
|---|---|---|
| `ai.threshold_ratio_high` | > 5% tài khoản hoạt động đạt ≥ 2 USD trong chu kỳ | `check_thresholds` |
| `ai.invoice_mismatch` | `|Σsổ − hóa đơn| / hóa đơn > 5%` theo nhà cung cấp/ngày | `reconcile_invoices` |
| `ai_gateway_provider_calls_total{provider,outcome}` | tỷ lệ `outcome=error` > 5% trong 15 phút | chỉ số OpenTelemetry (quy tắc Prometheus) |
| `ai.unsettled_reservation` | giữ chỗ `calling` treo > 15 phút phải quyết toán theo ước tính | `release_stale*` |
| `ai.cost_anomaly` | chi phí thực > ước tính | `settle` |
| `ai.settle_failed` | quyết toán lỗi sau 1 lần thử lại | `settle` |
| `ai.price_missing`, `ai.route_missing` | thiếu giá/tuyến hợp lệ (FR-022) | đường gọi |
| `ai.system_budget_exhausted` | hết trần tuần hệ thống | đường gọi hệ thống |
| `ai.industry_source_missing` | chưa có nguồn số ngành/tài khoản theo ngành | tính trần tuần/phân bổ |

SC-013: kích hoạt đúng trong mô phỏng và đội vận hành nhận trong ≤ 15 phút (cảnh báo nhật ký/chỉ số → kênh cảnh báo hiện có).
Cách hiểu đã chốt: nhóm cảnh báo theo sự kiện/tỷ lệ phải đến đội vận hành ≤ 15 phút kể từ lúc điều kiện xảy ra (`check_thresholds` mỗi 5 phút, ≈ 11 phút).
Riêng đối soát hóa đơn (chạy hằng ngày vì hóa đơn nhà cung cấp theo ngày): ≤ 15 phút **sau khi việc đối soát phát hiện lệch**.

## 3. Chỉ số OpenTelemetry (gắn `account_id` khi có, không nhãn có độ phân tán cao ngoài `account_id`)

- `ai_gateway_reserve_duration_ms` (histogram) — p95 ≤ 50 ms (SC-003).
- `ai_gateway_calls_total{task, tier, outcome}`, `ai_gateway_fallback_total{task}`, `ai_gateway_blocked_total{reason}`.
- `ai_gateway_provider_calls_total{provider, outcome}`, `ai_gateway_provider_latency_ms{provider}`.
- `ai_gateway_estimate_ratio{task}` — token thực / ước tính (hiệu chỉnh R-09).
- `ai_gateway_open_reservations` (gauge) — phát hiện giữ chỗ treo.

## 4. Thông báo cho khách (đã có ở 005, không đổi)

`ai_usage_80` và `ai_usage_100`, tạo trong **cùng giao dịch quyết toán** qua `notifications.emit(tx, …)`; khóa chống trùng theo `(tài khoản, cycleStart)`; nội dung
chỉ có phần trăm (SC-004, SC-011). Thử lại quyết toán không phát trùng vì cờ chỉ bật bằng cập nhật có điều kiện `= false`.
