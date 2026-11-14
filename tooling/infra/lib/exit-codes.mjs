// Mã thoát chung của `pnpm infra` (contracts/infra-cli.md mục 5).
export const EXIT = Object.freeze({
  /** Đạt. */
  OK: 0,
  /** Lỗi chung. */
  ERROR: 1,
  /** Có lệch / có thay đổi cần xử lý. */
  CHANGES: 2,
  /** Bị lớp chặn từ chối. */
  BLOCKED: 3,
  /** Thiếu điều kiện khởi tạo (hồ sơ chứng thực, kubeconfig, danh sách khởi tạo một lần). */
  NOT_READY: 4,
});

/**
 * Lỗi có mã thoát riêng. Thông điệp phải là việc người dùng cần làm tiếp và KHÔNG chứa giá trị bí mật.
 * `cli.mjs` bắt lỗi này, in thông điệp và thoát đúng mã.
 */
export class CliExit extends Error {
  /** @param {string} message @param {number} exit */
  constructor(message, exit = EXIT.ERROR) {
    super(message);
    this.name = 'CliExit';
    this.exit = exit;
  }
}
