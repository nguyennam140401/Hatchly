import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  isCustomerPermission,
  PERMISSION_LIST,
  PERMISSIONS,
} from '../../src/core/auth/permissions';
import { describeDb } from '../db/helpers/db';
import {
  createTestApp,
  registerAndVerify,
  type Agent,
  type ErrorBody,
  type TestApp,
} from './helpers/app';
import {
  collaboratorOf,
  createActors,
  detachedOf,
  staffAgent,
  unverifiedOwner,
  type Actors,
} from './helpers/actors';
import { AccessMatrixTestModule } from './support/access-matrix.module';

// T057 (SC-003, FR-012): 5 loại người gọi × mọi quyền (14 từ 006 – tự lấy PERMISSION_LIST) → 200/401/403 khớp 100% bảng FR-012.
// 009 T084: thêm cột thứ 6 "người ở tài khoản chờ" – mọi điểm cuối không khai báo `allowDetached`
// phải trả 403 NO_ACCOUNT; và bảng mức truy cập của 25 điểm cuối mới (+ các điểm cuối 004 được chỉnh).

type State = 'anonymous' | 'owner' | 'collaborator' | 'detached' | 'support' | 'admin';
const STATES: State[] = ['anonymous', 'owner', 'collaborator', 'detached', 'support', 'admin'];

/**
 * Mã mong đợi: chưa đăng nhập → 401; sai loại người gọi (khách ↔ nhân viên) → 401; người ở tài khoản
 * chờ gọi điểm cuối khách hàng không có `allowDetached` → 403 NO_ACCOUNT; thiếu quyền → 403.
 */
