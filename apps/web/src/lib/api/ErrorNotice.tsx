import { useNavigate } from 'react-router';
import { explain, FALLBACK_ACTIONS, type ErrorActionView } from '../catalogs/error-explanations';
import { t } from '../i18n/t';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import type { AppError } from './errors';

// Cách DUY NHẤT hiển thị một `AppError` cho người dùng (SC-010): lời giải thích đời thường + ≥ 1 nút hành động; mã gốc và mã
// theo dõi chỉ nằm trong "Chi tiết cho hỗ trợ". Thay `ErrorNotice` cũ của `features/auth/ui.tsx` (FR-036).

export interface ErrorNoticeProps {
  error: AppError;
  /** Chạy lại thao tác/tải lại; có hàm này thì lỗi `network`/`server` luôn có nút "Thử lại". */
  onRetry?: () => void;
  /** Ghi đè xử lý hành động (mặc định: `retry` → onRetry, `navigate` → chuyển trang trong ứng dụng). */
  onAction?: (action: ErrorActionView) => void;
  /** Ghi đè hành động của máy chủ (vd đăng nhập sai → "Quên mật khẩu"). Rỗng/không có → dùng hành động của máy chủ. */
  actions?: readonly ErrorActionView[];
  className?: string;
}

function withRetry(
  actions: readonly ErrorActionView[],
  error: AppError,
  hasRetry: boolean,
): [ErrorActionView, ...ErrorActionView[]] {
  const list: ErrorActionView[] = [...actions];
  const wantsRetry =
    hasRetry &&
    (error.kind === 'network' || error.kind === 'server' || error.kind === 'invalid_response');
  if (wantsRetry && !list.some((a) => a.kind === 'retry'))
    list.unshift({ kind: 'retry', label: t('common.retry') });
  const [first, ...rest] = list.length > 0 ? list : FALLBACK_ACTIONS;
  return [first ?? FALLBACK_ACTIONS[0], ...rest];
}

export function ErrorNotice({
  error,
  onRetry,
  onAction,
  actions: override,
  className,
}: ErrorNoticeProps) {
  const navigate = useNavigate();
  const message =
    error.message !== '' ? error.message : (explain(error.code)?.message ?? t('errors.page.body'));
  const actions = withRetry(
    override !== undefined && override.length > 0 ? override : error.actions,
    error,
    onRetry !== undefined,
  );

  const handle = (action: ErrorActionView) => {
    if (onAction !== undefined) {
      onAction(action);
      return;
    }
    if (action.kind === 'retry') onRetry?.();
    else if (action.kind === 'navigate' && action.href !== undefined) void navigate(action.href);
  };

  return (
    <InlineAlert
      tone="error"
      actions={actions}
      onAction={handle}
      support={{ traceId: error.support.traceId, code: error.code, detail: error.support.detail }}
      {...(className !== undefined ? { className } : {})}
    >
      {message}
    </InlineAlert>
  );
}
