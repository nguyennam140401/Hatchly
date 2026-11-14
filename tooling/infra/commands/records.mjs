// `pnpm infra records <env> [--last N]` – liệt kê bản ghi áp dụng và bản ghi diễn tập (T096). Chỉ đọc.
import { EXIT } from '../lib/exit-codes.mjs';
import { openSession } from '../lib/session.mjs';
import { listApplyRecords, listDrillRecords } from '../lib/records.mjs';

/** UTC → UTC+7, dạng `YYYY-MM-DD HH:mm`. */
export function toLocal(iso) {
  const t = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return `${t.toISOString().slice(0, 16).replace('T', ' ')} (UTC+7)`;
}

export function formatApplied(records) {
  if (records.length === 0) return '  (chưa có bản ghi áp dụng)';
  return records
    .map((r) => {
      const s = r.summary ?? {};
      const loss = r.dataLossConfirmed ? ' · ĐÃ XÁC NHẬN MẤT DỮ LIỆU' : '';
      return `  ${toLocal(r.appliedAt)}  ${r.stack.padEnd(8)} ${String(r.definitionHash).slice(7, 19)}  ${String(r.gitCommit).slice(0, 8)}  +${s.create ?? 0} ~${s.update ?? 0} ±${s.replace ?? 0} -${s.delete ?? 0}${loss}  (${r.operator})`;
    })
    .join('\n');
}

export function formatDrills(records) {
  if (records.length === 0) return '  (chưa có bản ghi diễn tập)';
  return records
    .map(
      (r) =>
        `  ${toLocal(r.startedAt)}  ${String(r.result).toUpperCase()}  ${r.durationSeconds}s  mất ${r.dataLossSeconds}s  dòng đánh dấu: ${r.markerFound ? 'có' : 'THIẾU'}  (${r.operator})`,
    )
    .join('\n');
}

export async function run({ env, flags }, deps = {}) {
  const last = typeof flags.last === 'string' ? Number(flags.last) : undefined;
  if (deps.listApplyRecords === undefined)
    await (deps.openSession ?? openSession)(env, { verifyProject: false });
  const applied = await (deps.listApplyRecords ?? listApplyRecords)(env, { last });
  const drills = await (deps.listDrillRecords ?? listDrillRecords)(env, { last });
  console.log(
    `Bản ghi áp dụng – ${env}:\n${formatApplied(applied)}\n\nBản ghi diễn tập – ${env}:\n${formatDrills(drills)}`,
  );
  return EXIT.OK;
}
