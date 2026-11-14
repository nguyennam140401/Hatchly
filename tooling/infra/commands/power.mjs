// `pnpm infra power staging off|on` – tắt/bật máy của MÔI TRƯỜNG THỬ NGHIỆM (T062, FR-034, research R11,
// contracts/infra-cli.md mục 7). Cụm, cân bằng tải (địa chỉ công khai), bucket và đĩa được giữ nguyên.
import { readFileSync } from 'node:fs';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { createKube } from '../lib/kube.mjs';
import { envFile } from '../lib/paths.mjs';
import { parseTfvars } from '../lib/params-diff.mjs';
import { writePower } from '../lib/runtime-state.mjs';
import { assertCleanTree, openSession } from '../lib/session.mjs';
import { applyOne } from './apply.mjs';
import { run as dnsCheck } from './dns-check.mjs';
import { run as kubeconfig } from './kubeconfig.mjs';
import { planOne } from './plan.mjs';

const WARN_MINUTES = 60;
const DB_PLATFORM_ADDRESS = 'module.database[0].helm_release.pg_cluster';

/** Từ chối (thoát 3) khi không phải thử nghiệm hoặc đang khóa tắt. Trả cấu hình đã đọc. */
export function assertMayPower(env, direction, tfvars) {
  if (env !== 'staging') {
    throw new CliExit(
      `Chỉ môi trường thử nghiệm được tắt/bật máy (nhận "${env}"). Production luôn bật (FR-034).`,
      EXIT.BLOCKED,
    );
  }
  if (direction === 'off' && tfvars.power_lock === true) {
    throw new CliExit(
      'power_lock = true trong staging.tfvars: không được tắt máy (đang trong thời gian Meta xét duyệt). Đặt lại power_lock = false khi hết thời gian xét duyệt.',
      EXIT.BLOCKED,
    );
  }
}

export async function run({ env, args }, deps = {}) {
  const direction = args[0];
  if (direction !== 'off' && direction !== 'on')
    throw new CliExit('Cú pháp: pnpm infra power staging off|on', EXIT.ERROR);
  const tfvars = deps.tfvars ?? parseTfvars(readFileSync(envFile('staging', 'tfvars'), 'utf8'));
  assertMayPower(env, direction, tfvars);

  const log = deps.log ?? ((m) => console.log(m));
  const started = (deps.now ?? (() => new Date()))();
  await (deps.assertCleanTree ?? assertCleanTree)();
  const session = await (deps.openSession ?? openSession)(env);
  const keepVolume = tfvars.staging_keep_db_volume !== false;
  const planCloud = deps.planOne ?? planOne;
  const applyStack = deps.applyOne ?? applyOne;
  const kube = deps.kube ?? createKube(env);

  if (direction === 'off') {
    if (!keepVolume) {
      log(
        'staging_keep_db_volume = false: gỡ cả đĩa CSDL (dữ liệu thử nghiệm sẽ mất; bật lại sẽ chạy migration + dữ liệu mẫu).',
      );
      await kube.exec([
        'delete',
        'cluster.postgresql.cnpg.io',
        'pg',
        '-n',
        'database',
        '--ignore-not-found',
        '--wait=true',
      ]);
    }
    await planCloud(session, 'cloud', { powered: false });
    await applyStack(session, 'cloud', {});
    await (deps.writePower ?? writePower)(env, false, 'pnpm infra power');
    log('Đã tắt máy. Cụm, cân bằng tải và bucket được giữ; địa chỉ công khai không đổi.');
    return EXIT.OK;
  }

  // on: máy → nền tảng → chờ sẵn sàng → DNS
  await planCloud(session, 'cloud', { powered: true });
  await applyStack(session, 'cloud', {});
  await (deps.writePower ?? writePower)(env, true, 'pnpm infra power');
  await (deps.kubeconfig ?? kubeconfig)({ env });

  await kube.exec(['wait', '--for=condition=Ready', 'node', '--all', '--timeout=1800s']);
  await planCloud(session, 'platform', {
    powered: true,
    replace: keepVolume ? [] : [DB_PLATFORM_ADDRESS],
  });
  await applyStack(session, 'platform', {});
  for (const target of [
    ['deployment', 'api', 'app'],
    ['deployment', 'worker', 'app'],
  ]) {
    // Có thể chưa có kê khai triển khai (smoke-deploy chưa áp) – không coi là lỗi.
    const exists = await kube.get(target[0], target[1], target[2]);
    if (exists !== null)
      await kube.waitFor(target[0], target[1], 'condition=Available', {
        namespace: target[2],
        timeoutSeconds: 900,
      });
  }
  await kube.waitFor('cluster.postgresql.cnpg.io', 'pg', 'condition=Ready', {
    namespace: 'database',
    timeoutSeconds: 1200,
  });

  const dns = await (deps.dnsCheck ?? dnsCheck)({ env });
  const minutes = ((deps.now ?? (() => new Date()))().getTime() - started.getTime()) / 60_000;
  log(`Tổng thời gian bật máy: ${minutes.toFixed(1)} phút.`);
  if (minutes > WARN_MINUTES) log(`CẢNH BÁO: vượt ${WARN_MINUTES} phút (mục tiêu FR-034).`);
  return dns;
}
