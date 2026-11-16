import type { StatusTone } from '../../lib/catalogs/post-status';

/** Lớp màu theo `tone` – nền nhạt + chữ đậm (đã kiểm tương phản ở tokens.contrast). */
export const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-surface-200 text-ink',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
};
