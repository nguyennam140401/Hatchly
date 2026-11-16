import type { ReactNode } from 'react';
import { useNavigate, useRouteError } from 'react-router';
import { t } from '../../lib/i18n/t';
import { Button } from '../../ui/button/Button';
import { PageHeader } from '../../ui/layout/PageHeader';

// Trang lỗi bằng tiếng Việt đời thường, luôn có nút hành động; mã gốc chỉ ở "Chi tiết cho hỗ trợ" (FR-011).

function Screen({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-phone min-w-0 flex-col gap-4 p-gutter">
      <PageHeader title={title} description={body} />
      <div className="flex flex-wrap gap-2">{children}</div>
    </main>
  );
}

export function NotFound() {
  const navigate = useNavigate();
  return (
    <Screen title={t('errors.notFound.title')} body={t('errors.notFound.body')}>
      <Button
        onClick={() => {
          void navigate('/');
        }}
      >
        {t('common.goHome')}
      </Button>
    </Screen>
  );
}

/** "Bạn không có quyền": lối về Tổng quan + "Nhờ chủ tài khoản" (cộng tác viên). */
export function Forbidden() {
  const navigate = useNavigate();
  return (
    <Screen title={t('errors.forbidden.title')} body={t('errors.forbidden.body')}>
      <Button
        onClick={() => {
          void navigate('/');
        }}
      >
        {t('common.goHome')}
      </Button>
      <a
        href="/settings/members"
        className="inline-flex min-h-touch min-w-touch items-center rounded-md border border-line-strong px-4 text-label text-brand focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t('errors.forbidden.askOwner')}
      </a>
    </Screen>
  );
}

/** `errorElement`: lỗi hiển thị ở một nhóm tuyến; khung điều hướng ngoài nó còn nguyên. */
export function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const detail = error instanceof Error ? error.message : undefined;
  return (
    <Screen title={t('errors.page.title')} body={t('errors.page.body')}>
      <Button
        onClick={() => {
          window.location.reload();
        }}
      >
        {t('common.reload')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          void navigate('/');
        }}
      >
        {t('common.goHome')}
      </Button>
      {detail !== undefined && (
        <details className="w-full text-caption text-ink-muted">
          <summary className="min-h-touch cursor-pointer py-3 text-label">
            {t('support.detailsTitle')}
          </summary>
          <p>{detail}</p>
        </details>
      )}
    </Screen>
  );
}
