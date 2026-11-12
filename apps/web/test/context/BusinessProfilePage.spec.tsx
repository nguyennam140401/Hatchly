// Nhóm (f) – màn hình "Hồ sơ kinh doanh" theo bảng trạng thái (006 contracts/business-profile-ui.md,
// FR-017, FR-018). Chép mẫu này khi: thêm màn hình nghiệp vụ – mỗi dòng của bảng trạng thái là một ca
// (đang tải, trống, có dữ liệu, đang lưu, thành công, không đổi, lỗi hợp lệ, lỗi máy chủ, lỗi mạng),
// kiểm vai trò ARIA + chữ, và quét axe 0 vi phạm.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, keyboardReachable, renderAt } from '../auth/helpers';
import { emptyList, errorBody, meWith, profileView, versionList } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const P = '/api/v1/context/profile';
const ownerBase = {
  'GET /api/v1/auth/me': () => ({ status: 200, body: meWith('owner') }),
  [`GET ${P}/versions`]: () => ({ status: 200, body: emptyList }),
};

describe('BusinessProfilePage – chủ tài khoản', () => {
  it('đang tải → aria-busy', async () => {
    // Hồ sơ không bao giờ trả về → trang dừng ở trạng thái đang tải.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input.startsWith('/api/v1/auth/me')
          ? Promise.resolve(new Response(JSON.stringify(meWith('owner')), { status: 200 }))
          : new Promise<Response>(() => undefined),
      ),
    );
    renderAt('/business-profile');
    const main = await screen.findByText('Đang tải hồ sơ…');
    expect(main.closest('main')).toHaveAttribute('aria-busy', 'true');
  });

  it('chưa có hồ sơ → biểu mẫu trống + thẻ gợi ý; 0 vi phạm axe; dùng được bằng bàn phím', async () => {
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({
        status: 200,
        body: { profile: null, missingOptional: ['products', 'policies', 'tone', 'keywords'] },
      }),
    });
    const { container } = renderAt('/business-profile');
    expect(await screen.findByText(/Chưa có hồ sơ/)).toBeInTheDocument();
    expect(screen.getByText(/AI sẽ viết tốt hơn nếu bạn bổ sung/)).toHaveTextContent(
      'Sản phẩm/dịch vụ, Chính sách, Giọng văn mong muốn, Từ khóa riêng',
    );
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);
  });

  it('có hồ sơ → dòng "Phiên bản N · lưu lúc HH:mm dd/MM/yyyy (giờ Việt Nam) · bởi <tên>"', async () => {
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({ status: 200, body: { profile: profileView(3), missingOptional: [] } }),
    });
    renderAt('/business-profile');
    expect(
      await screen.findByText(
        'Phiên bản 3 · lưu lúc 10:05 10/11/2026 (giờ Việt Nam) · bởi Chị Lan',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Giới thiệu/)).toHaveValue('Tiệm áo dài may đo ở Huế.');
  });

  it('lưu: "Đang lưu…" vô hiệu khi chờ, rồi role=status "Đã lưu phiên bản 1"', async () => {
    let release: (v: { status: number; body: unknown }) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'PUT') {
          const r = await new Promise<{ status: number; body: unknown }>((resolve) => {
            release = resolve;
          });
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
        const path = input.split('?')[0] ?? input;
        const body =
          path === P
            ? { profile: null, missingOptional: [] }
            : path === `${P}/versions`
              ? emptyList
              : meWith('owner');
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    renderAt('/business-profile');
    fireEvent.change(await screen.findByLabelText(/Ngành kinh doanh/), {
      target: { value: 'fashion' },
    });
    fireEvent.change(screen.getByLabelText(/Giới thiệu/), { target: { value: 'Tiệm áo dài' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const saving = await screen.findByRole('button', { name: 'Đang lưu…' });
    expect(saving).toBeDisabled();
    // Bấm lần nữa không gửi yêu cầu thứ hai.
    fireEvent.click(saving);
    release({ status: 200, body: { changed: true, profile: profileView(1) } });
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu phiên bản 1');
    const puts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts).toHaveLength(1);
  });

  it('lưu không đổi → role=status "Không có thay đổi để lưu"', async () => {
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({ status: 200, body: { profile: profileView(2), missingOptional: [] } }),
      [`PUT ${P}`]: () => ({ status: 200, body: { changed: false, profile: profileView(2) } }),
    });
    renderAt('/business-profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Không có thay đổi để lưu');
  });

  it('lỗi hợp lệ ở web: lỗi cạnh ô (aria-invalid, aria-describedby), tóm tắt, tiêu điểm vào ô lỗi đầu; không gọi API', async () => {
    const api = fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({ status: 200, body: { profile: null, missingOptional: [] } }),
    });
    renderAt('/business-profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu' }));
    const industry = screen.getByLabelText(/Ngành kinh doanh/);
    expect(industry).toHaveAttribute('aria-invalid', 'true');
    expect(industry).toHaveFocus();
    expect(screen.getByText('Hãy chọn ngành kinh doanh.')).toBeInTheDocument();
    const intro = screen.getByLabelText(/Giới thiệu/);
    expect(intro).toHaveAttribute('aria-invalid', 'true');
    expect(intro.getAttribute('aria-describedby')).toContain('bp-introduction-err');
    expect(screen.getByText(/Hãy sửa 2 ô được đánh dấu/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('lỗi hợp lệ từ máy chủ gắn đúng ô (bỏ tiền tố fields.)', async () => {
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({ status: 200, body: { profile: profileView(1), missingOptional: [] } }),
      [`PUT ${P}`]: () => ({
        status: 400,
        body: errorBody(
          'VALIDATION_FAILED',
          'Thông tin gửi lên chưa đúng.',
          [{ kind: 'fix_input', label: 'Sửa thông tin' }],
          [
            {
              path: ['fields', 'tone'],
              message: 'Phần giọng văn dài quá 500 ký tự – hãy rút gọn.',
            },
          ],
        ),
      }),
    });
    renderAt('/business-profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Giọng văn mong muốn')).toHaveAttribute('aria-invalid', 'true');
    });
    expect(screen.getByText('Phần giọng văn dài quá 500 ký tự – hãy rút gọn.')).toBeInTheDocument();
  });

  it('lỗi mạng khi lưu → role=alert + "Thử lại" + "Chi tiết cho hỗ trợ" thu gọn', async () => {
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({ status: 200, body: { profile: profileView(1), missingOptional: [] } }),
      [`PUT ${P}`]: () => ({
        status: 503,
        body: errorBody('SERVICE_UNAVAILABLE', 'Hệ thống đang tạm dừng để cập nhật.'),
      }),
    });
    renderAt('/business-profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Hệ thống đang tạm dừng để cập nhật.');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    const details = screen.getByText('Chi tiết cho hỗ trợ').closest('details');
    expect(details).not.toHaveAttribute('open');
  });

  it('tải hồ sơ lỗi → role=alert + "Thử lại" tải lại được', async () => {
    let fail = true;
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () =>
        fail
          ? { status: 500, body: errorBody('INTERNAL_ERROR', 'Đã có lỗi xảy ra.') }
          : { status: 200, body: { profile: null, missingOptional: [] } },
    });
    renderAt('/business-profile');
    expect(await screen.findByRole('alert')).toHaveTextContent('Đã có lỗi xảy ra.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(/Chưa có hồ sơ/)).toBeInTheDocument();
  });

  it('văn bản người dùng hiển thị nguyên văn (không chạy <script>)', async () => {
    fakeApi({
      ...ownerBase,
      [`GET ${P}`]: () => ({
        status: 200,
        body: {
          profile: profileView(1, {
            introduction: '<script>alert(1)</script>',
            keywords: ['<b>x</b>'],
          }),
          missingOptional: [],
        },
      }),
      [`GET ${P}/versions`]: () => ({ status: 200, body: versionList([1]) }),
    });
    const { container } = renderAt('/business-profile');
    expect(await screen.findByLabelText(/Giới thiệu/)).toHaveValue('<script>alert(1)</script>');
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});
