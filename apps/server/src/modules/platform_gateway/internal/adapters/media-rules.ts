import type { MediaDescriptor, MediaRules, MediaViolation } from '../../public-api';

// Kiểm media theo quy tắc của kênh (hàm thuần, công khai – UI cảnh báo sớm và bước 1–2 của luồng đăng).
// Thông điệp tiếng Việt đời thường, luôn kèm giới hạn và giá trị thực.

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

export function validateMedia(rules: MediaRules, items: MediaDescriptor[]): MediaViolation[] {
  const out: MediaViolation[] = [];
  if (items.length > rules.maxItems) {
    out.push({
      mediaId: null,
      rule: 'count',
      messageVi: `Kênh này chỉ nhận tối đa ${rules.maxItems} tệp mỗi bài (bài đang có ${items.length}).`,
      limit: rules.maxItems,
      actual: items.length,
    });
  }
  const kinds = new Set(items.map((i) => i.kind));
  if (!rules.allowMixed && kinds.size > 1) {
    out.push({
      mediaId: null,
      rule: 'mixed',
      messageVi: 'Kênh này không cho đăng ảnh và video chung một bài. Hãy tách thành hai bài.',
      limit: 'một loại',
      actual: 'ảnh + video',
    });
  }
  for (const item of items) {
    const rule = item.kind === 'image' ? rules.image : rules.video;
    if (rule === null) {
      out.push({
        mediaId: item.mediaId,
        rule: 'format',
        messageVi: item.kind === 'image' ? 'Kênh này không nhận ảnh.' : 'Kênh này không nhận video.',
        limit: 'không hỗ trợ',
        actual: item.kind,
      });
      continue;
    }
    const format = item.format.toLowerCase();
    if (!(rule.formats as string[]).includes(format)) {
      out.push({
        mediaId: item.mediaId,
        rule: 'format',
        messageVi: `Định dạng ${format.toUpperCase()} chưa được hỗ trợ. Hãy dùng ${rule.formats.map((f) => f.toUpperCase()).join(', ')}.`,
        limit: rule.formats.join(','),
        actual: format,
      });
    }
    if (item.bytes > rule.maxBytes) {
      out.push({
        mediaId: item.mediaId,
        rule: 'size',
        messageVi: `Tệp quá lớn (${mb(item.bytes)}). Kênh này nhận tối đa ${mb(rule.maxBytes)}.`,
        limit: rule.maxBytes,
        actual: item.bytes,
      });
    }
    if ('maxDurationSec' in rule && (item.durationSec ?? 0) > rule.maxDurationSec) {
      out.push({
        mediaId: item.mediaId,
        rule: 'duration',
        messageVi: `Video dài ${Math.round(item.durationSec ?? 0)} giây, kênh này nhận tối đa ${rule.maxDurationSec} giây.`,
        limit: rule.maxDurationSec,
        actual: item.durationSec ?? 0,
      });
    }
    const aspect = item.height > 0 ? item.width / item.height : 0;
    if (aspect < rule.minAspect - 1e-9 || aspect > rule.maxAspect + 1e-9) {
      out.push({
        mediaId: item.mediaId,
        rule: 'aspect',
        messageVi: `Tỉ lệ khung hình ${aspect.toFixed(2)} nằm ngoài khoảng kênh này nhận (${rule.minAspect.toFixed(2)}–${rule.maxAspect.toFixed(2)}). Hãy cắt lại ảnh/video.`,
        limit: `${rule.minAspect}-${rule.maxAspect}`,
        actual: Number(aspect.toFixed(4)),
      });
    }
  }
  return out;
}
