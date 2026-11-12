// Nhóm (f) – xung đột phiên bản trên màn hình (006 US4, FR-005): 409 → cảnh báo + "Tải bản mới nhất",
// nội dung đang gõ GIỮ NGUYÊN; tải bản mới khi đang có thay đổi → hỏi trước. Chép mẫu này khi: màn hình
// ghi dữ liệu có khóa lạc quan.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, renderAt } from '../auth/helpers';
import { emptyList, errorBody, meWith, profileView } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const conflict = errorBody(
  'VERSION_CONFLICT',
  'Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.',
  [{ kind: 'retry', label: 'Tải bản mới nhất' }],
);

describe('Xung đột khi lưu', () => {
  it('409 → role=alert + "Tải bản mới nhất"; nội dung đang gõ giữ nguyên; xác nhận rồi mới thay bằng bản mới', async () => {
    let latest = 1;
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
      'GET /api/v1/context/profile': () => ({
        status: 200,
        body: {
          profile: profileView(latest, latest === 2 ? { introduction: 'Bản của người khác' } : {}),
          missingOptional: [],
        },
      }),
      'GET /api/v1/context/profile/versions': () => ({ status: 200, body: emptyList }),
      'PUT /api/v1/context/profile': () => ({ status: 409, body: conflict }),
    });
    renderAt('/business-profile');
    const intro = await screen.findByLabelText(/Giới thiệu/);
    fireEvent.change(intro, { target: { value: 'Nội dung tôi đang gõ' } });
    latest = 2;
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.');
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveValue('Nội dung tôi đang gõ');
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      expectedVersion: 1,
    });

    // Đang có thay đổi → hỏi trước; "Giữ nội dung đang sửa" không tải gì.
    fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới nhất' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Thay nội dung đang sửa bằng bản mới nhất?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Giữ nội dung đang sửa' }));
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveValue('Nội dung tôi đang gõ');

    fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới nhất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thay bằng bản mới nhất' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Giới thiệu/)).toHaveValue('Bản của người khác');
    });
    expect(screen.getByText(/Phiên bản 2 · lưu lúc/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
