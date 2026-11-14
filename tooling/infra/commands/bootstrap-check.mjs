// `pnpm infra bootstrap-check <env> [--mark <mục>]` – kiểm danh sách khởi tạo một lần (T050,
// contracts/one-time-bootstrap.md). Mỗi mục A1–A4, B1–B5, C1–C12 trả: đạt · thiếu (kèm lý do) · tự xác nhận ·
// kiểm sau khi dựng. Thoát 4 khi còn [thiếu].
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CliExit, EXIT } from '../lib/exit-codes.mjs';
import { envFile } from '../lib/paths.mjs';
import { parseTfvars } from '../lib/params-diff.mjs';
import { defaultListProjectIds, loadCredentials, projectIdOf } from '../lib/credentials.mjs';
import { createS3, tryAnonymousGet } from '../lib/s3.mjs';
import { loadBackendConfig } from '../lib/backend-config.mjs';

export const STATUS = Object.freeze({
  OK: 'đạt',
  MISSING: 'thiếu',
  SELF: 'tự xác nhận',
  LATER: 'kiểm sau khi dựng',
});

const self = (id, title) => ({ id, title, kind: 'self' });
const later = (id, title) => ({ id, title, kind: 'later' });

/** Danh sách mục (tiêu đề ngắn) – thứ tự theo mục D của hợp đồng. */
export const ITEMS = [
  self('A1', 'Tài khoản VNG Cloud, xác thực hai lớp, mã khôi phục cất ngoài máy'),
  self('A2', 'Hạn mức đủ (3 máy 4 vCPU/8 GB + 1 máy tạm, 2 cân bằng tải, đĩa 300 GB)'),
  self('A3', 'Tài khoản IAM cá nhân cho người vận hành (không dùng tài khoản gốc)'),
  self('A4', 'Nhật ký hoạt động quản trị (V14)'),
  self('B1', 'Kho ảnh riêng tư vCR với hai kho con server, web'),
  self('B2', 'Robot push (không nằm trong bất kỳ Secret nào)'),
  self('B3', 'Robot pull-staging, pull-production (chỉ kéo)'),
  self('B4', 'Luật thẻ ảnh không ghi đè (V11)'),
  self('B5', 'GitHub Environment staging-readonly, production-readonly'),
  { id: 'C1', title: 'Project của môi trường tồn tại', kind: 'auto' },
  { id: 'C2', title: 'terraform-<env>: thấy project mình, bị từ chối ở project kia', kind: 'auto' },
  self('C3', 'drift-<env>: chỉ đọc (thử tạo nhóm bảo mật bị từ chối)'),
  later('C4', 'app-<env>: đọc/ghi được bucket media'),
  later('C5', 'dbbackup-<env>: ghi được bucket sao lưu, bị từ chối ở bucket media'),
  { id: 'C6', title: 'Khóa S3 xác thực được', kind: 'auto' },
  {
    id: 'C7',
    title: 'Bucket trạng thái: lưu phiên bản, mã hóa, giữ phiên bản cũ ≥ 90 ngày, riêng tư',
    kind: 'auto',
  },
  { id: 'C8', title: 'Khóa KMS (kms_key_id) đã điền', kind: 'auto' },
  later('C9', 'Điểm phân phối CDN trỏ origin-app.<base_domain>'),
  later('C10', 'Bản ghi DNS theo pnpm infra outputs'),
  { id: 'C11', title: 'Hồ sơ chứng thực infra/.credentials/<env>.env đọc được', kind: 'auto' },
  self('C12', 'drill-production: chỉ đọc bucket sao lưu phát hành'),
];

