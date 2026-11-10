import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { EXIT_ENV, EXIT_INPUT, EXIT_OK, runStaffCli } from '../../src/ops/staff';
import { asOwner, dbUrls, describeDb } from '../db/helpers/db';
import { TEST_AUTH_ENV } from '../helpers/auth-env';

// T066 (US4, contracts/auth-ops.md mục 2): lệnh `pnpm staff …` trên CSDL thật.

const env = { APP_ENV: 'test', ...TEST_AUTH_ENV, DATABASE_APP_URL: dbUrls.app };

function sink() {
  let text = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += String(chunk);
      cb();
    },
  });
  return { stream, text: () => text };
}

async function run(argv: string[], stdin = '', overrideEnv: Record<string, string> = env) {
  const out = sink();
  const err = sink();
  const code = await runStaffCli(argv, {
    env: overrideEnv,
    stdin: Readable.from([stdin]),
    stdout: out.stream,
    stderr: err.stream,
  });
  return { code, out: out.text(), err: err.text() };
}

const email = () => `nv.${randomBytes(4).toString('hex')}@example.test`;
const PASSWORD = 'Mat-khau-nhan-vien-2026';

describeDb('pnpm staff', () => {
  it('create đọc mật khẩu từ stdin, áp chính sách; tạo trùng → 1', async () => {
    const e = email();
    const weak = await run(
      ['create', '--email', e, '--name', 'Lan', '--role', 'support'],
      '123456789\n',
    );
    expect(weak.code).toBe(EXIT_INPUT);
    const ok = await run(
      ['create', '--email', e, '--name', 'Lan', '--role', 'support'],
      `${PASSWORD}\n`,
    );
    expect(ok.code).toBe(EXIT_OK);
    expect(ok.out).toContain(e);
    const dup = await run(
      ['create', '--email', e, '--name', 'Lan', '--role', 'support'],
      `${PASSWORD}\n`,
    );
    expect(dup.code).toBe(EXIT_INPUT);
    const audit = await asOwner(
      async (c) =>
        (
          await c.query<{ actor_type: string; actor_id: string }>(
            `SELECT actor_type, actor_id FROM infra.audit_log WHERE action = 'staff.created'
            ORDER BY occurred_at DESC LIMIT 1`,
          )
        ).rows[0],
    );
    expect(audit).toEqual({ actor_type: 'system', actor_id: 'ops-cli' });
  });

  it('không nhận mật khẩu qua tham số; tham số sai → 1', async () => {
    const r = await run(['create', '--email', email(), '--password', 'x'], '');
    expect(r.code).toBe(EXIT_INPUT);
    expect(
      (await run(['create', '--email', email(), '--name', 'A', '--role', 'boss'], PASSWORD)).code,
    ).toBe(EXIT_INPUT);
    expect((await run(['xoa-het'])).code).toBe(EXIT_INPUT);
  });

  it('disable và reset-password thu hồi mọi phiên; không tìm thấy → 1', async () => {
    const e = email();
    await run(['create', '--email', e, '--name', 'Minh', '--role', 'admin'], `${PASSWORD}\n`);
    // Phiên giả để kiểm thu hồi.
    await asOwner((c) =>
      c.query(
        `INSERT INTO account.staff_sessions (id, staff_user_id, token_hash, idle_expires_at, absolute_expires_at)
         SELECT gen_random_uuid(), id, $2, now() + interval '30 minutes', now() + interval '12 hours'
           FROM account.staff_users WHERE email_normalized = $1`,
        [e, randomBytes(32)],
      ),
    );
    const active = () =>
      asOwner(async (c) =>
        Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM account.staff_sessions s JOIN account.staff_users u
                 ON u.id = s.staff_user_id WHERE u.email_normalized = $1 AND s.revoked_at IS NULL`,
              [e],
            )
          ).rows[0]?.n,
        ),
      );
    expect(await active()).toBe(1);
    expect((await run(['reset-password', '--email', e], 'Mat-khau-moi-cua-nv-99\n')).code).toBe(
      EXIT_OK,
    );
    expect(await active()).toBe(0);
    expect((await run(['disable', '--email', e])).code).toBe(EXIT_OK);
    expect((await run(['disable', '--email', email()])).code).toBe(EXIT_INPUT);
  });

  it('list không in băm mật khẩu', async () => {
    const e = email();
    await run(['create', '--email', e, '--name', 'Hà', '--role', 'support'], `${PASSWORD}\n`);
    const r = await run(['list']);
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain(`${e}\tHà\tsupport\tactive`);
    expect(r.out).not.toContain('$argon2');
  });

  it('thiếu cấu hình hoặc không kết nối được → 2, không lộ mật khẩu chuỗi kết nối', async () => {
    expect((await run(['list'], '', { APP_ENV: 'test' })).code).toBe(EXIT_ENV);
    const r = await run(['list'], '', {
      ...env,
      DATABASE_APP_URL: 'postgres://app:mat-khau-ket-noi@127.0.0.1:1/app',
    });
    expect(r.code).toBe(EXIT_ENV);
    expect(r.err).not.toContain('mat-khau-ket-noi');
  });
});
