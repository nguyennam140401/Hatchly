---
type: concept
title: Kiến trúc giao diện web (apps/web)
sources:
  [
    apps/web/docs/ui-guide.md,
    specs/011-ui-architecture-foundation/plan.md,
    apps/web/src/app/shell/nav-registry.ts,
    apps/web/src/lib/api/query-client.ts,
    apps/web/src/lib/api/mutations.ts,
    eslint.config.mjs,
    tooling/check-web-rules.mjs,
  ]
updated: 2026-11-16
status: current
related:
  [
    features/011-ui-architecture-foundation.md,
    concepts/auth-rbac.md,
    concepts/ci-cd.md,
    concepts/module-boundaries.md,
  ]
---

# Kiến trúc giao diện web (apps/web)

React + Vite (SPA), TypeScript chặt. Nền chung do tính năng [011](../features/011-ui-architecture-foundation.md) dựng; hướng dẫn thao tác
chi tiết ở `apps/web/docs/ui-guide.md`. Trang này tóm tắt các quy tắc cần nhớ.

## Lớp thư mục và quy tắc nhập khẩu

| Thư mục                                             | Vai trò                                                                                       | Quy tắc                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/ui/*`                                          | Thành phần dùng chung (nút, ô nhập, thẻ, hộp thoại…)                                          | Không biết API/phiên/tính năng; chỉ `ui/nav` được dùng `react-router`                                  |
| `src/lib/api`                                       | **Nơi duy nhất `fetch`**: client, `AppError`, khóa truy vấn, hook, `MUTATIONS`, `endpoints/*` | Chỉ nhập `@app/shared`                                                                                 |
| `src/lib/{forms,session,limits,jobs,notifications}` | Nền tảng biểu mẫu, phiên, giới hạn, tiến độ việc nền                                          | Dùng `ui/*` và `lib/*`                                                                                 |
| `src/app`                                           | Khung ứng dụng, tuyến, `SessionGate`, `AsyncBoundary`                                         | —                                                                                                      |
| `src/features/<tên>`                                | Màn hình của tính năng                                                                        | Không nhập thư viện đã bọc (`react-hook-form`, `@tanstack/react-query`, `@radix-ui/*`, `react-router`) |
| `src/catalog`                                       | Danh mục `/_catalog`                                                                          | Chỉ khi DEV hoặc `VITE_ENABLE_CATALOG=1`; không nằm trong gói khởi đầu                                 |

Web chỉ nhập `@app/shared` từ phần còn lại của repo (`check:boundaries`). Các quy tắc nhập khẩu do ESLint ép (`eslint.config.mjs`).

## Kiểu dáng: chỉ token

Giá trị thiết kế (màu, cỡ chữ, khoảng cách, bo góc, điểm ngắt) nằm ở `figma-tokens.json`, sinh ra khối `@theme` của `tokens.css`.
`pnpm check:web-rules` cấm màu `#hex`, `style={{ … }}` mang màu/cỡ chữ/khoảng cách, giá trị tùy ý kiểu `w-[300px]`, và định dạng tiền ở khu vực
khách hàng (hiến pháp III). Giá trị động duy nhất cho phép: biến CSS tùy chỉnh. Không bóng đổ, chỉ giao diện sáng, `lg` = 1024 px.

## Dữ liệu máy chủ

- `useApiQuery(key, fn, { freshness })` với lớp làm mới: `catalog` 1 giờ · `entity` 30 giây · `counter` 15 giây · `volatile`/`session` không giữ cache.
  Ngân sách AI, hạn mức, trạng thái lượt đăng và quyền nền tảng luôn `volatile` (hiến pháp: không cache).
- `useApiMutation({ operation, fn, invalidates })`; mỗi thao tác ghi có **một hàng** trong `MUTATIONS` khai báo khóa phải làm mới
  (`mutations.spec.ts` chặn việc quên). Chỉ `reschedule`, `markRead`, `reorder` được cập nhật lạc quan; xóa/ngắt kết nối/hủy lịch phải xác nhận trước.
- Lỗi luôn là `AppError` (có `kind`, `fieldErrors`, `support.traceId`, ≥ 1 hành động). `ErrorNotice` là cách duy nhất hiện lỗi; mã gốc chỉ trong
  "Chi tiết cho hỗ trợ". `AsyncBoundary` cho 5 tình huống: tải, trống, lỗi, khóa, một phần.
- Bản ghi dùng chung gửi `version`; `409 VERSION_CONFLICT` thành `kind = 'version_conflict'`.

## Phiên, quyền, giới hạn

- Mã tài khoản không bao giờ do web gửi (`apiClient` ném lỗi nếu có `accountId`/`tenantId`); quyền ẩn/khóa giao diện lấy từ `/auth/me`,
  API vẫn tự chặn ([auth-rbac](auth-rbac.md)).
- Hết phiên giữa chừng: `AuthGate` mở hộp đăng nhập lại tại chỗ (không chuyển trang); đổi tài khoản hoặc đăng xuất xóa `QueryClient`, bản nháp,
  bộ lưu; `BroadcastChannel` báo các tab khác. Bản nháp biểu mẫu chỉ ở RAM, trường nhạy cảm không vào.
- Giới hạn: `useUsage()` là nguồn duy nhất; `UsageSnapshot` **không có trường tiền** (chỉ số đếm/phần trăm); `<LimitGate kind="ai">` khóa mọi nút AI cùng lúc
  kèm ngày mở lại, soạn tay/duyệt/đăng vẫn dùng được.

## Biểu mẫu

`useAppForm` + `<Form>` (bọc React Hook Form): chống gửi trùng, chặn rời trang, lỗi máy chủ theo ô, xung đột phiên bản, chế độ chỉ xem, bản nháp RAM.
Nút gửi bị khóa có điều kiện dùng `submitLocked` (`aria-disabled` + lý do). Mọi biểu mẫu thật đăng ký vào bộ kiểm thử hợp đồng `testForm()` (10 hành vi);
đã đăng ký: Login, Register, Mời thành viên và 3 biểu mẫu mẫu. **Ngoại lệ còn lại**: `ProfileForm` của 006 chưa chuyển (T074).

## Kiểm thử và cổng

- Vitest + Testing Library + MSW + `vitest-axe` (jsdom); Playwright + `@axe-core/playwright` ở 360/768/1280 px.
- Cổng trong `pnpm verify`: `check:web-rules`, `check:web-bundle` (ngưỡng 240 KB gzip, không lọt `/_catalog`, `/internal`), `test:web-e2e`
  (thiếu Chromium thì bỏ qua trên máy cá nhân, không đạt trên `--ci`). Xem [ci-cd](ci-cd.md).
- Cài Chromium một lần: `pnpm --filter @app/web exec playwright install chromium --only-shell`.