function expected(state: State, permission: (typeof PERMISSION_LIST)[number]): number {
  if (state === 'anonymous') return 401;
  const customerEndpoint = isCustomerPermission(permission);
  const isCustomer = state === 'owner' || state === 'collaborator' || state === 'detached';
  if (customerEndpoint !== isCustomer) return 401;
  if (state === 'detached') return 403;
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

  it('009: người ở tài khoản chờ bị từ chối mọi quyền khách hàng bằng đúng NO_ACCOUNT', async () => {
    const wrong: string[] = [];
    for (const permission of PERMISSION_LIST.filter(isCustomerPermission)) {
      const res = await actors.detached.get(`/api/v1/__test/perm/${permission}`);
      const code = (res.body as ErrorBody).error.code;
      if (res.status !== 403 || code !== 'NO_ACCOUNT')
        wrong.push(`${permission}: ${res.status} ${code}`);
    }
    expect(wrong).toEqual([]);
    // Điểm cuối chỉ cần đăng nhập nhưng KHÔNG khai báo allowDetached cũng bị chặn; có allowDetached thì qua.
    const noDeclare = await actors.detached.get('/api/v1/__test/customer-unverified');
    expect((noDeclare.body as ErrorBody).error.code).toBe('NO_ACCOUNT');
    expect((await actors.detached.get('/api/v1/__test/customer-detached')).status).toBe(200);
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

// ---------------------------------------------------------------------------------------------
// 009 T084: mức truy cập của các điểm cuối THẬT (25 điểm cuối mới + các điểm cuối 004 được chỉnh) theo
// contracts/auth-http-api.md mục 1–7. Chỉ kiểm LỚP CHẶN QUYỀN: gửi thân rỗng và so "bị chặn bởi lớp
// quyền" với "qua được lớp quyền" (lỗi nghiệp vụ như 400/404/409 coi là đã qua). Điểm cuối đổi trạng
// thái đăng nhập (nhận tài khoản, đăng xuất) xếp CUỐI để không làm hỏng các lời gọi sau của cùng người.

type Access =
  | 'public'
  | 'customer' // đã xác minh email, không cho người ở tài khoản chờ
  | 'customer+unverified+detached'
  | 'customer+detached'
  | 'members.manage';

interface Endpoint {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  access: Access;
  /** Điểm cuối mới của 009 (đếm đủ 25) hay điểm cuối 004 được chỉnh. */
  isNew: boolean;
}

const ID = '00000000-0000-7000-8000-000000000000';
const REAL: Endpoint[] = [
  // 1. Đăng nhập qua nhà cung cấp (7)
  { method: 'post', path: '/auth/oauth/google/start', access: 'public', isNew: true },
  { method: 'get', path: '/auth/oauth/google/callback', access: 'public', isNew: true },
  { method: 'get', path: '/auth/oauth/pending', access: 'public', isNew: true },
  { method: 'post', path: '/auth/oauth/signup', access: 'public', isNew: true },
  { method: 'post', path: '/auth/oauth/link/password', access: 'public', isNew: true },
  { method: 'post', path: '/auth/oauth/link/send-email', access: 'public', isNew: true },
  { method: 'post', path: '/auth/oauth/confirm', access: 'public', isNew: true },
  // 2. Cách đăng nhập của tôi (5)
  {
    method: 'get',
    path: '/auth/login-methods',
    access: 'customer+unverified+detached',
    isNew: true,
  },
  { method: 'post', path: '/auth/reauth', access: 'customer+unverified+detached', isNew: true },
  {
    method: 'post',
    path: '/auth/login-methods/google/start',
    access: 'customer+detached',
    isNew: true,
  },
  {
    method: 'delete',
    path: '/auth/login-methods/facebook',
    access: 'customer+detached',
    isNew: true,
  },
  {
    method: 'post',
    path: '/auth/login-methods/password/request',
    access: 'customer+detached',
    isNew: true,
  },
  // 3. Thành viên – chỉ chủ (5)
  { method: 'get', path: '/members', access: 'members.manage', isNew: true },
  { method: 'post', path: '/members/invitations', access: 'members.manage', isNew: true },
  {
    method: 'post',
    path: `/members/invitations/${ID}/resend`,
    access: 'members.manage',
    isNew: true,
  },
  { method: 'delete', path: `/members/invitations/${ID}`, access: 'members.manage', isNew: true },
  { method: 'delete', path: `/members/${ID}`, access: 'members.manage', isNew: true },
  // 4. Lời mời – phía người được mời (4)
  { method: 'post', path: '/invitations/preview', access: 'public', isNew: true },
  { method: 'post', path: '/invitations/accept', access: 'public', isNew: true },
  { method: 'get', path: '/invitations/mine', access: 'customer+detached', isNew: true },
  {
    method: 'post',
    path: '/invitations/accept-existing',
    access: 'customer+detached',
    isNew: true,
  },
  // 6. Thông báo của Meta và trang trạng thái (3)
  { method: 'post', path: '/auth/facebook/deauthorize', access: 'public', isNew: true },
  { method: 'post', path: '/auth/facebook/data-deletion', access: 'public', isNew: true },
  { method: 'get', path: '/public/data-deletion/khong-ton-tai', access: 'public', isNew: true },
  // 7. Điểm cuối 004 được chỉnh (+detached)
  { method: 'patch', path: '/auth/email', access: 'customer+unverified+detached', isNew: false },
  // `email/resend` là Public từ 004 (gửi lại theo email, không lộ email có tồn tại) – 009 không đổi.
  { method: 'post', path: '/auth/email/resend', access: 'public', isNew: false },
  { method: 'post', path: '/auth/password/change', access: 'customer+detached', isNew: false },
  { method: 'get', path: '/auth/me', access: 'customer+unverified+detached', isNew: false },
  // Cuối bảng: đổi trạng thái đăng nhập của chính người gọi. `claim` (5. Người không thuộc tài khoản nào)
  // là điểm cuối mới thứ 25. `logout`/`logout-all` xóa phiên nên kiểm riêng ở ca bên dưới.
  { method: 'post', path: '/account/claim', access: 'customer+detached', isNew: true },
];

/** Hai điểm cuối kết thúc phiên (004, 009 thêm +detached): mỗi lần kiểm dùng bộ người gọi MỚI. */
const SESSION_ENDERS = ['/auth/logout', '/auth/logout-all'] as const;

type RealState = 'anonymous' | 'owner' | 'collaborator' | 'unverified' | 'detached' | 'support';
const REAL_STATES: RealState[] = [
  'anonymous',
  'owner',
  'collaborator',
  'unverified',
  'detached',
  'support',
];

/** `pass` = qua lớp chặn quyền; còn lại là kết quả từ chối của lớp chặn. */
function expectedOutcome(state: RealState, access: Access): string {
  if (access === 'public') return 'pass';
  if (state === 'anonymous' || state === 'support') return '401';
  const allowsUnverified = access === 'customer+unverified+detached';
  const allowsDetached = access !== 'customer' && access !== 'members.manage';
  if (state === 'detached') return allowsDetached ? 'pass' : '403:NO_ACCOUNT';
  if (state === 'unverified') return allowsUnverified ? 'pass' : '403:EMAIL_NOT_VERIFIED';
  if (state === 'collaborator' && access === 'members.manage') return '403:FORBIDDEN';
  return 'pass';
}

const GUARD_CODES = new Set([
  'NO_ACCOUNT',
  'FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  'ACCESS_NOT_DECLARED',
]);

function outcomeOf(res: { status: number; body: unknown }): string {
  if (res.status === 401) return '401';
  const code = (res.body as Partial<ErrorBody> | undefined)?.error?.code;
  if (res.status === 403 && code !== undefined && GUARD_CODES.has(code)) return `403:${code}`;
  return 'pass';
}

/** Một bộ người gọi đủ 6 trạng thái (chủ + cộng tác viên + người bị gỡ cùng một tài khoản). */
async function makeAgents(t: TestApp): Promise<Record<RealState, Agent>> {
  const owner = await registerAndVerify(t);
  return {
    anonymous: t.agent(),
    owner: owner.agent,
    collaborator: (await collaboratorOf(t, owner.me)).agent,
    unverified: (await unverifiedOwner(t)).agent,
    detached: (await detachedOf(t, owner)).agent,
    support: (await staffAgent(t, 'support')).agent,
  };
}

describeDb('Mức truy cập của điểm cuối thật – 009 T084', () => {
  let t: TestApp;
  let agents: Record<RealState, Agent>;
  beforeAll(async () => {
    t = await createTestApp();
    agents = await makeAgents(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it.each(SESSION_ENDERS)(
    '%s: khách hàng (kể cả người ở tài khoản chờ) gọi được, ẩn danh/nhân viên 401',
    async (path) => {
      const fresh = await makeAgents(t);
      const mismatches: string[] = [];
      for (const state of REAL_STATES) {
        const got = outcomeOf(await fresh[state].post(`/api/v1${path}`, {}));
        const want = expectedOutcome(state, 'customer+unverified+detached');
        if (got !== want) mismatches.push(`${state} × POST ${path}: ${got} ≠ ${want}`);
      }
      expect(mismatches).toEqual([]);
    },
  );

  it('bảng phủ đủ 25 điểm cuối mới của 009', () => {
    expect(REAL.filter((e) => e.isNew)).toHaveLength(25);
  });

  it('6 loại người gọi × mọi điểm cuối khớp bảng truy cập của hợp đồng', async () => {
    const mismatches: string[] = [];
    for (const state of REAL_STATES) {
      for (const ep of REAL) {
        const url = `/api/v1${ep.path}`;
        const agent = agents[state];
        let res;
        if (ep.method === 'get') res = await agent.get(url);
        else if (ep.method === 'delete') res = await agent.delete(url);
        else if (ep.method === 'patch') res = await agent.patch(url, {});
        else res = await agent.post(url, {});
        const got = outcomeOf(res);
        const want = expectedOutcome(state, ep.access);
        if (got !== want)
          mismatches.push(`${state} × ${ep.method.toUpperCase()} ${ep.path}: ${got} ≠ ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
