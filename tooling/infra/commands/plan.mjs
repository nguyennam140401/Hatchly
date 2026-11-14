// `pnpm infra plan <env> [--stack cloud|platform]` – tạo bản xem trước, lưu vào infra/.plans/<env>/ và in tóm tắt
// (T051, contracts/infra-cli.md mục 4). Bản cơ sở: cây git sạch, chứng thực đúng môi trường, tóm tắt tiếng Việt.
// Các lớp chặn của production (đã chạy ở thử nghiệm, chặn xóa dữ liệu) thêm ở US3 qua `lib/gates.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { planDir, STACKS } from '../lib/paths.mjs';
import { formatSummary, summarizePlan } from '../lib/plan-summary.mjs';
import { readPowered } from '../lib/runtime-state.mjs';
import { assertStagingFirst, planHooksWithChanges } from '../lib/gates.mjs';
import { assertCleanTree, currentCommit, openSession } from '../lib/session.mjs';
import { init, planToFile, showJson, withLock } from '../lib/terraform.mjs';

export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

export const planFileOf = (env, stack) => join(planDir(env), `${stack}.tfplan`);
export const metaFileOf = (env, stack) => join(planDir(env), `${stack}.meta.json`);

export function pickStacks(flags) {
  if (flags.stack === undefined || flags.stack === true) return STACKS;
  if (!STACKS.includes(flags.stack))
    throw new CliExit(`--stack phải là cloud hoặc platform (nhận "${flags.stack}").`, EXIT.ERROR);
  return [flags.stack];
}

/**
 * Lập bản xem trước cho một stack. Trả `{ summary, changed, skipped? }`.
 * @param {{ gates?: (ctx: object) => Promise<void> }} [hooks] điểm gắn lớp chặn (US3)
 */
export async function planOne(
  session,
  stack,
  {
    powered,
    hooks = planHooksWithChanges(session.env),
    extraVars = {},
    replace = [],
    now = () => new Date(),
    deps = {},
  } = {},
) {
  const tf = { init, planToFile, showJson, withLock, ...deps };
  const { env, procEnv } = session;

  if (stack === 'platform' && powered === false) {
    return {
      skipped: true,
      summary: summarizePlan({}),
      message:
        '[platform] Máy đang tắt (power off): bỏ qua – bật máy trước (pnpm infra power staging on).',
    };
  }

  mkdirSync(planDir(env), { recursive: true });
  const planFile = planFileOf(env, stack);

  return await tf.withLock(stack, env, async () => {
    await tf.init(stack, env, { env: procEnv });
    const vars = { ...extraVars, ...(stack === 'cloud' ? { powered: String(powered) } : {}) };
    const r = await tf.planToFile(stack, env, planFile, { vars, replace, env: procEnv });
    if (r.code === 1)
      throw new CliExit(`terraform plan (${stack}) lỗi – xem thông báo ở trên.`, EXIT.ERROR);

    const json = await tf.showJson(stack, planFile, { env: procEnv });
    const summary = summarizePlan(json);
    if (hooks.gates !== undefined) await hooks.gates({ env, stack, summary, json, planFile });

    const createdAt = now();
    const meta = {
      environment: env,
      stack,
      gitCommit: await currentCommit(),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
      summary: summary.counts,
      ...(hooks.meta !== undefined ? await hooks.meta({ env, stack, summary }) : {}),
    };
    writeFileSync(metaFileOf(env, stack), JSON.stringify(meta, null, 2));
    return { summary, changed: summary.changed };
  });
}

/** @param {{ env: string, args?: string[], flags: Record<string, string | boolean> }} params */
export async function run({ env, flags }, deps = {}) {
  await (deps.assertCleanTree ?? assertCleanTree)();
  const session = await (deps.openSession ?? openSession)(env);
  await (deps.assertStagingFirst ?? assertStagingFirst)(env);
  const powered = await (deps.readPowered ?? readPowered)(env);
  let anyChange = false;

  for (const stack of pickStacks(flags)) {
    const result = await planOne(session, stack, { powered, deps: deps.terraform });
    console.log(result.skipped ? result.message : formatSummary(result.summary, stack));
    if (result.changed) anyChange = true;
  }
  if (!anyChange) {
    console.log('Không có thay đổi.');
    return EXIT.OK;
  }
  console.log(`\nXem lại rồi áp dụng bằng: pnpm infra apply ${env}`);
  return flags['detailed-exitcode'] === true ? EXIT.CHANGES : EXIT.OK;
}
