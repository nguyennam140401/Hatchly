// Nhóm (f) – lịch sử phiên bản và bản cũ chỉ xem (006 US5). Chép mẫu này khi: màn hình có danh sách phân
// trang "Xem thêm" hoặc trang chi tiết theo mã (404 dùng thông điệp + hành động của máy chủ).
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderAt } from '../auth/helpers';
import { errorBody, fields, meWith, profileView, versionList, vid } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const P = '/api/v1/context/profile';

describe('Lịch sử phiên bản', () => {
  it('"Phiên bản N · thời điểm · người lưu", mới nhất trước; "Thành viên đã rời"; "Xem thêm" tải trang kế', async () => {
    const page1 = versionList(
      Array.from({ length: 20 }, (_, i) => 21 - i),
      21,
      1,
    );
    const page2 = versionList([1], 21, 2);
    // fakeApi bỏ chuỗi truy vấn → phân biệt trang bằng thứ tự lời gọi.
    let listCalls = 0;
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
      [`GET ${P}`]: () => ({
        status: 200,
        body: { profile: profileView(21), missingOptional: [] },
      }),
      [`GET ${P}/versions`]: () => ({ status: 200, body: ++listCalls === 1 ? page1 : page2 }),
    });
    renderAt('/business-profile');
    const first = await screen.findByRole('link', {
      name: 'Phiên bản 21 · 10:05 10/11/2026 · Chị Lan',
    });
    expect(first).toHaveAttribute('href', `/business-profile/versions/${vid(21)}`);
    expect(screen.getByText('Lịch sử phiên bản (21)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    expect(
      await screen.findByRole('link', {
        name: 'Phiên bản 1 · 10:05 10/11/2026 · Thành viên đã rời',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });
});

describe('Bản cũ – chỉ xem', () => {
  it('tiêu đề "Bản cũ – chỉ xem", nội dung đúng, chỉ đọc, không có nút khôi phục; 0 vi phạm axe', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
      [`GET ${P}/versions/${vid(1)}`]: () => ({
        status: 200,
        body: {
          versionId: vid(1),
          version: 1,
          savedAt: '2026-11-10T03:05:00.000Z',
          savedBy: { userId: vid(900), displayName: null, memberStatus: 'left' },
          fields: fields({ introduction: 'Bản đầu tiên' }),
          isCurrent: false,
        },
      }),
    });
    const { container } = renderAt(`/business-profile/versions/${vid(1)}`);
    expect(await screen.findByRole('heading', { name: 'Bản cũ – chỉ xem' })).toBeInTheDocument();
    expect(await screen.findByLabelText(/Giới thiệu/)).toHaveValue('Bản đầu tiên');
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveAttribute('readonly');
    expect(
      screen.getByText(
        /Phiên bản 1 · lưu lúc 10:05 10\/11\/2026 \(giờ Việt Nam\) · bởi Thành viên đã rời/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /khôi phục|Lưu/i })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('404 → "Không tìm thấy phiên bản này." + "Về hồ sơ kinh doanh"', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
      [`GET ${P}/versions/${vid(5)}`]: () => ({
        status: 404,
        body: errorBody('NOT_FOUND', 'Không tìm thấy phiên bản này.', [
          { kind: 'navigate', label: 'Về hồ sơ kinh doanh', href: '/business-profile' },
        ]),
      }),
    });
    renderAt(`/business-profile/versions/${vid(5)}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy phiên bản này.');
    expect(screen.getByRole('link', { name: 'Về hồ sơ kinh doanh' })).toHaveAttribute(
      'href',
      '/business-profile',
    );
  });
});
