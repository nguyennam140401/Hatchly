import type { Server } from 'node:http';
import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerAccess, Public, StaffAccess } from '../../src/core/auth/access.decorators';
import { can, currentActor } from '../../src/core/auth/actor';
import { AuthModule } from '../../src/core/auth/auth.module';
import { hashToken } from '../../src/core/auth/cookies';
import { SessionCache } from '../../src/core/auth/session-cache';
import { SESSION_RESOLVER, type SessionResolver } from '../../src/core/auth/session-resolver';
import { resolveAuthConfig } from '../../src/core/config/auth-config';
import { loadConfig } from '../../src/core/config/load-config';
import type { CustomerActor, StaffActor } from '../../src/core/context/actor.types';
import { requestContextMiddleware } from '../../src/core/context/request-context';
import { CoreModule } from '../../src/core/core.module';
import { currentAccountId } from '../../src/core/db/transaction';
import { TEST_AUTH_ENV } from '../helpers/auth-env';

// T027 (R7, contracts/authz-api.md mục 6): AccessGuard với SessionResolver giả – từng dòng của bảng
// quyết định. Ghi kiểm toán nhân viên được thay bằng hàm giả (kiểm thật ở staff.e2e).

const audits = vi.hoisted(() => [] as { result: string }[]);
vi.mock('../../src/core/auth/staff-audit', () => ({
  writeStaffRequestAudit: (entry: { result: string }) => {
    audits.push(entry);
    return Promise.resolve();
  },
}));

@Controller('t')
class GuardTestController {
  @Get('undeclared')
  undeclared(): string {
    return 'không bao giờ tới';
  }

  @Get('public')
  @Public()
  pub(): unknown {
    return { actor: currentActor()?.kind ?? null, account: currentAccountId() };
  }

  @Get('me')
  @CustomerAccess({ allowUnverifiedEmail: true })
  me(): unknown {
    return { actor: currentActor(), account: currentAccountId() };
  }

  @Get('verified')
  @CustomerAccess()
  verified(): string {
    return 'ok';
  }

  // 009: điểm cuối cá nhân mở cho người ở tài khoản chờ.
  @Get('personal')
  @CustomerAccess({ allowDetached: true })
  personal(): unknown {
    return { actor: currentActor(), account: currentAccountId(), canApprove: can('post.approve') };
  }

  @Get('personal-unverified')
  @CustomerAccess({ allowDetached: true, allowUnverifiedEmail: true })
  personalUnverified(): string {
    return 'ok';
  }

  // Khai báo SAI (kiểm tra khởi động bắt); guard vẫn phải từ chối.
  @Get('personal-with-permission')
  @CustomerAccess({ allowDetached: true }, 'post.approve')
  personalWithPermission(): string {
    return 'không bao giờ tới với người ở tài khoản chờ';
  }

  @Post('approve/:accountId')
  @CustomerAccess('post.approve')
  approve(): unknown {
    return { account: currentAccountId() };
  }

  @Get('staff')
  @StaffAccess('support.lookup')
  staff(): unknown {
    return { actor: currentActor() };
  }

  @Get('admin')
  @StaffAccess('plan.manage')
  admin(): string {
    return 'ok';
  }
}

const far = new Date(Date.now() + 86_400_000);
const owner: CustomerActor = {
  kind: 'user',
  userId: 'u-owner',
  accountId: 'acc-a',
  role: 'owner',
  emailVerified: true,
  sessionId: 's1',
  detached: false,
};
const collaborator: CustomerActor = { ...owner, userId: 'u-col', role: 'collaborator' };
const unverified: CustomerActor = { ...owner, userId: 'u-unv', emailVerified: false };
// 009: người ở tài khoản chờ – giữ ghế chủ của tài khoản chờ nhưng không có quyền nào.
const detached: CustomerActor = {
  ...owner,
  userId: 'u-det',
  accountId: 'acc-shell',
  detached: true,
};
const detachedUnverified: CustomerActor = {
  ...detached,
  userId: 'u-det-unv',
  emailVerified: false,
};
const support: StaffActor = { kind: 'staff', staffId: 'st-1', role: 'support', sessionId: 's9' };

