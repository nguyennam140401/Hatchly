# Hợp đồng giao diện – màn hình "Thư viện ảnh & video"

Theo UI/UX mục 6 và khung của `011-ui-architecture-foundation` (`ui/*`, `lib/api`, `lib/upload`, `lib/session`). Không thêm thư viện giao diện, trạng thái hay biểu mẫu.
Mã nguồn: `apps/web/src/features/media/`. Mọi chữ hiển thị là tiếng Việt đời thường; mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ".

## 1. Tuyến và quyền hiển thị

| Tuyến | Màn hình | Quyền (chỉ ẩn/hiện; API tự chặn) |
|---|---|---|
| `/media` | Thư viện: thanh dung lượng, khu tải lên, bộ lọc, lưới | `media.view` (chủ, cộng tác viên) |
| `/media?item=<mediaId>` | Hộp chi tiết (phủ lên lưới, mở được bằng đường dẫn) | `media.view` |
| (không tuyến) | Hộp xác nhận xóa | `media.delete` |

Mục "Thư viện" trong thanh điều hướng 011 dẫn tới `/media`. Hỗ trợ/quản trị không thấy (không có quyền). Trạng thái bộ lọc nằm trên URL (`lib/url-state`): `?kind=image&from=…&to=…&q=…`.

## 2. Bố cục (≥ 360 px, ưu tiên điện thoại)

```text
┌ Thư viện ảnh & video ───────────────────────┐
│ Đã dùng 1,2 / 5 GB  ▓▓░░░░░░  [Sắp đầy ⚠]    │  ← QuotaMeter (chữ + thanh; cảnh báo bằng chữ + biểu tượng)
│ ┌ Tải lên ────────────────────────────────┐ │
│ │ [ Chọn tệp ]  [ Chụp ảnh ]  hoặc kéo thả │ │  ← FileField (nút ≥ 44×44, thay thế cho kéo thả)
│ │ ảnh ≤ 20 MB · video ≤ 500 MB             │ │
│ │ ▸ IMG_01.jpg   ▓▓▓▓░ 72%   [Hủy]         │ │  ← UploadQueue (tiến độ từng tệp)
│ └─────────────────────────────────────────┘ │
│ [Tất cả ▾] [Ngày tải ▾] [🔍 Tên tệp…]         │
│ ┌──┐ ┌──┐ ┌──┐                              │
│ │▢ │ │▶ │ │… │   lưới (nạp dần, ảnh thu nhỏ) │
│ └──┘ └──┘ └──┘                              │
└─────────────────────────────────────────────┘
```

## 3. Trạng thái bắt buộc (chữ + biểu tượng; không chỉ màu — FR-025)

| Tình huống | Chữ hiển thị | Hành động |
|---|---|---|
| Đang chờ trong hàng (`queued`) | "Đang chờ tải" | Hủy |
| Đang tải | "Đang tải 72%" | Hủy |
| Mất mạng giữa chừng (`waiting_network`) | "Tạm dừng – đang chờ mạng" (tự tiếp tục khi có mạng) | Hủy |
| Đã tải, Worker đang xử lý (`processing`) | "Đang xử lý" (có thể đã thấy ô trong lưới, chưa chọn được để đính bài) | — |
| Xong | "Sẵn sàng" | — |
| Trùng nội dung (`duplicate`) | "Tệp này đã có trong thư viện" + liên kết "Xem tệp đã có" | Đóng |
| Lỗi tải (xác nhận bị bác, hết thời gian) | "Tệp bị lỗi khi tải" | **Thử lại** |
| Bị từ chối trước khi tải (sai loại / quá cỡ) | "Ảnh tối đa 20 MB – hãy giảm kích thước rồi tải lại" (lý do + cách khắc phục theo từng tệp) | Gỡ khỏi hàng |
| Hết chỗ | "Thư viện đã đầy (4,9/5 GB). Hãy xóa bớt ảnh/video cũ rồi tải lại" | Nút "Xem danh sách để xóa" |
| Gói hết hạn | "Gói của bạn đã hết hạn nên chưa tải thêm được. Bạn vẫn xem và xóa được ảnh/video" | "Gia hạn gói" |
| Không xử lý được (`unprocessable`) | "Không xử lý được" + "Hãy thử xuất lại ảnh từ máy rồi tải lên lại" | **Xóa** |
| Phiên cũ hết hạn khi chọn lại tệp | "Lần tải trước đã hết hạn, đang tải lại từ đầu" | — |
| Lưới rỗng | "Tải ảnh/video đầu tiên" + giới hạn "ảnh ≤ 20 MB, video ≤ 500 MB" | Nút chọn tệp |
| ≥ 80% dung lượng | "Sắp đầy" kèm biểu tượng cảnh báo | — |
| Đầy 5 GB | Khu tải lên bị chặn kèm giải thích; xem/xóa/soạn/duyệt/đăng vẫn dùng | — |

Số tiền AI **không** xuất hiện ở màn hình này (không gọi AI). Đơn vị dung lượng hiển thị "MB/GB" (cơ số 1024) theo định dạng số của `lib/format` (dấu phẩy thập phân).

## 4. Hộp xác nhận xóa (FR-021)

