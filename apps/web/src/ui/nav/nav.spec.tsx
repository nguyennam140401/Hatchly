import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../test/helpers/axe';
import { NAVBAR_SAMPLE, SIDEBAR_SAMPLE, navCatalog } from './nav.catalog';
import { NavBar } from './NavBar';
import { Sidebar } from './Sidebar';

function at(path: string, ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('Sidebar', () => {
  it('mỗi trong 7 mục có thể là mục hiện tại: aria-current="page"', () => {
    for (const item of SIDEBAR_SAMPLE) {
      const { unmount } = at(item.href, <Sidebar items={SIDEBAR_SAMPLE} appName="App" />);
      const current = screen
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page');
      expect(current, item.id).toHaveLength(1);
      expect(current[0]).toHaveTextContent(item.label);
      unmount();
    }
  });
  it('huy hiệu đếm có chữ số', () => {
    at('/', <Sidebar items={SIDEBAR_SAMPLE} appName="App" />);
    expect(
      within(screen.getByRole('link', { name: /Bài viết/ })).getByText('3'),
    ).toBeInTheDocument();
  });
});

describe('NavBar', () => {
  it('5 ô; "Tạo bài" nổi bật; mục hiện tại có aria-current', () => {
    at('/calendar', <NavBar items={NAVBAR_SAMPLE} />);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Lịch đăng' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tạo bài' })).toBeInTheDocument();
  });
});

describe('navigation catalog', () => {
  it('không vi phạm trợ năng', async () => {
    for (const v of navCatalog.variants) {
      const { container, unmount } = at('/', <main>{v.render()}</main>);
      expect(await axe(container), v.label).toHaveNoViolations();
      unmount();
    }
  });
});