const customers: Record<string, CustomerActor> = {
  'tok-owner': owner,
  'tok-col': collaborator,
  'tok-unv': unverified,
  'tok-det': detached,
  'tok-det-unv': detachedUnverified,
};
const staffs: Record<string, StaffActor> = { 'tok-support': support };

const byHash = <A>(table: Record<string, A>) =>
  new Map(Object.entries(table).map(([t, a]) => [hashToken(t).toString('hex'), a]));

describe('AccessGuard', () => {
  let app: INestApplication;
  let cache: SessionCache;
  const customerMap = byHash(customers);
  const staffMap = byHash(staffs);
  const resolver: SessionResolver & { calls: number; fail: boolean } = {
    calls: 0,
    fail: false,
    resolveCustomer(hash) {
      this.calls++;
      if (this.fail)
        return Promise.reject(Object.assign(new Error('db down'), { code: 'ECONNREFUSED' }));
      const actor = customerMap.get(hash.toString('hex'));
      return Promise.resolve(actor === undefined ? null : { actor, absoluteExpiresAt: far });
    },
    resolveStaff(hash) {
      this.calls++;
      const actor = staffMap.get(hash.toString('hex'));
      return Promise.resolve(actor === undefined ? null : { actor, absoluteExpiresAt: far });
    },
  };

  beforeAll(async () => {
    const config = loadConfig({
      APP_ENV: 'test',
      LOG_LEVEL: 'fatal',
      ...TEST_AUTH_ENV,
      STAFF_ALLOWED_CIDRS: '10.0.0.0/8,127.0.0.1/32,::1/128',
      DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot('api', config),
        AuthModule.forRoot(resolveAuthConfig(config), { accessScan: 'log' }),
      ],
      controllers: [GuardTestController],
      providers: [{ provide: SESSION_RESOLVER, useValue: resolver }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestContextMiddleware);
    await app.init();
    cache = app.get(SessionCache);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    cache.clear();
    resolver.calls = 0;
    resolver.fail = false;
    audits.length = 0;
  });

  const http = () => request(app.getHttpServer() as Server);
  const sid = (t: string) => `__Host-sid=${t}`;
  const staffSid = (t: string) => `__Host-staff_sid=${t}`;

  it('thiếu khai báo → 403 ACCESS_NOT_DECLARED', async () => {
    const res = await http().get('/t/undeclared').set('cookie', sid('tok-owner')).expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('ACCESS_NOT_DECLARED');
  });

  it('@Public không cookie → qua, không người gọi', async () => {
    const res = await http().get('/t/public').expect(200);
    expect(res.body).toEqual({ actor: null, account: null });
  });

  it('@Public có cookie hợp lệ → gắn người gọi nhưng KHÔNG gắn tài khoản', async () => {
    const res = await http().get('/t/public').set('cookie', sid('tok-owner')).expect(200);
    expect(res.body).toEqual({ actor: 'user', account: null });
  });

  it('@Public khi tra phiên lỗi → vẫn qua như chưa đăng nhập', async () => {
    resolver.fail = true;
    const res = await http().get('/t/public').set('cookie', sid('tok-owner')).expect(200);
    expect(res.body).toEqual({ actor: null, account: null });
  });

  it('@CustomerAccess không cookie / cookie sai → 401 UNAUTHENTICATED, xóa cookie sai', async () => {
    const none = await http().get('/t/me').expect(401);
    expect((none.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    const bad = await http().get('/t/me').set('cookie', sid('tok-nope')).expect(401);
    expect(String(bad.headers['set-cookie'])).toMatch(/__Host-sid=; .*Max-Age=0/);
    // 011: phiên có cookie nhưng không còn hiệu lực → kèm `reason`; không cookie → không có `reason`.
    expect((bad.body as { error: { reason?: string } }).error.reason).toBe('expired');
    expect((none.body as { error: { reason?: string } }).error.reason).toBeUndefined();
  });

  it('@CustomerAccess chỉ đọc __Host-sid – cookie nhân viên → 401', async () => {
    await http().get('/t/me').set('cookie', staffSid('tok-support')).expect(401);
  });

  it('@CustomerAccess hợp lệ → người gọi + tài khoản từ phiên', async () => {
    const res = await http().get('/t/me').set('cookie', sid('tok-owner')).expect(200);
    expect(res.body).toMatchObject({ actor: { userId: 'u-owner' }, account: 'acc-a' });
  });

  it('dùng bộ nhớ đệm: lần hai không gọi SessionResolver', async () => {
    await http().get('/t/me').set('cookie', sid('tok-owner')).expect(200);
    await http().get('/t/me').set('cookie', sid('tok-owner')).expect(200);
    expect(resolver.calls).toBe(1);
  });

  it('chưa xác nhận email → 403 EMAIL_NOT_VERIFIED (trừ allowUnverifiedEmail)', async () => {
    const res = await http().get('/t/verified').set('cookie', sid('tok-unv')).expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('EMAIL_NOT_VERIFIED');
    await http().get('/t/me').set('cookie', sid('tok-unv')).expect(200);
  });

  it('thiếu quyền → 403 FORBIDDEN, lời giải thích + contact_owner cho cộng tác viên', async () => {
    const res = await http()
      .post('/t/approve/acc-b')
      .set('cookie', sid('tok-col'))
      .send({ accountId: 'acc-b' })
      .expect(403);
    const err = (
      res.body as { error: { code: string; message: string; actions: { kind: string }[] } }
    ).error;
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Chỉ chủ tài khoản mới duyệt được bài.');
    expect(err.actions.map((a) => a.kind)).toContain('contact_owner');
  });

  it('mã tài khoản chỉ từ phiên – bỏ qua path/body', async () => {
    const res = await http()
      .post('/t/approve/acc-b')
      .set('cookie', sid('tok-owner'))
      .send({ accountId: 'acc-b' })
      .expect(201);
    expect(res.body).toEqual({ account: 'acc-a' });
  });

  it('lỗi CSDL khi tra phiên → 503 SERVICE_UNAVAILABLE, không cho qua', async () => {
    resolver.fail = true;
    const res = await http().get('/t/me').set('cookie', sid('tok-owner')).expect(503);
    expect((res.body as { error: { code: string } }).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('@StaffAccess chỉ đọc __Host-staff_sid – cookie khách hàng → 401', async () => {
    await http().get('/t/staff').set('cookie', sid('tok-owner')).expect(401);
    await http().get('/t/staff').expect(401);
  });

  it('@StaffAccess hợp lệ trong dải mạng → 200', async () => {
    const res = await http().get('/t/staff').set('cookie', staffSid('tok-support')).expect(200);
    expect(res.body).toMatchObject({ actor: { staffId: 'st-1', role: 'support' } });
  });

  it('@StaffAccess thiếu quyền → 403 FORBIDDEN, ghi kiểm toán', async () => {
    await http().get('/t/admin').set('cookie', staffSid('tok-support')).expect(403);
    expect(audits.map((a) => a.result)).toEqual(['forbidden']);
  });

  it('khách hàng không gọi được điểm cuối nhân viên và ngược lại', async () => {
    await http().get('/t/verified').set('cookie', staffSid('tok-support')).expect(401);
    await http().get('/t/admin').set('cookie', sid('tok-owner')).expect(401);
  });
});

describe('AccessGuard – dải mạng nhân viên', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const config = loadConfig({
      APP_ENV: 'test',
      LOG_LEVEL: 'fatal',
      ...TEST_AUTH_ENV,
      STAFF_ALLOWED_CIDRS: '10.0.0.0/8',
      DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
    });
    const resolver: SessionResolver = {
      resolveCustomer: () => Promise.resolve(null),
      resolveStaff: () => Promise.resolve({ actor: support, absoluteExpiresAt: far }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot('api', config),
        AuthModule.forRoot(resolveAuthConfig(config), { accessScan: 'log' }),
      ],
      controllers: [GuardTestController],
      providers: [{ provide: SESSION_RESOLVER, useValue: resolver }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestContextMiddleware);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('ngoài STAFF_ALLOWED_CIDRS → 403 IP_NOT_ALLOWED, ghi kiểm toán denied_ip', async () => {
    audits.length = 0;
    const res = await request(app.getHttpServer() as Server)
      .get('/t/staff')
      .set('cookie', '__Host-staff_sid=tok-support')
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('IP_NOT_ALLOWED');
    expect(audits.map((a) => a.result)).toEqual(['denied_ip']);
  });
});

describe('AccessGuard – người ở tài khoản chờ (009, contracts/module-api.md mục 1)', () => {
  let app: INestApplication;
  const customerMap = byHash(customers);
  const resolver: SessionResolver = {
    resolveCustomer(hash) {
      const actor = customerMap.get(hash.toString('hex'));
      return Promise.resolve(actor === undefined ? null : { actor, absoluteExpiresAt: far });
    },
    resolveStaff: () => Promise.resolve(null),
  };
  const warnings: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const config = loadConfig({
      APP_ENV: 'test',
      LOG_LEVEL: 'fatal',
      ...TEST_AUTH_ENV,
      DATABASE_APP_URL: 'postgres://app:x@127.0.0.1:1/app',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot('api', config),
        AuthModule.forRoot(resolveAuthConfig(config), { accessScan: 'log' }),
      ],
      controllers: [GuardTestController],
      providers: [{ provide: SESSION_RESOLVER, useValue: resolver }],
    }).compile();
    app = moduleRef.createNestApplication({
      logger: {
        log: () => undefined,
        error: () => undefined,
        warn: (entry: unknown) => {
          if (typeof entry === 'object' && entry !== null) {
            warnings.push(entry as Record<string, unknown>);
          }
        },
      },
    });
    app.use(requestContextMiddleware);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    warnings.length = 0;
  });

  const http = () => request(app.getHttpServer() as Server);
  const sid = (t: string) => `__Host-sid=${t}`;
  const code = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;

  it('không có allowDetached → 403 NO_ACCOUNT + nhật ký auth.denied (reason: detached)', async () => {
    for (const path of ['/t/me', '/t/verified']) {
      const res = await http().get(path).set('cookie', sid('tok-det')).expect(403);
      expect(code(res), path).toBe('NO_ACCOUNT');
      expect((res.body as { error: { actions: { href?: string }[] } }).error.actions[0]?.href).toBe(
        '/no-account',
      );
    }
    const denied = warnings.filter((w) => w.event === 'auth.denied');
    expect(denied).toHaveLength(2);
    expect(denied[0]).toMatchObject({
      reason: 'detached',
      actor_id: 'u-det',
      account_id: 'acc-shell',
    });
  });

  it('điểm cuối đòi quyền → NO_ACCOUNT (không phải FORBIDDEN) dù vai trò dữ liệu là owner', async () => {
    const res = await http()
      .post('/t/approve/acc-a')
      .set('cookie', sid('tok-det'))
      .set('origin', 'http://app.test')
      .expect(403);
    expect(code(res)).toBe('NO_ACCOUNT');
  });

  it('kiểm detached chạy SAU khi gắn người gọi và TRƯỚC kiểm email', async () => {
    // Chưa xác minh + ở tài khoản chờ, điểm cuối không có cờ nào → NO_ACCOUNT, không phải EMAIL_NOT_VERIFIED.
    const res = await http().get('/t/verified').set('cookie', sid('tok-det-unv')).expect(403);
    expect(code(res)).toBe('NO_ACCOUNT');
    // Có allowDetached nhưng không allowUnverifiedEmail → tới bước kiểm email.
    const email = await http().get('/t/personal').set('cookie', sid('tok-det-unv')).expect(403);
    expect(code(email)).toBe('EMAIL_NOT_VERIFIED');
    await http().get('/t/personal-unverified').set('cookie', sid('tok-det-unv')).expect(200);
  });

  it('allowDetached → qua, gắn người gọi + tài khoản chờ; can() luôn false', async () => {
    const res = await http().get('/t/personal').set('cookie', sid('tok-det')).expect(200);
    expect(res.body).toMatchObject({
      actor: { userId: 'u-det', detached: true },
      account: 'acc-shell',
      canApprove: false,
    });
    // Người thuộc tài khoản thật vẫn dùng điểm cuối này bình thường.
    const normal = await http().get('/t/personal').set('cookie', sid('tok-owner')).expect(200);
    expect(normal.body).toMatchObject({ actor: { detached: false }, canApprove: true });
  });

  it('allowDetached kèm quyền (khai báo sai) → guard vẫn từ chối người ở tài khoản chờ', async () => {
    const res = await http()
      .get('/t/personal-with-permission')
      .set('cookie', sid('tok-det'))
      .expect(403);
    expect(code(res)).toBe('FORBIDDEN');
    await http().get('/t/personal-with-permission').set('cookie', sid('tok-owner')).expect(200);
  });
});
