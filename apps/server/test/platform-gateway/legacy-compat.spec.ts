import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../../src/core';
import { ConnectionsController } from '../../src/modules/platform_gateway/internal/connections/connections.controller';
import type { ConnectionsService } from '../../src/modules/platform_gateway/internal/connections/connections.service';
import type { StoredConnection } from '../../src/modules/platform_gateway/internal/connections/connection-store';
import { toChannelConnections } from '../../src/modules/platform_gateway/internal/gateway.service';
import type { ChannelConnection } from '../../src/modules/platform_gateway/public-api';

// T019 (010 R3): tương thích ngược với 012/013. `status` công khai CHỈ thuộc 4 giá trị cũ và "dùng được để đăng"
// ⇔ active|expiring; bộ chọn kênh của 012 không bao giờ có `tiktok`.

const DAY = 86_400_000;
const NOW = new Date('2026-11-18T05:00:00.000Z');

const row = (over: Partial<StoredConnection> = {}): StoredConnection => ({
  id: crypto.randomUUID(),
  channelType: 'facebook_page',
  externalId: 'e',
  displayName: 'Page',
  tokenCiphertext: Buffer.from('x'),
  tokenExpiresAt: new Date(NOW.getTime() + 30 * DAY),
  status: 'active',
  connectedAt: NOW,
  rowStatus: 'active',
  expiryKind: 'token',
  ...over,
});

const LEGACY = new Set(['active', 'expiring', 'expired', 'disconnected']);
const publishable = (c: ChannelConnection) => c.status === 'active' || c.status === 'expiring';

describe('status công khai giữ 4 giá trị (R3)', () => {
  const page = row({ id: 'p1' });
  const cases: [string, StoredConnection[], string][] = [
    ['active', [row()], 'active'],
    ['sắp hết hạn', [row({ tokenExpiresAt: new Date(NOW.getTime() + 2 * DAY) })], 'expiring'],
    ['quá hạn', [row({ tokenExpiresAt: new Date(NOW.getTime() - DAY) })], 'expired'],
    ['không hạn cố định', [row({ tokenExpiresAt: null, expiryKind: 'none' })], 'active'],
    [
      'needs_reconnect',
      [row({ rowStatus: 'needs_reconnect', reasonCode: 'TOKEN_REVOKED' })],
      'expired',
    ],
    ['ineligible', [row({ rowStatus: 'ineligible', reasonCode: 'NOT_PROFESSIONAL' })], 'expired'],
    [
      'đã ngắt',
      [row({ status: 'disconnected', rowStatus: 'disconnected', tokenExpiresAt: null })],
      'disconnected',
    ],
    [
      'Instagram mất Page nguồn',
      [row({ channelType: 'instagram', sourceConnectionId: 'missing' })],
      'expired',
    ],
    [
      'Instagram có Page nguồn tốt',
      [page, row({ channelType: 'instagram', sourceConnectionId: 'p1' })],
      'active',
    ],
  ];

  it.each(cases)('%s ⇒ %s', (_name, rows, expected) => {
    const out = toChannelConnections(rows, { now: NOW });
    expect(out.at(-1)?.status).toBe(expected);
    for (const c of out) expect(LEGACY.has(c.status)).toBe(true);
  });

  it('bất biến: dùng được để đăng ⇔ state ∈ {active, expiring}; kênh hỏng/ngắt/tạm tắt luôn chặn `precheck` của 013', () => {
    const rows = cases.flatMap(([, r]) => r);
    for (const c of toChannelConnections(rows, { now: NOW })) {
      expect(publishable(c)).toBe(c.state === 'active' || c.state === 'expiring');
      if (c.state === 'needs_reconnect' || c.state === 'ineligible')
        expect(c.status).toBe('expired');
      if (c.state === 'suspended' || c.state === 'disconnected')
        expect(c.status).toBe('disconnected');
    }
  });

  it('TikTok khi công tắc tắt ⇒ status `disconnected` (013 dừng), giữ nguyên bản mã', () => {
    const tiktok = row({ channelType: 'tiktok' as never });
    expect(toChannelConnections([tiktok], { now: NOW, featureEnabled: false })[0]).toMatchObject({
      state: 'suspended',
      status: 'disconnected',
    });
    expect(toChannelConnections([tiktok], { now: NOW, featureEnabled: true })[0]?.status).toBe(
      'active',
    );
  });
});

describe('GET /channels (bộ chọn kênh của 012)', () => {
  it('không bao giờ trả `tiktok`; giữ hình dạng cũ + trường mới tùy chọn; tokenExpiresAt null khi không hạn', async () => {
    const all = toChannelConnections(
      [
        row({ id: 'a' }),
        row({ id: 'b', channelType: 'tiktok' as never }),
        row({ id: 'c', tokenExpiresAt: null, expiryKind: 'none' }),
      ],
      { now: NOW },
    );
    const service = {
      listConnections: () => Promise.resolve(all),
    } as unknown as ConnectionsService;
    const controller = new ConnectionsController(service, {} as AuthConfig);
    const out = await controller.list();
    expect(out.map((c) => c.connectionId)).toEqual(['a', 'c']);
    expect(out.map((c) => c.channelType)).not.toContain('tiktok');
    expect(out[1]?.tokenExpiresAt).toBeNull();
    expect(out[0]).toMatchObject({ status: 'active', state: 'active' });
  });
});
