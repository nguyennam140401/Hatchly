# Research – 001 Kho mã nguồn chung chia module

Phase 0 của `/speckit-plan`. Mỗi mục: **Quyết định / Lý do / Phương án đã cân nhắc**. Ngăn xếp lõi
(TypeScript, React + Vite, NestJS, Drizzle, pg-boss) đã chốt ở hiến pháp, không bàn lại; ở đây chỉ chọn
công cụ phụ trợ mà spec để ngỏ. Phiên bản ghi là **major tối thiểu**; phiên bản chính xác được khóa
trong `pnpm-lock.yaml` và `package.json` (ghi số chính xác, không dùng `^`) lúc cài đặt (FR-020).

## R1. Môi trường chạy Node.js

- **Quyết định**: Node.js **24 LTS**, khóa bằng `.nvmrc` + `engines.node` (`>=24 <25`) ở gốc kho; ảnh
  container dùng `node:24-bookworm-slim` (ghi digest).
- **Lý do**: là bản LTS đang được hỗ trợ dài nhất ở thời điểm 11/2026 (bảo trì tới 04/2028); hỗ trợ
  sẵn `require(esm)`, `--env-file`, kiểm thử tín hiệu dừng ổn định.
- **Đã cân nhắc**: Node 22 (hết bảo trì 04/2027, quá gần ra mắt M5); Node 26 (chưa đủ thời gian ổn
  định cho thư viện NestJS).

## R2. Quản lý workspace và chạy lệnh

- **Quyết định**: **pnpm 10 workspaces** (`pnpm-workspace.yaml`), khóa bằng trường `packageManager`
  (Corepack). Lệnh chạy chéo gói bằng `pnpm -r` / `pnpm --filter`; **không** thêm Nx/Turborepo.
  `.npmrc`: `save-exact=true`, `engine-strict=true`.
- **Lý do**: `node_modules` nghiêm ngặt của pnpm chặn "phụ thuộc ma" (gói dùng thư viện không khai
  báo) – củng cố FR-011(d)(e); `pnpm deploy` tạo thư mục chạy gọn cho ảnh container; 3 gói thì không cần
  bộ điều phối build (nguyên tắc IX – ít thành phần).
- **Đã cân nhắc**: npm workspaces (cho phép phụ thuộc ma, không có `deploy`); Yarn Berry PnP (vướng
  với NestJS/công cụ); Nx (mạnh về ranh giới nhưng là thêm một nền tảng lớn cần vận hành).

## R3. Bố cục kho

- **Quyết định**: theo đề xuất của `architecture.md` mục 4:
  `apps/web` (`@app/web`), `apps/server` (`@app/server`), `packages/shared` (`@app/shared`).
  Module máy chủ ở `apps/server/src/modules/<module>/`, lõi dùng chung ở `apps/server/src/core/`.
- **Lý do**: khớp tài liệu đã duyệt; tách `apps/*` (đơn vị chạy) và `packages/*` (thư viện) để quy tắc
  ranh giới viết được bằng đường dẫn.
- **Đã cân nhắc**: tách `apps/api` và `apps/worker` thành hai gói – trái ADR-01 (một mã nguồn, cùng
  module) và buộc chia đôi module.

## R4. Hai điểm khởi động API / Worker

- **Quyết định**: hai tệp vào `apps/server/src/api.ts` và `apps/server/src/worker.ts` dùng chung
  `src/modules/**`. API: `NestFactory.create(ApiAppModule)` trên **Express** (`@nestjs/platform-express`,
  NestJS 11). Worker: `NestFactory.createApplicationContext(WorkerAppModule)` – không có bộ định tuyến
  HTTP. Ảnh container: lệnh mặc định `node dist/api.js`; Kubernetes ghi đè `command` thành
  `node dist/worker.js` cho Worker.
- **Lý do**: `createApplicationContext` bảo đảm Worker không thể vô tình mở endpoint nghiệp vụ (FR-004);
  hai tệp vào rõ hơn một tệp có tham số; Express là mặc định của NestJS, đủ cho phản hồi dần (SSE).
- **Đã cân nhắc**: Fastify (nhanh hơn nhưng tải nhỏ – ADD 8.1 – không cần, thêm khác biệt với tài liệu
  NestJS); một `main.ts` nhận tham số `api|worker` (dễ chạy nhầm vai trò); **tách mã nguồn Worker thành
  ứng dụng riêng** – phải chia đôi module hoặc tạo gói module dùng chung, thực chất là microservice, trái
  hiến pháp IV ở GĐ1. Việc co giãn độc lập **không** cần tách mã: Worker vốn là Deployment riêng (xem
  plan mục "Hình thái triển khai").

