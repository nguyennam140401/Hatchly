import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// FR-013a / R8: controller không được dùng @Body/@Query/@Param gốc của NestJS – phải đi qua lược đồ.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Đường dẫn ảo trong apps/server/src để khối quy tắc áp dụng (không cần tệp thật).
const virtualFile = join(repoRoot, 'apps/server/src/core/health/health.controller.ts');

async function lint(code: string) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfig: { rules: {} },
    // Chỉ cần quy tắc cú pháp – tắt kiểm tra có thông tin kiểu cho đoạn mã ảo.
    overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
  });
  const [result] = await eslint.lintText(code, { filePath: virtualFile });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

describe('Quy tắc ESLint: đầu vào HTTP phải qua lược đồ dùng chung', () => {
  it('controller dùng @Body() → lỗi kèm thông điệp tiếng Việt', async () => {
    const messages = await lint(
      "import { Body, Controller, Post } from '@nestjs/common';\n" +
        '@Controller()\nexport class X {\n  @Post() echo(@Body() body: unknown) { return body; }\n}\n',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Dùng @ValidBody/@ValidQuery/@ValidParam');
  });

  it('dùng @Query, @Param cũng bị chặn', async () => {
    const messages = await lint(
      "import { Query, Param } from '@nestjs/common';\nexport { Query, Param };\n",
    );
    expect(messages).toHaveLength(2);
  });

  it('controller dùng @ValidBody(EchoRequest) → sạch', async () => {
    const messages = await lint(
      "import { Controller, Post } from '@nestjs/common';\n" +
        "import { EchoRequest } from '@app/shared/core';\n" +
        "import { ValidBody } from '../validation/decorators';\n" +
        '@Controller()\nexport class X {\n  @Post() echo(@ValidBody(EchoRequest) body: EchoRequest) { return body; }\n}\n',
    );
    expect(messages).toEqual([]);
  });
});
