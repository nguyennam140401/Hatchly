// pnpm check:release-source – `master` chỉ nhận từ `dev` đã được triển khai thành công lên test, hoặc từ
// `hotfix/*` (008, FR-005, FR-005a, FR-005b, R8; contracts/quality-gates.md mục 4). KHÔNG có ngoại lệ.
// Biến: GATE_TARGET_BRANCH (đích của pull request), GATE_SOURCE_BRANCH (nguồn), STAGING_DEPLOYED_SHA (SHA
// triển khai thành công gần nhất ở test – Jenkins lấy từ GitHub Deployments). Không lưu trạng thái riêng:
// mọi điều kiện suy ra từ lịch sử git của origin/master và origin/dev.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MIGRATIONS = 'apps/server/drizzle/migrations';

/**
 * @param {{ env?: Record<string,string|undefined>, cwd?: string }} options
 * @returns {{ status: 'not_applicable'|'ok'|'failed', message: string }}
 */
export function checkReleaseSource({ env = process.env, cwd = process.cwd() } = {}) {
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return { status: r.status ?? 1, out: (r.stdout ?? '').trim() };
  };
  const short = (sha) => sha.slice(0, 12);
  const target = env.GATE_TARGET_BRANCH?.trim() ?? '';
  const source = env.GATE_SOURCE_BRANCH?.trim() ?? '';

  if (target !== 'master') {
    return { status: 'not_applicable', message: 'đích không phải master' };
  }
  const fail = (message) => ({ status: 'failed', message });

  if (source === 'dev') {
    const staging = env.STAGING_DEPLOYED_SHA?.trim();
    if (!staging) {
      return fail(
        'Không biết bản nào đã triển khai thành công lên test (thiếu STAGING_DEPLOYED_SHA). ' +
          'Chờ lần triển khai lên test chạy xong rồi chạy lại.',
      );
    }
    if (git('merge-base', '--is-ancestor', 'HEAD', staging).status !== 0) {
      const head = git('rev-parse', 'HEAD').out;
      return fail(
        `Commit ${short(head)} chưa được triển khai thành công lên test. Chờ test xanh rồi chạy lại.`,
      );
    }
    // Sửa nóng đã vào master mà dev chưa có → phát hành thường sẽ làm mất bản sửa đó.
    const missing = git('rev-list', '--no-merges', 'origin/master', '^HEAD');
    if (missing.status !== 0) return fail('Không đọc được lịch sử origin/master (đã fetch chưa?).');
    const commits = missing.out.split('\n').filter((l) => l !== '');
    if (commits.length > 0) {
      return fail(
        `Bản sửa nóng ${short(commits[0])} chưa về dev – hợp nhất pull request backmerge trước.`,
      );
    }
    return {
      status: 'ok',
      message: 'dev đã triển khai thành công lên test và chứa mọi bản sửa nóng',
    };
  }

  if (source.startsWith('hotfix/')) {
    // Mọi commit mà master chưa có phải là commit RIÊNG của nhánh sửa nóng, không phải commit của dev.
    const own = git('rev-list', 'origin/master..HEAD');
    if (own.status !== 0) return fail('Không đọc được lịch sử origin/master (đã fetch chưa?).');
    for (const sha of own.out.split('\n').filter((l) => l !== '')) {
      if (git('merge-base', '--is-ancestor', sha, 'origin/dev').status === 0) {
        return fail(`Nhánh hotfix mang commit của dev: ${short(sha)}. Tách lại từ master.`);
      }
    }
    // T021: migration có mốc cũ hơn bị bỏ qua âm thầm → sửa nóng không được kèm migration.
    const added = git(
      'diff',
      '--name-only',
      '--diff-filter=A',
      'origin/master',
      'HEAD',
      '--',
      MIGRATIONS,
    );
    const files = added.out.split('\n').filter((f) => f.endsWith('.sql'));
    if (files.length > 0) {
      return fail(
        `Sửa nóng không được kèm migration (${files.map((f) => f.split('/').pop()).join(', ')}) – ` +
          'đi đường phát hành thường (dev → test → master).',
      );
    }
    return {
      status: 'ok',
      message: 'nhánh sửa nóng tách từ master, không mang commit của dev, không kèm migration',
    };
  }

  return fail('master chỉ nhận từ dev hoặc hotfix/*.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkReleaseSource();
  if (result.status === 'not_applicable') console.log(`NOT_APPLICABLE: ${result.message}`);
  else if (result.status === 'ok') console.log(`✔ ${result.message}`);
  else {
    console.error(`✖ ${result.message}`);
    process.exit(1);
  }
}
