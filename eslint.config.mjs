// Cấu hình ESLint 9 dạng flat dùng chung cho cả kho (R11).
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Selector cho quy tắc `no-restricted-syntax` của apps/web.
const ROLE_SELECTORS = [
  {
    selector: "BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name='role']",
    message: 'So sánh vai trò chỉ ở lib/session; dùng useCan(permission) (FR-009).',
  },
  {
    selector: "BinaryExpression[operator=/^[!=]==?$/] > Literal[value='owner']",
    message: 'Không so sánh với vai trò "owner"; dùng useCan(permission) (FR-009).',
  },
];
const SPARK_SELECTORS = [
  {
    selector: 'Literal[value=/(^|[^-\\w])text-spark([^-\\w]|$)/]',
    message: 'Màu spark chỉ làm mảng màu (tương phản 2,47:1), không dùng cho chữ.',
  },
  {
    selector: 'TemplateElement[value.raw=/(^|[^-\\w])text-spark([^-\\w]|$)/]',
    message: 'Màu spark chỉ làm mảng màu (tương phản 2,47:1), không dùng cho chữ.',
  },
];
const UI_FORBIDDEN_GROUPS = [
  '**/lib/api',
  '**/lib/api/**',
  '**/lib/session',
  '**/lib/session/**',
  '**/lib/forms',
  '**/lib/forms/**',
  '**/lib/upload',
  '**/lib/upload/**',
  '**/features/**',
  '**/app/**',
];

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
    // Hàm `async () => giá_trị` làm `fn` giả cho tenantTx/systemTx là mẫu thường gặp trong kiểm thử.
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
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
  // ===== apps/web (011): trợ năng + ranh giới nhập khẩu theo thư mục =====
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...jsxA11y.flatConfigs.recommended,
    languageOptions: { globals: globals.browser },
  },
  {
    // Chỉ mã nguồn ứng dụng (không tính kiểm thử): mọi lời gọi mạng đi qua lib/api (FR-020);
    // vai trò chỉ so sánh trong lib/session (FR-009); spark chỉ làm mảng màu (tương phản 2,47:1).
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Gọi mạng chỉ qua lib/api (apiClient).' },
        { name: 'XMLHttpRequest', message: 'Gọi mạng chỉ qua lib/api; tải tệp ở lib/upload.' },
      ],
      'no-restricted-syntax': ['error', ...ROLE_SELECTORS, ...SPARK_SELECTORS],
    },
  },
  {
    // Nơi được phép gọi mạng.
    files: [
      'apps/web/src/lib/api/**',
      'apps/web/src/lib/upload/**',
      'apps/web/src/lib/api-client.ts',
    ],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // lib/session là nơi duy nhất được so sánh vai trò.
    files: ['apps/web/src/lib/session/**'],
    rules: { 'no-restricted-syntax': ['error', ...SPARK_SELECTORS] },
  },
  {
    // ui/** thuần hiển thị: không biết đến API, phiên, biểu mẫu, tải tệp, màn hình, tuyến.
    files: ['apps/web/src/ui/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.{ts,tsx}', '**/__tests__/**', 'apps/web/src/ui/nav/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: UI_FORBIDDEN_GROUPS,
              allowTypeImports: true,
              message:
                'ui/** thuần hiển thị: không nhập lib/api|session|forms|upload hay features/app.',
            },
            {
              group: ['react-router', 'react-router/*'],
              message: 'Chỉ ui/nav được dùng react-router.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/ui/nav/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: UI_FORBIDDEN_GROUPS,
              allowTypeImports: true,
              message:
                'ui/** thuần hiển thị: không nhập lib/api|session|forms|upload hay features/app.',
            },
          ],
        },
      ],
    },
  },
  {
    // Màn hình và khung dùng thư viện qua lớp bọc, không nhập trực tiếp (FR-038).
    files: ['apps/web/src/features/**/*.{ts,tsx}', 'apps/web/src/app/**/*.{ts,tsx}'],
    ignores: ['**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@tanstack/react-query',
                'react-hook-form',
                '@hookform/resolvers',
                '@hookform/resolvers/*',
                '@radix-ui/*',
                'sonner',
              ],
              message:
                'Dùng lớp bọc: lib/api, lib/forms, ui/* (thư viện bên thứ ba chỉ nhập ở lớp bọc).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
);
