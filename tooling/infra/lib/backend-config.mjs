// Đọc `infra/envs/<env>.backend.hcl` (không bí mật) – dùng cho s3.mjs và nhánh khóa dự phòng (R3, V6).
import { readFileSync } from 'node:fs';
import { envFile } from './paths.mjs';

/**
 * Phân tích tối thiểu: `khóa = "chuỗi" | số | true | false` và khối `endpoints = { s3 = "…" }`.
 * @param {string} text
 */
export function parseBackendHcl(text) {
  const out = {};
  const cleaned = text.replace(/#.*$/gm, '').replace(/\/\/.*$/gm, '');
  const endpoints = /endpoints\s*=\s*\{([^}]*)\}/s.exec(cleaned);
  if (endpoints !== null) {
    out.endpoints = {};
    for (const m of endpoints[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out.endpoints[m[1]] = m[2];
  }
  const rest = cleaned.replace(/endpoints\s*=\s*\{[^}]*\}/s, '');
  for (const m of rest.matchAll(
    /^\s*(\w+)\s*=\s*(?:"([^"]*)"|(true|false)|(-?\d+(?:\.\d+)?))\s*$/gm,
  )) {
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (m[3] !== undefined) out[m[1]] = m[3] === 'true';
    else out[m[1]] = Number(m[4]);
  }
  return out;
}

export function loadBackendConfig(env) {
  return parseBackendHcl(readFileSync(envFile(env, 'backend.hcl'), 'utf8'));
}

/** `true` khi vStorage không hỗ trợ khóa bằng ghi có điều kiện (V6) và CLI phải tự khóa. */
export function needsManualLock(config) {
  return config.use_lockfile === false;
}
