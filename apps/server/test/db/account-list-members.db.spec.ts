// 005 T016: AccountPublicApi.listActiveMembers – chỉ thành viên đang hoạt động của tài khoản trong ngữ cảnh.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { listActiveMembers } from '../../src/modules/account/internal/members-directory';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';
import { seedMember } from './helpers/members';

describeDb('listActiveMembers (005 R9)', () => {
  let database: TestDatabase;
  let a: string;
  let b: string;
  let ownerA: { userId: string; email: string };
  let ctvA: { userId: string; email: string };
  let removedA: { userId: string };
  let ownerB: { userId: string };

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
    b = await createAccount();
    ownerA = await seedMember(a, { role: 'owner', seat: 0, name: 'Chủ A' });
    ctvA = await seedMember(a, { role: 'collaborator', seat: 1, name: 'CTV A' });
    removedA = await seedMember(a, { role: 'collaborator', seat: 2, status: 'removed' });
    await seedMember(a, { role: 'collaborator', seat: 2, userStatus: 'disabled' });
    ownerB = await seedMember(b, { role: 'owner', seat: 0 });
  });
  afterAll(async () => {
    await database.close();
  });

  it('A thấy chủ + CTV đang hoạt động của A, theo ghế; không có người đã gỡ/khóa', async () => {
    const members = await withAccount(a, () => listActiveMembers());
    expect(members).toEqual([
      { userId: ownerA.userId, role: 'owner', email: ownerA.email, displayName: 'Chủ A' },
      { userId: ctvA.userId, role: 'collaborator', email: ctvA.email, displayName: 'CTV A' },
    ]);
    expect(members.map((m) => m.userId)).not.toContain(removedA.userId);
  });

  it('A không thấy thành viên của B', async () => {
    const members = await withAccount(a, () => listActiveMembers());
    expect(members.map((m) => m.userId)).not.toContain(ownerB.userId);
    const membersB = await withAccount(b, () => listActiveMembers());
    expect(membersB.map((m) => m.userId)).toEqual([ownerB.userId]);
  });

  it('ngoài ngữ cảnh tài khoản → TenantContextError', async () => {
    await expect(withAccount(undefined, () => listActiveMembers())).rejects.toMatchObject({
      name: 'TenantContextError',
    });
  });
});
