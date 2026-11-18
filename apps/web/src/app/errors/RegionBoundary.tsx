import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { useLocation } from 'react-router';
import { t } from '../../lib/i18n/t';
import { InlineAlert } from '../../ui/alert/InlineAlert';

// Lỗi hiển thị trong MỘT vùng không làm sập cả ứng dụng: phần còn lại sống, vùng lỗi có "Thử lại vùng này" (FR-011).
// Chunk không tải được (có bản mới) → "Có bản mới – tải lại".

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : '';
  const isChunk = CHUNK_ERROR.test(message);
  return (
    <InlineAlert
      tone="error"
      title={isChunk ? t('errors.newVersion') : t('errors.page.title')}
      actions={[
        isChunk
          ? { kind: 'retry', label: t('common.reload') }
          : { kind: 'retry', label: t('errors.region.retry') },
      ]}
      onAction={() => {
        if (isChunk) window.location.reload();
        else resetErrorBoundary();
      }}
      {...(message !== '' ? { support: { traceId: '', detail: message } } : {})}
    >
      {t('errors.page.body')}
    </InlineAlert>
  );
}

/** Bao một vùng; tự đặt lại khi đổi đường dẫn. */
export function RegionBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary FallbackComponent={Fallback} resetKeys={[pathname]}>
      {children}
    </ErrorBoundary>
  );
}