## R5. Worker: kiểm tra sống và tắt có kiểm soát

- **Quyết định**:
  - Kiểm tra sống của Worker: một máy chủ `node:http` tối giản trong `core/health` chỉ phục vụ
    `GET /healthz` trên `WORKER_HEALTH_PORT` (mặc định 3001), **không** qua NestJS router (FR-004).
  - Tắt có kiểm soát: `app.enableShutdownHooks(['SIGTERM','SIGINT'])`; `ShutdownCoordinator` trong
    `core/lifecycle` – (1) chuyển trạng thái "đang dừng" để các bộ tiêu thụ (WBS 1.3) ngừng lấy việc,
    (2) chờ các tác vụ đang chạy đã đăng ký qua `trackInFlight()`, (3) hết `SHUTDOWN_TIMEOUT_MS`
    (mặc định 30000) thì ghi nhật ký cảnh báo và `process.exit(1)`. Kubernetes:
    `terminationGracePeriodSeconds: 40`.
  - Khi chưa có hàng chờ nào (WBS 1.3 chưa làm), Worker ghi `worker.ready` với `queues: []` và chạy
    giữ tiến trình (edge case của spec).
- **Lý do**: đáp ứng FR-005/SC-004 và nguyên tắc V; hook để WBS 1.3 gắn pg-boss `stop({ graceful })`.
- **Lưu ý Windows**: trên Windows, `child.kill('SIGINT' | 'SIGTERM')` của Node **giết tiến trình con
  ngay**, hook tắt không chạy – không kiểm thử tắt có kiểm soát bằng tín hiệu lập trình được. Ctrl+C gõ
  tay trong console vẫn gửi SIGINT thật nên vẫn kiểm tra tay được. Vì vậy kiểm thử tự động tắt có kiểm
  soát (SC-004) chỉ chạy trên Linux (`it.skipIf(process.platform === 'win32')`); trên máy Windows chạy
  kiểm thử đó trong container `node:24` (`pnpm test:linux`). Môi trường chạy thật (Kubernetes) là Linux.
- **Đã cân nhắc**: dùng `@nestjs/terminus` cho Worker (cần HTTP adapter của Nest – trái FR-004).

## R6. Cấu hình

- **Quyết định**: lược đồ biến môi trường viết bằng **Zod** trong `apps/server/src/core/config`
  (phía máy chủ, không nằm trong gói dùng chung), kiểm tra một lần khi khởi động; lỗi → in danh sách
  **tên** biến thiếu/sai và thoát mã 1, không in giá trị. Biến được đánh dấu bí mật trong lược đồ
  (`secret: true`) không bao giờ được ghi nhật ký. Phát triển: `node --env-file=.env` (có
  `.env.example`, `.env` bị `.gitignore`).
- **Lý do**: FR-006, nguyên tắc VII; dùng lại Zod (R8) nên không thêm thư viện cấu hình.
- **Đã cân nhắc**: `@nestjs/config` + Joi (thêm thư viện kiểm tra thứ hai); `dotenv` (Node 24 có sẵn).

## R7. Nhật ký có cấu trúc tối thiểu

- **Quyết định**: **pino** (qua `nestjs-pino`) ghi JSON ra stdout; trường cố định `unit` (`api`|`worker`),
  `version`, `trace_id` (tạm: mã yêu cầu sinh mỗi request; WBS 1.6 thay bằng OpenTelemetry trace id),
  `account_id` (rỗng cho tới khi có phiên – WBS 2.1). `redact` mặc định: `*.password`, `*.token`,
  `*.accessToken`, `*.refreshToken`, `*.secret`, `req.headers.authorization`, `req.headers.cookie`.
  Phát triển dùng `pino-pretty` (devDependency).
- **Lý do**: nguyên tắc VIII (nhật ký có cấu trúc), VII (không lộ bí mật); pino là logger JSON phổ biến,
  có cầu nối OpenTelemetry cho WBS 1.6.
- **Đã cân nhắc**: Logger mặc định của NestJS (không phải JSON); winston (chậm hơn, cấu hình dài).

## R8. Lược đồ kiểm tra dữ liệu dùng chung

