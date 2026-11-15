import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import request, { type Response as TestResponse } from 'supertest';
import { ApiAppModule } from '../../../src/app/api-app.module';
import { configureApiApp } from '../../../src/app/configure-api-app';
import type { AccessScanMode } from '../../../src/core/auth/auth.module';
import { SessionCache } from '../../../src/core/auth/session-cache';
import { loadConfig } from '../../../src/core/config/load-config';
import { ShutdownCoordinator } from '../../../src/core/lifecycle/shutdown-coordinator';
import { MAILER, type MailMessage } from '../../../src/core/mail/mailer';
import type { MemoryMailTransport } from '../../../src/core/mail/memory.transport';
import { TEST_AUTH_ENV, TEST_ORIGIN } from '../../helpers/auth-env';
import { dbUrls } from '../../db/helpers/db';

// Khung kiểm thử e2e xác thực (004, T037): ApiAppModule THẬT trên CSDL thử của 002 (`pnpm test:db`),
// thư giữ trong bộ nhớ, argon2 tham số nhỏ, Origin cố định. Cookie được giữ bằng hũ cookie tự viết:
// cookie phiên là `Secure; __Host-` nên hũ của superagent không gửi lại qua http.

export interface LogLine extends Record<string, unknown> {
  msg?: string;
  level?: number;
}

export interface TestApp {
  app: INestApplication;
  server: Server;
  mail: MemoryMailTransport;
  logs: LogLine[];
  /** Văn bản gốc của mọi dòng nhật ký (để quét bí mật). */
  rawLogs: string[];
  cache: SessionCache;
  agent: (options?: { origin?: string | null; ip?: string }) => Agent;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  extraImports?: Type[];
  accessScan?: AccessScanMode;
  env?: Record<string, string>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'info',
    ...TEST_AUTH_ENV,
    DATABASE_APP_URL: dbUrls.app,
    DATABASE_SUPPORT_URL: dbUrls.support,
    DATABASE_SYSTEM_URL: dbUrls.system,
    // Mỗi agent gắn X-Forwarded-For riêng → bộ đếm theo địa chỉ mạng không tràn giữa các ca.
    TRUST_PROXY_HOPS: '1',
    ...options.env,
  });
  const rawLogs: string[] = [];
  const logs: LogLine[] = [];
  const destination = {
    write(chunk: string) {
      rawLogs.push(chunk);
      try {
        logs.push(JSON.parse(chunk) as LogLine);
      } catch {
        // dòng không phải JSON – vẫn giữ ở rawLogs
      }
      return true;
    },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      ApiAppModule.forRoot(config, {
        accessScan: options.accessScan ?? (options.extraImports ? 'log' : 'throw'),
        logDestination: destination,
      }),
      ...(options.extraImports ?? []),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  // Như src/api.ts: Logger của NestJS ghi qua pino → bắt được dòng auth.denied, auth.access_not_declared…
  app.useLogger(app.get(PinoLogger));
  configureApiApp(app, config);
  await app.init();
  app.get(ShutdownCoordinator).markReady();
  const server = app.getHttpServer() as Server;
  return {
    app,
    server,
    mail: app.get<MemoryMailTransport>(MAILER),
    logs,
    rawLogs,
    cache: app.get(SessionCache),
    agent: (o) =>
      new Agent(server, o?.origin === undefined ? TEST_ORIGIN : o.origin, o?.ip ?? randomIp()),
    close: () => app.close(),
  };
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** Tác nhân giữ cookie (như trình duyệt), tự gắn Origin cho yêu cầu thay đổi dữ liệu. */
export class Agent {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly server: Server,
    private readonly origin: string | null,
    /** Địa chỉ mạng giả của "trình duyệt" này (qua X-Forwarded-For, TRUST_PROXY_HOPS=1). */
    readonly ip: string,
  ) {}

  private send(
    method: Method,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    let req = request(this.server)[method](path).set('x-forwarded-for', this.ip);
    if (this.origin !== null && method !== 'get') req = req.set('origin', this.origin);
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie !== '') req = req.set('cookie', cookie);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    if (body !== undefined) req = req.send(body as object);
    return req.then((res) => {
      this.absorb(res.headers['set-cookie']);
      return res;
    });
  }

  private absorb(setCookie: unknown): void {
    const list = Array.isArray(setCookie) ? (setCookie as string[]) : [];
    for (const line of list) {
      const [pair, ...attrs] = line.split(';');
      if (pair === undefined) continue;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => a.trim().toLowerCase() === 'max-age=0');
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(path: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.send('get', path, undefined, headers);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.send('post', path, body ?? {}, headers);
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.send('patch', path, body ?? {}, headers);
  }
  put(path: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.send('put', path, body ?? {}, headers);
  }
  delete(path: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.send('delete', path, undefined, headers);
  }

  /** Mã phiên khách hàng hiện có (hoặc undefined). */
  get sid(): string | undefined {
    return this.cookies.get('__Host-sid');
  }
}

