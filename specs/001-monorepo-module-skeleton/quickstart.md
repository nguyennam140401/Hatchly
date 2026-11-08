# Quickstart – kiểm chứng tính năng 001

Hướng dẫn chạy để chứng minh tính năng hoạt động đầu-cuối. Lệnh chi tiết: [contracts/repo-commands.md](contracts/repo-commands.md).
Tài liệu khởi đầu chính thức cho đội (FR-021) là `README.md` ở gốc kho – tệp này chỉ là kịch bản
kiểm chứng.

## Điều kiện

- Node.js 24 LTS (`node -v` khớp `.nvmrc`), Corepack bật (`corepack enable`) → pnpm đúng phiên bản trong
  `packageManager`.
- Docker (chỉ cho bước 5).
- Không cần PostgreSQL ở tính năng này.

## 1. Cài đặt và kiểm tra toàn kho (US4, SC-006)

```powershell
pnpm install
pnpm verify
```

Mong đợi: bảng tổng kết mọi bước `✓ đạt`, mã thoát 0, tổng thời gian ≤ 5 phút.

## 2. API (US1)

```powershell
Copy-Item apps/server/.env.example apps/server/.env
pnpm dev:api
# cửa sổ khác:
curl http://localhost:3000/healthz
curl http://localhost:3000/readyz
```

Mong đợi: `/healthz` → 200 `{"status":"ok","unit":"api",…}`; `/readyz` → 200 `{"status":"ready","checks":[]}`;
nhật ký JSON có dòng `api.ready`.

Kiểm tra đầu vào bằng lược đồ dùng chung (US3 kịch bản 5):

```powershell
curl -X POST http://localhost:3000/api/v1/diagnostics/echo -H "content-type: application/json" -d "{}"
```

Mong đợi: 400, `error.code = "VALIDATION_FAILED"`, `fieldErrors` nêu `message` và `sentAt` bằng tiếng
Việt, có `actions` ≥ 1 và `support.traceId` trùng tiêu đề `x-trace-id`
(định dạng: [contracts/http-api.md](contracts/http-api.md)).

Thiếu cấu hình (edge case): xóa `APP_ENV` khỏi `.env` rồi chạy lại → tiến trình thoát mã 1, in
`APP_ENV: bắt buộc`, không in giá trị biến nào.

## 3. Worker (US1, SC-004)

```powershell
pnpm dev:worker
curl http://localhost:3001/healthz
```

Mong đợi: nhật ký `worker.ready` với `queues: []`; `/healthz` → `unit: "worker"`; không có đường dẫn
nào khác trên cổng 3001 (vd `/api/v1/diagnostics/echo` → 404). Nhấn Ctrl+C → nhật ký `worker.stopping`
rồi `worker.stopped`, tiến trình thoát trong ≤ 30 giây. Kiểm thử tự động lặp 10 lần:
`pnpm --filter @app/server test -- shutdown` (Linux). Trên Windows các ca dùng tín hiệu bị bỏ qua vì
`child.kill()` giết tiến trình ngay – chạy `pnpm --filter @app/server test:linux` (trong container
`node:24`) để kiểm SC-004.

## 4. Web (US3)

```powershell
pnpm dev:web
```

Mở `http://localhost:5173`: thấy "✓ API đang hoạt động" (chữ + biểu tượng). Dừng API → tải lại → thấy
"⚠ Không kết nối được API" kèm nút "Thử lại".

Lệch hợp đồng (SC-005): đổi tên trường `unit` thành `unitName` trong `HealthResponse` ở
`packages/shared` → `pnpm typecheck` báo lỗi ở cả `apps/server` và `apps/web`. Hoàn tác thay đổi.

## 5. Một ảnh container (SC-003)

```powershell
docker build -t app:local .
docker run --rm -e APP_ENV=development -p 3000:3000 app:local
docker run --rm -e APP_ENV=development -p 3001:3001 app:local node dist/worker.js
```

Mong đợi: một ảnh duy nhất; lần chạy thứ nhất là API, lần thứ hai là Worker; `docker stop` Worker xong
trong ≤ 30 giây.

Nhiều bản Worker song song với API (SC-009) – giữ API đang chạy, mở thêm:

```powershell
docker run --rm -d --name w1 -e APP_ENV=development -p 3101:3001 app:local node dist/worker.js
docker run --rm -d --name w2 -e APP_ENV=development -p 3102:3001 app:local node dist/worker.js
curl http://localhost:3101/healthz
curl http://localhost:3102/healthz
curl http://localhost:3000/healthz
docker stop w2
```

Mong đợi: cả hai Worker trả `unit: "worker"`, API vẫn trả 200 suốt quá trình; dừng `w2` không ảnh hưởng
`w1` và API. Kiểm thử tự động tương ứng: `pnpm --filter @app/server test -- multi-worker`.

## 6. Ranh giới module (US2, SC-002)

```powershell
pnpm check:boundaries
pnpm --filter @app/tooling test   # bộ mẫu vi phạm a–f + clean
```

Thử tay: trong `apps/server/src/modules/content/` thêm
`import '../platform_gateway/internal/x';` → `pnpm check:boundaries` báo
`no-internal-cross-module` và `allowed-deps-content`, mã thoát 1. Xóa dòng đó → sạch.

Danh sách module và phụ thuộc được phép: `apps/server/src/modules/modules.manifest.json`
(định dạng: [contracts/module-manifest.md](contracts/module-manifest.md)).

## 7. Thêm module mới (SC-007)

Làm theo mục "Thêm module" trong `README.md`: thêm một mục vào tệp kê khai, tạo thư mục theo khuôn, thêm
vào registry → `pnpm verify` đạt. Không sửa module có sẵn. Hoàn tác sau khi thử.
