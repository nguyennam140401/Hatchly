// In sơ đồ Mermaid các module và phụ thuộc được phép từ tệp kê khai (dùng cho README).
// Dùng: node tooling/print-module-graph.mjs
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('apps/server/src/modules/modules.manifest.json', 'utf8'));
const lines = ['```mermaid', 'flowchart LR'];
for (const m of manifest.modules) {
  const shape =
    m.kind === 'infra' ? ['[(', ')]'] : m.kind === 'gateway' ? ['{{', '}}'] : ['[', ']'];
  lines.push(`  ${m.name}${shape[0]}"${m.title}<br/><code>${m.name}</code>"${shape[1]}`);
}
for (const m of manifest.modules) {
  for (const dep of m.allowedDeps) lines.push(`  ${m.name} --> ${dep}`);
}
lines.push('```');
console.log(lines.join('\n'));