- **Quyết định**: **Zod 4** trong `@app/shared` – là phụ thuộc chạy thật duy nhất của gói. Kiểu suy ra
  bằng `z.infer` / `z.input` (không khai báo `interface` song song). Thông điệp lỗi tiếng Việt
  tự viết trong `@app/shared/core` để web và API ra **cùng** thông điệp (không phụ thuộc gói ngôn ngữ
  của thư viện). **Không** đăng ký bản đồ thông điệp toàn cục (`z.config`) – vì gói đặt
  `sideEffects: false`, bundler có thể loại đoạn đăng ký và web sẽ ra thông điệp tiếng Anh. Thay vào đó
  hàm thuần `toFieldErrors(error)` dịch từng issue (theo `code`, `expected`, `minimum`/`maximum`,
  `format`) sang tiếng Việt lúc chuyển đổi, nên kết quả không phụ thuộc thứ tự nạp mô-đun.
  Phía API: `ZodValidationPipe` tự viết (~50 dòng) trong `core/validation`, gắn qua decorator
  `@ValidBody(schema)`/`@ValidQuery(schema)`/`@ValidParam(schema)` – lỗi → `ErrorResponse` (FR-013a).
  Để bảo đảm **mọi** đầu vào đi qua lược đồ, ESLint (`no-restricted-imports` / `no-restricted-syntax`)
  cấm dùng `@Body`, `@Query`, `@Param` của `@nestjs/common` trong `apps/server/src/**` (trừ chính
  `core/validation`); quy tắc này có kiểm thử riêng.
- **Lý do**: Zod chạy ở cả trình duyệt và Node, nhỏ, hỗ trợ `z.uuid({ version: 'v7' })`,
  `z.iso.datetime()`; tự viết pipe tránh thêm thư viện cầu nối (nguyên tắc IX – bọc sau giao diện nội
  bộ: nơi duy nhất gọi Zod ở máy chủ là `core/validation`).
- **Đã cân nhắc**: `class-validator` (chỉ hợp phía máy chủ, cần decorator – không dùng chung được);
  Valibot (nhỏ hơn nhưng hệ sinh thái/kinh nghiệm đội ít hơn); `nestjs-zod` (thêm phụ thuộc cho việc
  nhỏ); TypeBox/JSON Schema (thông điệp lỗi kém hơn cho form).

## R9. Đóng gói `@app/shared`

- **Quyết định**: build bằng **tsup** ra cả ESM + CJS + `.d.ts`; `exports` gồm `"."`, `"./core"` và
  wildcard `"./*"` → `dist/modules/*/index.*` (mỗi module một lối vào, FR-015 – thêm module không phải
  sửa `exports`). Trong phát triển: `tsup --watch`. `sideEffects: false` để Vite loại mã không dùng.
- **Lý do**: máy chủ NestJS chạy CommonJS, web chạy ESM – gói kép tránh vướng tương tác CJS/ESM trong
  kiểm tra kiểu; build `dist` giúp `pnpm deploy` đóng gói ảnh container đơn giản.
- **Đã cân nhắc**: cho dùng thẳng mã nguồn TS (Vite được, nhưng `nest build`/`tsc` không biên dịch mã
  ngoài `rootDir`); chỉ ESM (dựa vào `require(esm)` – chạy được trên Node 24 nhưng kiểm tra kiểu TS với
  `module: commonjs` vẫn báo lỗi).

## R10. Kiểm tra ranh giới module

- **Quyết định**: **dependency-cruiser** với cấu hình `.dependency-cruiser.cjs` ở gốc kho. Quy tắc
  **sinh tự động** từ tệp kê khai tập trung `apps/server/src/modules/modules.manifest.json` (xem
  `contracts/module-manifest.md`), gồm:
  - (a) `no-internal-cross-module`: `modules/X/**` → `modules/Y/**` (Y ≠ X) mà không phải
    `modules/Y/index.ts`.
  - (b) `no-circular` giữa module.
  - (c) `core-no-business` / `queue-no-business`: `core/**` và `modules/queue/**` không trỏ tới module
    nghiệp vụ.
  - (d) `web-no-server`: `apps/web/**` chỉ được trỏ tới `packages/shared` và thư viện npm của chính nó.
  - (e) `shared-pure`: `packages/shared/**` chỉ được phụ thuộc gói npm có trong danh sách
    `sharedAllowedPackages` (ban đầu: `zod`) và không trỏ tới `apps/**`.
  - (f) `allowed-deps-<X>`: mỗi module X chỉ được trỏ tới `index.ts` của module trong `allowedDeps`.
  - Thêm: `ai-sdk-only-in-ai-gateway` – gói SDK nhà cung cấp AI (danh sách mẫu tên gói trong tệp kê
    khai) chỉ được nhập trong `modules/ai_gateway/**` (nguyên tắc III).
  - Lệnh `pnpm check:boundaries`; đầu ra liệt kê tệp, quy tắc, module nguồn/đích; mã thoát ≠ 0 khi vi
    phạm. Bộ mẫu vi phạm (SC-002) ở `tooling/boundaries/fixtures/`, là kiểm thử của gói workspace
    `@app/tooling` (chạy trong `pnpm test`, hoặc riêng `pnpm --filter @app/tooling test`).
