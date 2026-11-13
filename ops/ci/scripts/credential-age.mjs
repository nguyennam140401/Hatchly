// Báo tuổi thông tin xác thực (008, FR-040, jenkins-platform.md mục 6): đọc ngày xoay của từng thông tin trong
// ops/ci/rotation.json (CHỈ có tên + ngày, không có giá trị bí mật; cập nhật trong pull request xoay thông tin) và báo Telegram khi quá 90 ngày.
// Dùng: node credential-age.mjs [--file <rotation.json>] [--max-days 90] [--dry-run]
//   rotation.json: { "github-app-ci": "2026-11-13", "staging/registry": "2026-08-01", ... }
// Biến môi trường (job `maintenance/credential-age` cấp từ thông tin xác thực của thư mục deploy/): TELEGRAM_BOT_TOKEN,
// TELEGRAM_CHAT_ID. Thiếu một trong hai → chỉ in kết quả ra màn hình (mã thoát vẫn phản ánh có thông tin quá hạn).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DAY_MS = 86_400_000;

/**
 * @param {Record<string, string>} rotation tên → ngày xoay gần nhất (YYYY-MM-DD)
 * @returns {{ name: string, days: number }[]} các thông tin quá hạn, tuổi giảm dần; ngày sai định dạng cũng tính là quá hạn
 */
export function overdue(rotation, now = new Date(), maxDays = 90) {
  return Object.entries(rotation)
    .map(([name, date]) => {
      const t = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
      return {
        name,
        days: Number.isNaN(t) ? Number.POSITIVE_INFINITY : Math.floor((now.getTime() - t) / DAY_MS),
      };
    })
    .filter((item) => item.days > maxDays)
    .sort((a, b) => b.days - a.days);
}

export function message(items, maxDays = 90) {
  const lines = items.map(
    (i) => `• ${i.name}: ${Number.isFinite(i.days) ? `${i.days} ngày` : 'không rõ ngày xoay'}`,
  );
  return `⚠️ Thông tin xác thực của Jenkins quá ${maxDays} ngày chưa xoay:\n${lines.join('\n')}\nXoay theo docs/ci-cd/credentials.md rồi cập nhật rotation.json.`;
}

async function main(argv, env) {
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : (argv[i + 1] ?? fallback);
  };
  const file = flag('--file', 'ops/ci/rotation.json');
  const maxDays = Number(flag('--max-days', '90'));
  const items = overdue(JSON.parse(readFileSync(file, 'utf8')), new Date(), maxDays);
  if (items.length === 0) {
    console.log('✔ không có thông tin xác thực nào quá hạn xoay');
    return 0;
  }
  const text = message(items, maxDays);
  console.log(text);
  if (!argv.includes('--dry-run') && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
    // Không in thân phản hồi / URL (chứa mã bot).
    if (!res.ok) console.error(`✖ gửi Telegram lỗi: HTTP ${res.status}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2), process.env));
}
