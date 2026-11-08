# Data Model – 001 Kho mã nguồn chung chia module

Tính năng này **không tạo bảng CSDL** (bảng, RLS, biến phiên tenant thuộc WBS 1.2). "Dữ liệu" ở đây là
(1) tệp kê khai module, (2) hợp đồng dùng chung web ↔ API, (3) cấu hình môi trường. Tên định danh tiếng
Anh theo `architecture.md` mục 11 và phần "Thuật ngữ mới" của `research.md`.

## 1. ModuleDescriptor (tệp kê khai `apps/server/src/modules/modules.manifest.json`)

Nguồn sự thật duy nhất cho: danh sách module, schema sở hữu, phía chạy, phụ thuộc được phép. Được đọc
bởi (a) cấu hình dependency-cruiser, (b) registry ghép module vào API/Worker, (c) kiểm thử khung.
Định dạng chi tiết: [contracts/module-manifest.md](contracts/module-manifest.md).

| Trường | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `name` | chuỗi | ✓ | `snake_case`, duy nhất, trùng tên thư mục `src/modules/<name>/` |
| `title` | chuỗi | ✓ | Tên tiếng Việt theo ADD mục 6 (dùng cho tài liệu/sơ đồ) |
| `kind` | `"business"` \| `"gateway"` \| `"infra"` | ✓ | `infra` không được phụ thuộc module nào khác `infra` |
| `schema` | chuỗi `snake_case` | ✓ | Duy nhất giữa các module; mọi module đều có (hiến pháp IV) |
| `reservedSchema` | boolean | – | `true` = schema dành sẵn, chưa được có bảng (hiện chỉ `approval`) |
| `runsIn` | mảng con của `["api","worker"]` | ✓ | Không rỗng |
| `allowedDeps` | mảng tên module | ✓ | Mỗi phần tử là `name` có thật, ≠ chính nó; đồ thị không có vòng |

**Bất biến được kiểm thử** (`apps/server/test/manifest.spec.ts`):
1. Đúng 11 module; mỗi `name` có thư mục và `index.ts`; không có thư mục module nào ngoài tệp kê khai.
2. Mọi module có `schema` khác rỗng và không trùng; `approval.schema === "approval"` với
   `reservedSchema === true`; `platform_gateway.schema === "platform_gateway"`;
   `queue.schema === "infra"`.
3. Đồ thị `allowedDeps` không vòng; `queue.allowedDeps` rỗng.
4. Chỉ `publishing` có `platform_gateway` trong `allowedDeps`.
5. Mỗi module có `runsIn` chứa `api` có mặt trong `ApiAppModule`; tương tự `worker` (registry khớp).

### Giá trị ban đầu (đề xuất – sửa qua review)

| name | title | kind | schema | runsIn | allowedDeps |
|---|---|---|---|---|---|
| `account` | Tài khoản & Gói | business | `account` | api, worker | `queue` |
| `context` | Ngữ cảnh kinh doanh | business | `context` | api, worker | `ai_gateway`, `queue` |
| `media` | Thư viện media | business | `media` | api, worker | `account`, `ai_gateway`, `queue` |
| `trends` | Xu hướng | business | `trends` | api, worker | `ai_gateway`, `queue` |
| `content` | Nội dung | business | `content` | api, worker | `account`, `context`, `media`, `trends`, `ai_gateway`, `queue` |
| `approval` | Duyệt & lịch | business | `approval` (dành sẵn) | api | `account`, `content`, `publishing`, `queue` |
| `publishing` | Đăng bài | business | `publishing` | api, worker | `content`, `media`, `platform_gateway`, `notifications`, `queue` |
| `platform_gateway` | Cổng nền tảng | gateway | `platform_gateway` | api, worker | `notifications`, `queue` |
| `ai_gateway` | Cổng AI | gateway | `ai_gateway` | api, worker | `account`, `queue` |
| `notifications` | Thông báo | business | `notifications` | api, worker | `account`, `queue` |
| `queue` | Hàng chờ (hạ tầng) | infra | `infra` | api, worker | — |

Ghi chú thiết kế phụ thuộc:
- `content` **không** phụ thuộc `publishing` (tránh vòng với `publishing → content`). Việc "sửa bài đã
  duyệt → hủy lượt đăng" đi bằng sự kiện qua `queue` (ADD mục 6, edge case của spec).
- `account` không phụ thuộc `notifications` (tránh vòng `notifications → account`); thông báo hết hạn gói
  phát bằng sự kiện qua `queue`.
- `approval` chỉ chạy ở `api` (thao tác người dùng); việc nền liên quan thuộc `publishing`. Schema
  `approval` được dành sẵn để tuân thủ hiến pháp IV; WBS 1.2 tạo schema rỗng (`CREATE SCHEMA approval`),
  không tạo bảng. Thêm bảng vào đây cần đặc tả mới.

## 2. Hợp đồng dùng chung (`@app/shared`)

Mọi hợp đồng là **lược đồ Zod**; kiểu TS suy ra từ lược đồ. Chi tiết HTTP:
[contracts/http-api.md](contracts/http-api.md).