- **Lý do**: phát hiện được cả vòng phụ thuộc, nhập nội bộ và phụ thuộc gói npm; quy tắc theo nhóm
  đường dẫn; một tệp kê khai làm nguồn sự thật cho review (FR-011a).
- **Đã cân nhắc**: `eslint-plugin-boundaries` (không phát hiện vòng tốt, khó sinh quy tắc từ tệp kê
  khai); Nx `enforce-module-boundaries` (cần Nx – R2); ArchUnit-TS (ít người dùng).

## R11. Kiểm tra kiểu và lint

- **Quyết định**: TypeScript **5.9+** (khóa chính xác), `tsconfig.base.json` ở gốc: `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `useUnknownInCatchVariables`. Máy chủ bật thêm `experimentalDecorators` + `emitDecoratorMetadata`
  (NestJS). **ESLint 9** flat config + `typescript-eslint` `strictTypeChecked`; plugin
  `react-hooks` cho web; **Prettier** kiểm tra định dạng (`prettier --check`) nằm trong bước lint.
  Lệnh: `pnpm typecheck` (`tsc --noEmit` từng gói, project references), `pnpm lint`.
- **Lý do**: cổng chất lượng số 4 của hiến pháp; `noUncheckedIndexedAccess` bắt lỗi hay gặp với dữ liệu
  từ API.
- **Đã cân nhắc**: Biome (nhanh nhưng chưa có lint có thông tin kiểu như `typescript-eslint`).

## R12. Kiểm thử

- **Quyết định**: **Vitest** cho cả ba gói (một trình chạy). Máy chủ dùng `unplugin-swc` để có
  decorator metadata; kiểm thử HTTP bằng `@nestjs/testing` + `supertest`. Web: Vitest + jsdom +
  Testing Library. Kiểm thử mẫu tối thiểu (FR-019):
  - shared: lược đồ lỗi chuẩn, UUID v7, thời gian UTC, tiền micro-USD;
  - server: `/healthz`, `/readyz`, đầu vào sai → `ErrorResponse` (US3 kịch bản 5), Worker khởi động +
    tắt ≤ 30 giây (tiến trình con thật), tệp kê khai khớp thư mục module và registry;
  - web: trang khởi đầu hiển thị trạng thái bằng chữ + biểu tượng.
  - tooling: bộ mẫu vi phạm ranh giới (≥ 6 trường hợp a–f).
- **Lý do**: cùng hệ với Vite; nhanh (SC-006 ≤ 5 phút).
- **Đã cân nhắc**: Jest cho máy chủ (mặc định của Nest, nhưng hai trình chạy = hai cấu hình).

## R13. Lệnh kiểm tra toàn kho

- **Quyết định**: `pnpm verify` = `build:shared` → `typecheck` → `lint` → `check:boundaries` →
  `test` → `check:web-bundle` (build web rồi quét sourcemap không có tệp từ `apps/server` – SC-008),
  chạy tuần tự bằng một script Node nhỏ
  `tooling/verify.mjs` để in bảng tổng kết từng bước và **chạy hết các bước** rồi mới trả mã thất bại
  (US4: liệt kê đủ cả ba lỗi), thay vì dừng ở lỗi đầu tiên.
- **Lý do**: FR-018; script Node chạy giống nhau trên Windows và Linux.
- **Đã cân nhắc**: `npm-run-all` (dừng/không tổng kết theo ý); Makefile (không chạy sẵn trên Windows).

## R14. Ảnh container

- **Quyết định**: một `Dockerfile` nhiều tầng ở gốc: tầng build (`pnpm install --frozen-lockfile`,
  build shared + server), tầng chạy dùng kết quả `pnpm deploy --filter @app/server --prod`, người dùng
  không phải root, `NODE_ENV=production`. Ảnh **không** chứa mã web (web phục vụ tĩnh qua CDN – build
  riêng `apps/web/dist`). ffmpeg sẽ được thêm vào cùng ảnh ở đầu việc media (WBS 3.6), không phải ở đây.
  Điều kiện để `pnpm deploy` của pnpm 10 chạy đúng: `.npmrc` đặt `inject-workspace-packages=true` (nếu
  không, lệnh báo lỗi hoặc chỉ tạo liên kết tới gói workspace); `@app/shared` khai báo
  `"files": ["dist"]` để bản sao được tiêm vào có đủ mã đã build. Kiểm tra sau build: trong ảnh có
  `node_modules/@app/shared/dist/core/index.cjs`.
- **Lý do**: FR-002, SC-003; ADR-01 (cùng ảnh cho API và Worker).
- **Đã cân nhắc**: hai ảnh riêng cho API và Worker (API nhẹ hơn, không chứa ffmpeg) – loại vì trái
  ADR-01, dễ lệch phiên bản giữa hai bên khi migration chạy song song, phải build + quét bảo mật hai ảnh
  cho đội 3–4 người, và không cần cho co giãn (số bản Worker đã độc lập). **Xem lại khi**: ffmpeg
  (WBS 3.6) làm ảnh phình to khiến API khởi động chậm rõ rệt, hoặc cần tách Worker media riêng → lập
  ADR tách ảnh.

## R15. Web khung

- **Quyết định**: React 19 + Vite (major hiện hành, khóa chính xác), TypeScript. Chỉ có một trang khởi
  đầu gọi `GET /healthz` qua `src/lib/api-client.ts` (fetch + `safeParse` bằng lược đồ dùng chung),
  hiển thị "API đang hoạt động" / "Không kết nối được API" kèm biểu tượng ✓ / ⚠ và hành động "Thử
  lại" (nguyên tắc VI). Vite dev proxy `/api`, `/healthz`, `/readyz` → `http://localhost:3000`. Định
  tuyến, thư viện thành phần, quản lý dữ liệu máy chủ: WBS 1.7.
