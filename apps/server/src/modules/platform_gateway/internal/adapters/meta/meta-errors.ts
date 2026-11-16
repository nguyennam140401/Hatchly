import type { ErrorTable } from '../classify';

// Bảng phân loại lỗi mặc định của bộ chuyển đổi Meta (013 contracts/platform-adapters.md mục 3). Bảng này là mặc định
// trong mã; `publishing.error_mappings` (dữ liệu) có thể ghi đè thông điệp/cách sửa mà không cần phát hành.
// QUY TẮC AN TOÀN (Hiến pháp II): `transient` CHỈ cho mã CHẮC CHẮN nền tảng chưa tạo bài – lỗi mạng TRƯỚC khi gửi, giới
// hạn tốc độ, quá tải có mã rõ ràng. HTTP 5xx chung chung, hết thời gian SAU khi gửi, mã lạ → KHÔNG có trong bảng →
// `unknown` (đối soát, không gửi lại). Chỉ thêm mã `transient` sau khi đã kiểm thử hợp đồng.

const RECONNECT = [{ action: 'reconnect', labelVi: 'Kết nối lại kênh' }] as const;
const WAIT = [{ action: 'retry_later', labelVi: 'Chờ hệ thống tự thử lại' }] as const;
const MEDIA = [{ action: 'edit_media', labelVi: 'Chọn ảnh hoặc video khác' }] as const;

function common(p: 'FB' | 'IG'): ErrorTable {
  const name = p === 'FB' ? 'Facebook' : 'Instagram';
  return {
    [`${p}:190`]: {
      category: 'user_action',
      messageVi: `Quyền đăng bài lên ${name} đã hết hạn hoặc bị thu hồi. Hãy kết nối lại.`,
      remedies: [...RECONNECT],
    },
    [`${p}:102`]: {
      category: 'user_action',
      messageVi: `Phiên kết nối với ${name} đã hết hạn. Hãy kết nối lại.`,
      remedies: [...RECONNECT],
    },
    [`${p}:200`]: {
      category: 'user_action',
      messageVi: 'Ứng dụng chưa có đủ quyền đăng bài. Hãy kết nối lại và cấp đủ quyền.',
      remedies: [...RECONNECT],
    },
    [`${p}:10`]: {
      category: 'user_action',
      messageVi: 'Ứng dụng chưa có đủ quyền đăng bài. Hãy kết nối lại và cấp đủ quyền.',
      remedies: [...RECONNECT],
    },
    [`${p}:4`]: {
      category: 'transient',
      messageVi: `${name} đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.`,
      remedies: [...WAIT],
      retryAfterSec: 600,
    },
    [`${p}:17`]: {
      category: 'transient',
      messageVi: `${name} đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.`,
      remedies: [...WAIT],
      retryAfterSec: 600,
    },
    [`${p}:32`]: {
      category: 'transient',
      messageVi: `${name} đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.`,
      remedies: [...WAIT],
      retryAfterSec: 600,
    },
    [`${p}:2`]: {
      category: 'transient',
      messageVi: `${name} tạm quá tải và chưa nhận bài. Hệ thống sẽ tự thử lại sau ít phút.`,
      remedies: [...WAIT],
      retryAfterSec: 60,
    },
    'HTTP:429': {
      category: 'transient',
      messageVi: `${name} đang giới hạn tốc độ đăng. Hệ thống sẽ tự thử lại sau ít phút.`,
      remedies: [...WAIT],
      retryAfterSec: 60,
    },
    [`${p}:NET_BEFORE_SEND`]: {
      category: 'transient',
      messageVi: `Chưa kết nối được tới ${name} nên bài chưa được gửi. Hệ thống sẽ tự thử lại.`,
      remedies: [...WAIT],
      retryAfterSec: 60,
    },
  };
}

export const FACEBOOK_ERROR_TABLE: ErrorTable = {
  ...common('FB'),
  'FB:100': {
    category: 'user_action',
    messageVi:
      'Facebook không nhận ảnh hoặc video của bài này. Hãy chọn ảnh/video khác rồi đăng lại.',
    remedies: [...MEDIA],
  },
  'FB:368': {
    category: 'user_action',
    messageVi:
      'Facebook tạm chặn bài này vì nghi vi phạm chính sách. Hãy kiểm tra Trang trên Facebook.',
    remedies: [{ action: 'check_on_platform', labelVi: 'Kiểm tra Trang trên Facebook' }],
  },
};

export const INSTAGRAM_ERROR_TABLE: ErrorTable = {
  ...common('IG'),
  'IG:NOT_PROFESSIONAL': {
    category: 'user_action',
    messageVi:
      'Tài khoản Instagram chưa là tài khoản chuyên nghiệp (Business/Creator) nên chưa đăng được. Hãy chuyển rồi kết nối lại.',
    remedies: [...RECONNECT],
  },
  'IG:2207026': {
    category: 'user_action',
    messageVi: 'Instagram không nhận định dạng video này. Hãy chọn video MP4 khác.',
    remedies: [...MEDIA],
  },
  'IG:2207004': {
    category: 'user_action',
    messageVi: 'Ảnh quá lớn so với giới hạn của Instagram. Hãy chọn ảnh nhỏ hơn.',
    remedies: [...MEDIA],
  },
  'IG:2207009': {
    category: 'user_action',
    messageVi: 'Tỉ lệ khung hình của ảnh/video không được Instagram chấp nhận.',
    remedies: [...MEDIA],
  },
  'IG:2207042': {
    category: 'user_action',
    messageVi: 'Tài khoản Instagram đã hết lượt đăng trong 24 giờ. Hãy chọn giờ đăng khác.',
    remedies: [{ action: 'retry_later', labelVi: 'Chọn giờ đăng khác' }],
  },
};
