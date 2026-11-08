// Kiểm tra ranh giới module (pnpm check:boundaries). Quy tắc sinh từ
// apps/server/src/modules/modules.manifest.json qua tooling/boundaries/build-rules.cjs (R10).
'use strict';

const {
  buildForbiddenRules,
  buildOptions,
  readManifest,
} = require('./tooling/boundaries/build-rules.cjs');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: buildForbiddenRules(readManifest(__dirname)),
  options: {
    ...buildOptions(),
    reporterOptions: {},
  },
};
