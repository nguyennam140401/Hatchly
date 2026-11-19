import type { ErrorTable } from '../classify';

// Bảng phân loại lỗi mặc định của TikTok (010 contracts/meta-tiktok-adapters.md mục 5). Quy tắc bất biến: `transient` CHỈ cho mã
// chắc chắn nền tảng chưa làm gì (giới hạn tốc độ); mã lạ KHÔNG có trong bảng ⇒ `unknown`. `submit` chưa hiện thực đăng thật nên
// luôn `user_action` – KHÔNG BAO GIỜ `transient`.
const RECONNECT = [{ action: 'reconnect', labelVi: 'Kết nối lại TikTok' }] as const;
const SUPPORT = [{ action: 'contact_support', labelVi: 'Liên hệ hỗ trợ' }] as const;
const WAIT = [{ action: 'retry_later', labelVi: 'Thử lại sau' }] as const;

export const TIKTOK_ERROR_TABLE: ErrorTable = {
  'TT:access_token_invalid': {
    category: 'user_action',
    messageVi: 'Quyền kết nối TikTok đã hết hạn hoặc bị thu hồi. Hãy kết nối lại.',
    remedies: [...RECONNECT],
  },
  'TT:invalid_grant': {
    category: 'user_action',
    messageVi: 'Quyền kết nối TikTok đã hết hạn hoặc bị thu hồi. Hãy kết nối lại.',
    remedies: [...RECONNECT],
  },
  'TT:scope_not_authorized': {
    category: 'user_action',
    messageVi: 'Còn thiếu quyền đăng video lên TikTok. Hãy kết nối lại và cấp đủ quyền.',
    remedies: [...RECONNECT],
  },
  'TT:SCOPE_MISSING': {
    category: 'user_action',
    messageVi: 'Còn thiếu quyền đăng video lên TikTok. Hãy kết nối lại và cấp đủ quyền.',
    remedies: [...RECONNECT],
  },
  'TT:app_not_approved': {
    category: 'user_action',
    messageVi: 'Tính năng kết nối TikTok đang được chuẩn bị. Vui lòng liên hệ hỗ trợ.',
    remedies: [...SUPPORT],
  },
  'TT:rate_limit_exceeded': {
    category: 'transient',
    messageVi: 'TikTok đang giới hạn tốc độ tạm thời. Hãy thử lại sau ít phút.',
    remedies: [...WAIT],
    retryAfterSec: 600,
  },
  'TT:POSTING_NOT_AVAILABLE': {
    category: 'user_action',
    messageVi:
      'Tính năng đăng bài lên TikTok chưa mở. Bạn có thể kết nối kênh trước, việc đăng sẽ có sau.',
    remedies: [...SUPPORT],
  },
  'TT:REFRESH_UNSUPPORTED': {
    category: 'user_action',
    messageVi: 'Cần kết nối lại TikTok để gia hạn quyền.',
    remedies: [...RECONNECT],
  },
};
