# Trích xuất từ Figma "Nhịp – Thư viện thiết kế" (2026-11-15)

Nguồn: tệp `xYpQRkAT8FUkOZRv5bxZji`, 3 trang: **Nền tảng** (`0:1`), **Thành phần** (`2:2`), **Màn hình** (`7:2`). Trích bằng
Figma MCP `get_metadata` (tên, kích thước, nhãn hex trong khung trình bày). `get_variable_defs` không chạy được từ xa (đòi chọn
layer trong Figma desktop) nên **giá trị đọc từ nhãn văn bản của trang Nền tảng**, không phải biến Figma — nếu muốn tự động
hóa lần sau, cần tạo Variables trong Figma. Đây là đầu vào của `figma-tokens.json` (plan.md, R12). Chưa trích: bóng đổ (trang
Nền tảng không có → mặc định **không bóng**, tách bằng viền `line`), chi tiết bố cục bên trong từng thành phần (lấy bằng
`get_design_context` khi dựng từng thành phần), nội dung SVG biểu tượng (`download_assets` khi dựng `Icon`).

Quy tắc của Figma: **chỉ giao diện sáng** (không nền tối); "mọi cặp chữ/nền đạt tối thiểu 4,5:1".

## 1. Màu (24 giá trị; tên Figma → hex · bậc bảng màu · công dụng ghi trong Figma)

| Token | Hex | Bậc | Công dụng |
|---|---|---|---|
| surface-100 | #F7F6F2 | stone/100 | Nền trang |
| surface-0 | #FFFFFF | stone/50 | Nền thẻ, ô nhập |
| surface-200 | #EEECE6 | stone/200 | Nền phụ, tab chưa chọn |
| line | #DAD7CF | stone/300 | Đường chia trang trí |
| line-strong | #8C887E | stone/500 | Viền ô nhập, nút viền (3,5:1) |
| ink | #1C1B19 | stone/900 | Chữ chính |
| ink-muted | #5E5B54 | stone/700 | Chữ phụ |
| brand | #0E6F60 | teal/600 | Nút chính, mục đang chọn |
| brand-strong | #0A584C | teal/700 | Nút chính khi bấm |
| brand-soft | #DCEFEA | teal/100 | Nền mục đang chọn |
| on-brand | #FFFFFF | stone/50 | Chữ trên brand |
| spark | #E8912A | amber/500 | Màu ý tưởng – **chỉ mảng màu** (2,47:1 trên trắng, không dùng làm chữ) |
| spark-soft | #FCEBD3 | amber/100 | Nền thẻ ý tưởng nổi bật |
| spark-ink | #8A4B05 | amber/800 | Chữ trên spark-soft |
| success | #1E7A3A | green/700 | Chữ "Đã đăng" |
| success-soft | #E1F2E5 | green/100 | Nền "Đã đăng" |
| warning | #7A4F00 | yellow/800 | Chữ cảnh báo |
| warning-soft | #FFF1CC | yellow/100 | Nền "Chờ duyệt", cảnh báo |
| danger | #B42318 | red/700 | Chữ lỗi |
| danger-soft | #FDE4E1 | red/100 | Nền lỗi |
| info | #1D5FA8 | blue/700 | Chữ "Đang đăng" |
| info-soft | #E2ECF8 | blue/100 | Nền "Đang đăng" |

Tương phản đã tính (WCAG): ink/surface-100 15,92 · ink-muted/surface-100 6,26 · ink-muted/surface-200 5,73 · on-brand/brand 6,07 ·
brand/brand-soft 5,08 · spark-ink/spark-soft 5,81 · success/success-soft **4,62** · warning/warning-soft 6,35 ·
danger/danger-soft 5,44 · info/info-soft 5,40 · line-strong/surface-0 3,54 và /surface-100 3,27 (đủ 3:1 cho viền/thành phần giao
diện). Cặp sát ngưỡng nhất: success/success-soft 4,62.

## 2. Chữ (phông **Be Vietnam Pro**)

| Tên | Cỡ/dòng | Độ đậm | Ví dụ |
|---|---|---|---|
| display | 32/40 | 700 | Hôm nay đăng gì? |
| title | 24/32 | 700 | Tạo bài nhanh |
| heading | 18/26 | 600 | 3 ý tưởng cho khách mua nội thất |
| body | 16/24 | 400 | |
| body-sm | 14/20 | 400 | |
| label | 14/20 | 600 | Duyệt bài |
| caption | 12/16 | 500 | Dữ liệu tuần 45 |