/** Địa chỉ IPv4 ngẫu nhiên trong 10.0.0.0/8. */
export function randomIp(): string {
  const b = randomBytes(3);
  return `10.${b[0] ?? 0}.${b[1] ?? 0}.${b[2] ?? 1}`;
}

export function uniqueEmail(prefix = 'chu'): string {
  return `${prefix}.${randomBytes(5).toString('hex')}@example.test`;
}

export const STRONG_PASSWORD = 'Hoa-sen-nở-2026!';

/** Chờ thư tới địa chỉ (thư gửi sau khi giao dịch xác nhận – setImmediate). */
export async function waitForMail(
  mail: MemoryMailTransport,
  to: string,
  predicate: (m: MailMessage) => boolean = () => true,
  timeoutMs = 3_000,
): Promise<MailMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = [...mail.messages()]
      .reverse()
      .find((m) => m.to.toLowerCase() === to.toLowerCase() && predicate(m));
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`Không có thư tới ${to}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Chờ hết các tác vụ gửi thư đang treo (để khẳng định "không có thư"). */
export async function settleMail(): Promise<void> {
  await new Promise((r) => setTimeout(r, 150));
}

/** Mã một lần trong liên kết `#token=…`. */
export function tokenFromMail(mail: MailMessage): string {
  const m = /#token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (m?.[1] === undefined) throw new Error('Thư không có liên kết #token=');
  return m[1];
}

