// 013 – (T042) mẫu thông báo "bài cần xử lý/cần kiểm tra"; (T046) ánh xạ lỗi có hiệu lực không cần phát hành, mã lạ giữ
// `unknown`; (SC-009) luồng đăng chính KHÔNG biết tên nền tảng cụ thể nên thêm nền tảng không sửa nó.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationEventSchema } from '@app/shared/notifications';
import { describe, expect, it } from 'vitest';
import { render } from '../../src/modules/notifications/internal/templates';
import type { ClassifiedError } from '../../src/modules/platform_gateway';
import {
  ERROR_MAPPING_CACHE_MS,
  ErrorMappingService,
  type MappingEntry,
} from '../../src/modules/publishing/internal/error-mapping.service';

const id = (n: number) => `0190a000-0000-7000-8000-00000000000${String(n)}`;
const base = (state: 'needs_user' | 'needs_check', reason?: string) =>
  NotificationEventSchema.parse({
    type: 'publish_needs_action',
    refs: {
      attemptId: id(1),
      postId: id(2),
      authorUserId: id(3),
      state,
      channelType: 'facebook_page',
      ...(reason !== undefined ? { reason } : {}),
    },
    params: { postTitle: 'Khuyến mãi cuối tuần', channelDisplayName: 'Cửa hàng Hoa Mai' },
  });

describe('mẫu thông báo bài cần xử lý (T042)', () => {
  it('sự kiện cũ (không channelType/reason) vẫn hợp lệ', () => {
    expect(() =>
      NotificationEventSchema.parse({
        type: 'publish_needs_action',
        refs: { attemptId: id(1), postId: id(2), authorUserId: id(3), state: 'needs_user' },
      }),
    ).not.toThrow();
  });

  it('nêu tên bài + kênh, có hành động mở Tiến trình đăng của bài, KHÔNG có số tiền AI', () => {
    for (const [state, reason] of [
      ['needs_user', 'token_expired'],
      ['needs_user', 'overdue'],
      ['needs_user', 'retries_exhausted'],
      ['needs_check', 'uncertain_result'],
    ] as const) {
      const out = render(base(state, reason), 'https://app.test');
      expect(out.bodyVi, reason).toContain('Khuyến mãi cuối tuần');
      expect(out.bodyVi, reason).toContain('Cửa hàng Hoa Mai');
      expect(out.actions.length).toBeGreaterThanOrEqual(1);
      expect(out.actions[0]?.url).toBe(`https://app.test/posts/${id(2)}/progress`);
      expect(`${out.titleVi} ${out.bodyVi}`).not.toMatch(/USD|\$|đô la|micro/i);
    }
  });

  it('lý do quá giờ / hết lượt thử có lời giải thích riêng; cần kiểm tra nhắc "Đã đăng" hoặc "Đăng lại"', () => {
    expect(render(base('needs_user', 'overdue'), 'https://a.test').bodyVi).toContain('quá giờ hẹn');
    expect(render(base('needs_user', 'retries_exhausted'), 'https://a.test').bodyVi).toContain(
      'thử lại nhiều lần',
    );
    const check = render(base('needs_check'), 'https://a.test');
    expect(check.bodyVi).toContain('Đã đăng');
    expect(check.bodyVi).toContain('Đăng lại');
  });

  it('mã lý do và loại kênh ngoài danh sách bị từ chối (khuôn đóng)', () => {
    expect(() => base('needs_user', 'bí-mật-gì-đó')).toThrow();
  });
});

describe('ánh xạ lỗi (T017/T046)', () => {
  const unknownErr = (rawCode: string): ClassifiedError => ({
    category: 'unknown',
    rawCode,
    channelType: 'facebook_page',
    messageVi: 'Chưa rõ.',
    remedies: [{ action: 'check_on_platform', labelVi: 'Kiểm tra trên trang' }],
  });
  const row = (over: Partial<MappingEntry> = {}): MappingEntry => ({
    channelType: 'facebook_page',
    rawCode: 'FB:190',
    category: 'user_action',
    messageVi: 'Kết nối đã hết hạn.',
    remedies: [{ action: 'reconnect', labelVi: 'Kết nối lại' }],
    needsReason: 'token_expired',
    retryAfterSec: null,
    ...over,
  });

  it('mã có dòng → thay thông điệp/cách sửa/loại; mã lạ → giữ nguyên unknown (không bao giờ tạm thời)', async () => {
    const svc = new ErrorMappingService();
    svc.loader = () => Promise.resolve([row()]);
    const mapped = await svc.map(unknownErr('FB:190'));
    expect(mapped).toMatchObject({
      needsReason: 'token_expired',
      error: { category: 'user_action', messageVi: 'Kết nối đã hết hạn.' },
    });
    const strange = await svc.map(unknownErr('ZZZ:1'));
    expect(strange.error.category).toBe('unknown');
    expect(strange.needsReason).toBeNull();
    // Cùng mã nhưng KHÁC kênh thì không áp dụng.
    const other = await svc.map({ ...unknownErr('FB:190'), channelType: 'instagram' });
    expect(other.error.category).toBe('unknown');
  });

  it('dòng ánh xạ mới có hiệu lực sau tối đa 5 phút (cache), hoặc ngay khi bỏ cache – không cần phát hành', async () => {
    let clock = 1_000;
    let rows: MappingEntry[] = [];
    let loads = 0;
    const svc = new ErrorMappingService();
    svc.now = () => clock;
    svc.loader = () => {
      loads++;
      return Promise.resolve(rows);
    };
    expect((await svc.map(unknownErr('FB:555'))).error.category).toBe('unknown');
    rows = [row({ rawCode: 'FB:555', messageVi: 'Mới thêm' })];
    clock += ERROR_MAPPING_CACHE_MS - 1; // vẫn trong hạn cache
    expect((await svc.map(unknownErr('FB:555'))).error.category).toBe('unknown');
    expect(loads).toBe(1);
    clock += 2; // hết hạn cache
    expect((await svc.map(unknownErr('FB:555'))).error).toMatchObject({
      category: 'user_action',
      messageVi: 'Mới thêm',
    });
    svc.invalidate();
    expect(loads).toBe(2);
  });

  it('dòng transient mang retryAfterSec của bảng', async () => {
    const svc = new ErrorMappingService();
    svc.loader = () =>
      Promise.resolve([
        row({ rawCode: 'FB:4', category: 'transient', needsReason: null, retryAfterSec: 600 }),
      ]);
    expect((await svc.map(unknownErr('FB:4'))).error).toMatchObject({
      category: 'transient',
      retryAfterSec: 600,
    });
  });
});

describe('SC-009: luồng đăng chính không rẽ nhánh theo tên nền tảng', () => {
  const root = join(__dirname, '..', '..', 'src', 'modules', 'publishing');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

  it('bộ thực thi, nhật ký bước, đối soát, thông báo không chứa tên nền tảng cụ thể', () => {
    const core = walk(join(root, 'internal', 'executor')).concat(
      join(root, 'internal', 'step-log.ts'),
      join(root, 'internal', 'state-machine.ts'),
      join(root, 'internal', 'retry-policy.ts'),
    );
    for (const file of core) {
      const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, file).not.toMatch(/['"`](facebook_page|instagram|zalo_oa)['"`]/);
      expect(src, file).not.toMatch(/\bfacebook\b|\binstagram\b/i);
    }
  });
});
