import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbPriceSource } from '../../src/modules/ai_gateway/internal/prices/db-price-source';
import { asOwner, dbUrls, describeDb, makeDatabase, type TestDatabase } from '../db/helpers/db';
import { insertPrice, uniqueModel } from './helpers/price-fixtures';

// 015 US3 T036 (FR-019, FR-020, FR-022, SC-007): bảng giá `model_prices` chỉ-thêm, hiệu lực theo thời điểm, đệm TTL ≤ 60 s,
// trigger chặn UPDATE/DELETE/TRUNCATE, CHECK giá > 0 khớp đơn vị. Hành vi của Cổng (quyết toán dùng price_id của giữ chỗ,
// thiếu giá → AI_NOT_CONFIGURED) ở mục 18 của bộ hợp đồng `test/contracts/ai/ai-gateway.contract.ts`.
// Dòng giá mồi dùng (provider, model) RIÊNG của từng ca (xem helpers/price-fixtures.ts) – bảng chỉ-thêm không dọn được.
// Tên tệp `.spec.ts` nhưng cần CSDL: chạy ở `pnpm test:db` (include `test/ai_gateway/**/*.spec.ts` của vitest.db.config).

const HOUR = 3_600_000;
const T = new Date('2030-01-01T00:00:00.000Z'); // mốc hiệu lực của giá mới (tương lai so với thời gian chạy kiểm thử)

