import { Link } from 'react-router';
import { t } from '../../lib/i18n/t';
import { Icon } from '../../ui/icons/Icon';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { useNavItems } from './useNavItems';

/** Mục "Thêm" trên điện thoại: các mục không nằm ở thanh dưới. */
export function MorePage() {
  const { more } = useNavItems();
  return (
    <Page>
      <PageHeader title={t('nav.more')} />
      <ul className="flex flex-col gap-2">
        {more.map((item) => (
          <li key={item.id}>
            <Link
              to={item.href}
              className="flex min-h-touch items-center gap-3 rounded-lg border border-line bg-surface-0 px-4 text-body text-ink focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Icon name={item.icon} />
              <span className="flex-1">{item.label}</span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
