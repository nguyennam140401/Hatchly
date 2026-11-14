// So tập loại tài nguyên của hai môi trường (SC-004: cùng hình dạng, khác biệt truy được về tham số).
// Ngoại lệ DUY NHẤT: nhóm `mail-capture` (Mailpit) chỉ có ở thử nghiệm (FR-029).

/** Địa chỉ tài nguyên thuộc nhóm ngoại lệ. */
export const EXCEPTION_GROUPS = Object.freeze([
  { name: 'mail-capture', match: /mailpit|mail_capture/ },
]);

/**
 * Tập loại tài nguyên (`type`) trong một tài liệu `terraform show -json` hoặc danh sách địa chỉ trạng thái.
 * Tài nguyên thuộc nhóm ngoại lệ bị bỏ qua. Không tính nguồn dữ liệu (`data.`).
 * @param {{ resource_changes?: { address: string, type: string, change?: { actions: string[] } }[] }} plan
 */
export function componentTypes(plan) {
  const types = new Set();
  for (const rc of plan.resource_changes ?? []) {
    if (rc.address.startsWith('data.') || rc.address.includes('.data.')) continue;
    if (EXCEPTION_GROUPS.some((g) => g.match.test(rc.address))) continue;
    types.add(rc.type);
  }
  return types;
}

/** Trả `{ onlyA, onlyB }` – các loại chỉ có ở một bên. Rỗng cả hai = cùng hình dạng. */
export function compareComponents(a, b) {
  return {
    onlyA: [...a].filter((t) => !b.has(t)).sort(),
    onlyB: [...b].filter((t) => !a.has(t)).sort(),
  };
}
