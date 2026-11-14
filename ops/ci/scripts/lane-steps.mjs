// In các bước của một làn theo ops/ci/gate-lanes.json, cách nhau bằng dấu phẩy, theo `order` (008 R9).
// Dùng: node lane-steps.mjs <làn>        → ví dụ "build:shared,typecheck,lint"
//       node lane-steps.mjs --lanes      → tên các làn, mỗi dòng một tên
// Jenkinsfile.ci không viết danh sách bước trong Groovy: mọi thứ đọc từ tệp này (một nguồn sự thật).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function laneSteps(lanes, name) {
  const lane = lanes.lanes?.[name];
  if (!Array.isArray(lane)) throw new Error(`Không có làn "${name}"`);
  return [...lane].sort((a, b) => a.order - b.order).map((s) => s.step);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lanes = JSON.parse(
    readFileSync(process.env.GATE_LANES ?? 'ops/ci/gate-lanes.json', 'utf8'),
  );
  const arg = process.argv[2];
  try {
    if (arg === '--lanes') console.log(Object.keys(lanes.lanes).join('\n'));
    else console.log(laneSteps(lanes, arg).join(','));
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
