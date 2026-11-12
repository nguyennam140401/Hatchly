// Nhóm (f) – thành phần biểu mẫu hồ sơ (006 contracts/business-profile-ui.md "Thành phần biểu mẫu") và
// chặn rời trang khi còn thay đổi. Chép mẫu này khi: biểu mẫu có ô phụ thuộc (hiện/ẩn theo lựa chọn),
// bộ đếm ký tự, danh sách thẻ, hoặc cần chặn rời trang.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_FORM,
  ProfileForm,
  type ProfileFormValue,
} from '../../src/features/context/ProfileForm';
import { fakeApi, renderAt } from '../auth/helpers';
import { emptyList, meWith, profileView } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ initial = EMPTY_FORM }: { initial?: ProfileFormValue }) {
  const [value, setValue] = useState(initial);
  return <ProfileForm value={value} onChange={setValue} errors={{}} />;
}

describe('ProfileForm', () => {
  it('chọn "Khác" → hiện ô "Tên ngành" bắt buộc; chọn ngành khác → ẩn', () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/Tên ngành/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Ngành kinh doanh/), { target: { value: 'other' } });
    expect(screen.getByLabelText(/Tên ngành/)).toBeRequired();
    fireEvent.change(screen.getByLabelText(/Ngành kinh doanh/), { target: { value: 'education' } });
    expect(screen.queryByLabelText(/Tên ngành/)).toBeNull();
  });

  it('bộ đếm "x/2.000" cho giới thiệu (emoji đếm 1 ký tự)', () => {
    render(<Harness />);
    expect(screen.getByText('0/2.000')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Giới thiệu/), { target: { value: 'Xin chào 😀' } });
    expect(screen.getByText('10/2.000')).toBeInTheDocument();
  });

  it('từ khóa: Enter để thêm, nút "Xóa từ khóa X" để xóa, chặn quá 20', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Từ khóa riêng');
    fireEvent.change(input, { target: { value: ' áo dài ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('áo dài')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa từ khóa áo dài' }));
    expect(screen.queryByText('áo dài')).toBeNull();
    for (let i = 0; i < 21; i++) {
      fireEvent.change(input, { target: { value: `k${i}` } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(screen.getAllByRole('button', { name: /^Xóa từ khóa/ })).toHaveLength(20);
    expect(screen.getByText('Đã đủ 20 từ khóa.')).toBeInTheDocument();
    expect(input).toBeDisabled();
  });
});

describe('Chặn rời trang khi còn thay đổi chưa lưu', () => {
  it('sửa rồi bấm "Tổng quan" → hộp "Bỏ các thay đổi chưa lưu?"; Ở lại giữ trang; Bỏ thay đổi thì rời', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
      'GET /api/v1/context/profile': () => ({
        status: 200,
        body: { profile: profileView(1), missingOptional: [] },
      }),
      'GET /api/v1/context/profile/versions': () => ({ status: 200, body: emptyList }),
      'GET /healthz': () => ({ status: 200, body: {} }),
    });
    const { router } = renderAt('/business-profile');
    fireEvent.change(await screen.findByLabelText(/Giới thiệu/), {
      target: { value: 'Nội dung mới' },
    });
    fireEvent.click(screen.getByRole('link', { name: '← Tổng quan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Bỏ các thay đổi chưa lưu?');
    fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(router.state.location.pathname).toBe('/business-profile');
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveValue('Nội dung mới');

    fireEvent.click(screen.getByRole('link', { name: '← Tổng quan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ thay đổi' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('chưa sửa gì → rời trang không hỏi', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
      'GET /api/v1/context/profile': () => ({
        status: 200,
        body: { profile: profileView(1), missingOptional: [] },
      }),
      'GET /api/v1/context/profile/versions': () => ({ status: 200, body: emptyList }),
      'GET /healthz': () => ({ status: 200, body: {} }),
    });
    const { router } = renderAt('/business-profile');
    fireEvent.click(await screen.findByRole('link', { name: '← Tổng quan' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
