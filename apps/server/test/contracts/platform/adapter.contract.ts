import { describe, expect, it } from 'vitest';
import {
  ADAPTER_OPERATIONS,
  type PlatformAdapter,
} from '../../../src/modules/platform_gateway/internal/adapters/adapter';
import {
  AccountCheckShape,
  CheckStatusResultShape,
  ClassifiedErrorShape,
  ExpiryInfoShape,
  ReconcileResultShape,
  RefreshTokenShape,
  SubmitResultShape,
} from '../../../src/modules/platform_gateway/internal/adapters/result-shapes';
import {
  FakeCredentialVault,
  newFakeToken,
} from '../../../src/modules/platform_gateway/internal/vault/credential-vault';
import type { PlatformHarness } from './harness';

const TEST_AAD = 'contract-test-aad';

// Bộ kiểm thử hợp đồng BỘ CHUYỂN ĐỔI (005, contracts/platform-gateway.md mục 5) – chạy cho MỌI bộ chuyển
// đổi trong listRegisteredAdapters(): kênh mới đăng ký tự được kiểm (SC-002).

const vault = new FakeCredentialVault();

export function describePlatformAdapterContract(
  getAdapter: () => PlatformAdapter,
  harness: () => PlatformHarness,
): void {
  const label = () => getAdapter().channelType;

  describe('bộ chuyển đổi', () => {
    it('đủ 7 thao tác ADR-05 + dấu nội dung + luồng kết nối', () => {
      const adapter = getAdapter();
      for (const op of ADAPTER_OPERATIONS) {
        expect(typeof (adapter as unknown as Record<string, unknown>)[op], `${label()}.${op}`).toBe(
          'function',
        );
      }
      expect(adapter.capabilities).toEqual(
        expect.objectContaining({
          reconcile: expect.any(Boolean) as unknown,
          asyncProcessing: expect.any(Boolean) as unknown,
          tokenRefresh: expect.any(Boolean) as unknown,
          reportsQuota: expect.any(Boolean) as unknown,
        }),
      );
    });

    it('contentHash: tiền tố ch1:, "đổi nhẹ" → cùng dấu, khác thật → khác dấu', () => {
      const h = (t: string) => getAdapter().contentHash(t);
      const base = 'Khai trương quán Gió! Ghé https://example.vn/menu?id=1 nhé';
      expect(h(base)).toMatch(/^ch1:[0-9a-f]{64}$/);
      expect(h(base.replace('https://example.vn/menu?id=1', 'https://fb.me/abc'))).toBe(h(base));
      expect(h(base.normalize('NFD'))).toBe(h(base));
      expect(h(`  ${base.replace(/ /g, '   ')}\n`)).toBe(h(base));
      expect(h(base.replace('Gió', 'G\u200Bió'))).toBe(h(base));
      expect(h(base.replace(/ /g, '\u00A0'))).toBe(h(base));
      expect(h(base.replace('Gió', 'GIÓ'))).not.toBe(h(base));
      expect(h(base.replace('Gió', 'Mây'))).not.toBe(h(base));
    });

    it('classifyError: mã lạ → unknown có cách khắc phục; rawCode đã lọc', () => {
      const e = getAdapter().classifyError('LẠ <script>/../' + 'x'.repeat(100));
      expect(ClassifiedErrorShape.safeParse(e).success).toBe(true);
      expect(e.category).toBe('unknown');
      expect(e.remedies.length).toBeGreaterThanOrEqual(1);
      expect(e.rawCode).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
      expect(e.channelType).toBe(label());
    });

    it('mọi thao tác trả kết quả thuộc khuôn hợp đóng', async () => {
      const h = harness();
      const adapter = getAdapter();
      await h.as(h.a, async () => {
        const connectionId = await h.createConnection(adapter.channelType);
        const cred = await vault.decrypt(await vault.encrypt(newFakeToken(), TEST_AAD), TEST_AAD);
        const ctx = { connectionId };
        expect(AccountCheckShape.safeParse(await adapter.checkAccount(cred, ctx)).success).toBe(
          true,
        );
        const text = `Bài thử ${connectionId}`;
        const submitted = await adapter.submit(cred, {
          text,
          media: [],
          contentHash: adapter.contentHash(text),
          connectionId,
          signal: new AbortController().signal,
        });
        expect(SubmitResultShape.safeParse(submitted).success).toBe(true);
        expect(
          CheckStatusResultShape.safeParse(await adapter.checkStatus(cred, 'proc_khong_co', ctx))
            .success,
        ).toBe(true);
        const rec = await adapter.reconcile(cred, {
          connectionId,
          contentHash: adapter.contentHash(text),
          from: new Date(Date.now() - 3_600_000),
          to: new Date(Date.now() + 60_000),
        });
        expect(ReconcileResultShape.safeParse(rec).success).toBe(true);
        expect(RefreshTokenShape.safeParse(await adapter.refreshToken(cred, ctx)).success).toBe(
          true,
        );
        const rules = adapter.mediaRules();
        expect(rules.maxItems).toBeGreaterThan(0);
        expect(adapter.authorizeUrl('st', 'http://app.test/cb')).toContain('st');
      });
    });

    it('capabilities.reconcile = false → reconcile luôn unsupported', async () => {
      const adapter = getAdapter();
      if (adapter.capabilities.reconcile) return;
      const h = harness();
      await h.as(h.a, async () => {
        const cred = await vault.decrypt(await vault.encrypt(newFakeToken(), TEST_AAD), TEST_AAD);
        expect(
          await adapter.reconcile(cred, {
            connectionId: '00000000-0000-7000-8000-000000000000',
            contentHash: 'ch1:x',
            from: new Date(),
            to: new Date(),
          }),
        ).toMatchObject({ kind: 'unsupported' });
      });
    });

    // ----- 010: thu hồi quyền, hạn, địa chỉ ủy quyền -----
    it('010 revoke: không bao giờ ném, trả done|failed|unsupported', async () => {
      const h = harness();
      const adapter = getAdapter();
      await h.as(h.a, async () => {
        const connectionId = await h.createConnection(adapter.channelType);
        const cred = await vault.decrypt(await vault.encrypt(newFakeToken(), TEST_AAD), TEST_AAD);
        const result = await adapter.revoke(cred, { connectionId });
        expect(['done', 'failed', 'unsupported']).toContain(result);
      });
    });

    it('010 expiryOf: trả đúng một trong ba dạng hợp lệ (none | token | data_access)', async () => {
      const h = harness();
      const adapter = getAdapter();
      await h.as(h.a, async () => {
        const connectionId = await h.createConnection(adapter.channelType);
        const cred = await vault.decrypt(await vault.encrypt(newFakeToken(), TEST_AAD), TEST_AAD);
        const expiry = await adapter.expiryOf(cred, { connectionId });
        expect(ExpiryInfoShape.safeParse(expiry).success).toBe(true);
        // Bản giả điều khiển được bằng kịch bản: ép đủ ba dạng.
        if (adapter.constructor.name === 'FakePlatformAdapter') {
          for (const kind of ['none', 'token', 'data_access'] as const) {
            await h.script(`connection:${connectionId}`, [{ expiry: kind }]);
            expect((await adapter.expiryOf(cred, { connectionId })).kind).toBe(kind);
          }
        }
      });
    });

    it('010 authorizeUrl: không chứa bí mật ứng dụng', () => {
      const url = getAdapter().authorizeUrl('st', 'http://app.test/cb');
      expect(url).not.toMatch(/client_secret|app_secret|fb_exchange_token|access_token/i);
    });

    it('010 checkAccount hợp lệ: `expiry` nếu có thì đúng khuôn và nhất quán với tokenExpiresAt', async () => {
      const h = harness();
      const adapter = getAdapter();
      await h.as(h.a, async () => {
        const connectionId = await h.createConnection(adapter.channelType);
        const cred = await vault.decrypt(await vault.encrypt(newFakeToken(), TEST_AAD), TEST_AAD);
        const r = await adapter.checkAccount(cred, { connectionId });
        if (r.kind === 'eligible' && r.expiry?.kind === 'token') {
          expect(r.expiry.expiresAt.getTime()).toBe(r.tokenExpiresAt.getTime());
        }
      });
    });
  });
}
