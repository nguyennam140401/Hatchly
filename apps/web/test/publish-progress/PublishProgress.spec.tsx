// T055 (013 US5) – Tiến trình đăng: lượt lỗi ở bước 2 (bước 1 xong, bước 2 lỗi kèm giải thích + cách sửa, bước 3–5 chưa chạy),
// nút theo `allowedActions` do máy chủ lọc, "Chi tiết cho hỗ trợ" thu gọn, trạng thái bằng chữ + biểu tượng, Đăng lại có
// xác nhận + cảnh báo đăng trùng từ "Cần kiểm tra", xử lý 409; chu kỳ thăm dò; quét axe 0 vi phạm.
import type { ChannelProgressView, PublishProgressView, StepView } from '@app/shared/publishing';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { nextPollMs } from '../../src/features/publish-progress/usePublishProgress';
import { stepRowProps } from '../../src/features/publish-progress/StepTimeline';
import { apiError, fakeApi, me, renderAt } from '../auth/helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const POST = '0190a000-0000-7000-8000-0000000000e1';
const ATTEMPT = '0190a000-0000-7000-8000-0000000000f1';

const ownerMe = () => ({
  ...me({ role: 'owner' }),
  permissions: ['post.edit', 'post.republish', 'status.view'],
});
const collabMe = () => ({
  ...me({ role: 'collaborator' }),
  permissions: ['post.edit', 'post.republish', 'status.view'],
});

const KEYS = ['precheck', 'prepare_media', 'submit', 'await_processing', 'confirm'] as const;
const steps = (
  states: StepView['state'][],
  extra: Partial<Record<number, Partial<StepView>>> = {},
) =>
  KEYS.map((key, i): StepView => ({
    stepNo: (i + 1) as StepView['stepNo'],
    key,
    state: states[i] ?? 'not_run',
    at: states[i] === undefined || states[i] === 'not_run' ? null : '2026-11-20T02:00:00.000Z',
    note: null,
    messageVi: null,
    remedies: [],
    ...extra[i],
  }));

const channel = (over: Partial<ChannelProgressView> = {}): ChannelProgressView => ({
  attemptId: ATTEMPT,
  channelType: 'facebook_page',
  displayName: 'Cửa hàng Hoa Mai',
  status: 'needs_action',
  needsKind: 'needs_user',
  scheduledAt: '2026-11-20T02:00:00.000Z',
  permalink: null,
  message: 'Ảnh không phù hợp với Facebook.',
  remedies: [{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }],
  allowedActions: ['edit_media', 'republish', 'contact_support'],
  version: 3,
  steps: steps(['succeeded', 'failed', 'skipped', 'skipped', 'skipped'], {
    1: {
      messageVi: 'Ảnh không phù hợp với Facebook.',
      remedies: [{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }],
    },
  }),
  ...over,
});

const view = (c: ChannelProgressView[]): PublishProgressView => ({
  postId: POST,
  overall: c[0]?.status ?? null,
  channels: c,
});

const routes = (progress: PublishProgressView, meBody = ownerMe()) => ({
  'GET /api/v1/auth/me': () => ({ status: 200, body: meBody }),
  [`GET /api/v1/posts/${POST}/publish-progress`]: () => ({ status: 200, body: progress }),
  [`GET /api/v1/publish-attempts/${ATTEMPT}/support-details`]: () => ({
    status: 200,
    body: {
      attemptId: ATTEMPT,
      channelType: 'facebook_page',
      rawCode: 'FB:100',
      errorCategoryLabel: 'Cần người dùng xử lý',
      traceId: 'trace-abc',
      runNo: 1,
      updatedAt: '2026-11-20T02:01:00.000Z',
    },
  }),
});

