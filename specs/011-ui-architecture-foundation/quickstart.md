# Quickstart – kiểm chứng nền tảng giao diện (011)

Hướng dẫn chạy và kiểm tra, không chứa mã triển khai. Chạy từ gốc worktree `impl/011-ui-architecture-foundation`
(Node 24, pnpm 10). Đừng chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080).

## 0. Chuẩn bị

```bash
pnpm install
pnpm build:shared
```

Sau khi tác vụ thêm thư viện hoàn tất, `pnpm install` cài các gói đã cố định phiên bản (`research.md` bảng tổng kết).

## 1. Danh mục thành phần (Story 1, 6 – SC-001, SC-002)

```bash
pnpm --filter @app/web dev          # http://localhost:5173/_catalog
```

Kỳ vọng: mọi nhóm thành phần hiển thị đủ biến thể; chọn khung 360/768/1280 px không cuộn ngang; công tắc "cỡ chữ 200%" không
cắt nút. `/_catalog/sample` (danh sách + thẻ + biểu mẫu) chỉ dùng thành phần dùng chung. So đối chiếu với Figma: bảng
`ui/figma-variants.ts` (+ figma-extract.md) đối với từng nhóm (SC-001).

## 2. Kiểm tra tự động (FR-034)

```bash
pnpm --filter @app/web test         # thành phần + biểu mẫu + lớp dữ liệu + chuyển trang (Vitest, jsdom, MSW)
pnpm typecheck && pnpm lint         # strictTypeChecked + jsx-a11y + quy tắc nhập khẩu của web
node tooling/check-web-rules.mjs    # 0 màu/cỡ chữ/khoảng cách viết cứng (SC-002) · 0 số tiền AI ở khu vực khách hàng (SC-009)
node tooling/check-web-bundle.mjs   # ngân sách gói khởi đầu, không lọt /_catalog & /internal (FR-012, SC-006)
node tooling/check-boundaries.mjs   # web chỉ nhập @app/shared
pnpm --filter @app/web test:e2e     # Playwright: axe trên danh mục ở 360/768/1280 px (SC-003), điều hướng theo vai trò, hai tab
```

Kỳ vọng: toàn bộ qua; **kiểm thử cũ của 004, 006, 009 vẫn qua không sửa kỳ vọng** (SC-011). Kiểm thử tương phản màu
(`tokens.contrast.spec.ts`) đỏ nếu một cặp (chữ, nền) dưới 4,5:1.

## 3. Kịch bản thủ công theo từng câu chuyện (với `pnpm dev:web` + API cục bộ hoặc MSW)

| # | Kịch bản | Kỳ vọng | Truy vết |
|---|---|---|---|
| 1 | Đăng nhập chủ ở 1280 px → thu còn 360 px | thanh bên 7 mục → thanh dưới 5 mục, "Tạo bài" nổi bật; không cuộn ngang | Story 2.1–2.2, SC-003 |
| 2 | Đăng nhập cộng tác viên | không thấy Duyệt/Thành viên/Xóa tài khoản; vào thẳng `/settings/members` → "Bạn không có quyền" + lối về | Story 2.3 |
| 3 | Mở ứng dụng, **xóa phiên phía máy chủ** (hoặc để hết hạn), bấm thao tác lưu | màn hình giữ nguyên, hiện hộp "Phiên đã hết hạn"; đăng nhập lại cùng tài khoản → thao tác an toàn tự gửi lại hoặc báo bấm lại; bản nháp còn | Story 2.4, SC-013 |
| 4 | Như 3 nhưng đăng nhập tài khoản khác | xóa bản nháp/dữ liệu cũ, về Tổng quan | FR-011a |
| 5 | Sửa hồ sơ ở hai trình duyệt, lưu cái thứ hai | thấy "Tải bản mới nhất / Giữ bản của tôi"; không ghi đè | Story 3.5, FR-018 |
| 6 | Bấm nút Lưu 10 lần liên tiếp | đúng 1 lời gọi (kiểm Network) | Story 3.3, SC-007 |
| 7 | Sửa dở rồi đóng tab / chuyển trang | được hỏi xác nhận | Story 3.4 |
| 8 | Tắt mạng sau khi tải một màn | vẫn thấy dữ liệu + biểu ngữ "có thể chưa mới"; thao tác ghi báo "Chưa gửi được", dữ liệu nhập còn | Edge, Story 4 |
| 9 | Duyệt một bài (danh mục dùng MSW) | danh sách, chi tiết, số đếm điều hướng, Tổng quan cùng đổi ≤ 1 giây | Story 4.1, SC-005 |
| 10 | Đặt mức AI = 100% (fixture) | mọi nút AI khóa cùng lúc có lý do + ngày mở lại; "soạn tay" vẫn dùng được; không có số tiền ở đâu | Story 4.4, SC-009 |
| 11 | Đăng xuất ở tab A | tab B tự về đăng nhập; DevTools → Application: không có dữ liệu tài khoản | FR-028, SC-008 |
| 12 | Đặt `prefers-reduced-motion` | hiệu ứng dừng, chữ trạng thái còn | Edge |
| 13 | Bộ đọc màn hình + chỉ bàn phím trên 3 biểu mẫu mẫu | lỗi được đọc, thứ tự tiêu điểm hợp lý, hộp thoại giữ tiêu điểm | FR-003 |

