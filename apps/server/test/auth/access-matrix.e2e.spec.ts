import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  isCustomerPermission,
  PERMISSION_LIST,
  PERMISSIONS,
} from '../../src/core/auth/permissions';
import { describeDb } from '../db/helpers/db';
import { createTestApp, type ErrorBody, type TestApp } from './helpers/app';
import { createActors, type Actors } from './helpers/actors';
import { AccessMatrixTestModule } from './support/access-matrix.module';

// T057 (SC-003, FR-012): 5 loại người gọi × mọi quyền (14 từ 006 – tự lấy PERMISSION_LIST) → 200/401/403 khớp 100% bảng FR-012.

type State = 'anonymous' | 'owner' | 'collaborator' | 'support' | 'admin';
const STATES: State[] = ['anonymous', 'owner', 'collaborator', 'support', 'admin'];

/** Mã mong đợi: chưa đăng nhập → 401; sai loại người gọi (khách ↔ nhân viên) → 401; thiếu quyền → 403. */
function expected(state: State, permission: (typeof PERMISSION_LIST)[number]): number {
  if (state === 'anonymous') return 401;
  const customerEndpoint = isCustomerPermission(permission);
  const isCustomer = state === 'owner' || state === 'collaborator';
  if (customerEndpoint !== isCustomer) return 401;
  return PERMISSIONS[permission][state] ? 200 : 403;
}

describeDb('Ma trận quyền (e2e)', () => {
  let t: TestApp;
  let actors: Actors;
  beforeAll(async () => {
    t = await createTestApp({ extraImports: [AccessMatrixTestModule] });
    actors = await createActors(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it('5 trạng thái × mọi quyền khớp 100% bảng FR-012', async () => {
    const mismatches: string[] = [];
    for (const state of STATES) {
      for (const permission of PERMISSION_LIST) {
        const res = await actors[state].get(`/api/v1/__test/perm/${permission}`);
        const want = expected(state, permission);
        if (res.status !== want)
          mismatches.push(`${state} × ${permission}: ${res.status} ≠ ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('AS1: cộng tác viên duyệt bài → 403 FORBIDDEN, lời giải thích và contact_owner', async () => {
    const res = await actors.collaborator.get('/api/v1/__test/perm/post.approve');
    const err = (res.body as ErrorBody).error;
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Chỉ chủ tài khoản mới duyệt được bài.');
    expect(err.actions.map((a) => a.kind)).toContain('contact_owner');
  });

  it('AS3: chưa đăng nhập chỉ gọi được @Public', async () => {
    expect((await actors.anonymous.get('/api/v1/__test/public')).status).toBe(200);
    expect((await actors.anonymous.get('/api/v1/__test/customer-unverified')).status).toBe(401);
  });

  it('AS4/AS5: nhân viên gọi điểm cuối khách hàng → 401; khách hàng gọi điểm cuối nội bộ → 401', async () => {
    expect((await actors.support.get('/api/v1/auth/me')).status).toBe(401);
    expect((await actors.owner.get('/api/v1/internal/auth/me')).status).toBe(401);
  });

  it('điểm cuối không khai báo → 403 ACCESS_NOT_DECLARED với mọi người gọi', async () => {
    for (const state of STATES) {
      const res = await actors[state].get('/api/v1/__test/undeclared');
      expect(res.status, state).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('ACCESS_NOT_DECLARED');
    }
  });

  it('AS7: mỗi lần từ chối có dòng auth.denied đủ trường, không có cookie/mã', async () => {
    const before = t.logs.length;
    const res = await actors.collaborator.get('/api/v1/__test/perm/channel.manage');
    expect(res.status).toBe(403);
    const traceId = (res.body as ErrorBody).error.support.traceId;
    const line = t.logs.slice(before).find((l) => l.msg === 'auth.denied');
    expect(line).toMatchObject({
      trace_id: traceId,
      actor_id: actors.collaboratorId,
      account_id: actors.ownerMe.account.id,
      required: ['channel.manage'],
      reason: 'missing_permission:channel.manage',
    });
    const raw = t.rawLogs.slice(before).join('\n');
    expect(raw).not.toContain(actors.collaborator.sid ?? '∅');
    expect(raw).not.toMatch(/__Host-sid=[A-Za-z0-9_-]{10,}/);
  });
});
