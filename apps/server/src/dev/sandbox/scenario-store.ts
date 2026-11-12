import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { tenantTx } from '../../core/db';
import { uuidV7 } from '../../core/ids/uuid-v7';
import {
  requireFakeAccount,
  type FakeComponent,
  type FakeScenario,
  type PutScenario,
  type ScenarioStore,
} from '../fake-components';
import { fakeScenarios } from './schema';

// Kho kịch bản chế độ `sandbox` trên `sandbox.fake_scenarios` (RLS) – API và Worker thấy chung.

type Row = typeof fakeScenarios.$inferSelect;

function toScenario(r: Row): FakeScenario {
  return {
    id: r.id,
    component: r.component,
    target: r.target,
    spec: r.spec,
    remainingUses: r.remaining_uses,
    createdAt: r.created_at,
  };
}

export class SandboxScenarioStore implements ScenarioStore {
  put(input: PutScenario): Promise<FakeScenario> {
    const accountId = requireFakeAccount();
    return tenantTx(async (db) => {
      const [row] = await db
        .insert(fakeScenarios)
        .values({
          id: uuidV7(),
          account_id: accountId,
          component: input.component,
          target: input.target,
          spec: input.spec ?? {},
          remaining_uses: input.remainingUses ?? null,
          // clock_timestamp: các lệnh put trong cùng giao dịch vẫn giữ thứ tự.
          created_at: sql`clock_timestamp()`,
        })
        .returning();
      if (row === undefined) throw new Error('Không đọc lại được kịch bản vừa ghi');
      return toScenario(row);
    });
  }

  list(): Promise<FakeScenario[]> {
    return tenantTx(async (db) =>
      (
        await db
          .select()
          .from(fakeScenarios)
          .orderBy(asc(fakeScenarios.created_at), asc(fakeScenarios.id))
      ).map(toScenario),
    );
  }

  async delete(id: string): Promise<void> {
    await tenantTx((db) => db.delete(fakeScenarios).where(eq(fakeScenarios.id, id)));
  }

  async clear(): Promise<void> {
    await tenantTx((db) => db.delete(fakeScenarios));
  }

  take(component: FakeComponent, target: string, specKey?: string): Promise<FakeScenario | null> {
    return tenantTx(async (db) => {
      const [row] = await db
        .select()
        .from(fakeScenarios)
        .where(
          and(
            eq(fakeScenarios.component, component),
            inArray(fakeScenarios.target, [target, '*']),
            specKey === undefined ? undefined : sql`${fakeScenarios.spec} ? ${specKey}`,
          ),
        )
        .orderBy(
          desc(sql`${fakeScenarios.target} = ${target}`),
          asc(fakeScenarios.created_at),
          asc(fakeScenarios.id),
        )
        .limit(1)
        .for('update');
      if (row === undefined) return null;
      if (row.remaining_uses !== null) {
        const updated = await db
          .update(fakeScenarios)
          .set({ remaining_uses: sql`${fakeScenarios.remaining_uses} - 1` })
          .where(and(eq(fakeScenarios.id, row.id), gt(fakeScenarios.remaining_uses, 0)))
          .returning({ remaining: fakeScenarios.remaining_uses });
        if (updated.length === 0) return null;
        if ((updated[0]?.remaining ?? 0) <= 0) {
          await db.delete(fakeScenarios).where(eq(fakeScenarios.id, row.id));
        }
      }
      return toScenario(row);
    });
  }
}
