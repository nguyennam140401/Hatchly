// 010 T016/T022: kho kết nối THẬT trên Postgres – chèn một lần, một Page chỉ thuộc một tài khoản (đua cả hai kiểu),
// vượt giới hạn, ngắt xóa bản mã, `state` dùng một lần, phiên chọn hết hạn.
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ChannelOwnedByAnotherAccountError,
  ConnectionLimitError,
} from '../../../src/modules/platform_gateway/internal/errors';
import { PgConnectionStore } from '../../../src/modules/platform_gateway/internal/connections/pg-connection-store';
import type { NewConnection } from '../../../src/modules/platform_gateway/internal/connections/connection-store';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from '../helpers/db';

const store = new PgConnectionStore();
const DAY = 86_400_000;

const newConn = (over: Partial<NewConnection> = {}): NewConnection => ({
  channelType: 'facebook_page',
  externalId: `page-${randomBytes(6).toString('hex')}`,
  displayName: 'Page thử',
  tokenCiphertext: randomBytes(48),
  tokenExpiresAt: new Date(Date.now() + 30 * DAY),
  ...over,
});

describeDb('PgConnectionStore (kho kết nối thật)', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    b = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  const as = <T>(acc: string, fn: () => Promise<T>) => withAccount(acc, fn);

  it('chèn → đọc lại; chèn lần hai cùng Page ⇒ trả kết nối có sẵn, created=false (không nhân đôi)', async () => {
    const c = newConn();
    const first = await as(a, () => store.insertConnection(c));
    expect(first.created).toBe(true);
    expect(first.connection.rowStatus).toBe('active');
    expect(first.connection.version).toBe(1);
    const again = await as(a, () => store.insertConnection(newConn({ externalId: c.externalId })));
    expect(again.created).toBe(false);
    expect(again.connection.id).toBe(first.connection.id);
    expect(
      (await as(a, () => store.listConnections())).filter((x) => x.externalId === c.externalId),
    ).toHaveLength(1);
  });

  it('hai lượt chèn cùng Page song song cùng tài khoản ⇒ đúng 1 hàng', async () => {
    const c = newConn();
    const results = await Promise.all([
      as(a, () => store.insertConnection(c)),
      as(a, () => store.insertConnection({ ...c, tokenCiphertext: randomBytes(48) })),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.connection.id)).size).toBe(1);
  });

  it('hai TÀI KHOẢN cùng Page ⇒ một bên được, bên kia ChannelOwnedByAnotherAccountError (không lộ chi tiết)', async () => {
    const c = newConn();
    const settled = await Promise.allSettled([
      as(a, () => store.insertConnection(c)),
      as(b, () => store.insertConnection({ ...c, tokenCiphertext: randomBytes(48) })),
    ]);
    const ok = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ChannelOwnedByAnotherAccountError);
    // Sau khi ngắt, tài khoản kia kết nối được (chỉ mục duy nhất chỉ tính kết nối chưa ngắt).
    const owner = settled[0].status === 'fulfilled' ? a : b;
    const other = owner === a ? b : a;
    const held = await as(owner, () => store.listConnections());
    const mine = held.find((x) => x.externalId === c.externalId)!;
    expect(await as(owner, () => store.disconnect(mine.id))).toBe(true);
    const taken = await as(other, () => store.insertConnection(c));
    expect(taken.created).toBe(true);
  });

  it('giới hạn: maxPerPlatform=2 ⇒ kết nối thứ 3 ném ConnectionLimitError; ngắt trả chỗ', async () => {
    const acc = await createAccount();
    const mk = () => as(acc, () => store.insertConnection(newConn({ maxPerPlatform: 2 })));
    const c1 = await mk();
    await mk();
    await expect(mk()).rejects.toBeInstanceOf(ConnectionLimitError);
    await as(acc, () => store.disconnect(c1.connection.id));
    expect((await mk()).created).toBe(true);
  });

  it('ngắt: status=disconnected, disconnected_at, hai bản mã bị xóa NGAY; ngắt lặp ⇒ false', async () => {
    const created = await as(a, () =>
      store.insertConnection(newConn({ refreshCiphertext: randomBytes(32) })),
    );
    expect(await as(a, () => store.disconnect(created.connection.id))).toBe(true);
    const raw = await asOwner(
      async (c) =>
        (
          await c.query<{
            status: string;
            disconnected_at: Date | null;
            token_ciphertext: Buffer | null;
            refresh_ciphertext: Buffer | null;
          }>(
            'SELECT status, disconnected_at, token_ciphertext, refresh_ciphertext FROM platform_gateway.channel_connections WHERE id = $1',
            [created.connection.id],
          )
        ).rows[0],
    );
    expect(raw?.status).toBe('disconnected');
    expect(raw?.disconnected_at).toBeInstanceOf(Date);
    expect(raw?.token_ciphertext).toBeNull();
    expect(raw?.refresh_ciphertext).toBeNull();
    expect(await as(a, () => store.disconnect(created.connection.id))).toBe(false);
  });

  it('tài khoản khác không đọc/ngắt được kết nối (null / false)', async () => {
    const created = await as(a, () => store.insertConnection(newConn()));
    expect(await as(b, () => store.getConnection(created.connection.id))).toBeNull();
    expect(await as(b, () => store.disconnect(created.connection.id))).toBe(false);
    expect((await as(a, () => store.getConnection(created.connection.id)))?.rowStatus).toBe(
      'active',
    );
  });

  it('updateRow: khóa lạc quan theo version (xung đột ⇒ lỗi), tăng version khi thành công', async () => {
    const created = await as(a, () => store.insertConnection(newConn()));
    const id = created.connection.id;
    const updated = await as(a, () =>
      store.updateRow(id, 1, { reason_code: 'X', status: 'needs_reconnect' }),
    );
    expect(updated.version).toBe(2);
    expect(updated.rowStatus).toBe('needs_reconnect');
    await expect(as(a, () => store.updateRow(id, 1, { display_name: 'cũ' }))).rejects.toMatchObject(
      {
        code: 'VERSION_CONFLICT',
      },
    );
  });

  it('state OAuth dùng MỘT lần; hết hạn/băm sai ⇒ null; mang reconnectConnectionId', async () => {
    const created = await as(a, () => store.insertConnection(newConn()));
    const hash = createHash('sha256').update(randomBytes(32)).digest();
    await as(a, () =>
      store.saveOauthState({
        stateHash: hash,
        userId: '00000000-0000-7000-8000-0000000000aa',
        channelType: 'facebook_page',
        expiresAt: new Date(Date.now() + 60_000),
        reconnectConnectionId: created.connection.id,
      }),
    );
    // Tài khoản khác không dùng được state của tài khoản này.
    expect(await as(b, () => store.consumeOauthState(hash, new Date()))).toBeNull();
    const [first, second] = await Promise.all([
      as(a, () => store.consumeOauthState(hash, new Date())),
      as(a, () => store.consumeOauthState(hash, new Date())),
    ]);
    expect([first, second].filter((x) => x !== null)).toHaveLength(1);
    const got = first ?? second;
    expect(got?.reconnectConnectionId).toBe(created.connection.id);
    expect(await as(a, () => store.consumeOauthState(hash, new Date()))).toBeNull();

    const expired = createHash('sha256').update(randomBytes(32)).digest();
    await as(a, () =>
      store.saveOauthState({
        stateHash: expired,
        userId: '00000000-0000-7000-8000-0000000000aa',
        channelType: 'instagram',
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    expect(await as(a, () => store.consumeOauthState(expired, new Date()))).toBeNull();
  });

  it('phiên chọn: tạo → đọc (đúng tài khoản) → dùng một lần → xóa; hết hạn ⇒ null', async () => {
    const id = await as(a, () =>
      store.createSelection({
        channelType: 'facebook_page',
        userId: '00000000-0000-7000-8000-0000000000aa',
        candidates: [],
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    expect(await as(b, () => store.getSelection(id, new Date()))).toBeNull();
    expect((await as(a, () => store.getSelection(id, new Date())))?.id).toBe(id);
    expect(await as(a, () => store.consumeSelection(id, new Date()))).toBe(true);
    expect(await as(a, () => store.consumeSelection(id, new Date()))).toBe(false);
    expect(await as(a, () => store.getSelection(id, new Date()))).toBeNull();

    const id2 = await as(a, () =>
      store.createSelection({
        channelType: 'instagram',
        userId: '00000000-0000-7000-8000-0000000000aa',
        candidates: [],
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    await as(a, () => store.deleteSelection(id2));
    expect(await as(a, () => store.getSelection(id2, new Date()))).toBeNull();
    const id3 = await as(a, () =>
      store.createSelection({
        channelType: 'instagram',
        userId: '00000000-0000-7000-8000-0000000000aa',
        candidates: [],
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    expect(await as(a, () => store.getSelection(id3, new Date()))).toBeNull();
  });
});
