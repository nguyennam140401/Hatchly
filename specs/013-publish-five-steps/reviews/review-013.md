# Rà soát 013 – Tiến trình đăng 5 bước (luồng "Đăng lại")

Kiểm tra tĩnh: check:boundaries, check:secrets, typecheck, lint, prettier đều đạt.

## Kết luận nguyên tắc
- II: `transition()` là nơi duy nhất đổi status, cập nhật có điều kiện. Lượt `unknown` không có đường tới `scheduled` (ALLOWED_TRANSITIONS), nên không bao giờ gửi lại ngay. `succeeded` không đăng lại được (notRepublishable). Dấu "đã gửi" ghi trước khi gọi nền tảng, Worker chết sau dấu thì đối soát. Đạt.
- Race hai lần bấm: lần hai lệch `version` hoặc đã rời `needs_*`, nhận 409 và không tạo việc. Đăng lại với Worker: Worker thoát khi gặp `needs_*`; việc cũ còn sống thì `enqueue = exists`, ném lỗi và hoàn tác (đã có test). Đạt.
- I: tenantTx + RLS, mã tài khoản lấy từ phiên. Đạt. V: handler đọc trạng thái trước khi rẽ nhánh. Đạt.
- VI: `@CustomerAccess('post.republish')` ở API; mọi lỗi kèm hành động. VII: hỗ trợ chỉ trả mã gốc đã lọc; audit chỉ chứa mã tham chiếu. Đạt.
- UI: nút dùng `min-h-touch`, trạng thái bằng chữ và biểu tượng, cảnh báo trùng trong hộp xác nhận cho `needs_check`, không có số tiền AI. Đạt.

## Phát hiện
1. THẤP – attempt-actions.service.ts:98, publish-errors.ts:34: "bài đang được xử lý" dùng lại mã PUBLISH_VERSION_CONFLICT, nên log và chỉ số lẫn với lệch phiên bản thật. Đề xuất: mã riêng PUBLISH_JOB_BUSY khi có dịp (chủ sở hữu: dev backend publishing).
2. THẤP – progress.query.ts:~125-135: `getConnection` gọi tuần tự từng kênh (vòng lặp await) và nạp mọi bước của mọi lượt rồi lọc `run_no` trong bộ nhớ. Quy mô nhỏ nên chấp nhận được; đề xuất lọc `run_no` ngay trong truy vấn (dev backend).
3. THẤP – outcomes.ts toRetryWait: `transient_attempts` ghi `giá trị đọc cũ + 1` thay vì `transient_attempts + 1` ở SQL. Có điều kiện trạng thái nên an toàn, chỉ lưu ý.
4. THẤP – PublishProgress.tsx: hộp xác nhận đóng ngay khi lỗi và lỗi chỉ hiện ở ErrorNotice dưới dòng thời gian. Ổn; có thể chuyển focus tới thông báo để người đọc màn hình biết (dev frontend).

Không có phát hiện nghiêm trọng, cao hay trung bình.
