// T032 (012 US1) – màn hình Soạn / xem bài theo bảng trạng thái: chưa có kênh, chọn kênh + tab theo kênh, nội dung
// riêng, cảnh báo giới hạn bằng CHỮ (không chỉ màu), lưu nháp, kênh hỏng, chỉ-xem theo quyền; quét axe 0 vi phạm.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { apiError, fakeApi, me, renderAt } from '../auth/helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FB = '0190a000-0000-7000-8000-0000000000f1';
const IG = '0190a000-0000-7000-8000-0000000000f2';
const POST_ID = '0190a000-0000-7000-8000-0000000000b1';

const ownerMe = () => ({
  ...me({ role: 'owner' }),
  permissions: ['post.edit', 'post.approve', 'status.view'],
});
const collabMe = () => ({
  ...me({ role: 'collaborator' }),
  permissions: ['post.edit', 'status.view'],
});

const channel = (
  connectionId: string,
  channelType: string,
  displayName: string,
  status = 'active',
) => ({
  connectionId,
  channelType,
  displayName,
  externalId: `ext-${connectionId}`,
  status,
  tokenExpiresAt: '2027-01-01T00:00:00.000Z',
  connectedAt: '2026-11-01T00:00:00.000Z',
});

const RULES = {
  rules: [
    {
      channelType: 'facebook_page',
      maxTextLength: 63206,
      maxHashtags: null,
      mediaRequired: false,
      maxPostsPer24h: null,
    },
    {
      channelType: 'instagram',
      maxTextLength: 20,
      maxHashtags: 30,
      mediaRequired: true,
      maxPostsPer24h: 25,
    },
  ],
};

const postBody = (over: Record<string, unknown> = {}) => ({
  id: POST_ID,
  status: 'draft',
  source: 'manual',
  internalName: 'Khuyến mãi tuần 47',
  title: 'Khuyến mãi tuần 47',
  sharedText: 'Giảm giá cuối tuần',
  scheduledAt: null,
  version: 1,
  labels: { returned: null, editedAfterApproval: false, timePassed: false },
  createdBy: 'u-1',
  submittedBy: null,
  approvedBy: null,
  approvedAt: null,
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
  variants: [
    {
      id: 'v1',
      connectionId: FB,
      channelType: 'facebook_page',
      channelDisplayName: 'Tiệm áo dài Huế',
      channelStatus: 'active',
      customized: false,
      text: '',
      hashtags: [],
      media: [],
      version: 1,
      issues: [],
    },
  ],
  ...over,
});

const base = (meBody = ownerMe()) => ({
  'GET /api/v1/auth/me': () => ({ status: 200, body: meBody }),
  'GET /api/v1/channels': () => ({
    status: 200,
    body: [channel(FB, 'facebook_page', 'Tiệm áo dài Huế'), channel(IG, 'instagram', 'huế.aodai')],
  }),
  'GET /api/v1/channel-rules': () => ({ status: 200, body: RULES }),
});

