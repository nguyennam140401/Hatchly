// FR-007: nhật ký ghi bên trong giao dịch tenant có account_id của tài khoản đó.
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { executionStorage } from '../../src/core/context/execution-storage';
import { logContextMixin, REDACT_PATHS } from '../../src/core/logging/logging.module';
import {
  createAccount,
  describeDb,
  makeDatabase,
  withAccount,
  type TestDatabase,
} from './helpers/db';

function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  // Cùng mixin với LoggingModule (nestjs-pino).
  return { lines, logger: pino({ mixin: logContextMixin, messageKey: 'msg' }, stream) };
}

describeDb('account_id trong nhật ký', () => {
  let database: TestDatabase;
  let a: string;

  beforeAll(async () => {
    database = makeDatabase();
    a = await createAccount();
  });
  afterAll(async () => {
    await database.close();
  });

  it('bên trong tenantTx của A → account_id = A; ngoài mọi ngữ cảnh → null', async () => {
    const { lines, logger } = memoryLogger();
    logger.info({ msg: 'ngoai' });
    await withAccount(a, () =>
      tenantTx(async () => {
        logger.info({ msg: 'trong' });
      }),
    );
    expect(lines.find((l) => l.msg === 'ngoai')).toMatchObject({
      account_id: null,
      trace_id: null,
    });
    expect(lines.find((l) => l.msg === 'trong')).toMatchObject({ account_id: a });
    expect(typeof lines.find((l) => l.msg === 'trong')?.trace_id).toBe('string');
  });

  it('ngoài giao dịch nhưng trong ExecutionContext có accountId → account_id theo ngữ cảnh', async () => {
    const { lines, logger } = memoryLogger();
    await withAccount(a, async () => {
      logger.info({ msg: 'viec' });
    });
    expect(lines[0]).toMatchObject({ msg: 'viec', account_id: a });
  });

  it('có người gọi đã xác thực → actor_id, actor_kind trên mọi dòng (004)', async () => {
    const { lines, logger } = memoryLogger();
    await executionStorage.run(
      {
        traceId: 't',
        source: 'request',
        accountId: a,
        actor: {
          kind: 'user',
          userId: 'user-1',
          accountId: a,
          role: 'owner',
          emailVerified: true,
          sessionId: 's',
          detached: false,
        },
      },
      async () => {
        logger.info({ msg: 'khach' });
      },
    );
    await executionStorage.run(
      {
        traceId: 't2',
        source: 'request',
        actor: { kind: 'staff', staffId: 'staff-1', role: 'support', sessionId: 's2' },
      },
      async () => {
        logger.info({ msg: 'nhan_vien' });
      },
    );
    logger.info({ msg: 'an_danh' });
    expect(lines.find((l) => l.msg === 'khach')).toMatchObject({
      actor_id: 'user-1',
      actor_kind: 'user',
      account_id: a,
    });
    expect(lines.find((l) => l.msg === 'nhan_vien')).toMatchObject({
      actor_id: 'staff-1',
      actor_kind: 'staff',
    });
    expect(lines.find((l) => l.msg === 'an_danh')).toMatchObject({
      actor_id: null,
      actor_kind: null,
    });
  });

  it('pino che cookie, set-cookie và trường mật khẩu/mã (R13)', () => {
    const { lines, logger } = memoryLoggerWithRedact();
    logger.info({
      msg: 'x',
      req: { headers: { cookie: '__Host-sid=abc', authorization: 'Bearer z' } },
      res: { headers: { 'set-cookie': '__Host-sid=abc' } },
      body: { password: 'p1', currentPassword: 'p2', newPassword: 'p3', token: 't1' },
    });
    const text = JSON.stringify(lines[0]);
    for (const secretValue of ['abc', 'Bearer z', 'p1', 'p2', 'p3', 't1']) {
      expect(text).not.toContain(secretValue);
    }
  });
});

function memoryLoggerWithRedact() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return {
    lines,
    logger: pino(
      { redact: { paths: REDACT_PATHS, censor: '[đã che]' }, messageKey: 'msg' },
      stream,
    ),
  };
}
