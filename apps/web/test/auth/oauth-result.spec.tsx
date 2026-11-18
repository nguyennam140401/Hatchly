import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../src/lib/api/endpoints/auth';
import { apiError, fakeApi, healthy, keyboardReachable, me, renderAt } from './helpers';

// T032 + T040 (009 – US1, US2): nút nhà cung cấp, trang kết quả theo từng `stage`, trang xác nhận thư.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const PENDING = 'GET /api/v1/auth/oauth/pending';
const pending = (overrides: Record<string, unknown> = {}) => ({
  provider: 'google',
  purpose: 'login',
  stage: 'needs_signup',
  suggestedDisplayName: 'Lan Tiệm Hoa',
  suggestedEmail: 'lan@example.vn',
  emailRequired: false,
  methods: [],
  hint: null,
  error: null,
  ...overrides,
});

describe('ProviderButtons ở trang đăng nhập / đăng ký', () => {
  it('LoginPage và RegisterPage có hai nút; bấm → gọi start rồi chuyển sang nhà cung cấp', async () => {
    const api = fakeApi({
      'POST /api/v1/auth/oauth/google/start': () => ({
        status: 200,
        body: { authorizationUrl: 'https://accounts.example/authorize?state=abc' },
      }),
    });
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const login = renderAt('/login');
    const google = await screen.findByRole('button', { name: 'Tiếp tục với Google' });
    expect(screen.getByRole('button', { name: 'Tiếp tục với Facebook' })).toBeInTheDocument();
    expect(await axe(login.container)).toHaveNoViolations();
    fireEvent.click(google);
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://accounts.example/authorize?state=abc');
    });
    expect(api.calls.at(-1)).toMatchObject({ body: { purpose: 'login' } });
    cleanup();

    renderAt('/register');
    expect(await screen.findByRole('button', { name: 'Tiếp tục với Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục với Facebook' })).toBeInTheDocument();
    // Lời đồng ý nêu rõ Google và Meta là bên nhận dữ liệu (FR-032); ô đồng ý không đặt sẵn.
    expect(screen.getByText(/Google và Meta sẽ gửi cho chúng tôi tên, email/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('StaffLoginPage KHÔNG có nút nhà cung cấp', async () => {
    fakeApi();
    renderAt('/internal/login');
    await screen.findByRole('heading');
    expect(screen.queryByRole('button', { name: /Google|Facebook/ })).toBeNull();
  });

  it('nhà cung cấp gặp sự cố → hiện lỗi của máy chủ, không chuyển trang', async () => {
    fakeApi({
      'POST /api/v1/auth/oauth/facebook/start': () => ({
        status: 503,
        body: apiError('PROVIDER_UNAVAILABLE', { message: 'Facebook đang gặp sự cố.' }),
      }),
    });
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục với Facebook' }));
    expect(await screen.findByText('Facebook đang gặp sự cố.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('OAuthResultPage', () => {
  it('needs_signup: tên điền sẵn, ô đồng ý CHƯA tích, nút khóa tới khi tích; tạo xong → trang chính', async () => {
    const api = fakeApi({
      [PENDING]: () => ({ status: 200, body: pending() }),
      'POST /api/v1/auth/oauth/signup': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const { container, router } = renderAt('/oauth/result');
    const name = await screen.findByLabelText('Tên hiển thị');
    expect(name).toHaveValue('Lan Tiệm Hoa');
    expect(screen.getByText(/lan@example\.vn/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
    const checkbox = screen.getByRole('checkbox');
    const submit = screen.getByRole('button', { name: 'Tạo tài khoản' });
    expect(checkbox).not.toBeChecked();
    expect(submit).toHaveAttribute('aria-disabled', 'true'); // khóa kèm lý do (chuẩn 011)
    expect(screen.getByText(/Google và Meta sẽ gửi cho chúng tôi/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    expect(keyboardReachable(container)).toBe(true);

    fireEvent.click(checkbox);
    expect(submit).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(submit);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    const call = api.calls.find((c) => c.path === '/api/v1/auth/oauth/signup');
    expect(call?.body).toEqual({
      displayName: 'Lan Tiệm Hoa',
      acceptTerms: true,
      termsVersion: '2026-11',
    });
  });

  it('needs_email: ô email + tên + ô đồng ý → "Hãy kiểm tra email"', async () => {
    const api = fakeApi({
      [PENDING]: () => ({
        status: 200,
        body: pending({
          provider: 'facebook',
          stage: 'needs_email',
          suggestedEmail: null,
          emailRequired: true,
        }),
      }),
      'POST /api/v1/auth/oauth/signup': () => ({ status: 202, body: { status: 'check_email' } }),
    });
    const { container } = renderAt('/oauth/result');
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'minh@example.vn' },
    });
    expect(screen.getByText(/Facebook không cho chúng tôi biết email/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi liên kết hoàn tất' }));
    expect(await screen.findByRole('heading', { name: 'Hãy kiểm tra email' })).toBeInTheDocument();
    expect(screen.getByText('minh@example.vn')).toBeInTheDocument();
    expect(api.calls.at(-1)?.body).toMatchObject({ email: 'minh@example.vn', acceptTerms: true });
    expect(screen.getByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
  });

  it('failed: thông điệp + "Thử lại" và "Đăng nhập bằng email"', async () => {
    fakeApi({
      [PENDING]: () => ({
        status: 200,
        body: pending({
          stage: 'failed',
          error: {
            code: 'OAUTH_CANCELLED',
            message: 'Bạn chưa hoàn tất đăng nhập bằng Google.',
            actions: [{ kind: 'retry', label: 'Thử lại' }],
          },
        }),
      }),
    });
    const { container } = renderAt('/oauth/result');
    expect(await screen.findByText('Bạn chưa hoàn tất đăng nhập bằng Google.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại với Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập bằng email' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('signed_in → về trang chính; lượt hết hạn → lỗi kèm đường về đăng nhập', async () => {
    fakeApi({
      [PENDING]: () => ({ status: 200, body: pending({ stage: 'signed_in' }) }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    const first = renderAt('/oauth/result');
    await waitFor(() => {
      expect(first.router.state.location.pathname).toBe('/');
    });
    cleanup();
    fakeApi({
      [PENDING]: () => ({
        status: 400,
        body: apiError('OAUTH_FLOW_INVALID', { message: 'Phiên đăng nhập này đã hết hạn.' }),
      }),
    });
    renderAt('/oauth/result');
    expect(await screen.findByText('Phiên đăng nhập này đã hết hạn.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về đăng nhập' })).toHaveAttribute('href', '/login');
  });

  it('needs_link_confirm [password, email]: ô mật khẩu + "Gửi liên kết qua email"; sai mật khẩu báo cạnh ô', async () => {
    fakeApi({
      [PENDING]: () => ({
        status: 200,
        body: pending({
          stage: 'needs_link_confirm',
          suggestedDisplayName: null,
          suggestedEmail: 'l***@example.vn',
          methods: ['password', 'email'],
        }),
      }),
      'POST /api/v1/auth/oauth/link/password': () => ({
        status: 401,
        body: apiError('INVALID_CREDENTIALS', { message: 'Email hoặc mật khẩu chưa đúng.' }),
      }),
      'POST /api/v1/auth/oauth/link/send-email': () => ({
        status: 202,
        body: { status: 'check_email' },
      }),
    });
    const { container } = renderAt('/oauth/result');
    expect(
      await screen.findByRole('heading', { name: 'Email này đã có tài khoản' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hãy xác nhận đây là bạn/)).toBeInTheDocument();
    expect(screen.getByText(/l\*\*\*@example\.vn/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    const input = screen.getByLabelText('Mật khẩu của tài khoản');
    fireEvent.change(input, { target: { value: 'sai-mat-khau' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và liên kết Google' }));
    const message = await screen.findByText('Email hoặc mật khẩu chưa đúng.');
    // Lỗi gắn với ô nhập qua aria-describedby.
    expect(input.getAttribute('aria-describedby')).toContain(message.id);
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Gửi liên kết qua email' }));
    expect(await screen.findByRole('heading', { name: 'Hãy kiểm tra email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại' })).toBeInTheDocument();
  });

  it('needs_link_confirm [email] + hint: chỉ có nút gửi liên kết kèm gợi ý cách đã liên kết', async () => {
    fakeApi({
      [PENDING]: () => ({
        status: 200,
        body: pending({
          stage: 'needs_link_confirm',
          suggestedEmail: 'l***@example.vn',
          methods: ['email'],
          hint: 'login_with_facebook',
        }),
      }),
    });
    renderAt('/oauth/result');
    expect(
      await screen.findByRole('button', { name: 'Gửi liên kết qua email' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Mật khẩu của tài khoản')).toBeNull();
    expect(
      screen.getByText(
        'Hoặc đăng nhập bằng Facebook rồi thêm Google trong Cài đặt → Cách đăng nhập.',
      ),
    ).toBeInTheDocument();
  });
});

describe('OAuthConfirmPage', () => {
  it('đọc mã từ #token= rồi XÓA khỏi thanh địa chỉ trước khi gọi API', async () => {
    const api = fakeApi({
      'POST /api/v1/auth/oauth/confirm': () => ({ status: 200, body: me() }),
      'GET /api/v1/auth/me': () => ({ status: 200, body: me() }),
      'GET /healthz': () => ({ status: 200, body: healthy }),
    });
    window.history.replaceState(null, '', '/oauth/confirm#token=ma-mot-lan_123');
    const { router } = renderAt('/oauth/confirm');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    const call = api.calls.find((c) => c.path === '/api/v1/auth/oauth/confirm');
    expect(call?.body).toEqual({ token: 'ma-mot-lan_123' });
    expect(call?.hashAtCall).toBe('');
  });

  it('mã hỏng → lỗi + "Gửi lại" / "Về đăng nhập"', async () => {
    fakeApi({
      'POST /api/v1/auth/oauth/confirm': () => ({
        status: 400,
        body: apiError('TOKEN_INVALID', { message: 'Liên kết không còn dùng được.' }),
      }),
    });
    window.history.replaceState(null, '', '/oauth/confirm#token=hong');
    const { container } = renderAt('/oauth/confirm');
    expect(await screen.findByText('Liên kết không còn dùng được.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gửi lại' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về đăng nhập' })).toHaveAttribute('href', '/login');
    expect(await axe(container)).toHaveNoViolations();
  });
});
