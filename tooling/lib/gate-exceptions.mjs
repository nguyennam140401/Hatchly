// Ngoại lệ vượt cổng – GateException (008, FR-009, R17; data-model.md mục 2).
// Tệp `ops/ci/exceptions/<YYYY-MM-DD>-<slug>.yml`. Dùng bởi `pnpm verify --ci` (áp ngoại lệ còn hạn) và
// `pnpm check:pipeline` (tệp không hợp lệ → không đạt; hết hạn → nhắc xóa).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** Cổng KHÔNG BAO GIỜ được vượt (cột "Ngoại lệ: không" của contracts/quality-gates.md mục 2). */
export const NO_EXCEPTION_GATES = [
  'test:db',
  'check:secrets',
  'check:secrets:test-logs',
  'db:immutable',
  'check:release-source',
];

export const EXCEPTIONS_DIR = 'ops/ci/exceptions';
export const TEAM_FILE = 'ops/ci/team.json';
const MAX_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.yml$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

/** Tên GitHub có vai `release-manager` trong ops/ci/team.json. */
export function releaseManagers(teamFile = TEAM_FILE) {
  if (!existsSync(teamFile)) return [];
  const team = JSON.parse(readFileSync(teamFile, 'utf8'));
  return (team.members ?? [])
    .filter((m) => Array.isArray(m.roles) && m.roles.includes('release-manager'))
    .map((m) => m.github);
}

/**
 * Kiểm một ngoại lệ đã đọc. Trả `{ errors, expired }`; `errors` rỗng = hợp lệ.
 * @param {string} fileName tên tệp (không kèm thư mục)
 * @param {unknown} data nội dung YAML đã phân tích
 */
export function validateException(fileName, data, { gateNames, managers, now = new Date() }) {
  const errors = [];
  const named = FILE_NAME.exec(fileName);
  if (!named) errors.push('tên tệp phải có dạng <YYYY-MM-DD>-<slug>.yml');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: [...errors, 'nội dung phải là một đối tượng YAML'], expired: false };
  }
  const { gate, reason, approvedBy, expiresAt, pullRequest, commit } = data;

  if (typeof gate !== 'string' || !gateNames.includes(gate)) {
    errors.push(`gate: "${String(gate)}" không phải tên một bước của pnpm verify`);
  } else if (NO_EXCEPTION_GATES.includes(gate)) {
    errors.push(`gate: cổng "${gate}" không bao giờ được vượt`);
  }
  if (typeof reason !== 'string' || reason.trim().length < 20) {
    errors.push('reason: cần ít nhất 20 ký tự (vì sao phải vượt, kế hoạch sửa)');
  }
  if (typeof approvedBy !== 'string' || !managers.includes(approvedBy)) {
    errors.push(
      `approvedBy: "${String(approvedBy)}" không có vai release-manager trong ${TEAM_FILE}`,
    );
  }

  let expired = false;
  const expiresText = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;
  if (typeof expiresText !== 'string' || !ISO_UTC.test(expiresText)) {
    errors.push('expiresAt: cần thời điểm ISO-8601 theo UTC (vd 2026-11-20T10:00:00Z)');
  } else {
    const expires = Date.parse(expiresText);
    if (Number.isNaN(expires)) {
      errors.push('expiresAt: không đọc được thời điểm');
    } else {
      expired = expires <= now.getTime();
      if (named) {
        // Hết ngày thứ 7 kể từ ngày trong tên tệp (tính theo UTC).
        const limit = Date.parse(`${named[1]}T00:00:00Z`) + (MAX_DAYS + 1) * DAY_MS;
        if (Number.isNaN(limit)) errors.push('tên tệp: ngày không hợp lệ');
        else if (expires >= limit) {
          errors.push(`expiresAt: quá ${MAX_DAYS} ngày kể từ ngày trong tên tệp (${named[1]})`);
        }
      }
    }
  }

  const hasPullRequest = Number.isInteger(pullRequest) && pullRequest > 0;
  const hasCommit = typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit);
  if (!hasPullRequest && !hasCommit) {
    errors.push('phạm vi: cần pullRequest (số) hoặc commit (SHA)');
  }
  return { errors, expired };
}

/**
 * Đọc mọi ngoại lệ trong thư mục. Mỗi mục: `{ file, data, errors, expired }`.
 * @param {{ dir?: string, teamFile?: string, gateNames: string[], now?: Date }} options
 */
export function loadExceptions({ dir = EXCEPTIONS_DIR, teamFile = TEAM_FILE, gateNames, now }) {
  if (!existsSync(dir)) return [];
  const managers = releaseManagers(teamFile);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const file = join(dir, name).replaceAll('\\', '/');
      let data;
      try {
        data = parse(readFileSync(file, 'utf8'));
      } catch (err) {
        const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
        return { file, data: null, errors: [`YAML không hợp lệ: ${message}`], expired: false };
      }
      return { file, data, ...validateException(name, data, { gateNames, managers, now }) };
    });
}

/** Ngoại lệ hợp lệ, còn hạn cho đúng cổng; không có → undefined. */
export function findActiveException(exceptions, gate) {
  return exceptions.find((e) => e.errors.length === 0 && !e.expired && e.data.gate === gate);
}