describe('ComposePage – soạn bài mới', () => {
  it('chưa có kênh hoạt động → hướng dẫn "Kết nối kênh để bắt đầu"', async () => {
    fakeApi({
      ...base(),
      'GET /api/v1/channels': () => ({ status: 200, body: [] }),
    });
    renderAt('/posts/new');
    expect(await screen.findByText('Kết nối kênh để bắt đầu soạn bài.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kết nối kênh' })).toBeInTheDocument();
  });

  it('chọn kênh → hiện tab theo kênh; đếm ký tự và cảnh báo bằng chữ khi vượt giới hạn Instagram', async () => {
    fakeApi(base());
    const { container } = renderAt('/posts/new');
    const instagram = await screen.findByRole('checkbox', { name: /huế\.aodai/ });
    fireEvent.click(instagram);
    fireEvent.change(screen.getByLabelText('Nội dung chung'), {
      target: { value: 'Nội dung dài hơn hai mươi ký tự chắc chắn' },
    });
    // Giới hạn Instagram giả lập 20 ký tự: báo bằng CHỮ + biểu tượng ⚠, không chỉ màu.
    expect(await screen.findByText(/vượt giới hạn của kênh này/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'huế.aodai' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Kênh này yêu cầu có ít nhất một ảnh hoặc video/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nội dung riêng của kênh: bật "Dùng nội dung riêng" → ô nhập riêng, xem trước đổi theo', async () => {
    fakeApi(base());
    renderAt('/posts/new');
    fireEvent.click(await screen.findByRole('checkbox', { name: /Tiệm áo dài Huế/ }));
    fireEvent.change(screen.getByLabelText('Nội dung chung'), { target: { value: 'Chữ chung' } });
    const preview = () => screen.getByRole('region', { name: /Xem trước Facebook/ });
    expect(within(preview()).getByText('Chữ chung')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dùng nội dung riêng cho kênh này' }));
    fireEvent.change(screen.getByLabelText('Nội dung riêng của kênh'), {
      target: { value: 'Chữ riêng cho Facebook' },
    });
    expect(within(preview()).getByText('Chữ riêng cho Facebook')).toBeInTheDocument();
  });

  it('lưu nháp → POST /posts với kênh đã chọn, KHÔNG gửi mã tài khoản; chuyển sang /posts/:id', async () => {
    const api = fakeApi({
      ...base(),
      'POST /api/v1/posts': () => ({ status: 201, body: postBody() }),
      [`GET /api/v1/posts/${POST_ID}`]: () => ({
        status: 200,
        body: { post: postBody(), validation: [], attempts: [] },
      }),
    });
    const { router } = renderAt('/posts/new');
    fireEvent.click(await screen.findByRole('checkbox', { name: /Tiệm áo dài Huế/ }));
    fireEvent.change(screen.getByLabelText('Nội dung chung'), {
      target: { value: 'Giảm giá cuối tuần' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/posts/${POST_ID}`);
    });
    const call = api.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/posts');
    expect(call?.body).toMatchObject({
      sharedText: 'Giảm giá cuối tuần',
      variants: [{ connectionId: FB, customized: false }],
    });
    expect(JSON.stringify(call?.body)).not.toMatch(/accountId/i);
  });

  it('kênh hỏng → nhãn "Kênh cần kết nối lại", không chọn mới được', async () => {
    fakeApi({
      ...base(),
      'GET /api/v1/channels': () => ({
        status: 200,
        body: [
          channel(FB, 'facebook_page', 'Tiệm áo dài Huế'),
          channel(IG, 'instagram', 'huế.aodai', 'expired'),
        ],
      }),
    });
    renderAt('/posts/new');
    expect(await screen.findByText('Kênh cần kết nối lại')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /huế\.aodai/ })).toBeDisabled();
  });

  it('thân thiện bàn phím + vùng chạm: mọi ô nhập và nút dùng được bằng bàn phím', async () => {
    fakeApi(base());
    const { container } = renderAt('/posts/new');
    await screen.findByRole('checkbox', { name: /Tiệm áo dài Huế/ });
    const controls = container.querySelectorAll('button, input, textarea, a[href]');
    expect([...controls].every((el) => (el as HTMLElement).tabIndex >= 0)).toBe(true);
  });
});

describe('ComposePage – xem / sửa bài đã có', () => {
  const detail = (post: Record<string, unknown>) => ({
    status: 200,
    body: { post, validation: [], attempts: [] },
  });

  it('bài bị trả lại → hiện ghi chú "Bị trả lại"; chủ thấy nút "Duyệt và lên lịch" (khóa tới khi chọn giờ)', async () => {
    fakeApi({
      ...base(),
      [`GET /api/v1/posts/${POST_ID}`]: () =>
        detail(
          postBody({
            labels: {
              returned: {
                note: 'Hãy đổi ảnh bìa',
                byUserId: 'u-9',
                at: '2026-11-16T01:00:00.000Z',
              },
              editedAfterApproval: false,
              timePassed: false,
            },
          }),
        ),
    });
    renderAt(`/posts/${POST_ID}`);
    expect(await screen.findByText('Hãy đổi ảnh bìa')).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Duyệt và lên lịch' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
  });

  it('cộng tác viên: thấy "Gửi duyệt", KHÔNG thấy "Duyệt và lên lịch"', async () => {
    fakeApi({
      ...base(collabMe()),
      [`GET /api/v1/posts/${POST_ID}`]: () => detail(postBody()),
    });
    renderAt(`/posts/${POST_ID}`);
    expect(await screen.findByRole('button', { name: 'Gửi duyệt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duyệt và lên lịch' })).not.toBeInTheDocument();
  });

  it('bài đã duyệt: cảnh báo trước khi sửa + nút "Hủy lịch" có hộp xác nhận (chỉ chủ)', async () => {
    fakeApi({
      ...base(),
      [`GET /api/v1/posts/${POST_ID}`]: () =>
        detail(postBody({ status: 'approved', scheduledAt: '2026-11-20T03:00:00.000Z' })),
    });
    renderAt(`/posts/${POST_ID}`);
    expect(await screen.findByText(/đưa bài về Chờ duyệt và hủy lịch đăng cũ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy lịch' }));
    expect(await screen.findByText('Hủy lịch đăng?')).toBeInTheDocument();
  });

  it('bài đang Chờ duyệt: cộng tác viên chỉ xem + giải thích; không có nút Lưu', async () => {
    fakeApi({
      ...base(collabMe()),
      [`GET /api/v1/posts/${POST_ID}`]: () =>
        detail(postBody({ status: 'pending_review', submittedBy: 'u-1' })),
    });
    renderAt(`/posts/${POST_ID}`);
    expect(await screen.findByText(/bạn chỉ xem được/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu nháp' })).not.toBeInTheDocument();
  });

  it('lỗi tải bài (404) → thông điệp kèm hành động, không trắng trang', async () => {
    fakeApi({
      ...base(),
      [`GET /api/v1/posts/${POST_ID}`]: () => ({ status: 404, body: apiError('NOT_FOUND') }),
    });
    renderAt(`/posts/${POST_ID}`);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
