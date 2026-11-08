// Sinh quy tắc ranh giới cho dependency-cruiser từ tệp kê khai module (R10, contracts/module-manifest.md).
// Một nguồn sự thật: apps/server/src/modules/modules.manifest.json – sửa tệp đó (qua review), không sửa ở đây.
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MANIFEST_PATH = 'apps/server/src/modules/modules.manifest.json';
const MODULES = '^apps/server/src/modules/';

/** Thoát ký tự đặc biệt của regex. */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Đọc tệp kê khai của một cây mã (kho thật hoặc bộ mẫu). */
function readManifest(baseDir) {
  return JSON.parse(readFileSync(join(baseDir, MANIFEST_PATH), 'utf8'));
}

/**
 * Mẫu tên gói (vd `^openai$`) → regex khớp cả đường dẫn đã phân giải trong node_modules
 * (`…/node_modules/openai/index.js`) lẫn tên gói chưa phân giải được (`openai`).
 */
function packagePatternToPath(pattern) {
  const body = pattern.replace(/^\^/, '').replace(/\$$/, '');
  const anchoredEnd = pattern.endsWith('$') ? '(/|$)' : '';
  return `(^|node_modules/)${body}${anchoredEnd}`;
}

/** Danh sách quy tắc `forbidden` của dependency-cruiser. */
function buildForbiddenRules(manifest) {
  const modules = manifest.modules;
  const infraNames = modules.filter((m) => m.kind === 'infra').map((m) => m.name);
  const sharedAllowed = manifest.sharedAllowedPackages.map(escapeRe).join('|');
  const aiPaths = manifest.aiProviderPackagePatterns.map(packagePatternToPath);

  /** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
  const rules = [
    {
      name: 'no-internal-cross-module',
      severity: 'error',
      comment:
        'Chỉ được nhập giao diện công khai index.ts của module khác. Đưa thứ cần dùng ra index.ts / public-api.ts của module đích (cần review), không nhập thư mục internal.',
      from: { path: `${MODULES}([^/]+)/` },
      to: {
        path: MODULES,
        pathNot: [`${MODULES}$1/`, `${MODULES}[^/]+/index\\.ts$`],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Có vòng phụ thuộc. Tách phần dùng chung ra hoặc đổi một chiều thành sự kiện qua module queue.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-no-modules',
      severity: 'error',
      comment:
        'Lõi máy chủ (core) không được phụ thuộc module nghiệp vụ. Đảo chiều: module dùng core, hoặc ghép ở tầng app/.',
      from: { path: '^apps/server/src/core/' },
      to: { path: MODULES },
    },
    {
      name: 'web-only-shared',
      severity: 'error',
      comment:
        'Web chỉ được dùng @app/shared và thư viện của chính nó. Đưa hợp đồng cần dùng vào packages/shared.',
      from: { path: '^apps/web/(src|test)/' },
      to: { path: '^(apps/(?!web/)|packages/(?!shared/))' },
    },
    // shared-pure: ba điều kiện, cùng một mã quy tắc và cùng gợi ý (reporter tra gợi ý theo tên).
    ...[
      { path: '^apps/' },
      { dependencyTypes: ['core'] },
      {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: `(^|node_modules/)(${sharedAllowed})(/|$)`,
      },
    ].map((to) => ({
      name: 'shared-pure',
      severity: 'error',
      comment: `Mã nguồn packages/shared chạy cả trong trình duyệt và máy chủ: chỉ được phụ thuộc ${manifest.sharedAllowedPackages.join(', ')} (sharedAllowedPackages – thêm cần review); không nhập apps/**, không dùng module lõi Node (fs, net, crypto…).`,
      from: { path: '^packages/shared/src/' },
      to,
    })),
    {
      name: 'ai-sdk-only-in-ai-gateway',
      severity: 'error',
      comment:
        'SDK nhà cung cấp AI chỉ được dùng trong modules/ai_gateway (nguyên tắc III). Gọi qua giao diện công khai của ai_gateway.',
      from: { pathNot: `${MODULES}ai_gateway/` },
      to: { path: aiPaths },
    },
    {
      name: 'bind-account-restricted',
      severity: 'error',
      comment:
        'Chỉ core/auth (guard xác thực), modules/queue (việc nền) và core/db được đặt accountId vào ngữ cảnh thực thi (002, FR-004). Module nghiệp vụ lấy tài khoản qua tenantTx/currentAccountId, không bao giờ từ tham số.',
      from: {
        pathNot: [
          '^apps/server/src/core/(auth|context|db)/',
          '^apps/server/src/modules/queue/',
          '^apps/server/test/',
        ],
      },
      to: { path: '^apps/server/src/core/context/(bind-account|execution-storage)\\.ts$' },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'Không phân giải được đường dẫn nhập. Sửa đường dẫn hoặc khai báo gói trong package.json.',
      from: {},
      to: { couldNotResolve: true },
    },
  ];

  for (const infra of infraNames) {
    rules.push({
      name: 'infra-no-business',
      severity: 'error',
      comment: `Module hạ tầng ${infra} không được phụ thuộc module nghiệp vụ. Module nghiệp vụ phát/nhận sự kiện qua ${infra}.`,
      from: { path: `${MODULES}${escapeRe(infra)}/` },
      to: {
        path: MODULES,
        pathNot: infraNames.map((n) => `${MODULES}${escapeRe(n)}/`),
      },
    });
  }

  for (const m of modules) {
    const allowed = [m.name, ...m.allowedDeps].map(escapeRe).join('|');
    rules.push({
      name: `allowed-deps-${m.name}`,
      severity: 'error',
      comment: `Module ${m.name} chỉ được phụ thuộc: ${m.allowedDeps.join(', ') || '(không module nào)'}. Thêm vào allowedDeps của ${m.name} trong modules.manifest.json (cần review) hoặc đi qua giao diện công khai của một module được phép.`,
      from: { path: `${MODULES}${escapeRe(m.name)}/` },
      to: {
        path: `${MODULES}[^/]+/`,
        pathNot: `${MODULES}(${allowed})/`,
      },
    });
  }

  return rules;
}

/** Tùy chọn cruise dùng chung cho CLI (`.dependency-cruiser.cjs`) và kiểm thử bộ mẫu. */
function buildOptions() {
  return {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '(^|/)dist/',
        '(^|/)dist-types/',
        '(^|/)test/',
        '^tooling/boundaries/fixtures/',
        '(^|/)coverage/',
      ],
    },
    // Tính cả `import type` – nhập kiểu nội bộ của module khác cũng là vi phạm ranh giới.
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  };
}

/** Tùy chọn cho API lập trình `cruise()` (có ruleSet). */
function buildCruiseOptions(baseDir) {
  return {
    ...buildOptions(),
    ruleSet: { forbidden: buildForbiddenRules(readManifest(baseDir)) },
  };
}

module.exports = {
  MANIFEST_PATH,
  readManifest,
  buildForbiddenRules,
  buildOptions,
  buildCruiseOptions,
  packagePatternToPath,
};
