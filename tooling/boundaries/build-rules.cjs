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
        // queue/enqueue-registered.ts: lối riêng của `account` (005 R9a) – quy tắc enqueue-registered-only-account.
        pathNot: [
          `${MODULES}$1/`,
          `${MODULES}[^/]+/index\\.ts$`,
          `${MODULES}queue/enqueue-registered\\.ts$`,
        ],
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
      name: 'pgboss-only-in-queue',
      severity: 'error',
      comment:
        'Thư viện pg-boss chỉ được dùng trong modules/queue/internal (bộ nối) và src/db (công cụ migration) – 003 FR-001. Module khác tạo việc qua enqueue()/defineJobType() của modules/queue/index.ts.',
      from: {
        pathNot: ['^apps/server/src/modules/queue/internal/', '^apps/server/src/db/'],
      },
      to: { path: packagePatternToPath('^pg-boss$') },
    },
    {
      name: 'cron-parser-only-in-queue',
      severity: 'error',
      comment:
        'cron-parser chỉ được dùng trong modules/queue/internal (bộ hẹn giờ). Module khác khai báo việc định kỳ bằng defineSchedule() của modules/queue/index.ts.',
      from: { pathNot: '^apps/server/src/modules/queue/internal/' },
      to: { path: packagePatternToPath('^cron-parser$') },
    },
    // bind-account-restricted: hai điều kiện, cùng mã quy tắc và gợi ý.
    ...[
      {
        // Đường ghi accountId/actor: chỉ guard xác thực (004), việc nền, lõi context/db.
        from: {
          pathNot: [
            '^apps/server/src/core/auth/access\\.guard\\.ts$',
            '^apps/server/src/core/(context|db)/',
            '^apps/server/src/modules/queue/',
            '^apps/server/test/',
          ],
        },
        to: { path: '^apps/server/src/core/context/bind-account\\.ts$' },
      },
      {
        // Kho ngữ cảnh: thêm core/auth (runInAccountScope tạo ngữ cảnh con – 004 R4).
        from: {
          pathNot: [
            '^apps/server/src/core/(auth|context|db)/',
            '^apps/server/src/modules/queue/',
            '^apps/server/test/',
          ],
        },
        to: { path: '^apps/server/src/core/context/execution-storage\\.ts$' },
      },
    ].map((rule) => ({
      name: 'bind-account-restricted',
      severity: 'error',
      comment:
        'Chỉ core/auth/access.guard.ts (guard xác thực), modules/queue (việc nền) và core/db được đặt accountId vào ngữ cảnh thực thi (002, FR-004, 004). Module nghiệp vụ lấy tài khoản qua tenantTx/currentAccountId, người gọi qua currentActor(), không bao giờ từ tham số.',
      ...rule,
    })),
    {
      name: 'auth-tx-restricted',
      severity: 'error',
      comment:
        'authTx (giao dịch app không tenant) chỉ dành cho core/auth và modules/account/internal/auth (004, R4). Module nghiệp vụ dùng tenantTx; cần dữ liệu dùng chung thì đi qua giao diện công khai của module sở hữu.',
      from: {
        pathNot: [
          '^apps/server/src/core/(auth|db)/',
          '^apps/server/src/modules/account/internal/auth/',
          // 008 FR-032: kiểm tra khói ghi infra.smoke_pings (bảng dùng chung, KHÔNG có dữ liệu khách hàng)
          // bằng vai `app` không tenant – đúng thứ FR-032 đòi; `system` chỉ chạy ở Worker.
          '^apps/server/src/modules/queue/internal/smoke/',
          '^apps/server/test/',
        ],
      },
      to: { path: '^apps/server/src/core/db/auth-tx\\.ts$' },
    },
    // account-scope-restricted: runInAccountScope chỉ cho module account; bộ nhớ đệm phiên thêm core/auth.
    ...[
      {
        from: {
          pathNot: ['^apps/server/src/modules/account/internal/auth/', '^apps/server/test/'],
        },
        to: { path: '^apps/server/src/core/auth/account-scope\\.ts$' },
      },
      {
        from: {
          pathNot: [
            '^apps/server/src/core/auth/',
            '^apps/server/src/modules/account/internal/auth/',
            '^apps/server/test/',
          ],
        },
        to: { path: '^apps/server/src/core/auth/session-cache\\.ts$' },
      },
    ].map((rule) => ({
      name: 'account-scope-restricted',
      severity: 'error',
      comment:
        'runInAccountScope và bộ nhớ đệm phiên chỉ dành cho modules/account/internal/auth (004, R4): mã tài khoản chỉ được đặt sau khi danh tính đã xác minh. Module khác dùng tenantTx với tài khoản của phiên.',
      ...rule,
    })),
    // ----- 005 (research R17) -----
    {
      name: 'storage-restricted',
      severity: 'error',
      comment:
        'Kho tệp (core/storage) chỉ dành cho modules/media, modules/context, modules/account và tầng ghép (app/, dev/) – 005 R17. Module khác lấy đường dẫn tệp qua giao diện công khai của media.',
      from: {
        pathNot: [
          '^apps/server/src/core/storage/',
          '^apps/server/src/modules/(media|context|account)/',
          '^apps/server/src/app/',
          '^apps/server/src/dev/',
          '^apps/server/test/',
        ],
      },
      to: { path: '^apps/server/src/core/storage/' },
    },
    {
      name: 'enqueue-registered-only-account',
      severity: 'error',
      comment:
        'enqueueRegistered (tạo việc theo TÊN loại việc) chỉ dành cho modules/account để phát thông báo mà không phụ thuộc notifications (005 R9a). Module khác dùng enqueue(def, …) với loại việc khai báo bằng defineJobType, hoặc gọi giao diện công khai của module sở hữu.',
      from: {
        pathNot: ['^apps/server/src/modules/(account|queue)/', '^apps/server/test/'],
      },
      to: { path: '^apps/server/src/modules/queue/enqueue-registered\\.ts$' },
    },
    // dev-only-restricted: hai điều kiện, cùng mã quy tắc và gợi ý.
    ...[
      {
        // Module chỉ được nhập src/dev từ bản giả lập của chính nó.
        from: {
          path: `${MODULES}`,
          pathNot: `${MODULES}[^/]+/internal/fake/`,
        },
        to: { path: '^apps/server/src/dev/' },
      },
      {
        // Bảng/kho giả lập (src/dev/sandbox) chỉ dành cho src/dev và internal/fake.
        from: {
          pathNot: [
            '^apps/server/src/dev/',
            `${MODULES}[^/]+/internal/fake/`,
            '^apps/server/test/',
          ],
        },
        to: { path: '^apps/server/src/dev/sandbox/' },
      },
    ].map((rule) => ({
      name: 'dev-only-restricted',
      severity: 'error',
      comment:
        'Mã chỉ-dev (src/dev: schema sandbox, kho kịch bản, memoryTx, endpoint giả lập) chỉ được dùng từ src/dev, modules/*/internal/fake/** và tầng ghép (005 R17). Mã chạy ở production không được phụ thuộc bản giả lập.',
      ...rule,
    })),
    {
      name: 'aws-sdk-only-in-storage',
      severity: 'error',
      comment:
        'SDK AWS (@aws-sdk/*) chỉ được dùng trong core/storage/s3/ (005 R13, FR-008). Dùng giao diện ObjectStorage của core/storage.',
      from: { pathNot: '^apps/server/src/core/storage/s3/' },
      to: { path: packagePatternToPath('^@aws-sdk/') },
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
