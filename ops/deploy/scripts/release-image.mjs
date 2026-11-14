// Ảnh phát hành của một commit (008 T076, FR-028/FR-029, R14/R17): dùng lại nếu thẻ <sha> đã có, chưa có thì dựng và
// đẩy; lấy digest; quét lỗ hổng bằng Trivy theo chính sách của môi trường.
// Dùng: node ops/deploy/scripts/release-image.mjs --repository <registry/repo> --sha <sha> --policy block|warn
//         [--ignorefile .trivyignore] [--dry-run]
// Yêu cầu: docker (buildx) đã đăng nhập kho ảnh của môi trường, trivy (chỉ máy `deploy`). KHÔNG đẩy đè thẻ đã có.
// Kết quả: dòng cuối stdout là JSON { reused, digest, vulnerabilities: { critical, criticalFixable, blocked } }.
// Mã thoát: 0 đạt; 1 chính sách `block` và có lỗ hổng nghiêm trọng ĐÃ CÓ BẢN VÁ; 2 lỗi khác.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @typedef {(cmd: string, args: string[]) => {status: number, stdout: string}} Runner */

/** @type {Runner} */
export const defaultRunner = (cmd, args) => {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: String(err.stdout ?? ''),
    };
  }
};

/** Đếm lỗ hổng nghiêm trọng từ JSON của `trivy image --format json`. */
export function countCritical(report) {
  let critical = 0;
  let criticalFixable = 0;
  for (const result of report?.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      if (v.Severity !== 'CRITICAL') continue;
      critical++;
      if (v.FixedVersion) criticalFixable++;
    }
  }
  return { critical, criticalFixable };
}

/**
 * @param {{repository: string, sha: string, policy: 'block'|'warn', ignorefile?: string, run?: Runner}} o
 */
export function releaseImage(o) {
  const run = o.run ?? defaultRunner;
  if (!/^[0-9a-f]{40}$/.test(o.sha)) throw new Error('--sha phải là SHA commit đầy đủ');
  const ref = `${o.repository}:${o.sha}`;
  const exists = run('docker', ['manifest', 'inspect', ref]).status === 0;
  let reused = exists;
  if (!exists) {
    const build = run('docker', [
      'buildx',
      'build',
      '--build-arg',
      `APP_VERSION=${o.sha}`,
      '--build-arg',
      `IMAGE_CREATED=${new Date().toISOString()}`,
      '--build-arg',
      `IMAGE_SOURCE=${process.env.IMAGE_SOURCE ?? ''}`,
      '-t',
      ref,
      '--push',
      '.',
    ]);
    if (build.status !== 0) throw new Error('docker buildx build/push không đạt');
    reused = false;
  }
  const inspected = run('docker', [
    'buildx',
    'imagetools',
    'inspect',
    ref,
    '--format',
    '{{.Manifest.Digest}}',
  ]);
  const digest = inspected.stdout.trim();
  if (inspected.status !== 0 || !/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error('không lấy được digest của ảnh');

  const scanArgs = [
    'image',
    '--severity',
    'CRITICAL',
    '--format',
    'json',
    '--quiet',
    ...(o.ignorefile ? ['--ignorefile', o.ignorefile] : []),
    `${o.repository}@${digest}`,
  ];
  const scan = run('trivy', scanArgs);
  if (scan.status !== 0) throw new Error('trivy không quét được ảnh');
  const counts = countCritical(JSON.parse(scan.stdout || '{}'));
  const blocked = o.policy === 'block' && counts.criticalFixable > 0;
  return { reused, digest, vulnerabilities: { ...counts, blocked } };
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  try {
    const policy = flag('--policy') ?? 'warn';
    if (!['block', 'warn'].includes(policy)) throw new Error('--policy phải là block hoặc warn');
    const result = releaseImage({
      repository: flag('--repository') ?? '',
      sha: flag('--sha') ?? '',
      policy,
      ignorefile: flag('--ignorefile'),
    });
    console.log(
      result.vulnerabilities.blocked
        ? `✖ ${result.vulnerabilities.criticalFixable} lỗ hổng nghiêm trọng đã có bản vá – chặn (chính sách block)`
        : `✔ ảnh ${result.digest.slice(0, 19)} (${result.reused ? 'dùng lại' : 'mới dựng'}); nghiêm trọng: ${result.vulnerabilities.critical}, có bản vá: ${result.vulnerabilities.criticalFixable}`,
    );
    console.log(JSON.stringify(result));
    return result.vulnerabilities.blocked ? 1 : 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
