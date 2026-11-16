# Hợp đồng: chỉ số, cảnh báo và nhật ký (Đăng bài)

Theo OpenTelemetry; nhật ký có cấu trúc; nhật ký nghiệp vụ (`publish_steps`) tách khỏi nhật ký kỹ thuật. Mọi nhật ký kỹ thuật có `trace_id`,
`account_id`, `attempt_id`, `channel_type`, `run_no`, `status`; **không** có mã quyền, nội dung bài, phản hồi thô của nền tảng.

## 1. Chỉ số

| Chỉ số | Loại | Nhãn | Dùng cho |
|---|---|---|---|
| `publish_attempt_transitions_total` | counter | `channel`, `from`, `to` | tỷ lệ lỗi, dòng chảy trạng thái |
| `publish_lag_seconds` | histogram | `channel` | độ trễ so với giờ hẹn (SC-003; mục tiêu p95 ≤ 300 s) |
| `publish_overdue_attempts` | gauge | `channel` | việc quá hạn > 5 phút |
| `publish_step_duration_seconds` | histogram | `channel`, `step`, `outcome` | tìm bước chậm/hỏng |
| `publish_unknown_total` / `publish_needs_check_total` | counter | `channel` | tỷ lệ "Cần kiểm tra" |
| `publish_reconcile_total` | counter | `channel`, `result` (`found/not_found/unsupported`) | chất lượng đối soát (POC-2) |
| `publish_duplicate_guard_total` | counter | `channel`, `guard` (`unique_index`, `conditional_update_lost`, `phase_resume`) | chứng minh các lớp chặn trùng đang hoạt động |
| `publish_notification_latency_seconds` | histogram | `kind` | SC-004 (≤ 5 phút) |

Nhãn **không** có `account_id`/`post_id` (tránh bùng kích thước chuỗi thời gian); tra theo nhật ký.

## 2. Cảnh báo (bổ sung vào bảng ở kiến trúc mục 9)

| Cảnh báo | Điều kiện | Mức |
|---|---|---|
| Tỷ lệ lỗi đăng một kênh | `(to ∈ {needs_user, needs_check, unknown}) / tổng` > 5% / 15 phút | cao |
| Việc đăng quá hạn | `publish_overdue_attempts > 0` kéo dài > 5 phút | cao |
| Tỷ lệ "Cần kiểm tra" | > 1% lượt đăng của một kênh / ngày (điều kiện xem lại ADR-04) | trung bình |
| Việc `publish` chết | `dead_jobs{queue=publish} > 0` | **ngay** |
| Chặn trùng bị kích hoạt bất thường | `publish_duplicate_guard_total{guard=conditional_update_lost}` tăng đột biến | trung bình |
| Không đối soát được hàng loạt | `reconcile_total{result=unsupported}` > 20% | trung bình |

## 3. Nhật ký nghiệp vụ

- `publish_steps`: xem `data-model.md` mục 3. Đủ 5 bước kể cả "chưa chạy"/"không áp dụng" (SC-005).
- `infra.audit_log`: `publish.republish`, `publish.mark_published`, `publish.rescheduled`, `publish.cancelled`, `error_mapping.updated`, `support.view_account` (đã có).
- Hỗ trợ tra từ mã bài hoặc mã lượt đăng trong ≤ 2 phút (SC-005): truy vấn `publish_steps` theo `attempt_id` qua `supportViewAccount`; liên kết `trace_id` sang Tempo/Loki.

## 4. Quét bí mật

Bài kiểm thử tự động: chạy toàn bộ ca hợp đồng bộ chuyển đổi và ca bộ thực thi với một mã quyền mẫu có tiền tố nhận diện; kiểm tra tiền tố
**không** xuất hiện ở nhật ký thu được, `publish_steps`, thông báo, phản hồi HTTP (SC-008).
