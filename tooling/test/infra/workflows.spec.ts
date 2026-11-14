import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// T026 (007, FR-026/FR-027): quy trình tự động của hạ tầng chỉ ĐỌC. Không `apply`, bí mật trong danh sách cho phép,
// action bên thứ ba ghim theo SHA, và `infra-static` không dùng bí mật nào ngoài GITHUB_TOKEN.

const ALLOWED_SECRETS = new Set([
  'DRIFT_VNGCLOUD_CLIENT_ID',
  'DRIFT_VNGCLOUD_CLIENT_SECRET',
  'DRIFT_AWS_ACCESS_KEY_ID',
  'DRIFT_AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
]);

interface Workflow {
  jobs?: Record<string, { steps?: { run?: string; uses?: string }[] }>;
}

/** Danh sách vi phạm của một tệp quy trình (rỗng = đạt). */
export function lintWorkflow(file: string, text: string): string[] {
  const problems: string[] = [];
  const workflow = parse(text) as Workflow;
  const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);

  for (const step of steps) {
    if (step.run !== undefined && /\bapply\b|pnpm infra (?:up|power)\b/.test(step.run)) {
      problems.push(`${file}: bước run có "apply"/"up"/"power": ${step.run.split('\n')[0]}`);
    }
    if (
      step.uses !== undefined &&
      !step.uses.startsWith('./') &&
      !/@[0-9a-f]{40}$/.test(step.uses.split(' ')[0] ?? '')
    ) {
      problems.push(`${file}: action chưa ghim SHA commit: ${step.uses}`);
    }
  }

  // Chỉ xét biểu thức `${{ … }}` (đường dẫn như `tooling/scan-secrets.mjs` không phải tham chiếu bí mật).
  for (const expression of text.matchAll(/\$\{\{([^}]*)\}\}/g)) {
    for (const match of (expression[1] ?? '').matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)) {
      const name = match[1] ?? '';
      if (!ALLOWED_SECRETS.has(name))
        problems.push(`${file}: bí mật ngoài danh sách chỉ đọc: ${name}`);
      if (file.endsWith('infra-static.yml') && name !== 'GITHUB_TOKEN') {
        problems.push(`${file}: infra-static không được dùng bí mật ${name}`);
      }
    }
  }
  return problems;
}

const dir = join(__dirname, '..', '..', '..', '.github', 'workflows');
const files = readdirSync(dir).filter((f) => /^infra-.*\.yml$/.test(f));

describe('quy trình infra-*.yml của repo', () => {
  it('có ít nhất infra-static.yml', () => {
    expect(files).toContain('infra-static.yml');
  });

  for (const file of files) {
    it(`${file}: đạt mọi quy tắc`, () => {
      expect(lintWorkflow(file, readFileSync(join(dir, file), 'utf8'))).toEqual([]);
    });
  }
});

describe('lintWorkflow bắt đúng vi phạm', () => {
  const sha = 'a'.repeat(40);
  const base = (step: string, extra = '') => `jobs:\n  j:\n    steps:\n      - ${step}\n${extra}`;

  it.each([
    ['pnpm infra apply staging', 'run: pnpm infra apply staging'],
    ['terraform apply', 'run: terraform apply -auto-approve'],
    ['pnpm infra up', 'run: pnpm infra up staging'],
    ['pnpm infra power', 'run: pnpm infra power staging off'],
  ])('bắt "%s"', (_name, step) => {
    expect(lintWorkflow('infra-x.yml', base(step)).join('\n')).toMatch(/apply|up|power/);
  });

  it('bắt bí mật ngoài danh sách và action chưa ghim SHA', () => {
    const text = base(
      'uses: actions/checkout@v4',
      '        with:\n          token: ${{ secrets.DEPLOY_KEY }}',
    );
    const problems = lintWorkflow('infra-x.yml', text).join('\n');
    expect(problems).toContain('DEPLOY_KEY');
    expect(problems).toContain('chưa ghim SHA');
  });

  it('infra-static dùng bí mật khác GITHUB_TOKEN → lỗi; infra-drift dùng DRIFT_* → được', () => {
    const withDrift = base(
      `uses: actions/checkout@${sha}`,
      '        env:\n          K: ${{ secrets.DRIFT_AWS_ACCESS_KEY_ID }}',
    );
    expect(lintWorkflow('infra-static.yml', withDrift).join('\n')).toContain(
      'infra-static không được dùng',
    );
    expect(lintWorkflow('infra-drift.yml', withDrift)).toEqual([]);
  });
});
