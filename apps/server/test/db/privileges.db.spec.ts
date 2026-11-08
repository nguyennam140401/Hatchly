// US4-AS6, FR-024, quy tắc g: vai trò app không vượt được RLS bằng bất kỳ cách nào.
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { createAccount, dbUrls, describeDb } from './helpers/db';

describeDb('Quyền của vai trò app', () => {
  let c: Client;
  let a: string;

  beforeAll(async () => {
    a = await createAccount();
    c = new Client({ connectionString: dbUrls.app });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });

  const code = async (text: string, values: unknown[] = []) => {
    try {
      await c.query(text, values);
      return 'ok';
    } catch (err) {
      return (err as { code?: string }).code ?? 'unknown';
    }
  };

  it.each([['SET ROLE "owner"'], ['SET ROLE "system"'], ['SET ROLE "support"']])(
    '%s → bị từ chối',
    async (statement) => {
      expect(await code(statement)).toBe('42501');
    },
  );

  it('ALTER TABLE … DISABLE ROW LEVEL SECURITY → bị từ chối', async () => {
    expect(await code('ALTER TABLE sandbox.tenant_notes DISABLE ROW LEVEL SECURITY')).toBe('42501');
  });

  it('SET row_security = off rồi SELECT bảng có chính sách → lỗi', async () => {
    await c.query('SET row_security = off');
    try {
      expect(await code('SELECT * FROM sandbox.tenant_notes')).toBe('42501');
    } finally {
      await c.query('RESET row_security');
    }
  });

  it('infra.audit_log: INSERT được; SELECT/UPDATE/DELETE bị từ chối', async () => {
    expect(
      await code(
        `INSERT INTO infra.audit_log (id, actor_type, actor_id, action) VALUES ($1, 'system', 'x', 'test.insert')`,
        [uuidV7()],
      ),
    ).toBe('ok');
    expect(await code('SELECT * FROM infra.audit_log')).toBe('42501');
    expect(await code("UPDATE infra.audit_log SET reason = 'x'")).toBe('42501');
    expect(await code('DELETE FROM infra.audit_log')).toBe('42501');
  });

  it('account.accounts: INSERT/DELETE bị từ chối', async () => {
    expect(
      await code("INSERT INTO account.accounts (id, status) VALUES ($1, 'active')", [uuidV7()]),
    ).toBe('42501');
    expect(await code('DELETE FROM account.accounts WHERE id = $1', [a])).toBe('42501');
  });

  it('infra.ensure_audit_log_partitions chỉ cho system', async () => {
    expect(await code('SELECT infra.ensure_audit_log_partitions(1)')).toBe('42501');
  });
});
