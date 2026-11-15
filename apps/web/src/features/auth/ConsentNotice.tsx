import { useId } from 'react';
import { styles } from './ui';

// Ô đồng ý điều khoản dùng chung (009, FR-032, nguyên tắc VII): KHÔNG BAO GIỜ đặt sẵn. Lời bên cạnh
// nêu rõ Google và Meta là bên nhận dữ liệu khi người dùng chọn đăng nhập bằng hai cách đó.

/** Lời giải thích bên nhận dữ liệu – hiện cạnh ô đồng ý ở mọi nơi tạo tài khoản/tham gia. */
export function ConsentNotice() {
  return (
    <p style={{ margin: '4px 0 0', fontSize: 14, color: '#4b5563' }}>
      Nếu bạn đăng nhập bằng Google hoặc Facebook, Google và Meta sẽ gửi cho chúng tôi tên, email và
      mã người dùng của bạn ở dịch vụ đó. Chúng tôi không lấy ảnh đại diện, danh bạ hay quyền đăng
      bài.{' '}
      <a href="/privacy" style={{ color: '#1d4ed8' }}>
        Chính sách quyền riêng tư
      </a>
    </p>
  );
}

export function TermsCheckbox({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | undefined;
}) {
  const id = useId();
  return (
    <div style={{ ...styles.field, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        style={{ width: 24, height: 24, margin: 10, flexShrink: 0 }}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-note ${id}-err` : `${id}-note`}
      />
      <div>
        <label htmlFor={id}>
          Tôi đồng ý với Điều khoản sử dụng và Chính sách bảo vệ dữ liệu cá nhân
        </label>
        <div id={`${id}-note`}>
          <ConsentNotice />
        </div>
        {error !== undefined && (
          <p id={`${id}-err`} style={styles.error}>
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