### 2.1 Kiểu nền (`@app/shared/core`)

| Tên | Định nghĩa | Ghi chú |
|---|---|---|
| `Id` | chuỗi UUID v7 | Sinh ở máy chủ (WBS 1.2); web chỉ kiểm tra |
| `UtcDateTime` | chuỗi ISO 8601 có hậu tố `Z` | Hiển thị UTC+7 là việc của web |
| `MicroUsd` | số nguyên an toàn ≥ 0 | Không dùng trong hợp đồng cho khách hàng |
| `UsagePercent` | số nguyên 0–100 | Cách duy nhất hiển thị mức dùng AI cho khách hàng |
| `UnitName` | `"api"` \| `"worker"` | |

### 2.2 `ErrorResponse`

| Trường | Kiểu | Bắt buộc | Quy tắc |
|---|---|---|---|
| `error.code` | chuỗi `UPPER_SNAKE_CASE` | ✓ | Mã ổn định cho máy đọc (vd `VALIDATION_FAILED`) |
| `error.message` | chuỗi tiếng Việt | ✓ | Lời giải thích đời thường, không chứa mã kỹ thuật |
| `error.actions` | mảng `ErrorAction`, **≥ 1** | ✓ | Nguyên tắc VI: mỗi lỗi có ít nhất một hành động khắc phục |
| `error.fieldErrors` | mảng `{ path: string[], message: string }` | – | Có khi lỗi kiểm tra đầu vào |
| `error.support` | `{ traceId: string, detail?: string }` | ✓ | "Chi tiết cho hỗ trợ"; `detail` là mã lỗi gốc, không chứa bí mật |

`ErrorAction`: `{ kind: "retry" | "fix_input" | "contact_support" | "navigate", label: string, href?: string }`.

### 2.3 `HealthResponse` / `ReadinessResponse`

- `HealthResponse`: `{ status: "ok", unit: UnitName, version: string, time: UtcDateTime }`.
- `ReadinessResponse`: `{ status: "ready" | "not_ready", checks: { name: string, status: "pass" | "fail" }[] }`.
  Ban đầu `checks` rỗng → `ready`; WBS 1.2/1.3 thêm kiểm tra CSDL/hàng chờ.
- Không trường nào chứa dữ liệu tenant (FR-003).

### 2.4 `EchoRequest` / `EchoResponse` (chẩn đoán, không có ở production)

- `EchoRequest`: `{ message: string (1–200 ký tự, đã cắt khoảng trắng), sentAt: UtcDateTime }`.
- `EchoResponse`: `{ message: string, receivedAt: UtcDateTime }`.
- Dùng để kiểm chứng US3 kịch bản 5: cùng một đầu vào sai, `EchoRequest.safeParse` ở web và
  `ZodValidationPipe` ở API cho cùng `fieldErrors`.

### 2.5 Hợp đồng theo module (`@app/shared/<module>`)

Mỗi module có thư mục `packages/shared/src/modules/<module>/index.ts` (ban đầu rỗng, chỉ có chú thích
mục đích). Thêm hợp đồng mới chỉ chạm thư mục của module đó (FR-015).

## 3. Cấu hình môi trường (`apps/server/src/core/config`)

| Biến | Kiểu | Mặc định | Bí mật | Dùng ở |
|---|---|---|---|---|
| `APP_ENV` | `development` \| `test` \| `staging` \| `production` | – (bắt buộc) | | api, worker |
| `APP_VERSION` | chuỗi | `0.0.0-dev` | | api, worker |
| `API_PORT` | số nguyên 1–65535 | `3000` | | api |
| `WORKER_HEALTH_PORT` | số nguyên 1–65535 | `3001` | | worker |
| `SHUTDOWN_TIMEOUT_MS` | số nguyên 1000–60000 | `30000` | | api, worker |
| `LOG_LEVEL` | `fatal`…`trace` | `info` | | api, worker |
| `CORS_ORIGINS` | danh sách URL, cách bằng dấu phẩy | `http://localhost:5173` | | api |

Biến của CSDL, kho tệp, KMS… do WBS 1.2/1.5 thêm, với `secret: true`. Lỗi cấu hình → thoát mã 1, in
tên biến và lý do, không in giá trị.

## 4. Trạng thái vòng đời tiến trình

```text
starting → ready → stopping → stopped
                 ↘ (quá SHUTDOWN_TIMEOUT_MS) → forced_exit
```

- `starting`: kiểm tra cấu hình, ghép module. Lỗi → thoát mã 1.
- `ready`: API nhận yêu cầu / Worker sẵn sàng lấy việc; ghi nhật ký `api.ready` hoặc `worker.ready`.
- `stopping`: nhận SIGTERM/SIGINT; API ngừng nhận kết nối mới, Worker ngừng lấy việc; `/readyz` trả
  `not_ready`.
- `stopped`: mọi tác vụ đã đăng ký xong → thoát mã 0. `forced_exit`: hết hạn chờ → nhật ký cảnh báo,
  thoát mã 1.
