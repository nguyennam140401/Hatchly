// Thông báo Telegram của đường ống (008 FR-044/FR-044a, contracts/deploy-pipeline.md mục 8).
// Dùng:
//   node notify-telegram.mjs --env staging --result success --sha a1b2c3d4e5f6 --author ten --pr 123 \
//        --minutes 9 --migrations 1 --vulns 0 --url https://ci.example/job/... [--excepted lint,...]
//   node notify-telegram.mjs --env production --result failed --failed-step migrate ...
//   node notify-telegram.mjs --text "nội dung tự do (đã được người gọi lọc bí mật)" [--high]
//   thêm --dry-run để chỉ in tin ra màn hình.
// Kết quả: success | failed | rolledback | noenv. Biến môi trường: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Tin KHÔNG chứa bí mật, nhật ký thô hay dữ liệu khách hàng. Gửi lỗi: thử lại 3 lần (5 s, 30 s, 120 s); vẫn lỗi
// → in `notifyErrors` và thoát mã 0 (kết quả triển khai không đổi).
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** @typedef {{env?:string, result?:string, sha?:string, author?:string, pr?:string, minutes?:string, migrations?:string, vulns?:string, url?:string, failedStep?:string, excepted?:string, text?:string, high?:boolean}} Event */

const short = (sha) => (sha ?? '').slice(0, 12);

/** Người hợp nhất + nhóm trực để nhắc ở tin ưu tiên cao (`ops/ci/team.json`, chỉ tên Telegram). */
export function mentions(team, author) {
  const handles = new Set();
  for (const m of team?.members ?? []) {
    if (m.telegram && (m.github === author || (team.onCall ?? []).includes(m.github))) {
      handles.add(m.telegram.startsWith('@') ? m.telegram : `@${m.telegram}`);
    }
  }
  return [...handles];
}

/**
 * Dựng nội dung tin theo bốn khuôn của hợp đồng.
 * @param {Event} e
 * @param {{members?: {github:string, telegram?:string}[], onCall?: string[]}} [team]
 */
export function buildMessage(e, team) {
  if (e.text !== undefined) return `${e.high ? '🚨 ƯU TIÊN CAO\n' : ''}${e.text}`;
  const head = `${e.env ?? '?'} · `;
  const sha = short(e.sha);
  let title;
  switch (e.result) {
    case 'success':
      title = `✅ ${head}thành công · ${sha}`;
      break;
    case 'failed':
      title = `❌ ${head}hỏng ở bước ${e.failedStep ?? '?'} (môi trường giữ nguyên) · ${sha}`;
      break;
    case 'rolledback':
      title = `⚠️ ${head}ĐÃ QUAY VỀ BẢN TRƯỚC (hỏng ở ${e.failedStep ?? '?'}) · ${sha}`;
      break;
    case 'noenv':
      title = `ℹ️ ${head}chưa có môi trường đích · ${sha}`;
      break;
    default:
      title = `❓ ${head}kết quả không rõ · ${sha}`;
  }
  const production = e.env === 'production';
  const bad = e.result === 'failed' || e.result === 'rolledback';
  const priority = (production && bad) || e.high === true;
  const lines = [];
  if (priority) {
    const who = mentions(team, e.author);
    lines.push(`🚨 ƯU TIÊN CAO${who.length > 0 ? ` ${who.join(' ')}` : ''}`);
  }
  lines.push(title);
  const meta = [
    e.author ? `Tác giả: ${e.author}` : null,
    e.pr ? `PR #${e.pr}` : null,
    e.minutes ? `${e.minutes} phút` : null,
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(' · '));
  if (e.result === 'success' || e.migrations !== undefined || e.vulns !== undefined) {
    lines.push(`Migration: ${e.migrations ?? '0'} · Lỗ hổng nghiêm trọng: ${e.vulns ?? '0'}`);
  }
  if (e.excepted) lines.push(`Ngoại lệ đã dùng: ${e.excepted}`);
  if (e.url) lines.push(e.url);
  return lines.join('\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gửi tin; thử lại theo `delaysMs`. Trả `{ok, attempts}`. Không bao giờ in mã bot hay thân phản hồi.
 */
export async function sendTelegram(
  text,
  env = process.env,
  delaysMs = [5000, 30000, 120000],
  fetchFn = fetch,
) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)
    return { ok: false, attempts: 0, reason: 'thiếu cấu hình Telegram' };
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      const res = await fetchFn(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text,
            disable_web_page_preview: true,
          }),
        },
      );
      if (res.ok) return { ok: true, attempts: attempt + 1 };
    } catch {
      // mạng lỗi: thử lại
    }
    if (attempt < delaysMs.length) await sleep(delaysMs[attempt]);
  }
  return { ok: false, attempts: delaysMs.length + 1, reason: 'gửi không thành công' };
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main(argv, env) {
  const args = parse(argv);
  const teamFile = 'ops/ci/team.json';
  const team = existsSync(teamFile) ? JSON.parse(readFileSync(teamFile, 'utf8')) : undefined;
  const text = buildMessage(args, team);
  console.log(text);
  if (args.dryRun) return 0;
  const result = await sendTelegram(text, env);
  if (!result.ok)
    console.error(`notifyErrors: ${result.reason ?? 'lỗi'} sau ${result.attempts} lần`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
