// `pnpm infra up <env>` – trình tự dựng đầy đủ cho lần đầu (T058, contracts/infra-cli.md mục 2, FR-004):
// bootstrap-check → plan+apply cloud → kubeconfig → plan+apply platform → secrets init → in DNS và việc còn lại.
// Chạy lại được: bước nào bản xem trước rỗng thì bỏ qua; ngắt giữa chừng rồi chạy lại không tạo tài nguyên trùng.
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { readPowered } from '../lib/runtime-state.mjs';
import { assertCleanTree, openSession } from '../lib/session.mjs';
import { applyOne } from './apply.mjs';
import { run as bootstrapCheck } from './bootstrap-check.mjs';
import { run as kubeconfig } from './kubeconfig.mjs';
import { formatSummary } from '../lib/plan-summary.mjs';
import { planOne } from './plan.mjs';
import { run as outputs } from './outputs.mjs';
import { secretsInit } from './secrets.mjs';

/** Việc nhập tay còn lại sau `up` (bí mật do bên ngoài cấp). */
export const MANUAL_SECRETS = [
  ['api-secrets', 'S3_ACCESS_KEY_ID'],
  ['api-secrets', 'S3_SECRET_ACCESS_KEY'],
  ['api-secrets', 'SMTP_URL'],
  ['worker-secrets', 'S3_ACCESS_KEY_ID'],
  ['worker-secrets', 'S3_SECRET_ACCESS_KEY'],
  ['worker-secrets', 'SMTP_URL'],
  ['registry-pull', '.dockerconfigjson'],
  ['pg-backup-s3', 'ACCESS_KEY_ID'],
  ['pg-backup-s3', 'ACCESS_SECRET_KEY'],
];

export function remainingManualSteps(env) {
  return MANUAL_SECRETS.map(([secret, key]) => `pnpm infra secrets set ${env} ${secret} ${key}`);
}

export async function run({ env }, deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const now = deps.now ?? (() => new Date());
  const started = now();
  const step = (n, text) => log(`\n── Bước ${n}: ${text}`);

  step(1, 'kiểm danh sách khởi tạo một lần');
  const bc = await (deps.bootstrapCheck ?? bootstrapCheck)({ env, flags: {} });
  if (bc !== EXIT.OK)
    throw new CliExit(
      `Danh sách khởi tạo chưa đạt – làm xong rồi chạy lại (pnpm infra bootstrap-check ${env}).`,
      EXIT.NOT_READY,
    );

  await (deps.assertCleanTree ?? assertCleanTree)();
  const session = await (deps.openSession ?? openSession)(env);
  const powered = await (deps.readPowered ?? readPowered)(env);
  const plan = deps.planOne ?? planOne;
  const apply = deps.applyOne ?? applyOne;

  step(2, 'hạ tầng đám mây (stack cloud)');
  const cloud = await plan(session, 'cloud', { powered });
  log(formatSummary(cloud.summary, 'cloud'));
  if (cloud.changed) await apply(session, 'cloud', {});

  step(3, 'kubeconfig');
  await (deps.kubeconfig ?? kubeconfig)({ env });

  step(4, 'nền tảng Kubernetes (stack platform)');
  const platform = await plan(session, 'platform', { powered });
  log(platform.skipped ? platform.message : formatSummary(platform.summary, 'platform'));
  if (platform.changed) await apply(session, 'platform', {});

  step(5, 'Secret tự sinh');
  await (deps.secretsInit ?? secretsInit)(env, {});

  step(6, 'bản ghi DNS và việc còn lại');
  await (deps.outputs ?? outputs)({ env, flags: {} });
  log('\nNhập tay các bí mật do bên ngoài cấp:');
  for (const line of remainingManualSteps(env)) log(`  ${line}`);
  log(
    `\nSau đó: tạo bản ghi DNS (C10), chạy pnpm infra dns-check ${env}, triển khai ảnh và pnpm infra smoke ${env}.`,
  );

  const minutes = (now().getTime() - started.getTime()) / 60_000;
  log(`\nTổng thời gian: ${minutes.toFixed(1)} phút.`);
  return EXIT.OK;
}
