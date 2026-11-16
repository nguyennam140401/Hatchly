// Quy tắc kiểm tra bài theo kênh (012 FR-002, FR-007, FR-008): hàm THUẦN, kết quả KHÔNG lưu – tính khi
// đọc/duyệt để không có dữ liệu cũ. Mỗi quy tắc trả danh sách `ValidationIssue` kèm ≥ 1 cách khắc phục
// (nguyên tắc VI); thông điệp tiếng Việt đời thường.
import type { ValidationIssue } from '@app/shared/content';
import type { ChannelRule, VariantRecord } from '../../public-api';

/** Nội dung hiệu lực của một kênh: bản riêng nếu đã tùy chỉnh, không thì nội dung chung. */
export function effectiveText(variant: Pick<VariantRecord, 'customized' | 'text'>, shared: string) {
  return variant.customized ? variant.text : shared;
}

/** Độ dài tính theo ký tự Unicode (emoji, tiếng Việt có dấu tính một ký tự). */
export function textLength(text: string): number {
  return Array.from(text).length;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');

export function textLengthRule(text: string, rule: ChannelRule): ValidationIssue[] {
  const len = textLength(text);
  if (len <= rule.maxTextLength) return [];
  return [
    {
      rule: 'text_length',
      messageVi: `Nội dung dài ${fmt(len)} ký tự, kênh này nhận tối đa ${fmt(rule.maxTextLength)} ký tự. Hãy rút gọn ${fmt(len - rule.maxTextLength)} ký tự.`,
      remedies: [{ action: 'edit_text', labelVi: 'Rút gọn nội dung' }],
    },
  ];
}

export function hashtagsRule(hashtags: readonly string[], rule: ChannelRule): ValidationIssue[] {
  if (rule.maxHashtags === null || hashtags.length <= rule.maxHashtags) return [];
  return [
    {
      rule: 'hashtags',
      messageVi: `Có ${hashtags.length} hashtag, kênh này nhận tối đa ${rule.maxHashtags}. Hãy bớt ${hashtags.length - rule.maxHashtags} hashtag.`,
      remedies: [{ action: 'edit_hashtags', labelVi: 'Bớt hashtag' }],
    },
  ];
}

export function mediaRequiredRule(mediaCount: number, rule: ChannelRule): ValidationIssue[] {
  if (!rule.mediaRequired || mediaCount > 0) return [];
  return [
    {
      rule: 'media_required',
      messageVi: 'Kênh này yêu cầu có ít nhất một ảnh hoặc video. Hãy thêm media cho bài.',
      remedies: [{ action: 'edit_media', labelVi: 'Thêm ảnh hoặc video' }],
    },
  ];
}

/** Kênh ngắt kết nối, hết hạn quyền hoặc không còn trong tài khoản. */
export function channelInactiveRule(
  status: 'active' | 'expiring' | 'expired' | 'disconnected' | 'unknown',
): ValidationIssue[] {
  if (status === 'active' || status === 'expiring') return [];
  return [
    {
      rule: 'channel_inactive',
      messageVi:
        status === 'disconnected'
          ? 'Kênh này đã bị ngắt kết nối nên chưa đăng được.'
          : status === 'expired'
            ? 'Quyền truy cập kênh này đã hết hạn nên chưa đăng được.'
            : 'Không tìm thấy kênh này trong tài khoản của bạn.',
      remedies: [
        { action: 'reconnect', labelVi: 'Kết nối lại' },
        { action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' },
      ],
    },
  ];
}

/** Không kiểm được media (thiếu cổng mô tả) của kênh bắt buộc media → chưa thể lên lịch (FR-007). */
export function mediaUnverifiableRule(): ValidationIssue[] {
  return [
    {
      rule: 'media_rule',
      messageVi:
        'Chưa kiểm tra được ảnh/video của kênh này nên chưa thể lên lịch. Hãy thử lại sau hoặc bỏ kênh này khỏi bài.',
      remedies: [
        { action: 'remove_channel', labelVi: 'Bỏ kênh này khỏi bài' },
        { action: 'edit_media', labelVi: 'Kiểm tra lại media' },
      ],
    },
  ];
}

/** Bài không có chữ lẫn media ở kênh này. */
export function emptyRule(text: string, mediaCount: number): ValidationIssue[] {
  if (text.trim() !== '' || mediaCount > 0) return [];
  return [
    {
      rule: 'empty',
      messageVi: 'Bài chưa có nội dung. Hãy nhập chữ hoặc thêm ảnh/video cho kênh này.',
      remedies: [{ action: 'edit_text', labelVi: 'Nhập nội dung' }],
    },
  ];
}
