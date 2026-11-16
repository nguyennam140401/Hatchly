import type { ReactNode } from 'react';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';

// Bố cục chung của các trang xác thực – một cột, chạy từ 360 px (dựng từ thành phần dùng chung).
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-gutter py-6">
      <Page>
        <p className="text-body-sm text-ink-muted">Trợ lý đăng bài</p>
        <PageHeader title={title} />
        {children}
      </Page>
    </div>
  );
}
