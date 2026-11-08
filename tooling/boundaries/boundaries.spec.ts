import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise, type ICruiseResult } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';

// SC-002: mọi mẫu vi phạm (a)–(f), SDK AI ngoài ai_gateway, hạ tầng nhập nghiệp vụ đều bị bắt;
// mẫu `clean` không báo gì.
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildCruiseOptions } = require('./build-rules.cjs') as {
  buildCruiseOptions: (baseDir: string) => Record<string, unknown>;
};

const FIXTURES = join(here, 'fixtures');
const cases = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

async function violationsOf(fixture: string): Promise<string[]> {
  const baseDir = join(FIXTURES, fixture);
  const previous = process.cwd();
  process.chdir(baseDir);
  try {
    const result = await cruise(
      ['apps', 'packages'].filter((p) => dirExists(baseDir, p)),
      {
        ...buildCruiseOptions(baseDir),
        validate: true,
      },
    );
    const output = result.output as ICruiseResult;
    return [...new Set(output.summary.violations.map((v) => v.rule.name))].sort();
  } finally {
    process.chdir(previous);
  }
}

function dirExists(base: string, rel: string): boolean {
  try {
    return readdirSync(join(base, rel)).length >= 0;
  } catch {
    return false;
  }
}

describe('Bộ mẫu ranh giới module', () => {
  it('có đủ các trường hợp a–i và clean', () => {
    expect(cases).toEqual(
      [
        'a-internal-import',
        'b-cycle',
        'c-core-imports-module',
        'd-web-imports-server',
        'e-shared-imports-node',
        'f-not-in-allowed-deps',
        'g-ai-sdk-outside-gateway',
        'h-infra-imports-business',
        'i-bind-account-outside-queue',
        'clean',
      ].sort(),
    );
  });

  it.each(cases)('%s → đúng các quy tắc mong đợi', async (fixture) => {
    const expected = JSON.parse(readFileSync(join(FIXTURES, fixture, 'expected.json'), 'utf8')) as {
      violations: string[];
    };
    expect(await violationsOf(fixture)).toEqual([...expected.violations].sort());
  });
});