## 4. Quy trình đồng bộ giá trị thiết kế (FR-037, SC-012)

Khi Figma đổi một giá trị: cập nhật `src/styles/figma-tokens.json` (hoặc chạy lại trích bằng Figma MCP `get_variable_defs`) →
`node tooling/sync-design-tokens.mjs` → chạy bước 2; mọi màn hình đổi theo mà **không sửa tệp thành phần nào** (mục tiêu ≤ 30
phút). Hướng dẫn đầy đủ: `apps/web/docs/ui-guide.md`.

**Kết quả đo (T080, SC-012, 2026-11-16):** đổi `colors.brand` từ `#0E6F60` sang `#7A2FA0` trong `figma-tokens.json` → chạy
`node tooling/sync-design-tokens.mjs` → `git diff --stat` chỉ gồm **2 tệp**: `figma-tokens.json` (1 dòng) và `tokens.css` (1 dòng
`--color-brand` trong khối `@theme`); **0 tệp thành phần** đổi. Chạy đồng bộ lần hai báo "đã khớp", không đổi gì. Kiểm thử
tương phản (27 ca) vẫn qua với màu thử. Đã hoàn lại về `#0E6F60` sau khi đo. Thời gian thao tác thực tế vài phút (mục tiêu ≤ 30).

## 5. Kết quả mong đợi khi hoàn tất

Danh mục đủ biến thể (SC-001) · 0 vi phạm quy tắc viết cứng (SC-002) · 0 vi phạm axe nghiêm trọng (SC-003) · kiểm thử cũ vẫn qua và
không còn khối kiểu dáng riêng trong `features/*` (SC-011: `grep -r "style={{" apps/web/src/features` chỉ còn các trường hợp có chú
thích lý do) · bản dựng sản xuất không chứa `/_catalog` hay `/internal` trong gói khởi đầu (SC-006).

## 6. Kết quả chạy (T084, 2026-11-16)

Chạy trong worktree `impl/011-ui-architecture-foundation` (Windows, Node 24, pnpm 10).

### Kiểm tra tự động (mục 2)

| Lệnh | Kết quả |
|---|---|
| `pnpm --filter @app/web test` | **410/410** ca, 64 tệp |
| `tsc --noEmit` ở `apps/web`, `e2e`, `packages/*`, `apps/server` | sạch. Toàn repo còn **1 lỗi có sẵn ở `dev`**: `tooling/test/check-wiki.spec.ts` (`sources` không có trong kiểu `{}`) – không thuộc 011 |
| `eslint` (gồm `jsx-a11y`, quy tắc nhập khẩu theo thư mục) | 0 lỗi |
| `prettier --check` | 0 tệp của 011 sai định dạng; còn `docs/wiki/concepts/feature-status.md` (có sẵn, do bước wiki quản lý) |
| `pnpm check:web-rules` | 163 tệp, **0 vi phạm** |
| `pnpm check:web-bundle` | gói khởi đầu **203,8 KB gzip** (≤ 240 KB), không chứa `/_catalog` hay `/internal` |
| `pnpm check:boundaries`, `pnpm check:secrets` | đạt |
| `pnpm test:web-e2e` (Playwright, Chromium, 360/768/1280 px) | **51/51** (axe 0 lỗi nghiêm trọng, không cuộn ngang, vùng chạm ≥ 44 px, cỡ chữ 200%, tương phản cao, khung theo vai trò, hết phiên, hai tab) |
| `pnpm --filter tooling test` | 298 ca qua; **1 tệp lỗi có sẵn ở `dev`**: `test/infra/power.spec.ts` (thiếu `tooling/infra/commands/kubeconfig.mjs`, của 007) |

