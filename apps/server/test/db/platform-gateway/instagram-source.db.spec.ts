// 010 T043 (US2, FR-042): liên kết Instagram ↔ Page nguồn ở tầng lưu trữ trên Postgres thật –
// IG có Page nguồn trong tài khoản ⇒ được gán; chưa có ⇒ NULL (IG độc lập); Page được kết nối sau ⇒ liên kết cùng giao dịch.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import type { NewConnection } from '../../../src/modules/platform_gateway/internal/connections/connection-store';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const token = () => randomBytes(40);
const uniq = (p: string) => `${p}-${randomBytes(5).toString('hex')}`;

describeDb('Liên kết Instagram với Page nguồn (lưu trữ)', () => {
  let database: TestDatabase;
  beforeAll(() => {
    database = makeDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  const page = (externalId: string): NewConnection => ({
    channelType: 'facebook_page',
    externalId,
    displayName: 'Trang',
    tokenCiphertext: token(),
    tokenExpiresAt: null,
    expiryKind: 'none',
    maxPerPlatform: 5,
  });
  const ig = (
    externalId: string,
    sourceExternalId: string,
    sourceConnectionId?: string,
  ): NewConnection => ({
    channelType: 'instagram',
    externalId,
    displayName: '@ig',
    tokenCiphertext: token(),
    tokenExpiresAt: null,
    expiryKind: 'none',
    sourceExternalId,
    sourceConnectionId: sourceConnectionId ?? null,
    maxPerPlatform: 5,
  });

  it('Page nguồn đã có trong tài khoản ⇒ IG giữ source_connection_id do bên gọi gán', async () => {
    const acc = await createAccount();
    const store = new PgConnectionStore();
    await withAccount(acc, async () => {
      const p = await store.insertConnection(page(uniq('p')));
      const g = await store.insertConnection(
        ig(uniq('ig'), p.connection.externalId, p.connection.id),
      );
      expect(g.connection.sourceConnectionId).toBe(p.connection.id);
    });
  });

  it('Page nguồn chưa có ⇒ NULL; sau này kết nối Page đó ⇒ IG được liên kết (cùng giao dịch)', async () => {
    const acc = await createAccount();
    const store = new PgConnectionStore();
    const pageId = uniq('p');
    await withAccount(acc, async () => {
      const g = await store.insertConnection(ig(uniq('ig'), pageId));
      expect(g.connection.sourceConnectionId ?? null).toBeNull();

      const p = await store.insertConnection(page(pageId));
      const after = await store.getConnection(g.connection.id);
      expect(after?.sourceConnectionId).toBe(p.connection.id);
    });
  });

  it('Page cùng tên ở tài khoản khác không liên kết nhầm IG của tài khoản này', async () => {
    const [a, b] = [await createAccount(), await createAccount()];
    const store = new PgConnectionStore();
    const pageId = uniq('p');
    let igId = '';
    await withAccount(a, async () => {
      igId = (await store.insertConnection(ig(uniq('ig'), pageId))).connection.id;
    });
    await withAccount(b, async () => {
      await store.insertConnection(page(pageId));
    });
    await withAccount(a, async () => {
      expect((await store.getConnection(igId))?.sourceConnectionId ?? null).toBeNull();
    });
  });
});
