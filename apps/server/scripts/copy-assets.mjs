// Chép tệp dữ liệu tĩnh không phải TypeScript từ src/ sang dist/ sau khi `tsc` biên dịch
// (vd danh sách mật khẩu cấm – 004 R2). tsc chỉ chép .json qua `resolveJsonModule`.
import { cpSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ASSET_EXTENSIONS = ['.txt'];
const SRC = 'src';
const DIST = 'dist';

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (ASSET_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      cpSync(path, join(DIST, relative(SRC, path)));
    }
  }
}

walk(SRC);