describe('Tiến trình đăng', () => {
  it('lượt lỗi ở bước 2: trạng thái bằng chữ, bước 1 xong, bước 2 lỗi kèm cách sửa, bước 3–5 chưa chạy; 0 vi phạm axe', async () => {
    fakeApi(routes(view([channel()])));
    const { container } = renderAt(`/posts/${POST}/progress`);

    expect(await screen.findByText('Cần bạn xử lý')).toBeInTheDocument(); // chữ, không chỉ màu
    expect(
      screen.getByRole('heading', { name: /Facebook – Cửa hàng Hoa Mai/ }),
    ).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /Các bước đăng lên/ });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('1. Kiểm tra');
    expect(items[0]).toHaveTextContent('Xong');
    expect(items[1]).toHaveTextContent('Lỗi');
    expect(items[1]).toHaveTextContent('Ảnh không phù hợp với Facebook.');
    expect(items[1]).toHaveTextContent('Chọn ảnh khác');
    for (const i of [2, 3, 4])
      expect(items[i]).toHaveTextContent('Chưa chạy vì bước trước chưa xong');

    expect(screen.getByRole('button', { name: 'Đăng lại' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đã đăng' })).not.toBeInTheDocument();
    // Mã lỗi gốc KHÔNG hiện ở màn hình chính; "Chi tiết cho hỗ trợ" thu gọn.
    expect(screen.queryByText('FB:100')).toBeNull();
    const details = screen.getByText('Chi tiết cho hỗ trợ').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('mở "Chi tiết cho hỗ trợ" mới gọi API và hiện mã lỗi gốc + mã theo dõi', async () => {
    const api = fakeApi(routes(view([channel()])));
    renderAt(`/posts/${POST}/progress`);
    const summary = await screen.findByText('Chi tiết cho hỗ trợ');
    expect(api.calls.some((c) => c.path.endsWith('/support-details'))).toBe(false);
    const details = summary.closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByText('FB:100')).toBeInTheDocument();
    expect(screen.getByText('trace-abc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi cho hỗ trợ' })).toBeInTheDocument();
  });

  it('cộng tác viên: "Nhờ chủ tài khoản kết nối lại", không có nút Kết nối lại', async () => {
    fakeApi(
      routes(
        view([
          channel({
            allowedActions: ['ask_owner_to_reconnect', 'republish', 'contact_support'],
            message: 'Quyền đăng bài đã hết hạn.',
            remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại Trang' }],
          }),
        ]),
        collabMe(),
      ),
    );
    renderAt(`/posts/${POST}/progress`);
    expect(await screen.findByText(/Nhờ chủ tài khoản kết nối lại/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kết nối lại' })).not.toBeInTheDocument();
  });

  it('chủ: "Kết nối lại" đi tới màn hình Kênh', async () => {
    fakeApi(routes(view([channel({ allowedActions: ['reconnect', 'republish'] })])));
    renderAt(`/posts/${POST}/progress`);
    const link = await screen.findByRole('link', { name: 'Kết nối lại' });
    expect(link).toHaveAttribute('href', '/channels');
  });

  it('"Cần kiểm tra": có "Đã đăng" + "Đăng lại"; Đăng lại hỏi xác nhận kèm cảnh báo đăng trùng rồi gửi phiên bản', async () => {
    const api = fakeApi({
      ...routes(
        view([
          channel({
            needsKind: 'needs_check',
            message: null,
            remedies: [],
            allowedActions: ['mark_published', 'republish', 'contact_support'],
            steps: steps(['succeeded', 'not_applicable', 'succeeded', 'not_applicable', 'failed']),
          }),
        ]),
      ),
      [`POST /api/v1/publish-attempts/${ATTEMPT}/republish`]: () => ({
        status: 200,
        body: { attemptId: ATTEMPT, status: 'scheduled', warning: 'possible_duplicate' },
      }),
    });
    renderAt(`/posts/${POST}/progress`);
    expect(await screen.findByText('Chưa rõ bài đã lên hay chưa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đã đăng' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đăng lại' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/đăng trùng/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đăng lại' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ version: 3 });
    });
  });

  it('"Đã đăng" gửi phiên bản (+ đường dẫn nếu có)', async () => {
    const api = fakeApi({
      ...routes(
        view([
          channel({
            needsKind: 'needs_check',
            allowedActions: ['mark_published', 'republish'],
          }),
        ]),
      ),
      [`POST /api/v1/publish-attempts/${ATTEMPT}/mark-published`]: () => ({
        status: 200,
        body: { attemptId: ATTEMPT, status: 'published', permalink: null },
      }),
    });
    renderAt(`/posts/${POST}/progress`);
    fireEvent.click(await screen.findByRole('button', { name: 'Đã đăng' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Đường dẫn bài/), {
      target: { value: 'https://facebook.com/p/1' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận đã đăng' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        version: 3,
        permalink: 'https://facebook.com/p/1',
      });
    });
  });

  it('409 phiên bản lệch → hiện lỗi có cách xử lý và tải lại tiến trình', async () => {
    let gets = 0;
    const api = fakeApi({
      ...routes(view([channel()])),
      [`GET /api/v1/posts/${POST}/publish-progress`]: () => {
        gets++;
        return { status: 200, body: view([channel()]) };
      },
      [`POST /api/v1/publish-attempts/${ATTEMPT}/republish`]: () => ({
        status: 409,
        body: apiError('PUBLISH_VERSION_CONFLICT'),
      }),
    });
    renderAt(`/posts/${POST}/progress`);
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng lại' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đăng lại' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => {
      expect(gets).toBeGreaterThanOrEqual(2);
    });
    expect(api.calls.some((c) => c.method === 'POST')).toBe(true);
  });

  it('đã đăng: có liên kết xem bài và không có nút Đăng lại', async () => {
    fakeApi(
      routes(
        view([
          channel({
            status: 'published',
            needsKind: null,
            message: null,
            remedies: [],
            permalink: 'https://facebook.com/p/1',
            allowedActions: [],
            steps: steps([
              'succeeded',
              'not_applicable',
              'succeeded',
              'not_applicable',
              'succeeded',
            ]),
          }),
        ]),
      ),
    );
    renderAt(`/posts/${POST}/progress`);
    expect(await screen.findByText('Đã đăng')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem bài đã đăng' })).toHaveAttribute(
      'href',
      'https://facebook.com/p/1',
    );
    expect(screen.queryByRole('button', { name: 'Đăng lại' })).not.toBeInTheDocument();
  });

  it('bài chưa có lượt đăng → trạng thái trống có giải thích', async () => {
    fakeApi(routes({ postId: POST, overall: null, channels: [] }));
    renderAt(`/posts/${POST}/progress`);
    expect(await screen.findByText(/chưa được lên lịch đăng/)).toBeInTheDocument();
  });
});

