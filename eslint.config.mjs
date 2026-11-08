// Cấu hình ESLint 9 dạng flat dùng chung cho cả kho (R11).
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/coverage/**',
      'tooling/boundaries/fixtures/**',
      '.specify/**',
      '.claude/**',
      'specs/**',
      'TaiLieuDacTa/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Cho phép số trong chuỗi mẫu (thông điệp lỗi có số ký tự tối thiểu/tối đa).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Kiểm thử: cho phép `!` sau khi đã khẳng định thất bại bằng expect.
    files: ['**/test/**/*.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Mã NestJS: lớp module rỗng dùng decorator là chuẩn của framework.
    files: ['apps/server/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // Mọi đầu vào HTTP phải đi qua lược đồ dùng chung (FR-013a, R8): cấm decorator gốc của Nest.
    files: ['apps/server/src/**/*.ts'],
    ignores: ['apps/server/src/core/validation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: ['Body', 'Query', 'Param'],
              message:
                'Dùng @ValidBody/@ValidQuery/@ValidParam để kiểm tra đầu vào bằng lược đồ dùng chung',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
);