describeDb('Bảng giá mô hình – chỉ-thêm và hiệu lực theo thời điểm', () => {
  let database: TestDatabase;
  beforeAll(() => {
    database = makeDatabase({ unit: 'worker' });
  });
  afterAll(async () => {
    await database.close();
  });

  describe('hiệu lực từ T (SC-007)', () => {
    it('trước T giá cũ, từ T (kể cả đúng T) giá mới, trước mọi dòng giá → null (không đoán giá)', async () => {
      const m = uniqueModel();
      const oldId = await insertPrice(m, {
        input: 1_000_000,
        effectiveFrom: '2026-01-01T00:00:00Z',
      });
      const newId = await insertPrice(m, { input: 3_000_000, effectiveFrom: T });
      const src = new DbPriceSource({ ttlMs: 0 });
      const at = (d: Date) => src.priceFor(m.provider, m.modelId, 'token', d);

      expect((await at(new Date(T.getTime() - 1)))?.priceId).toBe(oldId);
      expect((await at(T))?.priceId).toBe(newId);
      expect((await at(new Date(T.getTime() + 1)))?.priceId).toBe(newId);
      expect(await at(new Date('2025-12-31T23:59:59.999Z'))).toBeNull();
      // Bây giờ (trước T): vẫn giá cũ.
      expect((await src.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(oldId);
      expect((await at(new Date(T.getTime() - 1)))?.inputPerMTokMicroUsd).toBe(1_000_000);
      expect((await at(T))?.inputPerMTokMicroUsd).toBe(3_000_000);
    });

    it('khóa tra theo (provider, model, unit): cùng mô hình khác unit hoặc mô hình khác không lẫn giá', async () => {
      const m = uniqueModel();
      const other = uniqueModel();
      await insertPrice(m, { effectiveFrom: '2026-01-01T00:00:00Z' });
      await insertPrice(m, {
        unit: 'audio_minute',
        perMinute: 6_000,
        effectiveFrom: '2026-01-01T00:00:00Z',
      });
      const src = new DbPriceSource({ ttlMs: 0 });
      const token = await src.priceFor(m.provider, m.modelId, 'token');
      const audio = await src.priceFor(m.provider, m.modelId, 'audio_minute');
      expect(token).toMatchObject({ unit: 'token', perMinuteMicroUsd: null });
      expect(audio).toMatchObject({
        unit: 'audio_minute',
        perMinuteMicroUsd: 6_000,
        inputPerMTokMicroUsd: null,
        outputPerMTokMicroUsd: null,
      });
      expect(await src.priceFor(other.provider, other.modelId, 'token')).toBeNull();
    });
  });

  describe('đệm TTL (R-06): giá mới thêm ≥ now + TTL luôn có hiệu lực đúng giờ ở mọi bản đệm', () => {
    it('trong TTL đọc đệm (chưa thấy dòng mới); hết TTL đọc lại; dòng hiệu lực ≥ now + TTL được thấy khi tới giờ', async () => {
      const m = uniqueModel();
      const oldId = await insertPrice(m, { effectiveFrom: new Date(Date.now() - HOUR) });
      const clock = { t: 1_000_000 };
      const TTL = 60_000;
      const src = new DbPriceSource({ ttlMs: TTL, now: () => clock.t });
      expect((await src.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(oldId);

      // Admin thêm giá mới hiệu lực sau now + TTL (đúng ràng buộc của POST /admin/ai/prices).
      const effective = new Date(Date.now() + TTL + 1_000);
      const newId = await insertPrice(m, { input: 5_000_000, effectiveFrom: effective });
      const afterEffective = new Date(effective.getTime() + 1);

      // Còn trong TTL: bản đệm cũ chưa thấy dòng mới → vẫn A kể cả hỏi thời điểm sau `effective`.
      clock.t += TTL - 1;
      expect((await src.priceFor(m.provider, m.modelId, 'token', afterEffective))?.priceId).toBe(
        oldId,
      );
      // Tới TTL: đọc lại. Đệm cũ tối đa trễ đúng TTL ⇒ ràng buộc `effectiveFrom ≥ now + TTL` đủ để mọi bản đệm kịp thấy.
      clock.t += 1;
      expect((await src.priceFor(m.provider, m.modelId, 'token', afterEffective))?.priceId).toBe(
        newId,
      );
      // Trước giờ hiệu lực vẫn là A dù đã thấy dòng B (đệm chứa cả dòng tương lai).
      expect((await src.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(oldId);
    });

    it('TTL = 0: luôn đọc lại; invalidate() bỏ đệm', async () => {
      const m = uniqueModel();
      const a = await insertPrice(m, { effectiveFrom: new Date(Date.now() - 2 * HOUR) });
      const cached = new DbPriceSource({ ttlMs: 60_000 });
      const fresh = new DbPriceSource({ ttlMs: 0 });
      expect((await cached.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(a);
      expect((await fresh.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(a);
      const b = await insertPrice(m, { effectiveFrom: new Date(Date.now() - 1_000) });
      expect((await fresh.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(b);
      expect((await cached.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(a);
      cached.invalidate();
      expect((await cached.priceFor(m.provider, m.modelId, 'token'))?.priceId).toBe(b);
    });
  });

  describe('chỉ-thêm: trigger chặn UPDATE/DELETE/TRUNCATE (FR-020)', () => {
    it('owner UPDATE / DELETE một dòng → 42501 "chỉ được thêm"; dòng không đổi', async () => {
      const m = uniqueModel();
      const id = await insertPrice(m, { input: 1_000_000, effectiveFrom: '2026-01-01T00:00:00Z' });
      await asOwner(async (c) => {
        for (const sql of [
          'UPDATE ai_gateway.model_prices SET input_per_mtok = 9 WHERE id = $1',
          'UPDATE ai_gateway.model_prices SET effective_from = now() WHERE id = $1',
          'DELETE FROM ai_gateway.model_prices WHERE id = $1',
        ]) {
          const err = await c.query(sql, [id]).catch((e: unknown) => e);
          expect((err as { code?: string }).code, sql).toBe('42501');
          expect((err as Error).message, sql).toMatch(/chỉ được thêm/);
        }
        const r = await c.query<{ input_per_mtok: string }>(
          'SELECT input_per_mtok::text FROM ai_gateway.model_prices WHERE id = $1',
          [id],
        );
        expect(r.rows).toEqual([{ input_per_mtok: '1000000' }]);
      });
    });

    it('owner TRUNCATE bị từ chối; số dòng không đổi', async () => {
      const count = () =>
        asOwner(
          async (c) =>
            (
              await c.query<{ n: string }>(
                'SELECT count(*)::text AS n FROM ai_gateway.model_prices',
              )
            ).rows[0]!.n,
        );
      const before = await count();
      expect(Number(before)).toBeGreaterThan(0);
      const err = await asOwner((c) => c.query('TRUNCATE ai_gateway.model_prices')).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(await count()).toBe(before);
    });

    it('vai trò system chỉ INSERT được: UPDATE/DELETE → 42501; app không ghi được → 42501', async () => {
      const m = uniqueModel();
      const id = await insertPrice(m, { effectiveFrom: '2026-01-01T00:00:00Z' });
      for (const role of ['system', 'app'] as const) {
        const c = new Client({ connectionString: dbUrls[role] });
        await c.connect();
        try {
          for (const sql of [
            'UPDATE ai_gateway.model_prices SET input_per_mtok = 9 WHERE id = $1',
            'DELETE FROM ai_gateway.model_prices WHERE id = $1',
          ]) {
            const err = await c.query(sql, [id]).catch((e: unknown) => e);
            expect((err as { code?: string }).code, `${role}: ${sql}`).toBe('42501');
          }
        } finally {
          await c.end();
        }
      }
      const app = new Client({ connectionString: dbUrls.app });
      await app.connect();
      try {
        const err = await app
          .query(
            `INSERT INTO ai_gateway.model_prices (id, provider, model_id, unit, input_per_mtok, output_per_mtok,
               effective_from, created_by)
             VALUES (gen_random_uuid(), 'x', 'x', 'token', 1, 1, now(), 'app')`,
          )
          .catch((e: unknown) => e);
        expect((err as { code?: string }).code).toBe('42501');
      } finally {
        await app.end();
      }
    });
  });

  describe('CHECK: giá > 0 và khớp đơn vị (chốt cuối của kiểm tra bất hợp lý)', () => {
    const insertRaw = (cols: {
      unit: string;
      input?: number | null;
      output?: number | null;
      cached?: number | null;
      perMinute?: number | null;
      granularity?: number;
    }) =>
      asOwner(async (c) => {
        const m = uniqueModel();
        return c
          .query(
            `INSERT INTO ai_gateway.model_prices
               (id, provider, model_id, unit, input_per_mtok, output_per_mtok, cached_input_per_mtok, per_minute,
                billing_granularity_sec, effective_from, created_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), 'qa-test')`,
            [
              m.provider,
              m.modelId,
              cols.unit,
              cols.input ?? null,
              cols.output ?? null,
              cols.cached ?? null,
              cols.perMinute ?? null,
              cols.granularity ?? 1,
            ],
          )
          .then(() => null)
          .catch((e: unknown) => e as { code?: string });
      });

    it('giá token ≤ 0, thiếu giá ra, giá phút ở đơn vị token → 23514', async () => {
      for (const bad of [
        { unit: 'token', input: 0, output: 5 },
        { unit: 'token', input: -1, output: 5 },
        { unit: 'token', input: 5, output: 0 },
        { unit: 'token', input: 5, output: null },
        { unit: 'token', input: 5, output: 5, cached: 0 },
        { unit: 'token', input: 5, output: 5, perMinute: 5 },
      ]) {
        const err = await insertRaw(bad);
        expect(err?.code, JSON.stringify(bad)).toBe('23514');
      }
    });

    it('audio_minute: giá phút ≤ 0 hoặc có giá token → 23514; đơn vị lạ và độ làm tròn ≤ 0 → 23514', async () => {
      for (const bad of [
        { unit: 'audio_minute', perMinute: 0 },
        { unit: 'audio_minute', perMinute: null },
        { unit: 'audio_minute', perMinute: 5, input: 5 },
        { unit: 'phút', perMinute: 5 },
        { unit: 'token', input: 5, output: 5, granularity: 0 },
      ]) {
        const err = await insertRaw(bad);
        expect(err?.code, JSON.stringify(bad)).toBe('23514');
      }
    });

    it('dòng hợp lệ được nhận (token có/không có giá bộ đệm; audio_minute; làm tròn 60 giây)', async () => {
      for (const ok of [
        { unit: 'token', input: 1, output: 1 },
        { unit: 'token', input: 1, output: 1, cached: 1 },
        { unit: 'audio_minute', perMinute: 6_000, granularity: 60 },
      ]) {
        expect(await insertRaw(ok), JSON.stringify(ok)).toBeNull();
      }
    });
  });
});
