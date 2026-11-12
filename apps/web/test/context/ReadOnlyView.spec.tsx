// Nhóm (f) – cộng tác viên chỉ xem, người thiếu quyền (006 US2, FR-008). Quyền đọc từ /auth/me CHỈ để
// ẩn/hiện – API vẫn tự chặn (kiểm ở profile-api.e2e.spec.ts). Chép mẫu này khi: màn hình có chế độ
// xem/sửa theo quyền.
import { cleanup, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderAt } from '../auth/helpers';
import { meWith, profileView, versionList } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Chế độ chỉ xem', () => {
  it('có context.view, không có context.edit → ô chỉ đọc, không nút Lưu, dòng "Bạn đang xem…"; 0 vi phạm axe', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('collaborator') }),
      'GET /api/v1/context/profile': () => ({
        status: 200,
        body: { profile: profileView(2, { keywords: ['áo dài'] }), missingOptional: [] },
      }),
      'GET /api/v1/context/profile/versions': () => ({ status: 200, body: versionList([2, 1]) }),
    });
    const { container } = renderAt('/business-profile');
    expect(
      await screen.findByText('Bạn đang xem. Chỉ chủ tài khoản mới sửa được hồ sơ.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/Ngành kinh doanh/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xóa từ khóa/ })).toBeNull();
    // Lịch sử vẫn xem được.
    expect(await screen.findByText(/Phiên bản 2 ·/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('thiếu context.view → "Bạn không có quyền xem hồ sơ kinh doanh" + nút về Tổng quan; không gọi API hồ sơ', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('collaborator', ['post.edit']) }),
    });
    const { container } = renderAt('/business-profile');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bạn không có quyền xem hồ sơ kinh doanh',
    );
    expect(screen.getByRole('link', { name: 'Về Tổng quan' })).toHaveAttribute('href', '/');
    expect(api.calls.some((c) => c.path.startsWith('/api/v1/context'))).toBe(false);
    expect(await axe(container)).toHaveNoViolations();
  });
});
