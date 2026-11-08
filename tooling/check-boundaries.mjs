// pnpm check:boundaries – chạy dependency-cruiser theo tệp kê khai module (FR-011).
// depcruise trả mã thoát bằng số vi phạm; hợp đồng lệnh (contracts/repo-commands.md) cần 0 / 1.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'depcruise',
  ['apps', 'packages', '--config', '.dependency-cruiser.cjs', '--output-type', 'err-long'],
  { stdio: 'inherit', shell: true },
);
process.exit(result.status === 0 ? 0 : 1);