export function readBootstrap(env) {
  const file = envFile(env, 'bootstrap.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

export function markBootstrap(env, id, today = new Date()) {
  if (id !== 'C7-encryption' && !ITEMS.some((i) => i.id === id && i.kind === 'self')) {
    throw new CliExit(
      `Mục ${id} không thuộc loại tự xác nhận. Mục tự xác nhận: ${ITEMS.filter(
        (i) => i.kind === 'self',
      )
        .map((i) => i.id)
        .join(', ')}.`,
      EXIT.ERROR,
    );
  }
  const state = readBootstrap(env);
  state[id] = today.toISOString().slice(0, 10);
  writeFileSync(envFile(env, 'bootstrap.json'), `${JSON.stringify(state, null, 2)}\n`);
  return state[id];
}

const isPlaceholder = (value) =>
  typeof value !== 'string' || value === '' || value.startsWith('TODO-P6');

/** Kiểm bucket trạng thái (C7). `ctx.s3` và `ctx.fetchStatus` tiêm được. Trả danh sách `[status, lý do]` theo ý nhỏ. */
export async function checkStateBucket(ctx) {
  const problems = [];
  const notes = [];
  try {
    await ctx.s3.list('');
  } catch {
    return { problems: ['không đọc được bucket (chưa tạo hoặc khóa sai quyền)'], notes };
  }
  const versioning = await ctx.s3.getBucketVersioning();
  if (versioning !== 'Enabled') problems.push(`chưa bật lưu phiên bản (đang ${versioning})`);

  const encryption = await ctx.s3.getBucketEncryption();
  if (encryption === null) {
    if (ctx.bootstrap['C7-encryption'] === undefined) {
      problems.push(
        'chưa xác nhận mã hóa khi lưu (vStorage mã hóa mặc định? chạy --mark C7-encryption sau khi xác minh V5)',
      );
    } else notes.push(`mã hóa tự xác nhận ngày ${ctx.bootstrap['C7-encryption']}`);
  }

  const rules = await ctx.s3.getBucketLifecycle();
  const keepsOld = rules.some(
    (r) => r.Status === 'Enabled' && (r.NoncurrentVersionExpiration?.NoncurrentDays ?? 0) >= 90,
  );
  const neverExpires = rules.every((r) => r.NoncurrentVersionExpiration === undefined);
  if (!keepsOld && !neverExpires) problems.push('luật vòng đời hết hạn phiên bản cũ < 90 ngày');

  const status = await ctx.fetchStatus();
  if (status === 200) problems.push('bucket đọc được KHÔNG cần xác thực (đang công khai!)');
  return { problems, notes };
}

/**
 * @param {string} env
 * @param {object} [deps] tiêm cho kiểm thử: `listProjectIds`, `s3`, `fetchStatus`, `loadCredentials`, `bootstrap`, `tfvars`, `otherProjectId`
 * @returns {Promise<{ id: string, title: string, status: string, detail: string }[]>}
 */
export async function runChecks(env, deps = {}) {
  const other = env === 'staging' ? 'production' : 'staging';
  const tfvars = deps.tfvars ?? parseTfvars(readFileSync(envFile(env, 'tfvars'), 'utf8'));
  const bootstrap = deps.bootstrap ?? readBootstrap(env);
  const results = [];
  const push = (item, status, detail = '') =>
    results.push({ id: item.id, title: item.title.replace('<env>', env), status, detail });

  let creds;
  let credError;
  try {
    creds = (deps.loadCredentials ?? loadCredentials)(env);
  } catch (error) {
    credError = error instanceof Error ? error.message : 'lỗi';
  }

  let projects = null;
  if (creds !== undefined && deps.listProjectIds !== undefined) {
    try {
      projects = await deps.listProjectIds(creds);
    } catch {
      projects = null;
    }
  }

  let s3 = deps.s3;
  if (s3 === undefined && creds !== undefined) {
    try {
      s3 = createS3(env);
    } catch {
      s3 = undefined;
    }
  }
  const backend =
    deps.backend ??
    (() => {
      try {
        return loadBackendConfig(env);
      } catch {
        return {};
      }
    })();

  for (const item of ITEMS) {
    if (item.kind === 'self') {
      const day = bootstrap[item.id];
      push(
        item,
        day === undefined ? STATUS.MISSING : STATUS.SELF,
        day === undefined
          ? `chưa xác nhận – chạy: pnpm infra bootstrap-check ${env} --mark ${item.id}`
          : `ngày ${day}`,
      );
      continue;
    }
    if (item.kind === 'later') {
      push(item, STATUS.LATER, 'kiểm sau khi dựng stack cloud');
      continue;
    }
    switch (item.id) {
      case 'C1': {
        if (isPlaceholder(tfvars.project_id))
          push(item, STATUS.MISSING, 'project_id còn là chỗ giữ TODO-P6 trong tệp tham số');
        else if (projects === null)
          push(
            item,
            STATUS.MISSING,
            credError ?? 'không liệt kê được project (kiểm tra hồ sơ chứng thực/API)',
          );
        else
          push(
            item,
            projects.includes(tfvars.project_id) ? STATUS.OK : STATUS.MISSING,
            projects.includes(tfvars.project_id)
              ? ''
              : 'project_id không có trong danh sách project của tài khoản dịch vụ',
          );
        break;
      }
      case 'C2': {
        const otherId =
          deps.otherProjectId ??
          (() => {
            try {
              return projectIdOf(other);
            } catch {
              return undefined;
            }
          })();
        if (projects === null)
          push(item, STATUS.MISSING, credError ?? 'không liệt kê được project');
        else if (!projects.includes(tfvars.project_id))
          push(item, STATUS.MISSING, 'không thấy project của môi trường này');
        else if (
          typeof otherId === 'string' &&
          !isPlaceholder(otherId) &&
          projects.includes(otherId)
        )
          push(
            item,
            STATUS.MISSING,
            `tài khoản dịch vụ thấy cả project của ${other} – phải giới hạn một project (V2)`,
          );
        else
          push(
            item,
            STATUS.OK,
            isPlaceholder(otherId)
              ? `chưa kiểm được phía ${other} (project ${other} chưa khai)`
              : '',
          );
        break;
      }
      case 'C6': {
        if (s3 === undefined) push(item, STATUS.MISSING, credError ?? 'chưa có khóa S3');
        else {
          try {
            await s3.list('');
            push(item, STATUS.OK);
          } catch {
            push(
              item,
              STATUS.MISSING,
              'khóa S3 không xác thực được hoặc bucket trạng thái chưa có',
            );
          }
        }
        break;
      }
      case 'C7': {
        if (s3 === undefined) {
          push(item, STATUS.MISSING, credError ?? 'chưa có khóa S3');
          break;
        }
        const fetchStatus =
          deps.fetchStatus ??
          (() =>
            tryAnonymousGet(backend.endpoints?.s3 ?? '', backend.bucket ?? '', 'probe-anonymous', {
              pathStyle: backend.use_path_style !== false,
            }).catch(() => 403));
        const { problems, notes } = await checkStateBucket({ s3, bootstrap, fetchStatus });
        push(
          item,
          problems.length === 0 ? STATUS.OK : STATUS.MISSING,
          [...problems, ...notes].join('; '),
        );
        break;
      }
      case 'C8':
        push(
          item,
          isPlaceholder(tfvars.kms_key_id) ? STATUS.MISSING : STATUS.OK,
          isPlaceholder(tfvars.kms_key_id)
            ? 'kms_key_id còn là chỗ giữ TODO-P6 (khóa tạo tay – C8)'
            : '',
        );
        break;
      case 'C11':
        push(item, creds === undefined ? STATUS.MISSING : STATUS.OK, credError ?? '');
        break;
      default:
        push(item, STATUS.MISSING, 'chưa có phép kiểm');
    }
  }
  return results;
}

export function formatResults(results) {
  return results
    .map((r) => `[${r.status}] ${r.id} ${r.title}${r.detail ? ` – ${r.detail}` : ''}`)
    .join('\n');
}

export async function run({ env, flags }, deps = {}) {
  if (typeof flags.mark === 'string') {
    const day = markBootstrap(env, flags.mark);
    console.log(`Đã ghi ${flags.mark} = ${day}.`);
    return EXIT.OK;
  }
  const results = await runChecks(env, { listProjectIds: defaultListProjectIds, ...deps });
  console.log(formatResults(results));
  const missing = results.filter((r) => r.status === STATUS.MISSING);
  if (missing.length > 0) {
    console.log(
      `\nCòn ${missing.length} mục thiếu: ${missing.map((m) => m.id).join(', ')}. Làm theo infra/docs/01-khoi-tao-lan-dau.md.`,
    );
    return EXIT.NOT_READY;
  }
  console.log('\nDanh sách khởi tạo đạt (trừ mục kiểm sau khi dựng).');
  return EXIT.OK;
}
