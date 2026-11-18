// 014 T068 (FR-010/018, nguyên tắc VI): hết 5 GB chỉ chặn TẢI LÊN – xem, xóa, soạn, duyệt, đăng vẫn dùng được; mọi thông báo
// chặn có cách khắc phục; gói hết hạn có "Gia hạn gói"; lưới và hộp xóa vẫn hoạt động.
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, me, renderAt } from '../auth/helpers';
import { LIST, listOf, mediaItem, quota, uuid } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('khu tải lên khi hết chỗ', () => {
  it('đầy 5 GB ⇒ giải thích + khóa nút tải (aria-disabled) + "Xem danh sách để xóa"; lưới vẫn xem và xóa được', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      [`GET ${LIST}`]: () => ({ status: 200, body: listOf([mediaItem(1)], quota(4.9, 0.1)) }),
      [`GET ${LIST}/${uuid(1)}/usages`]: () => ({
        status: 200,
        body: { usages: [], blocking: false },
      }),
    });
    const { container } = renderAt('/media');
    const section = await screen.findByRole('region', { name: 'Tải lên' });
    expect((await within(section).findAllByText('Thư viện đã đầy')).length).toBeGreaterThan(0);
    expect(
      within(section).getByText(/xem, xóa, soạn và đăng bài vẫn dùng bình thường/),
    ).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Xem danh sách để xóa' })).toHaveAttribute(
      'href',
      '#media-grid',
    );
    // nút tải bị khóa nhưng vẫn đọc được lý do (aria-disabled, không `disabled` thuần)
    expect(within(section).getByRole('button', { name: 'Chọn tệp' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(section).getByRole('button', { name: 'Chụp ảnh' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Đầy')).toBeInTheDocument(); // thanh dung lượng: chữ + biểu tượng
    // xem + xóa vẫn dùng được
    expect(await screen.findByRole('button', { name: /^anh-1\.jpg, / })).toBeEnabled(); // xem được
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa anh-1.jpg' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('còn chỗ ⇒ không có cảnh báo; nút tải dùng được', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      [`GET ${LIST}`]: () => ({ status: 200, body: listOf([mediaItem(1)], quota(1.2)) }),
    });
    renderAt('/media');
    const section = await screen.findByRole('region', { name: 'Tải lên' });
    await screen.findByText('Đã dùng 1,2 GB / 5 GB');
    expect(within(section).queryAllByText('Thư viện đã đầy')).toHaveLength(0);
    expect(within(section).getByRole('button', { name: 'Chọn tệp' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sắp đầy (≥ 80%) ⇒ nhãn "Sắp đầy" nhưng vẫn tải được', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      [`GET ${LIST}`]: () => ({ status: 200, body: listOf([mediaItem(1)], quota(4.2)) }),
    });
    renderAt('/media');
    expect(await screen.findByText('Sắp đầy')).toBeInTheDocument();
    const section = await screen.findByRole('region', { name: 'Tải lên' });
    expect(within(section).getByRole('button', { name: 'Chọn tệp' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
