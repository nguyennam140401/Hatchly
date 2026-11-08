// Clarifications / edge case: xóa hẳn tài khoản → dữ liệu tenant của nó biến mất (ON DELETE CASCADE)
// trong cùng giao dịch; dữ liệu tài khoản khác và nhật ký kiểm toán còn nguyên.
import { expect, it } from 'vitest';
import { uuidV7 } from '../../src/core/ids/uuid-v7';
import { asOwner, countByAccount, createAccount, describeDb, seedNotes } from './helpers/db';

describeDb('Xóa hẳn tài khoản', () => {
  it('xóa accounts A bằng owner → mọi dòng của A ở tenant_notes mất; dòng B, audit_log của A còn', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seedNotes(a, 3);
    await seedNotes(b, 2);
    await asOwner((c) =>
      c.query(
        `INSERT INTO infra.audit_log (id, account_id, actor_type, actor_id, action, reason)
         VALUES ($1, $2, 'support', 'nv-1', 'support.view_account', 'kiểm tra lỗi')`,
        [uuidV7(), a],
      ),
    );

    await asOwner(async (c) => {
      await c.query('BEGIN');
      await c.query('DELETE FROM account.accounts WHERE id = $1', [a]);
      // Trong CÙNG giao dịch, dòng con đã mất.
      const inside = await c.query('SELECT 1 FROM sandbox.tenant_notes WHERE account_id = $1', [a]);
      expect(inside.rowCount).toBe(0);
      await c.query('COMMIT');
    });

    const counts = await countByAccount('sandbox.tenant_notes');
    expect(counts[a]).toBeUndefined();
    expect(counts[b]).toBe(2);
    const audit = await asOwner((c) =>
      c.query('SELECT 1 FROM infra.audit_log WHERE account_id = $1', [a]),
    );
    expect(audit.rowCount).toBe(1);
  });
});