describe('thăm dò và ánh xạ bước', () => {
  const v = (status: ChannelProgressView['status']): PublishProgressView =>
    view([channel({ status })]);

  it('hỏi mỗi 5 giây khi còn lượt đang chạy, giãn dần tới tối đa 30 giây, dừng khi không còn lượt chạy', () => {
    expect(nextPollMs(undefined, 0)).toBe(5000);
    expect(nextPollMs(v('publishing'), 1)).toBe(5000);
    expect(nextPollMs(v('scheduled'), 11)).toBe(5000);
    expect(nextPollMs(v('publishing'), 12)).toBe(10_000);
    expect(nextPollMs(v('publishing'), 500)).toBe(30_000);
    for (const done of ['published', 'needs_action', 'cancelled'] as const) {
      expect(nextPollMs(v(done), 3)).toBe(false);
    }
  });

  it('bước hiển thị: đang chạy = chữ "Đang xử lý", không áp dụng = xong có ghi chú', () => {
    expect(stepRowProps(steps(['running'])[0]!)).toMatchObject({
      state: 'pending',
      running: true,
    });
    const na = stepRowProps(steps(['succeeded', 'not_applicable'])[1]!);
    expect(na).toMatchObject({ state: 'done', explanation: 'Không áp dụng cho kênh này' });
  });
});
