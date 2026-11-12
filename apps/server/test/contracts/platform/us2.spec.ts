import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { CHANNEL_TYPES, ChannelNotSupportedError } from '../../../src/modules/platform_gateway';
import type { PlatformAdapter } from '../../../src/modules/platform_gateway/internal/adapters/adapter';
import {
  getAdapter,
  listRegisteredAdapters,
  registerAdapter,
} from '../../../src/modules/platform_gateway/internal/adapters/registry';
import { FAKE_CHANNELS } from '../../../src/modules/platform_gateway/internal/fake/channels';
import { describePlatformAdapterContract } from './adapter.contract';
import { makePlatformHarness, type PlatformHarness } from './harness';
import { samplePublishFlow } from './sample-publish-flow';

// 005 US2 (T045–T047): thêm nền tảng = thêm bộ chuyển đổi; luồng gọi rẽ nhánh theo năng lực; kết quả
// lạ của bộ chuyển đổi → unknown; loại kênh chưa đăng ký → ChannelNotSupportedError.

let h: PlatformHarness;
beforeAll(async () => {
  h = await makePlatformHarness('memory', { a: uuidV7(), b: uuidV7() });
});

describe('T045 – luồng gọi mẫu chạy cho MỌI bộ chuyển đổi đã đăng ký', () => {
  it('danh sách kênh của bộ hợp đồng khớp registry (kênh mới không lọt kiểm thử)', () => {
    expect(
      listRegisteredAdapters()
        .map((a) => a.channelType)
        .sort(),
    ).toEqual([...CHANNEL_TYPES].sort());
  });

  it('tệp luồng mẫu không chứa tên nền tảng nào (SC-002)', () => {
    const src = readFileSync(resolve(__dirname, 'sample-publish-flow.ts'), 'utf8');
    expect(src).not.toMatch(/facebook_page|instagram|zalo_oa|test_channel/);
  });

  it('published / processing / unknown → reconcile hoặc "Cần kiểm tra" theo năng lực', async () => {
    await h.as(h.a, async () => {
      const g = h.gateway(100);
      for (const adapter of listRegisteredAdapters()) {
        const id = await h.createConnection(adapter.channelType);
        const ok = await samplePublishFlow(g, {
          connectionId: id,
          text: `a ${id}`,
          sentAt: new Date(),
        });
        expect(ok.kind, adapter.channelType).toBe('published');

        await h.script(`connection:${id}`, [{ submit: 'processing_then_done' }]);
        const proc = await samplePublishFlow(g, {
          connectionId: id,
          text: `b ${id}`,
          sentAt: new Date(),
        });
        expect(proc.kind, adapter.channelType).toBe('published');

        await h.script(`connection:${id}`, [{ submit: 'timeout_after_publish' }]);
        const unknown = await samplePublishFlow(g, {
          connectionId: id,
          text: `c ${id}`,
          sentAt: new Date(),
        });
        expect(unknown.kind, adapter.channelType).toBe(
          adapter.capabilities.reconcile ? 'published' : 'needs_check',
        );
      }
    });
  });

  it('test_channel chỉ khác ở năng lực + quy tắc media (chỉ PNG, tối đa 1)', () => {
    const spec = FAKE_CHANNELS.test_channel!;
    expect(spec.mediaRules.maxItems).toBe(1);
    expect(spec.mediaRules.image?.formats).toEqual(['png']);
    expect(Object.values(spec.capabilities).filter((v) => v === true)).toEqual([]);
  });
});

/** Bộ chuyển đổi "hỏng" cố ý: thiếu thao tác và trả `kind` ngoài danh sách. */
function brokenAdapter(base: PlatformAdapter = getAdapter('facebook_page')): PlatformAdapter {
  const broken = Object.create(base) as PlatformAdapter & Record<string, unknown>;
  broken.submit = () => Promise.resolve({ kind: 'maybe_published' } as never);
  broken.checkStatus = () => Promise.resolve({ kind: 'weird' } as never);
  broken.reconcile = () => Promise.resolve({ kind: 'found' } as never);
  return broken;
}

describe('T046 – kết quả lạ của bộ chuyển đổi', () => {
  it('tầng cổng biến kết quả lạ thành failed/unknown, unsupported và ghi platform.unexpected_result', async () => {
    const original = getAdapter('facebook_page');
    registerAdapter('facebook_page', () => brokenAdapter(original));
    try {
      await h.as(h.a, async () => {
        const g = h.gateway();
        const id = await h.createConnection('facebook_page');
        const t = 'bài thử';
        expect(
          await g.submit({
            connectionId: id,
            text: t,
            media: [],
            contentHash: g.contentHash('facebook_page', t),
          }),
        ).toMatchObject({
          kind: 'failed',
          error: { category: 'unknown', rawCode: 'UNEXPECTED_RESULT' },
        });
        expect(await g.checkStatus(id, 'p')).toMatchObject({
          kind: 'failed',
          error: { category: 'unknown' },
        });
        expect(
          await g.reconcile({
            connectionId: id,
            contentHash: 'ch1:x',
            from: new Date(Date.now() - 1000),
            to: new Date(),
          }),
        ).toEqual({ kind: 'unsupported', reason: 'platform_unavailable' });
      });
      expect(h.logText()).toContain('platform.unexpected_result');
    } finally {
      registerAdapter('facebook_page', () => original);
    }
  });

  describe('bộ hợp đồng adapter bắt được bộ chuyển đổi hỏng', () => {
    // Chạy bộ hợp đồng trên bộ chuyển đổi hỏng và kỳ vọng nó THẤT BẠI.
    it.fails('submit trả kind lạ → hợp đồng thất bại', async () => {
      const { SubmitResultShape } =
        await import('../../../src/modules/platform_gateway/internal/adapters/result-shapes');
      const r = await brokenAdapter().submit({} as never, {} as never);
      expect(SubmitResultShape.safeParse(r).success).toBe(true);
    });
  });
});

describe('T047 – loại kênh chưa có bộ chuyển đổi', () => {
  it('mọi thao tác ném ChannelNotSupportedError, không hành vi mặc định ngầm', async () => {
    const g = h.gateway();
    expect(() => g.capabilities('nen_tang_moi' as never)).toThrow(ChannelNotSupportedError);
    expect(() => g.contentHash('nen_tang_moi' as never, 'x')).toThrow(ChannelNotSupportedError);
    expect(() => g.classifyError('nen_tang_moi' as never, 'x')).toThrow(ChannelNotSupportedError);
    await h.as(h.a, async () => {
      const id = await h.createConnection('nen_tang_moi' as never);
      await expect(g.checkAccount(id)).rejects.toBeInstanceOf(ChannelNotSupportedError);
      await expect(g.mediaRules(id)).rejects.toBeInstanceOf(ChannelNotSupportedError);
    });
    expect(new ChannelNotSupportedError().message).toBe('Kênh này chưa được hỗ trợ');
  });
});

// Dùng lại bộ hợp đồng adapter cho test_channel trong tệp này cũng được – đảm bảo kênh mới qua cùng bộ.
describe('T048 – test_channel qua cùng bộ hợp đồng', () => {
  describePlatformAdapterContract(
    () => getAdapter('test_channel'),
    () => h,
  );
});
