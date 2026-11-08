# Contract – HTTP API của khung

Lược đồ dữ liệu nằm ở `@app/shared/core` (xem `data-model.md` mục 2). Mọi phản hồi là JSON UTF-8.

| Phương thức | Đường dẫn | Đơn vị | Đăng nhập | Phản hồi thành công | Ghi chú |
|---|---|---|---|---|---|
| GET | `/healthz` | api | Không | 200 `HealthResponse` (`unit: "api"`) | Kiểm tra sống |
| GET | `/readyz` | api | Không | 200 `ReadinessResponse` `ready` · 503 khi `not_ready` (đang dừng / kiểm tra lỗi) | Kiểm tra sẵn sàng |
| GET | `/healthz` (cổng `WORKER_HEALTH_PORT`) | worker | Không | 200 `HealthResponse` (`unit: "worker"`) · 503 khi đang dừng | Không qua NestJS router |
| POST | `/api/v1/diagnostics/echo` | api | Không | 200 `EchoResponse` | **Chỉ khi `APP_ENV` ≠ `production`** |

## Lỗi

Mọi lỗi (kể cả 404, 500) trả `ErrorResponse`:

| Tình huống | HTTP | `error.code` | `actions[0].kind` |
|---|---|---|---|
| Đầu vào sai lược đồ | 400 | `VALIDATION_FAILED` | `fix_input` |
| Đường dẫn không tồn tại | 404 | `NOT_FOUND` | `navigate` |
| Đang dừng | 503 | `SERVICE_UNAVAILABLE` | `retry` |
| Lỗi không lường trước | 500 | `INTERNAL_ERROR` | `retry` (+ `contact_support`) |

Ví dụ (đầu vào thiếu `message`):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại các ô được đánh dấu.",
    "actions": [{ "kind": "fix_input", "label": "Sửa thông tin" }],
    "fieldErrors": [{ "path": ["message"], "message": "Vui lòng nhập nội dung." }],
    "support": { "traceId": "01J…", "detail": "invalid_type" }
  }
}
```

- `fieldErrors[].message` sinh bằng hàm thuần `toFieldErrors()` trong `@app/shared/core` – cùng kết
  quả với `EchoRequest.safeParse` ở web.
- Lỗi 500 không bao giờ chứa stack trace, câu SQL hay giá trị cấu hình trong `message`/`detail`.
- Mọi phản hồi có tiêu đề `x-trace-id` trùng `error.support.traceId`.

## CORS

Chỉ cho phép nguồn trong `CORS_ORIGINS`. Web chạy dev qua proxy của Vite nên không phụ thuộc CORS.
