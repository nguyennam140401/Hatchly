// `pnpm infra drill start|verify|destroy` – diễn tập khôi phục CSDL ra môi trường tạm, cô lập (T108, US4,
// contracts/infra-cli.md mục 8). Môi trường nguồn là `--from`; môi trường tạm dùng tên `drill`, trạng thái ở
// `drill/cloud.tfstate`, `drill/platform.tfstate` trong bucket của môi trường nguồn.
// ⏳ P6: chạy thật cần hạ tầng; phần logic thuần (số đo, kiểm đầu vào, tệp tham số) có kiểm thử ở drill.spec.ts.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import {
  assertNoLeftover,
  buildDrillTfvars,
  computeDrillRecord,
  validateTargetTime,
} from '../lib/drill.mjs';
import { createKube } from '../lib/kube.mjs';
import { envFile, kubeconfigFile } from '../lib/paths.mjs';
import { parseTfvars } from '../lib/params-diff.mjs';
import { operatorName, writeDrillRecord } from '../lib/records.mjs';
import { createS3 } from '../lib/s3.mjs';
import { assertCleanTree, openSession } from '../lib/session.mjs';
import { applyOne } from './apply.mjs';
import { planOne } from './plan.mjs';
import { init, stateList, tf } from '../lib/terraform.mjs';

const RUNTIME_KEY = 'runtime/drill.json';
const DEFAULT_MARKER =
  "select count(*) > 0 from information_schema.tables where table_schema = 'public'";

/** Phép thử cô lập (US4 kịch bản 2, FR-028): mỗi phép chạy trong pod tạm và PHẢI thất bại để đạt. */
export function isolationProbes({ sourceNetworkHost }) {
  return [
    { name: 'không kết nối được SMTP ra ngoài', cmd: 'nc -z -w3 email-smtp.example.invalid 587' },
    { name: 'không ra được internet (HTTPS)', cmd: 'wget -T3 -q -O- https://example.com' },
    {
      name: 'không gọi được nền tảng mạng xã hội / AI',
      cmd: 'wget -T3 -q -O- https://graph.facebook.com',
    },
    {
      name: 'không kết nối được tới CSDL của môi trường nguồn (pg-rw đang chạy, FR-028)',
      cmd: `nc -z -w3 ${sourceNetworkHost} 5432`,
    },
  ];
}

const drillTfvarsPath = () => envFile('drill', 'tfvars');

function sourceTfvars(from) {
  return parseTfvars(readFileSync(envFile(from, 'tfvars'), 'utf8'));
}

/** Biến môi trường chứng thực: `infra/.credentials/drill-<from>.env` (tài khoản `drill-<from>` – C12). */
async function openDrillSession(from, deps) {
  return await (deps.openSession ?? openSession)(`drill-${from}`, { verifyProject: false });
}

export async function drillStart({ from, targetTime }, deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const tfvars = sourceTfvars(from);
  const problems = validateTargetTime(targetTime, {
    retentionDays: Number(tfvars.db_backup_retention_days ?? 30),
  });
  if (problems.length > 0) throw new CliExit(problems.join('\n'), EXIT.BLOCKED);

  await (deps.assertCleanTree ?? assertCleanTree)();
  const session = await openDrillSession(from, deps);
  const procEnv = { ...session.procEnv };
  const s3 = deps.s3 ?? createS3(from);

  const leftover = [];
  for (const stack of ['cloud', 'platform']) {
    await init(stack, 'drill', { env: procEnv });
    leftover.push(...(await stateList(stack, { env: procEnv })));
  }
  const left = assertNoLeftover(leftover);
  if (left.length > 0) throw new CliExit(left.join('\n'), EXIT.BLOCKED);

  const other = from === 'production' ? 'staging' : 'production';
  writeFileSync(
    drillTfvarsPath(),
    buildDrillTfvars(tfvars, {
      otherCidrs: [String(tfvars.network_cidr), String(sourceTfvars(other).network_cidr)],
    }),
  );

  const startedAt = new Date().toISOString();
  const sourceBucket = `${tfvars.name_prefix}-db-backup-${from}`;
  const extra = {
    cloud: { drill_source_backup_bucket: sourceBucket },
    platform: {
      cloud_state_bucket: `${tfvars.name_prefix}-tfstate-${from}`,
      cloud_state_key: 'drill/cloud.tfstate',
      drill_target_time: targetTime,
    },
  };
  const drillSession = { env: 'drill', procEnv };
  for (const stack of ['cloud', 'platform']) {
    const plan = await (deps.planOne ?? planOne)(drillSession, stack, {
      powered: true,
      extraVars: extra[stack],
      hooks: {},
    });
    log(`[${stack}] ${JSON.stringify(plan.summary.counts)}`);
    await (deps.applyOne ?? applyOne)(drillSession, stack, {
      hooks: {},
      confirm: () => Promise.resolve(true),
    });
    if (stack === 'cloud' && !existsSync(kubeconfigFile('drill'))) {
      // `pnpm infra kubeconfig` chỉ nhận staging/production; môi trường tạm lấy tay (⏳ P6, xem infra/docs/07-khoi-phuc-csdl.md).
      throw new CliExit(
        `Chưa có ${kubeconfigFile('drill')}. Tải kubeconfig của cụm "drill" từ bảng điều khiển VKS vào đó rồi chạy lại drill start (các bước đã xong được bỏ qua).`,
        EXIT.NOT_READY,
      );
    }
  }
  log('Nhập khóa chỉ đọc của tài khoản drill vào Secret pg-backup-s3 (không qua Terraform):');
  log(
    '  pnpm infra secrets set <env> pg-backup-s3 ACCESS_KEY_ID   (và ACCESS_SECRET_KEY) – với kubeconfig của môi trường tạm',
  );
  await s3.putJson(RUNTIME_KEY, { from, targetTime, startedAt, sourceBucket });
  log(`Đã dựng môi trường tạm (bắt đầu ${startedAt}). Tiếp: pnpm infra drill verify`);
}

