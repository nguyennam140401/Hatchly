import { CheckboxField } from '../../ui/form/fields/CheckboxField';

// Ô đồng ý điều khoản dùng chung (009, FR-032, nguyên tắc VII): KHÔNG BAO GIỜ đặt sẵn. Lời bên cạnh
// nêu rõ Google và Meta là bên nhận dữ liệu khi người dùng chọn đăng nhập bằng hai cách đó.

/** Lời giải thích bên nhận dữ liệu – hiện cạnh ô đồng ý ở mọi nơi tạo tài khoản/tham gia. */
export function ConsentNotice() {
  return (
    <p>
      Nếu bạn đăng nhập bằng Google hoặc Facebook, Google và Meta sẽ gửi cho chúng tôi tên, email và
      mã người dùng của bạn ở dịch vụ đó. Chúng tôi không lấy ảnh đại diện, danh bạ hay quyền đăng
      bài.{' '}
      <a href="/privacy" className="text-brand underline">
        Chính sách quyền riêng tư
      </a>
    </p>
  );
}

/** Ô đồng ý điều khoản của biểu mẫu (trường `acceptTerms`); phải nằm trong `<Form>`. */
export function TermsField({ name = 'acceptTerms' }: { name?: string }) {
  return (
    <CheckboxField
      name={name}
      label="Tôi đồng ý với Điều khoản sử dụng và Chính sách bảo vệ dữ liệu cá nhân"
      description={<ConsentNotice />}
    />
  );
}
