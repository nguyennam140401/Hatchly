# Trợ lý đăng bài – kho mã nguồn

Ứng dụng web giúp chủ kinh doanh nhỏ lập kế hoạch, tạo bằng AI, duyệt, lên lịch và đăng bài lên
Facebook Page, Instagram và Zalo OA. Kho này là **modular monolith** (ADR-01): một mã nguồn TypeScript,
hai đơn vị triển khai **API** và **Worker** từ cùng một ảnh container, cộng ứng dụng web React.

> Quy tắc bắt buộc: `.specify/memory/constitution.md`. Kiến trúc triển khai:
> `.specify/memory/architecture.md`. Đặc tả tính năng: `specs/<mã>-<tên>/`.

## 1. Yêu cầu môi trường

| Công cụ | Phiên bản                                         | Ghi chú                                                      |
| ------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Node.js | 24 LTS (xem `.nvmrc`)                             | `engine-strict` – sai phiên bản thì `pnpm install` từ chối   |
| pnpm    | đúng số trong `packageManager` của `package.json` | Cài qua Corepack (bên dưới)                                  |
| Docker  | bất kỳ bản mới                                    | Chỉ cần để build ảnh và chạy kiểm thử Linux trên máy Windows |

Chưa cần PostgreSQL ở giai đoạn khung (WBS 1.2 thêm).

Bật pnpm qua Corepack:

```powershell
corepack enable
# Windows không có quyền quản trị: cài shim vào thư mục người dùng đã có trong PATH
corepack enable pnpm --install-directory "$env:APPDATA\npm"
pnpm -v
```

## 2. Cài đặt và kiểm tra

```powershell
pnpm install
pnpm verify      # build shared → typecheck → lint → ranh giới → kiểm thử → quét gói web
```

`pnpm verify` chạy **hết** các bước rồi in bảng tổng kết; mã thoát 1 nếu một bước lỗi. Khung sạch
chạy khoảng 20–30 giây.

## 3. Chạy khi phát triển

```powershell
Copy-Item apps/server/.env.example apps/server/.env   # Linux/macOS: cp
pnpm db:up         # PostgreSQL cục bộ (docker compose, cổng 5432)
pnpm db:setup      # 4 vai trò CSDL + migration (gồm schema sandbox ở development)
pnpm dev:api       # API  – http://localhost:3000/healthz
pnpm dev:worker    # Worker – kiểm tra sống http://localhost:3001/healthz
pnpm dev:web       # Web  – http://localhost:5173 (proxy /api, /healthz, /readyz sang API)
```

Thiếu hoặc sai biến cấu hình → tiến trình thoát mã 1 và in **tên** biến kèm lý do (không in giá trị).
Danh sách biến: `apps/server/.env.example`.

### CSDL cục bộ

```powershell
pnpm db:up                 # docker compose up -d postgres
pnpm db:setup              # bootstrap vai trò owner/app/system/support + migrate (chạy lại an toàn)
pnpm db:check              # kiểm tra quy ước CSDL (RLS, chủ sở hữu, quyền…) → "ĐẠT: 0 vi phạm"
$env:TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres_dev_only@localhost:5432/postgres'
pnpm test:db               # kiểm thử tích hợp trên CSDL tạm app_test_<ngẫu nhiên>
```

Hướng dẫn lớp CSDL (thêm bảng, ngữ cảnh tenant, migration tương thích ngược):
[`apps/server/docs/database.md`](apps/server/docs/database.md).

Dựng tính năng nghiệp vụ mới (màn hình → API → module → CSDL → việc nền) bằng cách chép module mẫu "Hồ sơ kinh
doanh": [`docs/sample-module.md`](docs/sample-module.md).

### Chạy toàn bộ bằng container (docker compose)

```powershell
docker compose up --build -d        # postgres (5432) + migrate (một lần) + web (8080) + api (3000) + worker (3001)
docker compose logs -f api worker
docker compose down                 # thêm -v để xóa dữ liệu PostgreSQL
```

Mở http://localhost:8080 – nginx phục vụ web và chuyển `/api`, `/healthz`, `/readyz` sang API.
API và Worker dùng chung ảnh `Dockerfile` gốc; ảnh web (`apps/web/Dockerfile`) chỉ dùng cục bộ,
môi trường chính thức phục vụ web tĩnh qua CDN.

## 4. Bảng lệnh

Giao diện ổn định cho lập trình viên và CI (chi tiết: `specs/001-monorepo-module-skeleton/contracts/repo-commands.md`).