## 3. Khoảng cách và bo góc

Khoảng cách: space-1=4 · space-2=8 · space-3=12 · space-4=16 · space-6=24 · space-8=32 (không có space-5/7). Bo góc: radius-sm=6 ·
radius-md=10 · radius-lg=16 · radius-pill=999. Khung màn: điện thoại 390 px (lề 16 px, nội dung 358 px), máy tính 1280 px
(thanh bên 248 px, nội dung 32 px lề, cột 968 px); thanh trên cao 56 px, thanh dưới cao 64 px, nút/ô nhập cao 44 px.

## 4. Thành phần (trang Thành phần) – tên Figma và thuộc tính biến thể

| Thành phần Figma | Thuộc tính → giá trị |
|---|---|
| Button | Kiểu = Chính · Thường · Nhẹ · Nguy hiểm × Trạng thái = Mặc định · Khóa (8) |
| StatusBadge | Trạng thái = Nháp · Chờ duyệt · Đã lên lịch · Đang đăng · Đã đăng · Cần bạn xử lý · **Gợi ý hôm nay** (7; **không có "Đã hủy"**) |
| ChannelTag | Kênh = Facebook · TikTok · Instagram · Zalo OA × Đăng tay = Không · Có (8) |
| UsageMeter | Mức = Bình thường · Cảnh báo · Hết (3) |
| IdeaCard | Nổi bật = Có · Không (2) |
| PostCard | (1 biến thể, 358×144) |
| NavBar (thanh dưới, 390×64) | Mục đang chọn = Tổng quan · Lịch · Bài viết · Thêm · Tạo bài (5) |
| Sidebar (248×860) | Mục đang chọn = Tổng quan · Lịch · Bài viết · Thư viện ảnh & video · Hồ sơ kinh doanh · Kênh & gói · Cài đặt (7) |
| TopBar (390×56) | Kiểu = Logo · Quay lại (2) |
| InlineAlert | Loại = Thông tin · Cảnh báo · Lỗi (3) |
| Chip | Đang chọn = Có · Không |
| ChannelTabs | Đang chọn = Facebook · TikTok (chỉ 2 biến thể đã vẽ; cần mở rộng theo số kênh) |
| StepRow | Trạng thái = Xong · Lỗi · Chờ |
| ChannelRow | Trạng thái = Đã kết nối · Sắp hết hạn · Chưa kết nối · Đăng tay |
| DayCell | Đang chọn = Có · Không (48×72) |
| CalendarItem | Trạng thái = Chờ duyệt · Đã lên lịch · Cần xử lý · Đã đăng |
| Field | (1 biến thể, 358×102 – nhãn + ô nhập; chưa có biến thể lỗi/khóa/chỉ xem) |
| Logo | 32×32 |

**Thiếu so với yêu cầu của spec** (cần người thiết kế bổ sung hoặc dựng theo token, đánh dấu ở kiểm thử là "chưa có thiết kế"):
(1) StatusBadge "Đã hủy"; (2) Field: trạng thái lỗi, tiêu điểm, khóa, chỉ xem, ô nhiều dòng, chọn, công tắc, thẻ nhập danh sách,
tải tệp; (3) ChannelTabs đủ 4 kênh; (4) khung chờ (Skeleton), EmptyState, hộp thoại (xác nhận, đăng nhập lại), biểu ngữ ngoại
tuyến, trang lỗi/không tìm thấy; (5) bóng đổ.

## 5. Biểu tượng – đúng 26 tên

Trang Thành phần: `check clock calendar send alert bulb info home list more plus image refresh copy` (14) và nhóm "Biểu tượng thêm":
`back bell download film link store gear library chevron-right pencil chevron-down x` (12) → **26**, khớp spec. Kích thước 24×24.
Không có biểu tượng riêng cho từng trạng thái bài/kênh (huy hiệu dùng bộ này: check, clock, calendar, send, alert, bulb, pencil…).

## 6. Màn hình đã thiết kế (trang Màn hình, mỗi màn có bản điện thoại 390 px + máy tính 1280 px)

