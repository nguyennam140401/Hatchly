// `pnpm infra drift <env> [--stack cloud|platform] [--json]` – kiểm tra lệch giữa hạ tầng thật và mã (T095, SC-011).
// Chỉ ĐỌC: `terraform plan -detailed-exitcode -lock=false -refresh=true`, không bao giờ `apply`.
// Quy trình tự động trên GitHub chỉ dùng `--stack cloud` (API cụm chỉ mở cho admin_cidrs – research R10).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { planDir, STACKS } from '../lib/paths.mjs';
import { readPowered } from '../lib/runtime-state.mjs';
import { openSession } from '../lib/session.mjs';
import { init, showJson, tf, varFileArg } from '../lib/terraform.mjs';

/** Các thuộc tính khác nhau giữa `before` và `after` (không đệ quy sâu: so theo khóa cấp một). */
export function changedAttributes(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out = [];
  for (const key of keys) {
    const a = JSON.stringify(before?.[key]);
    const b = JSON.stringify(after?.[key]);
    if (a !== b) out.push({ attribute: key, before: before?.[key], after: after?.[key] });
  }
  return out.sort((x, y) => x.attribute.localeCompare(y.attribute));
}

/** Từ `terraform show -json`: lệch do sửa ngoài (`resource_drift`) và thay đổi cần áp dụng (`resource_changes`). */
export function collectDrift(planJson, stack) {
  const items = [];
  for (const d of planJson.resource_drift ?? []) {
    for (const c of changedAttributes(d.change?.before, d.change?.after)) {
      items.push({ stack, address: d.address, ...c, kind: 'ngoài mã' });
    }
  }
  for (const rc of planJson.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    if (actions.every((a) => a === 'no-op' || a === 'read')) continue;
    const attrs = changedAttributes(rc.change?.before, rc.change?.after);
    if (attrs.length === 0)
      items.push({
        stack,
        address: rc.address,
        attribute: '(tài nguyên)',
        before: actions.join('+'),
        after: '',
        kind: 'chưa áp dụng',
      });
    for (const c of attrs) items.push({ stack, address: rc.address, ...c, kind: 'chưa áp dụng' });
  }
  return items;
}

const show = (v) => (v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v));

export function formatDrift(items) {
  return items
    .map(
      (i) =>
        `[${i.stack}] ${i.address}: ${i.attribute} (đang là ${show(i.before)} → mã khai ${show(i.after)}) – ${i.kind}`,
    )
    .join('\n');
}

export async function run({ env, flags }, deps = {}) {
  const stacks = flags.stack === undefined || flags.stack === true ? STACKS : [flags.stack];
  for (const s of stacks)
    if (!STACKS.includes(s))
      throw new CliExit(`--stack phải là cloud hoặc platform (nhận "${s}").`, EXIT.ERROR);

  const session = await (deps.openSession ?? openSession)(env);
  const powered = await (deps.readPowered ?? readPowered)(env);
  const terraform = { init, tf, showJson, ...deps.terraform };
  const all = [];
  mkdirSync(planDir(env), { recursive: true });

  for (const stack of stacks) {
    if (stack === 'platform' && powered === false) {
      if (flags.json !== true) console.log('[platform] Máy đang tắt: bỏ qua.');
      continue;
    }
    try {
      await terraform.init(stack, env, { env: session.procEnv });
      const planFile = join(planDir(env), `drift-${stack}.tfplan`);
      const vars = stack === 'cloud' ? [`-var=powered=${String(powered)}`] : [];
      const r = await terraform.tf(
        stack,
        [
          'plan',
          '-input=false',
          '-detailed-exitcode',
          '-lock=false',
          '-refresh=true',
          varFileArg(env),
          ...vars,
          `-out=${planFile}`,
        ],
        { env: session.procEnv, capture: true },
      );
      if (r.code === 1)
        throw new Error(`terraform plan lỗi: ${r.stderr.trim().split('\n').at(-1) ?? ''}`);
      if (r.code === 2)
        all.push(
          ...collectDrift(
            await terraform.showJson(stack, planFile, { env: session.procEnv }),
            stack,
          ),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'lỗi';
      if (flags.json === true)
        console.log(JSON.stringify({ environment: env, error: message, step: stack }));
      else console.error(`✖ drift ${stack}: ${message}`);
      return EXIT.ERROR;
    }
  }

  if (flags.json === true) console.log(JSON.stringify({ environment: env, drift: all }, null, 2));
  else
    console.log(
      all.length === 0
        ? `Không lệch (${env}).`
        : `${all.length} chỗ lệch ở ${env}:\n${formatDrift(all)}`,
    );
  return all.length === 0 ? EXIT.OK : EXIT.CHANGES;
}
