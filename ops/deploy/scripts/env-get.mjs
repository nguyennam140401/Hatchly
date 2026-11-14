// Đọc một trường của tham số môi trường (008): node ops/deploy/scripts/env-get.mjs <env> <đường.dẫn.trường> [--file <yaml>]
// Ví dụ: env-get.mjs staging cluster.namespaces.app → "app". In giá trị thô (chuỗi / số / boolean); thiếu → mã thoát 1.
// Dùng bởi ops/ci/scripts/deploy.sh để KHÔNG phải phân tích YAML trong shell/Groovy.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export function getPath(object, path) {
  return path
    .split('.')
    .reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), object);
}

function main(argv) {
  const [env, path] = argv;
  const fileIndex = argv.indexOf('--file');
  const file = fileIndex === -1 ? `ops/deploy/env/${env}.yaml` : argv[fileIndex + 1];
  if (!env || !path) {
    console.error('✖ cần <env> <đường.dẫn>');
    return 2;
  }
  const { parse } = createRequire(`${root}tooling/package.json`)('yaml');
  const value = getPath(parse(readFileSync(file, 'utf8')), path);
  if (value === undefined || value === null) {
    console.error(`✖ không có trường ${path} trong ${file}`);
    return 1;
  }
  console.log(typeof value === 'object' ? JSON.stringify(value) : String(value));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
