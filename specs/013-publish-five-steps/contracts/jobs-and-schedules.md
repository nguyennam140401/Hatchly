# Hợp đồng: loại việc, việc định kỳ và cấu hình

Khai báo ở `apps/server/src/modules/publishing/jobs.ts` (không nằm trong `internal/`), theo `apps/server/docs/queue.md`.

## 1. Loại việc

| Tên | Hàng chờ | Scope | Payload (`z.strictObject`) | Khóa chống trùng | Ghi chú |
|---|---|---|---|---|---|
| `publishing.execute_attempt` | `publish` | tenant | `{ attemptId: uuid }` | `publish:{attemptId}` | `allowGenericRetry: false`; `version: 1` |
| `publishing.sweep_overdue` | `scheduled` | system | `{}` | `scheduled:publishing.sweep_overdue` | mỗi phút (`defineSchedule`) |

Phong bì ≤ 8 192 byte, **không** chứa nội dung bài, mã quyền, `accountId` ở payload (lớp hàng chờ tự mang `accountId`).

## 2. Bộ xử lý `execute_attempt` (giả mã – không phải mã thật)

```
đọc lượt (tenantTx, không khóa dài)
nếu status ∈ {succeeded, cancelled, needs_user, needs_check} hoặc phase = finished → return (idempotent)
chọn nhánh theo (status, phase):
  scheduled + phase none        → transition scheduled→processing; chạy bước 1..3  (xem R3)
  retry_wait + phase none       → transition retry_wait→processing; chạy bước 1..3
  processing/unknown + phase submitted_awaiting_response → đối soát (không gửi)
  processing + phase awaiting_processing → bước 4 → 5
kết thúc mỗi nhánh bằng một trong:
  succeeded                     → return
  retry_wait                    → return retryAfter(delay)
  unknown                       → return retryAfter(lần đối soát kế)
  needs_user | needs_check      → phát thông báo (cùng giao dịch chuyển trạng thái) → return
tôn trọng ctx.signal; khi bị hủy → KHÔNG ghi kết quả; phase vẫn là trạng thái cuối đã commit (an toàn theo R3)
```

Kiểm thử bắt buộc (`runJobInline` + `expectIdempotent` + `startTestWorkers(2)`):

| Ca | Kỳ vọng |
|---|---|
| Hai Worker cùng nhận một lượt | một chuyển được `scheduled→processing`; Worker kia thoát, không gọi `submit` |
| Worker chết ngay sau ghi dấu (trước `submit`) | chạy lại → đối soát, `submit` không được gọi lần hai |
| Worker chết sau `submit`, trước ghi kết quả | chạy lại → đối soát → `succeeded`; số bài trên nền tảng giả = 1 |
| Chạy lại hai lần việc đã `succeeded` | không tác dụng phụ (snapshot bằng nhau) |
| Việc bị giao lại khi khóa hết hạn trong lúc `submit` đang chạy | `ctx.signal` hủy; lần sau đối soát, không gửi |
| `timeout_after_publish` + đối soát `found` | `succeeded`, 1 bài |
| `timeout_after_publish` + `not_found` 10 phút | thử lại **đúng một lần**, rồi `succeeded` hoặc `needs_check` |
| Năng lực `reconcile=false` + `unknown` | `needs_check` ngay |
| Mã lỗi lạ | `unknown`, không `submit` lần hai |

## 3. Việc định kỳ `sweep_overdue`

Mỗi phút, idempotent: đếm và phát chỉ số `publish_overdue_attempts` (lượt `scheduled` quá `scheduled_at + 5 phút` chưa vào
`processing`), `publish_unknown_total`, `publish_needs_check_ratio`; **không** đổi trạng thái lượt đăng, **không** gửi bài. Bộ quét
chỉ phát hiện và cảnh báo (R14).

Việc quản trị đã có sẵn của `queue`: `queue.sweep_failed` chôn việc hết lượt; việc `publish` chết → cảnh báo ngay (`dead_jobs.publish > 0`).

## 4. Cấu hình

Khóa ở `data-model.md` mục 5, đọc lại mỗi 60 giây cùng cơ chế cấu hình hàng chờ. Hàng chờ `publish` giữ mặc định đã có
(đồng thời 10/bản, tối đa 3/tenant, khóa 2 phút, chế độ thử lại `handler`); không đổi.

## 5. Tắt có kiểm soát

Worker ngừng nhận việc `publish`, chờ tối đa 30 giây. Việc đang ở `submit` bị hủy bằng `signal`; do đã commit `submitted_awaiting_response`
nên lần chạy sau đối soát — **không bao giờ** gửi lại. (Kiểm thử ở mục 2.)
