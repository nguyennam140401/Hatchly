// FR-007: nhật ký ghi bên trong giao dịch tenant có account_id của tài khoản đó.
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tenantTx } from '../../src/core/db/transaction';
import { logContextMixin } from '../../src/core/logging/logging.module';
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
});
