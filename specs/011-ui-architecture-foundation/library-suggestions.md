# Gợi ý thư viện cho nền tảng giao diện (011)

> Tài liệu **tham khảo** cho `/speckit-plan`, không phải yêu cầu. Việc chốt thư viện, phiên bản chính xác và
> giấy phép nằm ở `plan.md`/`research.md` (FR-038: cố định phiên bản, mã nguồn mở dùng được thương mại, bọc sau
> lớp dùng chung khi chi phối hành vi quan trọng). Thêm thư viện **không** đổi ngăn xếp đã chốt (React + Vite +
> TypeScript); chỉ khi thay React/Vite/bộ định tuyến mới cần ADR. Phiên bản hiện có ở `apps/web/package.json`:
> React 19, react-router 8, Vite 8, Vitest 5, Testing Library, `vitest-axe`; kiểm tra dữ liệu dùng Zod ở `@app/shared`.

Nguyên tắc chọn (bám người dùng một mình, nhạy chi phí, đội nhỏ): **ít thư viện, mỗi thư viện giải một việc rõ,
ưu tiên loại "không đóng gói kiểu dáng"** để khớp Figma tới từng điểm ảnh, tránh bộ giao diện dựng sẵn (MUI, Ant
Design, Chakra) vì khó bẻ theo thiết kế riêng và nặng cho mục tiêu tải ≤ 3 giây trên 4G.

## 1. Gói đề xuất (nên dùng)

| Nhu cầu | Đề xuất | Vì sao | Yêu cầu liên quan |
|---|---|---|---|
| Giá trị thiết kế + kiểu dáng | **Tailwind CSS v4** (khai báo giá trị thiết kế bằng biến CSS `@theme`) | Một nguồn giá trị thiết kế, không chạy mã lúc chạy (runtime), rất nhẹ; dễ cấm giá trị viết cứng bằng lint | FR-001, SC-002, SC-012 |
| Biến thể thành phần | **class-variance-authority** (+ `clsx`, `tailwind-merge`) | Khai báo "Kiểu=Chính/Thường/Nhẹ/Nguy hiểm × Trạng thái" đúng như biến thể Figma, có kiểu TypeScript | FR-002 |
| Thành phần tương tác có sẵn truy cập (hộp thoại, menu, tab, tooltip, công tắc, chọn, popover) | **Radix UI Primitives** (không có kiểu dáng) *hoặc* **React Aria Components** | Bàn phím, tiêu điểm, vai trò ARIA đã chuẩn; kiểu dáng do ta quyết. React Aria mạnh hơn ở ô chọn ngày giờ, kéo thả, nhập liệu; Radix gọn hơn | FR-003 |
| Dữ liệu từ máy chủ (bộ nhớ đệm phía giao diện, làm mới, thay đổi lạc quan) | **TanStack Query** | Một nguồn cho mỗi loại dữ liệu, khóa truy vấn → làm mới đúng phạm vi, hiển thị dữ liệu cũ khi quay lại rồi làm mới ngầm, hoàn tác lạc quan | FR-022…026, SC-005 |
| Trạng thái giao diện tạm | **Địa chỉ trang (tham số tìm kiếm của react-router)** cho bộ lọc/tab chia sẻ được; **Zustand** (rất nhỏ) cho phần còn lại (lựa chọn nhiều bài, ngăn mở/đóng) | Không cần Redux; tách rõ với dữ liệu máy chủ | FR-022, FR-027 |
| Biểu mẫu | **React Hook Form** + `@hookform/resolvers` + **Zod** (đã có ở `@app/shared`) | Cùng lược đồ hai phía, ít render lại, hỗ trợ danh sách động và nhiều bước | FR-013…020 |
| Ngày giờ UTC+7 | **date-fns v4** + `@date-fns/tz` (hoặc `Intl.DateTimeFormat` với `Asia/Ho_Chi_Minh` nếu đủ) | Nhẹ, cây rũ bỏ mã thừa; tránh Moment | FR-006, FR-005 (lịch) |
| Thông báo nhỏ (toast) | **Sonner** | Nhẹ, truy cập tốt; dùng cho xác nhận ngắn, **không** thay cảnh báo nội dòng kèm hành động | FR-015 |
| Lỗi cô lập từng màn | `errorElement` của react-router + **react-error-boundary** cho vùng con | Lỗi một thẻ không sập cả khung | FR-011 |
| Tải tệp lớn tiếp tục được | **Uppy** (lõi + Dashboard tùy chọn; plugin `aws-s3` tải đa phần/ký sẵn) *hoặc* tự viết bằng XHR/`fetch` + chia khúc | Tiến độ từng tệp, thử lại, tiếp tục; tải thẳng kho tệp S3 bằng đường dẫn ký sẵn. Nếu chỉ cần ảnh + video ≤ 500 MB, có thể tự viết để đỡ phụ thuộc | FR-021 |
| Lịch tuần/tháng + kéo thả đổi giờ | Tự dựng ô lịch từ `DayCell`/`CalendarItem` + **dnd-kit** | Figma có thành phần riêng; thư viện lịch dựng sẵn khó khớp thiết kế; dnd-kit có hỗ trợ bàn phím | UI/UX mục 6 (Lịch) |
| Danh sách dài (lưới thư viện media) | **TanStack Virtual** | Lưới nhiều tệp vẫn mượt trên điện thoại | SC-006 |
| Biểu tượng | **Xuất SVG từ Figma** (bộ 26 biểu tượng đã có) + `vite-plugin-svgr` | Khớp 100% thiết kế, không kéo cả bộ biểu tượng ngoài; `lucide-react` chỉ làm dự phòng cho biểu tượng chưa có trong Figma | FR-002 |
| Phông chữ | **Fontsource** (tự lưu, tập con tiếng Việt) | Không gọi CDN nước ngoài (hiến pháp VII: dữ liệu/phụ thuộc trong nước), tải nhanh | FR-012 |
| Đồng bộ nhiều tab | **BroadcastChannel** (có sẵn trong trình duyệt) | Đăng xuất ở một tab → mọi tab về đăng nhập, không cần thư viện | FR-028 |

