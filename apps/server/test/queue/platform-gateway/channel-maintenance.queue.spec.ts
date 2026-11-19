// 010 T055/T063 (US5, hiến pháp V): việc `channel_maintenance` (chỉ liệt kê kết nối đến hạn → tạo `check_connection` theo
// tài khoản, khóa chống trùng theo ngày) và `cleanup_connect_data` (xóa hẳn trạng thái OAuth/phiên chọn đã dùng/hết hạn).
// Chạy lại hai lần cho cùng kết quả; payload chỉ mã tham chiếu; việc quét là việc HỆ THỐNG.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '../../../src/core/ids/uuid-v7';
import { runCleanupConnectData } from '../../../src/modules/platform_gateway/internal/maintenance/cleanup.handler';
import { runChannelMaintenance } from '../../../src/modules/platform_gateway/internal/maintenance/due-connections';
import {
  channelMaintenance,
  checkConnection,
  checkDedupeKey,
  cleanupConnectData,
} from '../../../src/modules/platform_gateway/internal/maintenance/jobs';
import { startTestProducer } from '../../support/queue-test-kit';
import {
  asOwner,
  createAccount,
  describeDb,
  jobs,
  makeDatabase,
  resetQueues,
  type TestDatabase,
} from '../helpers/queue-db';