1 Tổng quan · 2 Tạo bài nhanh · 3 Soạn bài – Facebook · 4 Soạn bài – TikTok (đăng tay) · 5 Bài viết – Chờ duyệt · 6 Lịch đăng ·
7 Tiến trình đăng – xử lý lỗi · 8 Kênh & gói. (Dùng làm "màn hình mẫu" tham chiếu cho danh mục thành phần; **không** dựng
trong 011.) Chưa có thiết kế cho: Thư viện ảnh & video, Hồ sơ kinh doanh, Cài đặt, đăng nhập/đăng ký/bảo mật/thành viên.

## 7. Điểm lệch Figma ↔ UI/UX cần Product Owner xác nhận (T083, 2026-11-16)

Đã chốt trong spec (mục Clarifications) và đã cập nhật `TaiLieuDacTa/Mo_ta_UI_UX_App_AI_Content_MXH.md` mục 4. Figma là nguồn cho **giá trị
thiết kế và cấu trúc điều hướng**; UI/UX là nguồn cho **hành vi, quyền và nội dung chữ**.

| # | Nội dung | Figma | UI/UX v1.3 (trước khi sửa) | Đã làm ở 011 | Cần ai làm |
|---|---|---|---|---|---|
| 1 | Điều hướng | Thanh bên 7 mục; thanh dưới 5 ô (có "Tạo bài" nổi bật) | Thanh dưới 4 mục (Tổng quan, Lịch, Bài viết, Thư viện) + "Thêm" | Theo Figma; UI/UX mục 4 đã sửa | PO xác nhận |
| 2 | Mục "Kênh & gói" | Mục cấp một | Nằm trong Cài đặt | Theo Figma (sơ đồ UI/UX đã sửa) | PO xác nhận |
| 3 | Kênh TikTok, nhãn "Đăng tay" | Có (thẻ kênh, "Soạn bài – TikTok (đăng tay)") | Chưa nêu | Thẻ kênh 4 kênh × có/không "Đăng tay" | Người thiết kế: biến thể đủ 4 kênh cho `ChannelTabs` |
| 4 | "Gợi ý hôm nay" | Nhãn trên thẻ chủ đề | Không có | Nhãn riêng, không phải trạng thái bài | — |
| 5 | Trạng thái "Đã hủy" | **Chưa có** biến thể | Có ở mục 7 | Dựng theo token, đánh dấu `designPending` | Người thiết kế bổ sung vào Figma |
| 6 | Field: lỗi, tiêu điểm, khóa, chỉ xem, nhiều dòng, chọn, công tắc, thẻ nhập danh sách, tải tệp | **Chưa có** (1 biến thể) | Cần theo mục 10 | Dựng theo token | Người thiết kế bổ sung |
| 7 | Khung chờ, trạng thái trống, hộp thoại (xác nhận, đăng nhập lại), biểu ngữ ngoại tuyến, trang lỗi/không tìm thấy | **Chưa có** | Có yêu cầu hành vi | Dựng theo token | Người thiết kế bổ sung |
| 8 | Bóng đổ; điểm ngắt giữa 390 và 1280 px; chuyển động | Không có | — | Không bóng (tách bằng viền); điểm ngắt `lg` = 1024 px; chuyển động tự đặt, tôn trọng `prefers-reduced-motion` | PO/người thiết kế xác nhận |
| 9 | Bảng màu | Teal `#0E6F60` + nền stone, **chỉ giao diện sáng** | Giao diện cũ của 004/006/009 dùng xanh dương tạm | Theo Figma; các trang cũ đổi diện mạo, **không đổi hành vi hay chữ** | PO xem trước khi phát hành |
| 10 | Figma Variables | Chưa định nghĩa (`get_variable_defs` không chạy từ xa) | — | `figma-tokens.json` nhập từ nhãn hex | Người thiết kế tạo Variables để đồng bộ tự động |
| 11 | Màn hình chưa có thiết kế | Thiếu: Thư viện ảnh & video, Hồ sơ kinh doanh, Cài đặt, đăng nhập/đăng ký/bảo mật/thành viên | — | Đăng nhập, đăng ký, bảo mật, thành viên, hồ sơ đã chuyển sang thành phần dùng chung (theo token, chưa có bản vẽ) | Người thiết kế vẽ bản chính thức |

