// 006 T014 – AccountPublicApi.describeMembers (contracts/context-public-api.md mục 3): đọc tên +
// trạng thái thành viên trong ngữ cảnh tenant của người gọi. Mẫu cho "module A đọc dữ liệu module B
// qua giao diện công khai, RLS tự lọc theo tài khoản".
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TenantContextError } from '../../src/core/db/errors';
import { tenantTx } from '../../src/core/db/transaction';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { describeMembers } from '../../src/modules/account/internal/members/describe-members';
import {
  asOwner,
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

/** Chèn người dùng + thành viên bằng `owner` (không qua RLS). */
async function seedMember(
  accountId: string,
  opts: {
    name: string;
    role: 'owner' | 'collaborator';
    seat: number;
    status?: 'active' | 'removed' | 'disabled';
    userStatus?: 'active' | 'disabled';
  },
): Promise<string> {
  const userId = uuidV7();
  const email = `m.${randomBytes(5).toString('hex')}@example.test`;
  await asOwner(async (c) => {
    await c.query(
      `INSERT INTO account.users (id, account_id, display_name, email, email_normalized, status,
         terms_version, terms_accepted_at) VALUES ($1, $2, $3, $4, $4, $5, '2026-11', now())`,
      [userId, accountId, opts.name, email, opts.userStatus ?? 'active'],
    );
    await c.query(
      `INSERT INTO account.memberships (id, account_id, user_id, role, seat, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidV7(), accountId, userId, opts.role, opts.seat, opts.status ?? 'active'],
    );
  });
  return userId;
}

describeDb('AccountPublicApi.describeMembers', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;
  let ownerA: string;
  let removedA: string;
  let disabledA: string;
  let ownerB: string;

  beforeAll(async () => {
    database = makeDatabase({ poolMax: 3 });
    a = await createAccount();
    b = await createAccount();
    ownerA = await seedMember(a, { name: 'Chủ A', role: 'owner', seat: 0 });
    removedA = await seedMember(a, {
      name: 'CTV đã rời',
      role: 'collaborator',
      seat: 1,
      status: 'removed',
    });
    disabledA = await seedMember(a, {
      name: 'CTV bị khóa',
      role: 'collaborator',
      seat: 2,
      status: 'disabled',
    });
    ownerB = await seedMember(b, { name: 'Chủ B', role: 'owner', seat: 0 });
  });
  afterAll(async () => {
    await database.close();
  });

  it('trả tên + trạng thái của thành viên tài khoản mình; đã gỡ → removed, bị khóa → disabled', async () => {
    const rows = await withAccount(a, () => describeMembers([ownerA, removedA, disabledA]));
    const byId = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(byId[ownerA]).toEqual({ userId: ownerA, displayName: 'Chủ A', status: 'active' });
    expect(byId[removedA]?.status).toBe('removed');
    expect(byId[disabledA]).toEqual({
      userId: disabledA,
      displayName: 'CTV bị khóa',
      status: 'disabled',
    });
  });

  it('mã của tài khoản khác và mã không tồn tại không có trong kết quả', async () => {
    const rows = await withAccount(a, () => describeMembers([ownerA, ownerB, uuidV7()]));
    expect(rows.map((r) => r.userId)).toEqual([ownerA]);
  });

  it('dùng lại tenantTx đang mở của người gọi', async () => {
    const rows = await withAccount(b, () => tenantTx(() => describeMembers([ownerB])));
    expect(rows).toHaveLength(1);
  });

  it('không ngữ cảnh tenant → TENANT_CONTEXT_MISSING', async () => {
    await expect(describeMembers([ownerA])).rejects.toMatchObject({
      name: 'TenantContextError',
      code: 'TENANT_CONTEXT_MISSING',
    } satisfies Partial<TenantContextError>);
  });

  it('quá 100 mã → lỗi lập trình', async () => {
    const ids = Array.from({ length: 101 }, () => uuidV7());
    await expect(withAccount(a, () => describeMembers(ids))).rejects.toThrow(/tối đa 100/);
  });
});
