import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { fakeApi, me, renderAt } from '../../../test/auth/helpers';

// 010 T027/T046 (US1, US2): chọn Page sau khi cấp quyền – chọn sẵn khi chỉ có một ứng viên, khóa "Xác nhận" khi vượt chỗ còn lại,
// ứng viên bị chặn có lý do + hướng dẫn Instagram 3 bước, kết quả từng Page hiện riêng.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const SEL = '0198a1b2-0000-7000-8000-0000000000aa';
const ownerMe = () => ({
  ...me(),
  permissions: ['post.edit', 'status.view', 'channel.view', 'channel.manage'],
});
const cand = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  externalId: id,
  displayName: name,
  avatarUrl: null,
  accountType: null,
  selectable: true,
  blocked: null,
  ...extra,
});

describe('SelectChannelsPage', () => {
  it('chỉ một ứng viên chọn được ⇒ chọn sẵn; bấm Xác nhận hiện kết quả từng Page', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [`GET /api/v1/channels/selections/${SEL}`]: () => ({
        status: 200,
        body: {
          channelType: 'facebook_page',
          remainingSlots: 3,
          limit: 5,
          candidates: [
            cand('p1', 'Tiệm hoa Lan'),
            cand('p2', 'Quán cà phê', {
              selectable: false,
              blocked: {
                code: 'ALREADY_CONNECTED',
                messageVi: 'Đã kết nối',
                remedies: [{ action: 'check_on_platform', labelVi: 'Xem kênh' }],
              },
            }),
          ],
        },
      }),
      [`POST /api/v1/channels/selections/${SEL}/confirm`]: () => ({
        status: 200,
        body: { results: [{ externalId: 'p1', outcome: 'created' }] },
      }),
    });
    const { container } = renderAt(`/channels/select/${SEL}`);
    const first = await screen.findByRole('checkbox', { name: /Tiệm hoa Lan/ });
    expect(first).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Quán cà phê/ })).toBeDisabled();
    expect(screen.getByText(/Đã kết nối/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Kết quả từng kênh')).toBeInTheDocument();
    expect(screen.getByText('Đã kết nối')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.calls.find((c) => c.path.endsWith('/confirm'))?.body).toEqual({
        externalIds: ['p1'],
      });
    });
  });

  it('chọn quá chỗ còn lại ⇒ "Xác nhận" khóa kèm giải thích', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [`GET /api/v1/channels/selections/${SEL}`]: () => ({
        status: 200,
        body: {
          channelType: 'facebook_page',
          remainingSlots: 1,
          limit: 5,
          candidates: [cand('p1', 'Trang A'), cand('p2', 'Trang B')],
        },
      }),
    });
    renderAt(`/channels/select/${SEL}`);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Trang A/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Trang B/ }));
    expect(screen.getByText(/chỉ chọn thêm được 1 kênh/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('Instagram cá nhân ⇒ lý do + hướng dẫn 3 bước + nút Kiểm tra lại', async () => {
    fakeApi({
      'GET /api/v1/auth/me': () => ({ status: 200, body: ownerMe() }),
      [`GET /api/v1/channels/selections/${SEL}`]: () => ({
        status: 200,
        body: {
          channelType: 'instagram',
          remainingSlots: 5,
          limit: 5,
          candidates: [
            cand('ig1', '@canhan', {
              selectable: false,
              blocked: {
                code: 'NOT_PROFESSIONAL',
                messageVi: 'Tài khoản Instagram cần chuyển sang tài khoản chuyên nghiệp.',
                remedies: [{ action: 'check_on_platform', labelVi: 'Xem hướng dẫn' }],
              },
            }),
          ],
        },
      }),
    });
    renderAt(`/channels/select/${SEL}`);
    expect(await screen.findByText(/cần chuyển sang tài khoản chuyên nghiệp/)).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: /Cách chuyển sang tài khoản chuyên nghiệp/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kiểm tra lại' })).toBeInTheDocument();
  });
});