const NOW = new Date('2026-11-20T20:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeDb('Việc nền kênh: channel_maintenance + cleanup_connect_data', () => {
  let database: TestDatabase;
  let stopProducer: () => Promise<void>;
  let accountId: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 8 });
    stopProducer = await startTestProducer();
  });
  afterAll(async () => {
    await stopProducer();
    await database.close();
  });
  beforeEach(async () => {
    await resetQueues();
    await asOwner((c) => c.query('DELETE FROM platform_gateway.channel_connections'));
    accountId = await createAccount();
  });

  async function seed(o: {
    status?: string;
    lastCheckedAt?: Date | null;
    expiresAt?: Date | null;
    recheck?: boolean;
  }): Promise<string> {
    const id = uuidV7();
    await asOwner((c) =>
      c.query(
        `INSERT INTO platform_gateway.channel_connections
           (id, account_id, channel_type, external_id, display_name, token_ciphertext, token_issued_at,
            expiry_kind, token_expires_at, connected_at, status, last_checked_at, recheck_required)
         VALUES ($1, $2, 'facebook_page', $3, 'Trang', $4, $5, $6, $7, $5, $8, $9, $10)`,
        [
          id,
          accountId,
          `page-${randomBytes(5).toString('hex')}`,
          randomBytes(40),
          new Date(NOW.getTime() - 30 * DAY),
          o.expiresAt == null ? 'none' : 'token',
          o.expiresAt ?? null,
          o.status ?? 'active',
          o.lastCheckedAt ?? null,
          o.recheck ?? false,
        ],
      ),
    );
    return id;
  }

  describe('channel_maintenance', () => {
    it('chỉ kết nối đến hạn bị tạo việc; payload chỉ mã kết nối; chạy lại không nhân đôi', async () => {
      const fresh = new Date(NOW.getTime() - 2 * HOUR);
      const never = await seed({}); // chưa kiểm tra bao giờ
      const stale = await seed({ lastCheckedAt: new Date(NOW.getTime() - 21 * HOUR) }); // > 20 giờ
      const expiring = await seed({ lastCheckedAt: fresh, expiresAt: new Date(NOW.getTime() + 3 * DAY) });
      const recheck = await seed({ status: 'needs_reconnect', recheck: true, lastCheckedAt: fresh });
      const okRecent = await seed({ lastCheckedAt: fresh }); // vừa kiểm tra, không hạn ⇒ KHÔNG đến hạn
      const pureNeedsReconnect = await seed({ status: 'needs_reconnect', lastCheckedAt: null });

      const first = await runChannelMaintenance({ now: NOW, batchLimit: 100 });
      expect(first.due).toBe(4);
      expect(first.created).toBe(4);
      const queued = await jobs(`data->>'type' = 'platform_gateway.check_connection'`);
      const ids = queued.map((j) => j.data.payload.connectionId);
      expect(new Set(ids)).toEqual(new Set([never, stale, expiring, recheck]));
      expect(ids).not.toContain(okRecent);
      expect(ids).not.toContain(pureNeedsReconnect); // needs_reconnect thuần không quét lại hằng ngày
      for (const j of queued) {
        expect(j.data.accountId).toBe(accountId); // mã tài khoản đi theo phong bì
        expect(Object.keys(j.data.payload)).toEqual(['connectionId']); // payload chỉ mã tham chiếu
        expect(j.name).toBe('scheduled');
      }
      expect(queued.map((j) => j.singleton_key)).toContain(checkDedupeKey(never, NOW));

      const second = await runChannelMaintenance({ now: NOW, batchLimit: 100 });
      expect(second.created).toBe(0); // cùng khóa theo ngày
      expect(await jobs(`data->>'type' = 'platform_gateway.check_connection'`)).toHaveLength(4);
    });

    it('trần lô: batchLimit nhỏ hơn số đến hạn ⇒ chỉ tạo đúng lô, phần dư để lần sau', async () => {
      await seed({});
      await seed({});
      await seed({});
      const r = await runChannelMaintenance({ now: NOW, batchLimit: 2 });
      expect(r).toEqual({ due: 2, created: 2 });
    });

    it('khai báo: việc quét/dọn là việc HỆ THỐNG; check_connection thuộc tài khoản', () => {
      expect(channelMaintenance.scope).toBe('system');
      expect(cleanupConnectData.scope).toBe('system');
      expect(checkConnection.scope).toBe('tenant');
      expect(channelMaintenance.queue).toBe('scheduled');
    });
  });

  describe('cleanup_connect_data', () => {
    async function seedStates(): Promise<void> {
      const mk = (expiresAt: Date, usedAt: Date | null) =>
        asOwner(async (c) => {
          await c.query(
            `INSERT INTO platform_gateway.connect_states
               (id, account_id, state_hash, user_id, channel_type, expires_at, used_at)
             VALUES ($1, $2, $3, $4, 'facebook_page', $5, $6)`,
            [uuidV7(), accountId, randomBytes(32), uuidV7(), expiresAt, usedAt],
          );
          await c.query(
            `INSERT INTO platform_gateway.connect_selections
               (id, account_id, user_id, channel_type, candidates, expires_at, used_at)
             VALUES ($1, $2, $3, 'facebook_page', '[]'::jsonb, $4, $5)`,
            [uuidV7(), accountId, uuidV7(), expiresAt, usedAt],
          );
        });
      await mk(new Date(NOW.getTime() + HOUR), new Date(NOW.getTime() - HOUR)); // đã dùng ⇒ xóa
      await mk(new Date(NOW.getTime() - 2 * HOUR), null); // hết hạn > 1 giờ ⇒ xóa
      await mk(new Date(NOW.getTime() - 10 * 60_000), null); // vừa hết hạn (< 1 giờ) ⇒ giữ
      await mk(new Date(NOW.getTime() + HOUR), null); // còn hạn ⇒ giữ
    }
    const count = async (table: string): Promise<number> =>
      asOwner(async (c) => {
        const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM platform_gateway.${table}`);
        return r.rows[0]?.n ?? 0;
      });
    const counts = async () => ({
      states: await count('connect_states'),
      selections: await count('connect_selections'),
    });

    it('xóa hẳn dòng đã dùng/hết hạn > 1 giờ, giữ dòng còn hiệu lực; chạy lại hai lần cho cùng kết quả', async () => {
      await asOwner(async (c) => {
        await c.query('DELETE FROM platform_gateway.connect_states');
        await c.query('DELETE FROM platform_gateway.connect_selections');
      });
      await seedStates();
      const r1 = await runCleanupConnectData({ now: NOW });
      expect(r1.deleted).toBe(4); // 2 trạng thái + 2 phiên chọn
      expect(await counts()).toEqual({ states: 2, selections: 2 });
      const r2 = await runCleanupConnectData({ now: NOW });
      expect(r2.deleted).toBe(0);
      expect(await counts()).toEqual({ states: 2, selections: 2 });
    });
  });
});

describe('khai báo loại việc', () => {
  it('check_connection chỉ nhận connectionId (không chấp nhận mã quyền/tên)', () => {
    expect(checkConnection.payload.safeParse({ connectionId: uuidV7() }).success).toBe(true);
    expect(checkConnection.payload.safeParse({ connectionId: uuidV7(), token: 'x' }).success).toBe(
      false,
    );
  });
});