/** Đăng ký + xác minh email; trả tác nhân đã đăng nhập. */
export async function registerAndVerify(
  t: TestApp,
  input: { email?: string; displayName?: string; password?: string } = {},
): Promise<{ agent: Agent; email: string; password: string; me: MeBody }> {
  const email = input.email ?? uniqueEmail();
  const password = input.password ?? STRONG_PASSWORD;
  const agent = t.agent();
  const reg = await agent.post('/api/v1/auth/register', {
    displayName: input.displayName ?? 'Chủ tiệm',
    email,
    password,
    acceptTerms: true,
    termsVersion: '2026-11',
  });
  if (reg.status !== 202) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const mail = await waitForMail(t.mail, email, (m) => m.text.includes('/verify-email#token='));
  const res = await agent.post('/api/v1/auth/email/verify', { token: tokenFromMail(mail) });
  if (res.status !== 200) throw new Error(`verify ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, email, password, me: res.body as MeBody };
}

export interface MeBody {
  user: { id: string; displayName: string; email: string; emailVerified: boolean };
  account: { id: string; status: string };
  role: 'owner' | 'collaborator';
  permissions: string[];
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    actions: { kind: string; label: string; href?: string }[];
    fieldErrors?: { path: string[]; message: string }[];
    support: { traceId: string; detail?: string };
    retryAfterSeconds?: number;
  };
}

// ----- 009: đăng nhập qua nhà cung cấp giả lập (OAUTH_DRIVER=fake) -----

export type FakeScenario =
  | 'google_verified'
  | 'google_unverified'
  | 'facebook_with_email'
  | 'facebook_no_email'
  | 'cancel'
  | 'provider_down';

export interface OAuthScenario {
  scenario: FakeScenario;
  sub?: string;
  email?: string;
  name?: string;
}

/** Nhà cung cấp của một kịch bản (`cancel`, `provider_down` mặc định Google). */
export function providerOf(scenario: FakeScenario): 'google' | 'facebook' {
  return scenario.startsWith('facebook') ? 'facebook' : 'google';
}

/** Đường dẫn + truy vấn của một địa chỉ tuyệt đối (để gọi lại máy chủ kiểm thử). */
export function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

/**
 * Đi tiếp từ `authorizationUrl` của bản giả lập: trang giả lập (chọn kịch bản) → đường quay về thật.
 * Trả phản hồi 303 của đường quay về; cookie của lượt/phiên nằm trong `agent`.
 */
export async function followFakeProvider(
  agent: Agent,
  authorizationUrl: string,
  input: OAuthScenario,
): Promise<TestResponse> {
  const authorize = new URL(authorizationUrl);
  authorize.searchParams.set('scenario', input.scenario);
  for (const key of ['sub', 'email', 'name'] as const) {
    const value = input[key];
    if (value !== undefined) authorize.searchParams.set(key, value);
  }
  const page = await agent.get(`${authorize.pathname}${authorize.search}`);
  if (page.status !== 302) throw new Error(`fake authorize ${page.status} ${page.text}`);
  return agent.get(pathOf(page.headers.location!));
}

/**
 * Chạy trọn vòng `start` → trang giả lập → `callback` với `purpose: 'login'`. Trả `agent` giữ cookie
 * (`__Host-oauth`, và `__Host-sid` nếu danh tính đã liên kết) cùng phản hồi của đường quay về.
 */
export async function oauthLogin(
  t: TestApp,
  input: OAuthScenario & { agent?: Agent; provider?: 'google' | 'facebook' },
): Promise<{ agent: Agent; callback: TestResponse }> {
  const agent = input.agent ?? t.agent();
  const provider = input.provider ?? providerOf(input.scenario);
  const start = await agent.post(`/api/v1/auth/oauth/${provider}/start`, { purpose: 'login' });
  if (start.status !== 200) throw new Error(`oauth start ${start.status} ${start.text}`);
  const { authorizationUrl } = start.body as { authorizationUrl: string };
  return { agent, callback: await followFakeProvider(agent, authorizationUrl, input) };
}

export interface PendingBody {
  provider: 'google' | 'facebook';
  purpose: string;
  stage: string;
  suggestedDisplayName: string | null;
  suggestedEmail: string | null;
  emailRequired: boolean;
  methods: string[];
  hint: string | null;
  error: { code: string; message: string; actions: { kind: string; label: string }[] } | null;
}

export async function oauthPending(agent: Agent): Promise<PendingBody> {
  const res = await agent.get('/api/v1/auth/oauth/pending');
  if (res.status !== 200) throw new Error(`pending ${res.status} ${res.text}`);
  return res.body as PendingBody;
}

/** Đăng ký người MỚI bằng nhà cung cấp giả lập (email đã xác minh) – trả tác nhân đã đăng nhập. */
export async function oauthSignup(
  t: TestApp,
  input: OAuthScenario & { displayName?: string },
): Promise<{ agent: Agent; me: MeBody }> {
  const { agent } = await oauthLogin(t, input);
  const res = await agent.post('/api/v1/auth/oauth/signup', {
    displayName: input.displayName ?? 'Chủ tiệm',
    acceptTerms: true,
    termsVersion: '2026-11',
  });
  if (res.status !== 200) throw new Error(`oauth signup ${res.status} ${res.text}`);
  return { agent, me: res.body as MeBody };
}
