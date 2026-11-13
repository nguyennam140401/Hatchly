import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPipeline } from '../check-pipeline.mjs';

// 008 (R19): check:pipeline bắt được định nghĩa quy trình sai và nêu đúng tệp.
// Mỗi ca chép bộ hợp lệ `fixtures/pipeline/valid` ra thư mục tạm rồi làm hỏng đúng một chỗ.

interface Problem {
  file: string;
  line?: number;
  message: string;
}
interface Outcome {
  errors: Problem[];
  warnings: string[];
  notes: string[];
}
interface HelmResult {
  missing: boolean;
  status: number;
  output: string;
}
const run = checkPipeline as (options: {
  root: string;
  ci?: boolean;
  steps: { name: string }[];
  helm?: (args: string[]) => HelmResult;
  now?: Date;
}) => Outcome;

const validDir = join(__dirname, 'fixtures', 'pipeline', 'valid');
const steps = [{ name: 'lint' }, { name: 'test:db' }];
const HEX = 'c'.repeat(64);

function workspace(mutate?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-'));
  cpSync(validDir, root, { recursive: true });
  mutate?.(root);
  return root;
}
function write(root: string, file: string, content: string) {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
const edit = (root: string, file: string, change: (text: string) => string) => {
  write(root, file, change(readFileSync(join(root, file), 'utf8')));
};

describe('tooling/check-pipeline.mjs', () => {
  it('bộ hợp lệ → không lỗi', () => {
    expect(run({ root: workspace(), steps })).toEqual({ errors: [], warnings: [], notes: [] });
  });

  it('ảnh nền thiếu digest trong Dockerfile → nêu tệp và dòng', () => {
    const root = workspace((r) => {
      write(r, 'ops/ci/toolchain/Dockerfile', '# công cụ\nFROM node:24-bookworm-slim\n');
    });
    const { errors } = run({ root, steps });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'ops/ci/toolchain/Dockerfile', line: 2 });
    expect(errors[0]!.message).toContain('digest');
  });

  it('image: thiếu digest trong tệp YAML của ops/ → không đạt; mẫu Helm ghép theo digest → đạt', () => {
    const root = workspace((r) => {
      write(
        r,
        'ops/ci/jenkins/compose.yaml',
        'services:\n  jenkins:\n    image: jenkins/jenkins:lts\n',
      );
      write(
        r,
        'ops/deploy/chart/templates/api.yaml',
        'spec:\n  containers:\n    - image: "{{ .Values.image.repository }}@{{ .Values.image.digest }}"\n',
      );
      write(r, 'ops/deploy/chart/values.yaml', 'image:\n  repository: ""\n  digest: ""\n');
    });
    const { errors } = run({ root, steps });
    expect(errors.map((e) => [e.file, e.line])).toEqual([['ops/ci/jenkins/compose.yaml', 3]]);
  });

  it('plugins.txt có latest hoặc thiếu phiên bản → không đạt', () => {
    const root = workspace((r) => {
      write(r, 'ops/ci/jenkins/plugins.txt', 'job-dsl:latest\ngit\nworkflow-aggregator:600.1\n');
    });
    const { errors } = run({ root, steps });
    expect(errors.map((e) => [e.file, e.line])).toEqual([
      ['ops/ci/jenkins/plugins.txt', 1],
      ['ops/ci/jenkins/plugins.txt', 2],
    ]);
  });

  it('versions.env thiếu mã băm → không đạt', () => {
    const root = workspace((r) => {
      edit(r, 'ops/ci/versions.env', (t) => t.replace(/^TRIVY_SHA256_LINUX_AMD64=.*$/m, ''));
    });
    const { errors } = run({ root, steps });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe('ops/ci/versions.env');
    expect(errors[0]!.message).toContain('TRIVY_SHA256_LINUX_AMD64');
  });

  it('tệp tham số sai lược đồ (trường lạ, sai nhánh, tên không khớp tệp) → nêu đúng tệp', () => {
    const root = workspace((r) => {
      edit(r, 'ops/deploy/env/staging.yaml', (t) => `${t}\ndatabaseUrl: postgres://x\n`);
      edit(r, 'ops/deploy/env/production.yaml', (t) => t.replace('branch: master', 'branch: dev'));
    });
    const { errors } = run({ root, steps });
    expect(errors.map((e) => e.file).sort()).toEqual([
      'ops/deploy/env/production.yaml',
      'ops/deploy/env/staging.yaml',
    ]);
    expect(errors.find((e) => e.file.endsWith('staging.yaml'))!.message).toContain('databaseUrl');
    expect(errors.find((e) => e.file.endsWith('production.yaml'))!.message).toContain('branch');
  });

  it('provisioned: true mà còn trường rỗng → không đạt', () => {
    const root = workspace((r) => {
      edit(r, 'ops/deploy/env/staging.yaml', (t) =>
        t.replace(/^provisioned: false$/m, 'provisioned: true'),
      );
    });
    const { errors } = run({ root, steps });
    expect(errors.length).toBeGreaterThan(3);
    expect(errors.every((e) => e.file === 'ops/deploy/env/staging.yaml')).toBe(true);
    expect(errors.map((e) => e.message).join('\n')).toContain('registry.repository');
  });

  it('bước không thuộc làn nào, và làn nêu bước không tồn tại → không đạt', () => {
    const { errors } = run({ root: workspace(), steps: [...steps, { name: 'check:image' }] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'ops/ci/gate-lanes.json' });
    expect(errors[0]!.message).toContain('"check:image" không thuộc làn nào');

    const ghost = run({ root: workspace(), steps: [{ name: 'lint' }] });
    expect(ghost.errors[0]!.message).toContain('bước không tồn tại: test:db');
  });

  it('ruleset thiếu kiểm tra bắt buộc ci/gates → không đạt', () => {
    const root = workspace((r) => {
      write(
        r,
        'ops/ci/github/rulesets/dev.json',
        JSON.stringify({ name: 'dev', rules: [{ type: 'pull_request', parameters: {} }] }),
      );
    });
    const { errors } = run({ root, steps });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe('ops/ci/github/rulesets/dev.json');
    expect(errors[0]!.message).toContain('ci/gates');
  });

  it('FR-004: từ hai thành viên mà ruleset chưa yêu cầu người duyệt → không đạt', () => {
    const ruleset = (approvals: number) =>
      JSON.stringify({
        name: 'dev',
        rules: [
          { type: 'pull_request', parameters: { required_approving_review_count: approvals } },
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'ci/gates' }] },
          },
        ],
      });
    const twoMembers = (r: string) => {
      edit(r, 'ops/ci/team.json', (t) => {
        const team = JSON.parse(t) as { members: unknown[] };
        team.members.push({ github: 'dev-2', telegram: '', roles: ['developer'] });
        return JSON.stringify(team);
      });
    };
    // Một thành viên: 0 người duyệt là hợp lệ (chế độ một thành viên).
    const solo = workspace((r) => {
      write(r, 'ops/ci/github/rulesets/dev.json', ruleset(0));
    });
    expect(run({ root: solo, steps }).errors).toEqual([]);

    const pair = workspace((r) => {
      write(r, 'ops/ci/github/rulesets/dev.json', ruleset(0));
      twoMembers(r);
    });
    const { errors } = run({ root: pair, steps });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('FR-004');

    const pairOk = workspace((r) => {
      write(r, 'ops/ci/github/rulesets/dev.json', ruleset(1));
      twoMembers(r);
    });
    expect(run({ root: pairOk, steps }).errors).toEqual([]);
  });

  it('có chart mà thiếu helm: máy cá nhân chỉ ghi chú, --ci là không đạt; helm lint lỗi → không đạt', () => {
    const withChart = () =>
      workspace((r) => {
        write(r, 'ops/deploy/chart/Chart.yaml', 'apiVersion: v2\nname: app\nversion: 0.1.0\n');
      });
    const missing = () => ({ missing: true, status: 1, output: '' });
    const local = run({ root: withChart(), steps, helm: missing });
    expect(local.errors).toEqual([]);
    expect(local.notes).toHaveLength(1);
    const ci = run({ root: withChart(), steps, helm: missing, ci: true });
    expect(ci.errors).toHaveLength(1);
    expect(ci.errors[0]!.message).toContain('helm');

    const calls: string[] = [];
    const broken = run({
      root: withChart(),
      steps,
      helm: (args) => {
        calls.push(args[0]!);
        return {
          missing: false,
          status: args[0] === 'lint' ? 1 : 0,
          output: 'Error: thiếu trường\n',
        };
      },
    });
    expect(calls).toEqual(['lint', 'template', 'template']);
    expect(broken.errors).toHaveLength(1);
    expect(broken.errors[0]!.message).toContain('helm lint');
  });

  it('thiếu kịch bản test:compat → không đạt', () => {
    const root = workspace((r) => {
      write(r, 'apps/server/package.json', JSON.stringify({ scripts: {} }));
    });
    const { errors } = run({ root, steps });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('test:compat');
  });

  it('ngoại lệ không hợp lệ → không đạt, nêu trường sai; ngoại lệ hết hạn → chỉ cảnh báo', () => {
    const now = new Date('2026-11-14T00:00:00Z');
    const body = (gate: string, expiresAt: string) =>
      [
        `gate: ${gate}`,
        'reason: Kiểm thử chập chờn do hạ tầng, sửa trong tuần này',
        'approvedBy: sa-user',
        `expiresAt: '${expiresAt}'`,
        'pullRequest: 12',
        '',
      ].join('\n');
    const invalid = workspace((r) => {
      write(r, 'ops/ci/exceptions/2026-11-13-db.yml', body('test:db', '2026-11-15T00:00:00Z'));
    });
    const bad = run({ root: invalid, steps, now });
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]!.file).toBe('ops/ci/exceptions/2026-11-13-db.yml');
    expect(bad.errors[0]!.message).toContain('không bao giờ được vượt');

    const expired = workspace((r) => {
      write(r, 'ops/ci/exceptions/2026-11-01-lint.yml', body('lint', '2026-11-05T00:00:00Z'));
    });
    const old = run({ root: expired, steps, now });
    expect(old.errors).toEqual([]);
    expect(old.warnings).toHaveLength(1);
    expect(old.warnings[0]).toContain('hết hạn');
  });

  it(`digest giả ${HEX.slice(0, 4)}… trong bộ mẫu không bị coi là thiếu`, () => {
    const root = workspace((r) => {
      write(r, 'ops/ci/toolchain/Dockerfile', `FROM node:24@sha256:${HEX}\n`);
    });
    expect(run({ root, steps }).errors).toEqual([]);
  });
});
