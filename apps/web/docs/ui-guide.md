# Hướng dẫn giao diện (`apps/web`)

Dành cho người thêm màn hình hoặc thành phần mới. Nguồn quyết định: `specs/011-ui-architecture-foundation/` (spec, plan,
research, contracts). Quy tắc nhập khẩu và kiểu dáng được máy kiểm (ESLint + `pnpm check:web-rules`), không dựa vào trí nhớ.

## Bản đồ thư mục

| Thư mục                                                       | Vai trò                                                                                                                                        | Được nhập                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/ui/*`                                                    | Thành phần dùng chung (nút, ô nhập, thẻ, hộp thoại…). Không biết API, phiên hay tính năng.                                                     | `lib/i18n`, `lib/format`, `lib/catalogs`, `ui/*` |
| `src/lib/api`                                                 | **Nơi duy nhất gọi `fetch`**: client, lỗi `AppError`, khóa truy vấn, hook, ma trận vô hiệu hóa, `endpoints/*`.                                 | `@app/shared`                                    |
| `src/lib/forms`, `session`, `limits`, `jobs`, `notifications` | Nền tảng biểu mẫu, phiên, giới hạn gói, tiến độ việc nền, thông báo.                                                                           | `lib/*`, `ui/*`                                  |
| `src/app`                                                     | Khung ứng dụng, tuyến, cổng phiên, `AsyncBoundary`.                                                                                            | mọi thứ ở trên                                   |
| `src/features/<tên>`                                          | Màn hình của từng tính năng. **Không** nhập thư viện đã được bọc (`react-hook-form`, `@tanstack/react-query`, `@radix-ui/*`, `react-router`…). | `ui/*`, `lib/*`, `app/*`                         |
| `src/catalog`                                                 | Danh mục thành phần `/_catalog` (chỉ chạy khi DEV hoặc `VITE_ENABLE_CATALOG=1`).                                                               | mọi thứ                                          |

Web chỉ nhập `@app/shared` từ phần còn lại của repo (kiểm bởi `check:boundaries`). Giao diện **không bao giờ** gửi mã tài khoản:
mã lấy từ phiên ở máy chủ, `apiClient` ném lỗi nếu thân/đường dẫn chứa `accountId`/`tenantId`.

## 1. Thêm một thành phần

1. Nếu Figma có thiết kế: thêm một hàng ở `src/ui/figma-variants.ts` (đủ tổ hợp thuộc tính). Chưa có thiết kế thì đánh `designPending`.
2. Viết thành phần trong `src/ui/<nhóm>/` bằng **class Tailwind theo token** (`bg-brand`, `text-ink`, `p-4`, `min-h-touch`…).
   Không màu `#hex`, không `style={{ color… }}`, không `w-[300px]`. Giá trị động duy nhất cho phép: biến CSS tùy chỉnh
   (`style={{ '--progress': '40%' }}`).
3. Thêm `*.catalog.tsx` cạnh thành phần (xuất `CatalogEntry`: tên, mô tả, ghi chú trợ năng, các biến thể) – `/_catalog` tự nhặt.
4. Thêm `*.spec.tsx`: chạy từng biến thể trong catalog qua `axe` (không vi phạm) và kiểm hành vi.
5. Xuất ở `src/ui/index.ts`. Vùng chạm ≥ 44 px (`min-h-touch min-w-touch`); trạng thái luôn có **chữ + biểu tượng**, không chỉ màu.

Ví dụ: `ui/button/Button.tsx` + `ui/cards/cards.catalog.tsx` + `ui/cards/cards.spec.tsx`.

## 2. Thêm một mục điều hướng

Điều hướng có **một nguồn duy nhất**: `src/app/shell/nav-registry.ts` (`NAV_ITEMS`). Thanh bên (7 mục) và thanh dưới (5 ô) cùng sinh
từ mảng này. Một mục mới cần đúng ba thứ:

1. một phần tử `NAV_ITEMS` (đường dẫn, quyền cần có `permission`, vị trí, thứ tự);
2. một tuyến trong `src/app/routes.tsx` (nhóm tuyến tải lười, trong khung `AppShell`);
3. một hàng trong ma trận quyền của `nav-registry.spec.ts` (chủ thấy gì, cộng tác viên thấy gì).

Ẩn mục theo quyền chỉ là tiện lợi; API vẫn tự chặn và màn hình phải xử lý `403` (`<Forbidden />`).

## 3. Dựng một biểu mẫu

```tsx
const form = useAppForm<Values>({
  schema, // lược đồ Zod của @app/shared nếu có (cùng máy chủ); không thì lib/forms/rules
  defaultValues,
  version, // khi sửa bản ghi (khóa lạc quan)
  draftKey: 'tên-biểu-mẫu', // bản nháp trong RAM; trường nhạy cảm không bao giờ vào bản nháp
  onSubmit: async (values, { version }) => {
    await api.save(values, version);
  },
});
return (
  <Form form={form} submitLabel="Lưu">
    <TextField name="shopName" label="Tên cửa hàng" required />
  </Form>
);
```

Đã có sẵn, không tự viết lại: chống gửi trùng (bấm 10 lần = 1 lời gọi), chặn rời trang khi còn thay đổi, lỗi máy chủ theo ô (tiêu điểm
tới ô lỗi đầu), xung đột phiên bản (`ConflictNotice`: "Tải bản mới nhất" / "Giữ bản của tôi"), chế độ chỉ xem (`readOnly`).

- Nút khóa có điều kiện (vd chưa tích đồng ý): `submitLocked="lý do"`. Nút dùng `aria-disabled` + lý do, **không** `disabled` thuần.
- Lỗi chung cần hành động riêng (vd "Quên mật khẩu"): `errorActions={(error) => [...]}`.
- Biểu mẫu "tạo mới" muốn xóa ô sau khi gửi: `clearOnSuccess`.
- Tách biểu mẫu thành thành phần nhận `FormComponentProps` rồi đăng ký vào bộ kiểm thử hợp đồng `testForm()` (10 hành vi:
  lỗi theo ô, lỗi máy chủ, thử lại, chống gửi trùng, chặn rời trang, xung đột, chỉ xem, nhạy cảm, axe, bàn phím). Mẫu:
  `src/features/forms.contract.spec.tsx`, `src/catalog/sample/forms/forms.spec.tsx`.

## 4. Khai báo dữ liệu máy chủ

- **Điểm cuối**: đường dẫn API chỉ khai báo ở `src/lib/api/endpoints/<module>.ts` (hàm có kiểu, phản hồi kiểm bằng lược đồ `@app/shared`).
- **Đọc**: `useApiQuery(queryKeys.x.y(), fn, { freshness })`. Lớp làm mới:

  | Lớp        | `staleTime`        | Dùng cho                                  |
  | ---------- | ------------------ | ----------------------------------------- |
  | `catalog`  | 1 giờ              | danh mục tĩnh (kênh, ngành)               |
  | `entity`   | 30 giây            | bài, hồ sơ, danh sách                     |
  | `counter`  | 15 giây            | số đếm trên điều hướng                    |
  | `volatile` | 0, không giữ cache | trạng thái lượt đăng, hạn mức, quyền kênh |
  | `session`  | 0, không giữ cache | `/auth/me`                                |

  Ngân sách AI, hạn mức, trạng thái lượt đăng và quyền truy cập nền tảng **không bao giờ** được cache (hiến pháp).

- **Ghi**: `useApiMutation({ operation, fn, invalidates })`. Thao tác mới thêm **một hàng vào `MUTATIONS`** (`lib/api/mutations.ts`) khai
  báo các khóa phải làm mới; `mutations.spec.ts` chặn việc quên. Chỉ `reschedule`, `markRead`, `reorder` được cập nhật lạc quan; thao
  tác đắt hoặc không đảo ngược (xóa, ngắt kết nối, hủy lịch) dùng `ConfirmDialog` trước và chờ máy chủ xác nhận.
- **Bản ghi dùng chung**: gửi `version`; `409 VERSION_CONFLICT` thành `AppError.kind = 'version_conflict'`, màn hình hiện `StaleNotice`.
- **Hiển thị**: `<AsyncBoundary query={q} empty={…} lockedBy={…} partial={…}>` cho đủ 5 tình huống (tải, trống, lỗi, khóa, một phần).
  Lỗi luôn đi qua `ErrorNotice` (≥ 1 nút hành động; mã gốc và mã theo dõi chỉ ở "Chi tiết cho hỗ trợ").

## 5. Khóa theo quyền và giới hạn

- Quyền: `useCan('post.approve')` hoặc `<Can permission="…" fallback="hide|locked">`. Quyền lấy từ `/auth/me`; chỉ để ẩn/khóa giao diện.
- Giới hạn gói/AI: `useUsage()` (một nguồn duy nhất), `useLimit('ai'|'posts'|'storage')`, `<LimitGate kind="ai">`. `UsageSnapshot`
  **không có trường tiền**; giao diện chỉ hiện số đếm hoặc phần trăm. Hết AI (100%) thì mọi nút AI khóa cùng lúc kèm ngày mở lại;
  soạn tay, duyệt, đăng vẫn dùng được.

## 6. Thư viện bên thứ ba (phiên bản cố định, bọc một lớp)

| Gói                                                         | Phiên bản                     | Giấy phép              | Lớp bọc                                                                      |
| ----------------------------------------------------------- | ----------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `react`, `react-dom`                                        | 19.3.1                        | MIT                    | —                                                                            |
| `react-router`                                              | 8.5.1                         | MIT                    | `ui/nav/*`, `app/*`                                                          |
| `@tanstack/react-query`                                     | 5.107.1                       | MIT                    | `lib/api/hooks`, `lib/session/SessionProvider`                               |
| `react-hook-form` + `@hookform/resolvers`                   | 7.92.0 / 7.0.6                | MIT                    | `lib/forms`, `ui/form/*`                                                     |
| `@radix-ui/react-dialog` · `-switch` · `-tabs` · `-tooltip` | 1.3.1 · 1.4.1 · 1.2.1 · 1.4.1 | MIT                    | `ui/alert/Modal`, `ui/form/fields/SwitchField`, `ui/chip-tabs`, `ui/tooltip` |
| `sonner`                                                    | 2.0.8                         | MIT                    | `ui/toast/Toaster`                                                           |
| `react-error-boundary`                                      | 6.1.6                         | MIT                    | `app/errors/RegionBoundary`                                                  |
| `tailwindcss` + `@tailwindcss/vite`                         | 4.3.5                         | MIT                    | token ở `styles/tokens.css`                                                  |
| `class-variance-authority`, `clsx`, `tailwind-merge`        | 0.7.1 · 2.1.1 · 3.7.0         | Apache-2.0 · MIT · MIT | `ui/util/cn`                                                                 |
| `@fontsource/be-vietnam-pro`                                | 5.3.0                         | OFL-1.1                | phông tự lưu (không CDN nước ngoài – ADR-10)                                 |

Kiểm thử: `vitest` 5.1.0, `@testing-library/*`, `msw` 3.0.6, `vitest-axe`, `@playwright/test` 1.65.1 + `@axe-core/playwright` 4.14.0.
Không thêm Storybook, Zustand, date-fns, Uppy, dnd-kit (hoãn đến khi cần – plan.md, nguyên tắc IX). Thêm thư viện mới = cố định
phiên bản, bọc ở một lớp ở bảng này, và cập nhật bảng.

## 7. Đồng bộ giá trị thiết kế từ Figma (mục tiêu ≤ 30 phút)

1. Cập nhật `src/styles/figma-tokens.json` (màu, cỡ chữ, khoảng cách, bo góc, điểm ngắt) – hoặc trích lại bằng Figma MCP `get_variable_defs`.
2. `node tooling/sync-design-tokens.mjs` → chỉ ghi lại khối `@theme` của `tokens.css` (giữa hai dấu `BEGIN/END figma-tokens`, **không sửa tay**).
3. Chạy `pnpm --filter @app/web test` (kiểm thử tương phản `tokens.contrast.spec.ts` đỏ nếu một cặp chữ/nền dưới 4,5:1) và `pnpm check:web-rules`.

Kết quả mong đợi: không tệp thành phần nào đổi (`git diff` chỉ `figma-tokens.json` và khối `@theme`). Đã đo ở T080, xem `quickstart.md` mục 4.

## 8. Quyết định thiết kế cần nhớ

- **Không bóng đổ** (trang Nền tảng của Figma không có bóng): phân tầng bằng viền và màu nền (`border-line`, `bg-surface-*`). `--shadow-*` được đặt lại về rỗng.
- **Điểm ngắt `lg` = 1024 px**: từ đây thanh bên 7 mục thay cho thanh dưới 5 ô. Figma chỉ có khung điện thoại (~390 px) và máy tính (1280 px), không có điểm ngắt ở giữa nên 1024 px là lựa chọn của nhóm (research.md); đổi ở `figma-tokens.json` rồi đồng bộ.
- Giờ lưu UTC, **hiển thị UTC+7** qua `lib/format/datetime`; số tiền AI **không** hiện ở bất kỳ màn hình nào của khách hàng (chỉ phần trăm).
- Không `localStorage`/`sessionStorage`/IndexedDB cho dữ liệu tài khoản; bản nháp chỉ RAM. `lib/safe-storage` chỉ có danh sách trắng khóa giao diện (`app:ui.*`).
- Không gọi `console.*` với mã, mật khẩu hay bí mật.

## Lệnh hay dùng

```bash
pnpm --filter @app/web dev                 # /_catalog, /_catalog/sample
pnpm --filter @app/web test                # Vitest (jsdom, MSW)
pnpm test:web-e2e                          # Playwright 360/768/1280 px (cài Chromium: pnpm --filter @app/web exec playwright install chromium --only-shell)
pnpm check:web-rules                       # màu/cỡ chữ/khoảng cách viết cứng, số tiền ở khu vực khách hàng
pnpm check:web-bundle                      # gói khởi đầu không chứa /_catalog, /internal; ngân sách gzip
pnpm verify --only check:web-rules,test:web-e2e
```
