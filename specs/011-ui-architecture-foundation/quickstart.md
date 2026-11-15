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

## 5. Kết quả mong đợi khi hoàn tất

Danh mục đủ biến thể (SC-001) · 0 vi phạm quy tắc viết cứng (SC-002) · 0 vi phạm axe nghiêm trọng (SC-003) · kiểm thử cũ vẫn qua và
không còn khối kiểu dáng riêng trong `features/*` (SC-011: `grep -r "style={{" apps/web/src/features` chỉ còn các trường hợp có chú
thích lý do) · bản dựng sản xuất không chứa `/_catalog` hay `/internal` trong gói khởi đầu (SC-006).