Kiểm thử cũ của 004/006/009 qua trọn vẹn. **Có chỉnh một số khẳng định ở kiểm thử cũ** (kỳ vọng hành vi không đổi, chỉ đổi cách biểu diễn
theo chuẩn mới của 011): (a) nút bị khóa dùng `aria-disabled="true"` kèm lý do thay vì `disabled` thuần (7 chỗ: Mời, Tạo tài khoản
kinh doanh, nút Google ở trang mời, Tạo tài khoản ở OAuth, nút "Đang lưu…"); (b) kiểm tra của react-hook-form chạy bất đồng bộ nên một
khẳng định về lỗi ô đồng ý ở trang Đăng ký chờ bằng `waitFor`; (c) vùng chạm của nút "Thử lại" ở `StartPage` kiểm bằng lớp token
`min-h-touch min-w-touch` thay vì style nội tuyến.

### 13 kịch bản thủ công (mục 3) – bằng chứng thực tế

Không có người thao tác trên trình duyệt thật cho các kịch bản này; dưới đây là bằng chứng **tự động** tương ứng và phần **chưa kiểm chứng**.

| # | Bằng chứng | Chưa kiểm chứng |
|---|---|---|
| 1 | e2e `shell-roles`: chủ thấy 7 mục ở 1280 px, 5 mục ở 360/768 px; không cuộn ngang | — |
| 2 | e2e `shell-roles`: cộng tác viên vào `/settings/members` → bị chặn, có lối về | — |
| 3 | e2e `session-expiry`: hết phiên → hộp đăng nhập lại, cùng tài khoản đóng hộp, màn hình còn nguyên | bản nháp sau đăng nhập lại ở trình duyệt thật |
| 4 | e2e `session-expiry`: đăng nhập tài khoản khác → về Tổng quan, không còn dữ liệu cũ | — |
| 5 | `test/context/Conflict.spec` + hợp đồng biểu mẫu (6): 409 → hai lựa chọn, không ghi đè | thao tác hai trình duyệt thật |
| 6 | hợp đồng biểu mẫu (4): bấm nhanh 10 lần = 1 lời gọi (Login, Register, Mời, 3 biểu mẫu mẫu) | đếm trong tab Network |
| 7 | hợp đồng biểu mẫu (5): chặn rời trang khi còn thay đổi | đóng tab (`beforeunload`) |
| 8 | `stale-data.spec`: mất mạng vẫn xem dữ liệu đã tải, báo "Chưa gửi được", dữ liệu nhập còn | tắt mạng thật |
| 9 | `mutations.spec`/`optimistic.spec`: thao tác khai báo đủ khóa làm mới (danh sách, chi tiết, số đếm, Tổng quan) | **chưa đo ≤ 1 giây** trên màn hình thật (chưa có màn Bài viết) |
| 10 | `limits.spec`: AI = 100% → mọi nút AI khóa cùng lúc, có ngày mở lại, không trường tiền | — |
| 11 | e2e `two-tabs`: đăng xuất tab A → tab B về `/login`; bộ lưu trình duyệt không có dữ liệu tài khoản | — |
| 12 | chỉ dùng lớp `motion-safe:`; chữ trạng thái luôn có | **chưa thử bằng `prefers-reduced-motion` thật** |
| 13 | axe (Vitest + Playwright) và hợp đồng biểu mẫu (10): bàn phím tới được mọi điều khiển, lỗi gắn `aria-describedby` | **chưa thử với bộ đọc màn hình thật** (NVDA/VoiceOver) |

### Lỗi phát hiện và đã sửa khi chạy

- `two-tabs.spec.ts` (T060) truyền `Promise` lồng trong kết quả `page.evaluate` nên luôn nhận `{}`: chưa từng chạy vì máy chưa cài Chromium.
- Công tắc "cỡ chữ 200%" của danh mục dùng `zoom` nên đo sai vùng cuộn → đổi sang tăng cỡ chữ gốc của `<html>`.
- Hai phiên bản Playwright (`e2e` 1.64.1, `apps/web` 1.65.1 qua peer của `@axe-core/playwright`) làm lệch kiểu → chốt một bản bằng `overrides` ở `pnpm-workspace.yaml`.
- Đăng nhập xóa mật khẩu cả khi lỗi hệ thống nên "Thử lại" không gửi lại được cùng dữ liệu → chỉ xóa khi thông tin bị từ chối.
- Chặn rời trang cản chính việc chuyển trang sau khi gửi thành công → bộ chặn bỏ qua trong lúc đang gửi.

