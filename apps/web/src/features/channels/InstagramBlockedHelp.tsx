// Hướng dẫn 3 bước ngắn cho ứng viên Instagram bị chặn vì chưa phải tài khoản chuyên nghiệp / chưa liên kết với Page (US2, FR-009).
// Văn bản tĩnh, tiếng Việt đời thường; nút "Kiểm tra lại" do thành phần cha gắn (bắt đầu lại luồng cấp quyền).

export function InstagramBlockedHelp() {
  return (
    <ol
      className="flex list-decimal flex-col gap-1 pl-5 text-body"
      aria-label="Cách chuyển sang tài khoản chuyên nghiệp"
    >
      <li>Trong ứng dụng Instagram, vào Cài đặt và chọn "Loại tài khoản và công cụ".</li>
      <li>Chuyển sang tài khoản chuyên nghiệp (doanh nghiệp hoặc người sáng tạo nội dung).</li>
      <li>
        Liên kết tài khoản Instagram với Facebook Page của bạn, rồi quay lại đây bấm "Kiểm tra lại".
      </li>
    </ol>
  );
}