export async function drillVerify({ marker }, deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const runtime = await (deps.readRuntime ?? readRuntime)();
  const kube = deps.kube ?? createKube('drill');
  const { from, targetTime, startedAt } = runtime;

  await kube.waitFor('cluster.postgresql.cnpg.io', 'pg', 'condition=Ready', {
    namespace: 'database',
    timeoutSeconds: 3600,
  });
  const queryableAt = new Date().toISOString();

  const sql = marker ?? DEFAULT_MARKER;
  const psql = (query) =>
    kube.exec([
      'exec',
      '-n',
      'database',
      'pg-1',
      '-c',
      'postgres',
      '--',
      'psql',
      '-U',
      'postgres',
      '-d',
      'app',
      '-At',
      '-c',
      query,
    ]);
  const markerRun = await psql(sql);
  const markerFound = markerRun.code === 0 && /^(t|true|[1-9]\d*)$/i.test(markerRun.stdout.trim());
  const recoveredRun = await psql('select pg_last_xact_replay_timestamp()');
  const recoveredTo = new Date(recoveredRun.stdout.trim() || targetTime).toISOString();

  const failures = [];
  const hostBase = String(sourceTfvars(from).subnet_cidr ?? '10.10.1.0/24').replace(
    /\.0\/\d+$/,
    '.2',
  );
  for (const probe of isolationProbes({ sourceNetworkHost: hostBase })) {
    const r = await kube.exec([
      'run',
      `drill-probe-${Date.now()}`,
      '--rm',
      '-i',
      '--restart=Never',
      '--image=busybox:1.36',
      '-n',
      'app',
      '--',
      'sh',
      '-c',
      probe.cmd,
    ]);
    const blocked = r.code !== 0;
    log(`[${blocked ? 'đạt' : 'lỗi'}] ${probe.name}`);
    if (!blocked) failures.push(probe.name);
  }

  const record = computeDrillRecord({
    sourceEnvironment: from,
    targetTime,
    startedAt,
    queryableAt,
    recoveredTo,
    markerFound,
    operator: await operatorName(),
  });
  if (failures.length > 0) record.result = 'fail';
  await (deps.writeDrillRecord ?? writeDrillRecord)(from, record);
  log(
    `Kết quả diễn tập: ${record.result.toUpperCase()} – ${record.durationSeconds}s, mất ${record.dataLossSeconds}s, dòng đánh dấu ${markerFound ? 'có' : 'THIẾU'}.`,
  );
  return record.result === 'pass' ? EXIT.OK : EXIT.ERROR;
}

export async function drillDestroy(deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const runtime = await (deps.readRuntime ?? readRuntime)();
  const { from } = runtime;
  const session = await openDrillSession(from, deps);
  const procEnv = session.procEnv;
  const tfvars = sourceTfvars(from);

  for (const stack of ['platform', 'cloud']) {
    await init(stack, 'drill', { env: procEnv });
    const extra =
      stack === 'platform'
        ? [
            `-var=cloud_state_bucket=${tfvars.name_prefix}-tfstate-${from}`,
            '-var=cloud_state_key=drill/cloud.tfstate',
          ]
        : [];
    const r = await tf(
      stack,
      ['destroy', '-input=false', '-auto-approve', '-var-file=../../envs/drill.tfvars', ...extra],
      { env: procEnv },
    );
    if (r.code !== 0)
      throw new CliExit(`Hủy stack ${stack} lỗi – chạy lại pnpm infra drill destroy.`, EXIT.ERROR);
  }

  const left = [];
  for (const stack of ['cloud', 'platform'])
    left.push(...(await stateList(stack, { env: procEnv })));
  if (left.length > 0)
    throw new CliExit(
      `Còn ${left.length} tài nguyên môi trường tạm:\n  ${left.join('\n  ')}`,
      EXIT.ERROR,
    );

  rmSync(drillTfvarsPath(), { force: true });
  rmSync(kubeconfigFile('drill'), { force: true });
  await (deps.s3 ?? createS3(from)).deleteObject(RUNTIME_KEY);
  log(
    'Đã hủy sạch môi trường tạm. Kiểm tra bảng điều khiển: không còn tài nguyên nhãn environment=drill.',
  );
}

async function readRuntime() {
  for (const from of ['production', 'staging']) {
    try {
      const doc = await createS3(from).getJson(RUNTIME_KEY);
      if (doc !== null) return doc;
    } catch {
      // thử môi trường tiếp theo
    }
  }
  throw new CliExit(
    'Không có môi trường tạm đang chạy (runtime/drill.json). Chạy: pnpm infra drill start --from <env> --target-time <ISO>',
    EXIT.NOT_READY,
  );
}

export async function run({ args, flags }, deps = {}) {
  const [sub] = args;
  if (sub === 'start') {
    const from = flags.from;
    const targetTime = flags['target-time'];
    if (!['staging', 'production'].includes(from) || typeof targetTime !== 'string') {
      throw new CliExit(
        'Cú pháp: pnpm infra drill start --from staging|production --target-time <ISO>',
        EXIT.ERROR,
      );
    }
    await drillStart({ from, targetTime }, deps);
    return EXIT.OK;
  }
  if (sub === 'verify')
    return await drillVerify(
      { marker: typeof flags.marker === 'string' ? flags.marker : undefined },
      deps,
    );
  if (sub === 'destroy') {
    await drillDestroy(deps);
    return EXIT.OK;
  }
  throw new CliExit('Lệnh con: start | verify | destroy', EXIT.ERROR);
}