- Mở từ chi tiết/lưới; web gọi `GET /media/:id/usages` rồi (nếu cần) `DELETE …?confirm=true`.
- `blocking = true` (có bài đã duyệt/đã lên lịch): hộp **chỉ thông báo**, không có nút xóa — "Ảnh đang dùng trong 2 bài đã lên lịch", danh sách từng bài (tiêu đề + trạng thái + liên kết `/posts/:postId`),
  và hướng dẫn "Mở bài để đổi media rồi quay lại xóa".
- Chỉ có bài nháp/chờ duyệt/đã đăng: liệt kê **từng bài** (tiêu đề, trạng thái, liên kết) và nói rõ hậu quả ("Bài nháp sẽ mất ảnh và cần chọn ảnh khác trước khi gửi duyệt"); hai nút "Xóa" / "Giữ lại".
- Không dùng bài nào: xác nhận ngắn "Xóa ảnh này? Dung lượng sẽ được trả lại ngay."
- Nút Xóa chỉ hiện khi `canDelete`; cộng tác viên không thấy nút trên tệp của người khác (API vẫn trả `MEDIA_DELETE_NOT_OWNER`).

## 5. Hàng đợi tải (mở rộng `lib/upload`, R15)

- **Trạng thái mới** của `UploadItem.status`: `waiting_network`, `processing`, `duplicate`; thêm `mediaId?`, `duplicateOf?` và `UploadSession.fields?` (POST), `UploadSession.mode`.
- **Luồng một tệp**: kiểm cục bộ (`validateFile` + `heic/heif`) → tính `fingerprint` (WebCrypto) → `POST /media/uploads` → (a) `single`: `POST` multipart/form-data tới `post.url` kèm `post.fields`;
  (b) `multipart`: cắt phần 8 MiB, **bỏ qua phần có trong `completedParts`**, mỗi phần `PUT` tới URL từ `part-urls` (xin lô ≤ 20 phần; URL hết hạn/HTTP 403 ⇒ xin lại — người dùng không thấy lỗi)
  → `POST …/complete` → hỏi `GET /media/uploads/:id` tới khi `completed` + `mediaStatus ∈ {ready, unprocessable}` hoặc `duplicate`.
- **Song song**: giữ `MAX_CONCURRENT_UPLOADS = 3` (tệp); thử lại từng phần 1/3/10 giây; mất mạng (`offline` hoặc lỗi mạng liên tiếp) ⇒ `waiting_network` + tự tiếp tục khi sự kiện `online`.
- **Nhận lại phiên**: người dùng chọn lại cùng tệp ⇒ `POST /media/uploads` trả `resumed: true` + `completedParts` ⇒ tiến độ bắt đầu từ phần đã có.
- **Hủy** ⇒ `DELETE /media/uploads/:id` (trả giữ chỗ). **Đóng tab**: phiên giữ 24 giờ rồi bị dọn (không cần gọi lúc đóng).
- Không lưu tên tệp, `post.fields`, URL phần, `uploadId` vào `localStorage`/`sessionStorage` (chỉ trong bộ nhớ của hàng đợi — quy tắc có sẵn).
- Trang cập nhật lưới khi một tệp xong (vô hiệu hóa truy vấn danh sách của `lib/api`), không tải lại cả trang.

## 6. Khả năng truy cập và hiệu năng

- WCAG 2.1 AA; mọi vùng chạm ≥ 44 × 44 px; chạy từ 360 px; điều khiển bàn phím cho chọn tệp/lọc/mở chi tiết/xóa; kéo thả luôn có nút chọn tệp thay thế (FR-026).
- Lưới là danh sách có tên truy cập (`aria-label` = tên tệp + loại + trạng thái); trạng thái thay đổi thông báo bằng vùng `aria-live="polite"` (đã có ở `ui/feedback`).
- Ảnh thu nhỏ có `loading="lazy"`, kích thước cố định ô (tránh nhảy bố cục), chỉ nạp ô trong/ gần khung nhìn; trang đầu ≤ 40 ô (`limit` mặc định). Mục tiêu SC-007: lưới đầu ≤ 3 giây (4G), chuyển bộ lọc ≤ 1 giây với 200 tệp.
- Chi tiết: video dùng thẻ `<video controls preload="metadata">`, ảnh dùng bản chuẩn hóa; đường dẫn xem trước hết hạn ⇒ tự gọi lại `GET /media/:id` (không hiện lỗi).

## 7. Kiểm thử giao diện bắt buộc

Vitest + Testing Library + `vitest-axe`: (a) hàng đợi: trạng thái mới, nhận lại phiên bỏ qua phần đã có, mất mạng → tự tiếp tục (hàm chờ giả); (b) `QuotaMeter` các ngưỡng (ok/near_full/full) chữ + biểu tượng;
(c) hộp xóa: `blocking` không có nút xóa; liệt kê từng bài; (d) lưới: lọc/tìm cập nhật URL; (e) trạng thái trống/lỗi/hết chỗ/gói hết hạn; (f) axe không vi phạm; (g) Playwright 360 px: tải 3 ảnh, thấy "Sẵn sàng" trong lưới.