- **Lý do**: FR-016; giữ phạm vi WBS 1.1.

## R16. Định danh, thời gian, tiền trong hợp đồng

- **Quyết định**: `Id` = chuỗi UUID v7 (`z.uuid({ version: 'v7' })`, có brand theo thực thể khi cần);
  `UtcDateTime` = chuỗi ISO 8601 kết thúc bằng `Z` (`z.iso.datetime()` không cho phép offset khác);
  `MicroUsd` = số nguyên an toàn ≥ 0 (`z.int().nonnegative()`), **chỉ dùng trong hợp đồng nội bộ/hỗ
  trợ**; giao diện khách hàng dùng `UsagePercent` (số nguyên 0–100). Gói có kiểm thử khẳng định không
  hợp đồng nào dưới `modules/*` dành cho khách hàng chứa trường kiểu `MicroUsd` (nguyên tắc III) –
  hợp đồng nội bộ đặt dưới `modules/<m>/internal-support.ts` và được miễn.
- **Lý do**: FR-014, CLAUDE.md (tiền micro-USD, UTC, UUID v7). JSON number đủ an toàn tới 9×10¹⁵
  micro-USD.

## R17. Tên phạm vi gói và đường dẫn API

- **Quyết định**: phạm vi `@app/*` (gói riêng, không xuất bản). Đường dẫn: `/healthz`, `/readyz` ngoài
  tiền tố; API nghiệp vụ dưới `/api/v1`. Điểm chẩn đoán `POST /api/v1/diagnostics/echo` dùng lược đồ
  dùng chung để chứng minh FR-013a, **chỉ đăng ký khi `APP_ENV` ≠ `production`**.
- **Lý do**: có một endpoint thật để kiểm thử và quickstart chứng minh luồng kiểm tra đầu vào, không mở
  bề mặt thừa ở môi trường chính thức.

## Thuật ngữ mới (ghi vào `architecture.md` mục 11 theo FR-023)

| Tài liệu gốc | Mã nguồn |
|---|---|
| Duyệt & lịch (module) | `approval` (schema `approval` dành sẵn, để trống) |
| Cổng nền tảng (module) | `platform_gateway` (schema `platform_gateway`) |
| Hàng chờ (module hạ tầng) | `queue` (schema `infra`) |
| Lõi dùng chung phía máy chủ | `core` |
| Tệp kê khai module | `modules.manifest.json` |
| Đơn vị triển khai | `api` / `worker` |
