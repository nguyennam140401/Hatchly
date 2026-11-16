import { t } from '../../lib/i18n/t';
import { EmptyState } from '../../ui/feedback/EmptyState';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';

/** Giữ chỗ cho màn hình của tính năng sau. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Page>
      <PageHeader title={title} />
      <EmptyState message={t('common.comingSoon')} icon="clock" />
    </Page>
  );
}
