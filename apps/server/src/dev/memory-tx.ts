import type { Db } from '../core/db';

// Vật thế chỗ giao dịch cho chế độ `FAKE_STATE_STORE=memory` (005, research R9b). Đúng kiểu `Db` để
// truyền vào `notifications.emit(tx, …)` / `onCrossed(tx, …)` như bản thật, nhưng KHÔNG chạy được SQL:
// mọi truy cập thuộc tính → ném lỗi (bắt nhầm chế độ). Chỉ `src/dev/**` và `modules/*/internal/fake/**`
// được nhập tệp này (quy tắc ranh giới `dev-only-restricted`).

const MEMORY_TX = Symbol.for('app.dev.memoryTx');

const MESSAGE = 'memoryTx không chạy được SQL – sai chế độ FAKE_STATE_STORE';

/** Một giao dịch "trong bộ nhớ" mới (mỗi lần gọi là một đối tượng riêng). */
export function memoryTx(): Db {
  const target = { [MEMORY_TX]: true };
  return new Proxy(target, {
    get(obj, key) {
      if (key === MEMORY_TX) return true;
      // Cho phép kiểm tra "có phải Promise không" (await tx) và in gỡ lỗi mà không ném.
      if (key === 'then' || key === Symbol.toStringTag || key === 'toJSON') return undefined;
      if (key === Symbol.for('nodejs.util.inspect.custom')) return () => '[memoryTx]';
      throw new Error(MESSAGE);
    },
    has(_obj, key) {
      return key === MEMORY_TX;
    },
    set() {
      throw new Error(MESSAGE);
    },
  }) as unknown as Db;
}

/** `tx` có phải vật thế chỗ của `memoryTx()` không – CHỈ dùng trong bản giả lập. */
export function isMemoryTx(tx: unknown): boolean {
  return typeof tx === 'object' && tx !== null && MEMORY_TX in tx;
}
