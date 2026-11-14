// `pnpm infra apply <env> [--stack …] [--confirm-data-loss]` – áp dụng ĐÚNG bản xem trước đã lưu (T052).
// Bản cơ sở: có bản xem trước, chưa quá 24 giờ, cây git sạch, production gõ lại tên môi trường trước mỗi stack.
// Lớp chặn (b) băm mã/tham số và (c) xóa dữ liệu thêm ở US3 qua `hooks.beforeApply` / `hooks.afterApply`.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { applyHooks } from '../lib/gates.mjs';
import { confirmByTyping } from '../lib/prompt.mjs';
import { assertCleanTree, openSession } from '../lib/session.mjs';
import { applyFile, init, withLock } from '../lib/terraform.mjs';
import { metaFileOf, pickStacks, planFileOf } from './plan.mjs';

/** Đọc và kiểm bản xem trước đã lưu; ném `CliExit(3)` nếu thiếu hoặc quá hạn. */
export function loadSavedPlan(env, stack, now = new Date()) {
  const planFile = planFileOf(env, stack);
  const metaFile = metaFileOf(env, stack);
  if (!existsSync(planFile) || !existsSync(metaFile)) {
    throw new CliExit(
      `Chưa có bản xem trước của ${stack}. Chạy: pnpm infra plan ${env}`,
      EXIT.BLOCKED,
    );
  }
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  if (new Date(meta.expiresAt).getTime() < now.getTime()) {
    throw new CliExit(
      `Bản xem trước của ${stack} đã quá 24 giờ (${meta.createdAt}). Chạy lại: pnpm infra plan ${env}`,
      EXIT.BLOCKED,
    );
  }
  return { planFile, metaFile, meta };
}

export async function applyOne(
  session,
  stack,
  { hooks = applyHooks(session.env), confirm = confirmByTyping, flags = {} } = {},
) {
  const { env, procEnv } = session;
  const saved = loadSavedPlan(env, stack);

  if (hooks.beforeApply !== undefined) await hooks.beforeApply({ env, stack, ...saved, flags });

  if (env === 'production') {
    const ok = await confirm(
      env,
      `Sắp áp dụng stack "${stack}" lên PRODUCTION (${JSON.stringify(saved.meta.summary)}).`,
    );
    if (!ok) throw new CliExit('Không xác nhận – đã hủy, chưa thay đổi gì.', EXIT.BLOCKED);
  }

  await withLock(stack, env, async () => {
    await init(stack, env, { env: procEnv });
    const r = await applyFile(stack, saved.planFile, { env: procEnv });
    if (r.code !== 0) {
      // Giữ nguyên bản xem trước và trạng thái để chạy lại (FR-004).
      throw new CliExit(
        `terraform apply (${stack}) dừng giữa chừng. Trạng thái được giữ; chạy lại: pnpm infra plan ${env} rồi apply.`,
        EXIT.ERROR,
      );
    }
  });

  if (hooks.afterApply !== undefined) await hooks.afterApply({ env, stack, ...saved });
  rmSync(saved.planFile, { force: true });
  rmSync(saved.metaFile, { force: true });
  console.log(`[${stack}] Đã áp dụng.`);
}

export async function run({ env, flags }) {
  await assertCleanTree();
  const session = await openSession(env);
  for (const stack of pickStacks(flags)) await applyOne(session, stack, { flags });
  return EXIT.OK;
}
