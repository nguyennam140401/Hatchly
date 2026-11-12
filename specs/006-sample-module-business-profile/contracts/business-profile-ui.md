# Hợp đồng màn hình – "Hồ sơ kinh doanh"

Mã nằm ở `apps/web/src/features/context/`. Nguồn: UI/UX mục 7 (màn hình Hồ sơ kinh doanh), mục 9
(`TaiLieuDacTa/Mo_ta_UI_UX_App_AI_Content_MXH.md#uiux-9-ho-so-kinh-doanh`), hiến pháp VI.

## Tuyến

| Đường dẫn | Màn hình | Quyền |
|---|---|---|
| `/business-profile` | Hồ sơ hiện hành + biểu mẫu + lịch sử (thu gọn trên điện thoại) | `context.view` (sửa khi có `context.edit`) |
| `/business-profile/versions/:versionId` | Bản cũ – chỉ xem | `context.view` |

Thiếu `context.view` → trang "Bạn không có quyền xem hồ sơ kinh doanh" + nút về Tổng quan.

## Trạng thái (FR-017) – mỗi trạng thái có chữ + biểu tượng, không chỉ màu

| Trạng thái | Hiển thị | Hành động |
|---|---|---|
| Đang tải | khung chờ, `aria-busy="true"` | – |
| Chưa có hồ sơ | biểu mẫu trống + thẻ gợi ý "AI sẽ viết tốt hơn nếu bạn bổ sung…" | Lưu |
| Có hồ sơ | biểu mẫu điền sẵn, "Phiên bản N · lưu lúc HH:mm dd/MM/yyyy (giờ Việt Nam) · bởi <tên>" | Lưu |
| Thiếu trường tùy chọn | thẻ gợi ý liệt kê trường còn trống (không chặn) | – |
| Chỉ xem (CTV) | trường `readOnly`, dòng "Bạn đang xem. Chỉ chủ tài khoản mới sửa được hồ sơ." | Xem lịch sử |
| Đang lưu | nút "Đang lưu…" vô hiệu, chống bấm hai lần | – |
| Lưu thành công | thông báo `role="status"` "Đã lưu phiên bản N" | – |
| Không có thay đổi | `role="status"` "Không có thay đổi để lưu" | – |
| Lỗi hợp lệ | lỗi cạnh từng ô (`aria-describedby`, `aria-invalid`), tóm tắt đầu biểu mẫu, đưa tiêu điểm vào ô lỗi đầu | Sửa ô |
| Xung đột | `role="alert"` "Hồ sơ vừa được cập nhật ở nơi khác…", **giữ nguyên** nội dung đang gõ | "Tải bản mới nhất" (hỏi trước nếu đang có thay đổi chưa lưu) |
| Phiên hết hạn | theo `SessionGate` – nội dung đang gõ giữ trên trang tới khi chuyển trang | "Đăng nhập lại" |
| Mất mạng / lỗi máy chủ | `role="alert"` thông điệp từ `ApiError` + "Chi tiết cho hỗ trợ" thu gọn (mã theo dõi) | "Thử lại" |
| Rời trang khi còn thay đổi | hộp xác nhận "Bỏ các thay đổi chưa lưu?" (`useBlocker` + `beforeunload`) | Ở lại / Bỏ thay đổi |

## Thành phần biểu mẫu

- Ngành: `<select>` theo `INDUSTRIES`; chọn "Khác" → hiện ô "Tên ngành" bắt buộc.
- Giới thiệu, sản phẩm/dịch vụ, chính sách: `<textarea>` có bộ đếm "x/2.000" (`aria-live="polite"` khi gần chạm giới
  hạn).
- Giọng văn: `<textarea>` ngắn, ví dụ gợi ý trong `placeholder` không thay nhãn.
- Từ khóa: ô nhập + Enter để thêm, danh sách thẻ có nút xóa (nhãn "Xóa từ khóa X"), tối đa 20.
- Kiểm tra hợp lệ dùng đúng lược đồ `@app/shared/context` như máy chủ.
- Văn bản người dùng hiển thị như chữ (React mặc định thoát ký tự; không `dangerouslySetInnerHTML`).

## Lịch sử phiên bản

Danh sách: "Phiên bản N · thời điểm · người lưu" (mới nhất trước), nút "Xem thêm" theo trang 20 dòng; người đã rời →
"Thành viên đã rời". Bản cũ: tiêu đề "Bản cũ – chỉ xem" + nhãn phiên bản; không có nút khôi phục.

## Khả năng truy cập và bố cục (FR-018)

WCAG 2.1 AA; vùng chạm ≥ 44 × 44 px; dùng được ở 360 px (một cột); mọi thao tác bằng bàn phím, thứ tự tiêu điểm theo
thứ tự đọc; nhãn `<label>` cho mọi ô.

## Kiểm thử

- Thành phần (`apps/web/test/context/*.spec.tsx`, vitest + Testing Library + `vitest-axe`): mỗi dòng bảng trạng thái;
  CTV không thấy nút Lưu; lỗi từ máy chủ gắn đúng ô; xung đột giữ nội dung; chặn rời trang; 0 vi phạm axe.
- Trình duyệt (`e2e/tests/business-profile.e2e.ts`, Playwright): chủ đăng nhập → điền → lưu v1 → sửa → v2 → lịch sử 2
  dòng → mở v1; CTV chỉ xem; hai tab → xung đột; khung nhìn 360 px; quét axe trên trang thật.