| Lệnh                                                | Việc làm                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm install`                                      | Cài mọi gói theo `pnpm-lock.yaml` (CI: `--frozen-lockfile`)                     |
| `pnpm dev:api` / `pnpm dev:worker` / `pnpm dev:web` | Chạy chế độ theo dõi thay đổi                                                   |
| `pnpm build`                                        | Build `shared` → `server` → `web`                                               |
| `pnpm start:api` / `pnpm start:worker`              | Chạy bản đã build (`node dist/api.js` / `node dist/worker.js`)                  |
| `pnpm typecheck`                                    | `tsc --noEmit` nghiêm ngặt cho mọi gói                                          |
| `pnpm lint`                                         | ESLint + `prettier --check`                                                     |
| `pnpm check:boundaries`                             | Kiểm tra ranh giới module theo tệp kê khai                                      |
| `pnpm test`                                         | Vitest cho mọi gói (gồm bộ mẫu vi phạm ranh giới)                               |
| `pnpm check:web-bundle`                             | Build web, khẳng định gói web không chứa mã từ `apps/server`                    |
| `pnpm db:up` / `pnpm db:setup` / `pnpm db:migrate`  | PostgreSQL cục bộ / vai trò + migration / chỉ migration                         |
| `pnpm db:generate`                                  | Sinh migration từ định nghĩa bảng (drizzle-kit)                                 |
| `pnpm db:check` / `pnpm db:lint-migrations`         | Kiểm tra quy ước CSDL / câu lệnh phá tương thích ngược                          |
| `pnpm test:db`                                      | Kiểm thử CSDL thật (cần `TEST_DATABASE_ADMIN_URL`, không có thì bỏ qua)         |
| `pnpm verify`                                       | Chạy tất cả các bước trên, in bảng tổng kết                                     |
| `pnpm --filter @app/server test:linux`              | Kiểm thử tắt có kiểm soát bằng tín hiệu trong container Linux (cho máy Windows) |
| `docker build -t app:local .`                       | Một ảnh cho cả API và Worker                                                    |

## 5. Cấu trúc kho

```text
apps/server/        @app/server – NestJS: src/api.ts, src/worker.ts, src/core/, src/modules/<11 module>/
apps/web/           @app/web    – React + Vite: trang khởi đầu, src/lib/api-client.ts
packages/shared/    @app/shared – lược đồ Zod dùng chung web ↔ API (chỉ phụ thuộc zod)
tooling/            @app/tooling – verify.mjs, check-web-bundle.mjs, boundaries/ (quy tắc + bộ mẫu)
```

- `apps/server/src/core/` – lõi dùng chung phía máy chủ: cấu hình, nhật ký (pino, che bí mật),
  mã theo dõi `x-trace-id`, `ErrorResponse`, kiểm tra đầu vào (`@ValidBody/@ValidQuery/@ValidParam`),
  `/healthz` `/readyz`, tắt có kiểm soát. **Không** được nhập `modules/**`.
- `apps/server/src/app/` – tầng ghép: nơi duy nhất (cùng `api.ts`, `worker.ts`) nhập mọi module.

## 6. Module và ranh giới

Nguồn sự thật: `apps/server/src/modules/modules.manifest.json` – tên, schema PostgreSQL sở hữu,
phía chạy (`api`/`worker`), **phụ thuộc được phép**. Mọi thay đổi tệp này phải qua review.
Sơ đồ dưới đây sinh bằng `node tooling/print-module-graph.mjs` (mũi tên = được phép phụ thuộc):

```mermaid
flowchart LR
  account["Tài khoản & Gói<br/><code>account</code>"]
  context["Ngữ cảnh kinh doanh<br/><code>context</code>"]
  media["Thư viện media<br/><code>media</code>"]
  trends["Xu hướng<br/><code>trends</code>"]
  content["Nội dung<br/><code>content</code>"]
  approval["Duyệt & lịch<br/><code>approval</code>"]
  publishing["Đăng bài<br/><code>publishing</code>"]
  platform_gateway{{"Cổng nền tảng<br/><code>platform_gateway</code>"}}
  ai_gateway{{"Cổng AI<br/><code>ai_gateway</code>"}}
  notifications["Thông báo<br/><code>notifications</code>"]
  queue[("Hàng chờ (hạ tầng)<br/><code>queue</code>")]
  account --> queue
  context --> ai_gateway
  context --> queue
  media --> account
  media --> ai_gateway
  media --> queue
  trends --> ai_gateway
  trends --> queue
  content --> account
  content --> context
  content --> media
  content --> trends
  content --> ai_gateway
  content --> queue
  approval --> account
  approval --> content
  approval --> publishing
  approval --> queue
  publishing --> content
  publishing --> media
  publishing --> platform_gateway
  publishing --> notifications
  publishing --> queue
  platform_gateway --> notifications
  platform_gateway --> queue
  ai_gateway --> account
  ai_gateway --> queue
  notifications --> account
  notifications --> queue
```

Quy tắc kiểm tra tự động (`pnpm check:boundaries`, sinh bởi `tooling/boundaries/build-rules.cjs`):

| Mã                          | Ý nghĩa                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `no-internal-cross-module`  | Module chỉ được nhập `index.ts` của module khác, không nhập `internal/`                 |
| `no-circular`               | Không có vòng phụ thuộc                                                                 |
| `core-no-modules`           | `core/` không phụ thuộc module nghiệp vụ                                                |
| `infra-no-business`         | Module hạ tầng (`queue`) không phụ thuộc module nghiệp vụ                               |
| `web-only-shared`           | Web chỉ dùng `@app/shared`                                                              |
| `shared-pure`               | `packages/shared` chỉ phụ thuộc `zod`, không dùng module lõi Node, không nhập `apps/**` |
| `allowed-deps-<module>`     | Chỉ phụ thuộc module có trong `allowedDeps`                                             |
| `ai-sdk-only-in-ai-gateway` | SDK nhà cung cấp AI chỉ được nhập trong `modules/ai_gateway`                            |
| `no-unresolvable`           | Không có đường dẫn nhập không phân giải được                                            |

Thêm: ESLint cấm `@Body/@Query/@Param` gốc của NestJS trong `apps/server/src` – mọi đầu vào HTTP
phải qua `@ValidBody(schema)`, `@ValidQuery(schema)`, `@ValidParam(schema)` với lược đồ dùng chung.

## 7. Hình thái triển khai

**Chung ảnh ≠ chung tiến trình.** API và Worker dùng chung mã nguồn và một ảnh container nhưng chạy
là **hai Deployment Kubernetes riêng**, co giãn độc lập:

|                        | API                                   | Worker                                                             |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Lệnh                   | `node dist/api.js` (mặc định của ảnh) | `node dist/worker.js` (ghi đè `command`)                           |
| Kiểm tra sống/sẵn sàng | `/healthz`, `/readyz` trên `API_PORT` | `/healthz` trên `WORKER_HEALTH_PORT` (không có đường dẫn nào khác) |
| Tắt                    | `terminationGracePeriodSeconds: 40`   | Chờ việc đang chạy ≤ `SHUTDOWN_TIMEOUT_MS` (30 giây) rồi thoát     |

Worker không giữ trạng thái trong tiến trình, không ghi tệp cục bộ – chạy nhiều bản song song được.

```powershell
docker build -t app:local .
docker run --rm -e APP_ENV=development -p 3000:3000 app:local
docker run --rm -e APP_ENV=development -p 3001:3001 app:local node dist/worker.js
```

## 8. Thêm module

1. Thêm một mục vào `apps/server/src/modules/modules.manifest.json` (`name` snake_case, `title`,
   `kind`, `schema` riêng, `runsIn`, `allowedDeps`). Nếu module khác cần dùng module mới, thêm tên nó
   vào `allowedDeps` của module đó. **Cần review.**
2. Tạo thư mục `apps/server/src/modules/<name>/` theo khuôn:
   `index.ts` (export `<Name>Module` + kiểu công khai), `<name>.module.ts` (`@Module({})`),
   `public-api.ts` (interface `<Name>PublicApi`), `internal/` (mọi thứ còn lại).
3. Thêm một dòng `<name>: <Name>Module` vào `MODULE_REGISTRY` trong
   `apps/server/src/app/module-registry.ts` (khởi động sẽ báo lỗi nếu registry lệch tệp kê khai).
4. Tạo `packages/shared/src/modules/<name>/index.ts` cho hợp đồng web ↔ API của module
   (nhập ở web/máy chủ bằng `@app/shared/<name>` – không cần sửa `exports`).
5. Chạy `pnpm verify`.

Không sửa module có sẵn khi thêm module mới.

## 9. Thêm hợp đồng dùng chung

- Viết lược đồ Zod trong `packages/shared/src/modules/<module>/index.ts` (hoặc `src/core/` nếu dùng
  chung mọi module); kiểu TypeScript suy ra bằng `z.infer` – không viết `interface` song song.
- Kiểu nền: `Id` (UUID v7), `UtcDateTime` (ISO 8601 có `Z`), `UsagePercent` (0–100). `MicroUsd` chỉ dùng
  trong `internal-support.ts` – **không bao giờ** trong hợp đồng cho khách hàng (kiểm thử chặn).
- Máy chủ: kiểm tra đầu vào bằng `@ValidBody(Schema)`; lỗi tự thành `ErrorResponse` 400 với
  `fieldErrors` tiếng Việt (`toFieldErrors`) – web dùng cùng hàm nên ra cùng thông điệp.
- Web: `Schema.safeParse(response)` trong `apps/web/src/lib/`.
- Đổi tên trường → `pnpm typecheck` báo lỗi ở cả `apps/server` và `apps/web`.

## 10. Ghi chú Windows

- Kiểm thử tắt bằng tín hiệu (SIGTERM/SIGINT) bị bỏ qua trên Windows vì `child.kill()` giết tiến
  trình ngay. Chạy `pnpm --filter @app/server test:linux` (cần Docker) để kiểm trong Linux.
- Ctrl+C trong console vẫn gửi SIGINT thật – kiểm tra tay `pnpm dev:worker` được.
- Kho đặt `eol=lf` (`.gitattributes`); trình soạn thảo theo `.editorconfig`.
