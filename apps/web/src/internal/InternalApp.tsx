import { ComingSoon } from '../app/shell/ComingSoon';

// Khu vực nhân viên (hỗ trợ/quản trị): gói tải lười riêng, KHÔNG nằm trong gói khởi đầu của khách hàng (FR-011).
// Nội dung thật thuộc tính năng sau; đây chỉ là khung giữ chỗ.
export function InternalApp() {
  return (
    <div className="mx-auto max-w-phone p-gutter">
      <ComingSoon title="Khu vực nội bộ" />
    </div>
  );
}