## 2. Công cụ kiểm thử, danh mục thành phần, chất lượng

| Nhu cầu | Đề xuất | Ghi chú |
|---|---|---|
| Danh mục thành phần (FR-033) | **Storybook** (+ `@storybook/addon-a11y`, addon chạy trên Vitest) | Chạy độc lập; mỗi biến thể Figma = một "story"; xem ở 360/768/1280 px. Phương án nhẹ hơn: một trang `/_catalog` trong chính ứng dụng, chỉ bật ở môi trường phát triển |
| Giả lập máy chủ | **MSW** (Mock Service Worker) | Dùng chung cho danh mục thành phần, kiểm thử và phát triển; sinh 5 tình huống (tải, trống, lỗi, khóa, một phần) |
| Kiểm thử đơn vị/thành phần | Giữ **Vitest + Testing Library + vitest-axe** (đã có) | Không đổi |
| Kiểm thử truy cập tự động | `vitest-axe` + **eslint-plugin-jsx-a11y**; E2E dùng **@axe-core/playwright** | FR-034, SC-003 |
| Kiểm thử E2E + so sánh ảnh | **Playwright** (ảnh chụp so sánh cục bộ trong CI) | Tránh dịch vụ trả phí (Chromatic) khi chưa cần; chạy trình duyệt Chromium/WebKit |
| Cấm giá trị thiết kế viết cứng (FR-034, SC-002) | Quy tắc lint tùy biến hoặc **stylelint** + kiểm tra mẫu `#xxxxxx`/`px` ngoài tệp giá trị thiết kế; `eslint-plugin-better-tailwindcss` cho lớp Tailwind | Một bước kiểm tra riêng trong CI |
| Quét số tiền AI ở giao diện khách hàng (SC-009) | Kiểm tra tự động (lint/ripgrep) chuỗi định dạng tiền ở khu vực khách hàng + kiểm thử E2E | Không cần thư viện |
| Đo kích thước/tải trang (FR-012, SC-006) | `rollup-plugin-visualizer`, Lighthouse CI (giới hạn ngân sách kích thước) | Đặt ngưỡng trong CI |

## 3. Đồng bộ giá trị thiết kế với Figma (FR-001, FR-037)

- Hướng nhanh nhất cho người làm một mình: dùng Figma MCP (`get_variable_defs`, `get_design_context`) để trích biến
  màu/cỡ chữ/khoảng cách thành một tệp giá trị thiết kế duy nhất; ghi quy trình vào "Hướng dẫn giao diện".
- Nếu Figma có biến (variables) đầy đủ: cân nhắc **Style Dictionary** hoặc **Tokens Studio** để xuất tự động ra biến CSS;
  nếu chưa, nhập tay một lần rồi kiểm tra bằng ảnh chụp so sánh.
- **Code Connect** (Figma) MAY dùng để ghi liên kết thành phần Figma ↔ thành phần mã, giúp sau này sinh mã đúng.

## 4. Không nên dùng (kèm lý do)

| Loại | Lý do |
|---|---|
| MUI, Ant Design, Chakra (bộ giao diện dựng sẵn) | Khó khớp thiết kế riêng của Figma, nặng, tăng rủi ro vượt ngân sách tải 3 giây |
| Redux / Redux Toolkit | Quá nặng cho nhu cầu; dữ liệu máy chủ đã có TanStack Query, trạng thái tạm rất nhỏ |
| Moment.js | Đã ngừng phát triển, nặng |
| Dịch vụ phông chữ/CDN ngoài nước (Google Fonts…) | Trái hướng dữ liệu/phụ thuộc trong nước (ADR-10), thêm chặng mạng |
| Công cụ trả phí theo lượt (Chromatic…) ở giai đoạn đầu | Nhạy chi phí; Playwright + ảnh chụp so sánh cục bộ là đủ |
| Phụ thuộc kênh đẩy (WebSocket/SSE) cho thông báo | Giai đoạn 1 dùng làm mới định kỳ; thêm kênh đẩy cần ADR (hiến pháp IX) |
| CSS-in-JS chạy lúc chạy (styled-components, Emotion) | Tốn tài nguyên trên điện thoại tầm trung, không cần khi đã có Tailwind/biến CSS |

## 5. Gói cuối cùng nên chốt tối thiểu cho P1

`tailwindcss` + `class-variance-authority` + `clsx` + `tailwind-merge` · `@radix-ui/*` (chỉ gói cần) ·
`@tanstack/react-query` · `react-hook-form` + `@hookform/resolvers` · `date-fns` + `@date-fns/tz` · `sonner` ·
`vite-plugin-svgr` · `@fontsource/*` · dev: `storybook` + `@storybook/addon-a11y`, `msw`, `playwright` +
`@axe-core/playwright`, `eslint-plugin-jsx-a11y`. Các gói còn lại (dnd-kit, TanStack Virtual, Uppy, Zustand) thêm
đúng lúc tính năng cần (lịch, thư viện media, tải tệp, lựa chọn nhiều bài).
