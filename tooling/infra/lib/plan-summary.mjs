// Tóm tắt bản xem trước (`terraform show -json`) bằng tiếng Việt: tạo / sửa / thay thế / xóa, thao tác nguy hiểm lên đầu.

/** @param {string[]} actions @returns {'create'|'update'|'replace'|'delete'|'none'} */
export function classifyActions(actions) {
  const set = new Set(actions);
  if (set.has('delete') && set.has('create')) return 'replace';
  if (set.has('delete')) return 'delete';
  if (set.has('create')) return 'create';
  if (set.has('update')) return 'update';
  return 'none';
}

/**
 * @param {{ resource_changes?: { address: string, type: string, change: { actions: string[] } }[] }} plan
 * @returns {{ counts: Record<string, number>, items: { address: string, type: string, kind: string }[], changed: boolean }}
 */
export function summarizePlan(plan) {
  const counts = { create: 0, update: 0, replace: 0, delete: 0 };
  const items = [];
  for (const rc of plan.resource_changes ?? []) {
    const kind = classifyActions(rc.change.actions);
    if (kind === 'none') continue;
    counts[kind] += 1;
    items.push({ address: rc.address, type: rc.type, kind });
  }
  // Xóa/thay thế lên đầu để người đọc thấy trước.
  const order = { delete: 0, replace: 1, update: 2, create: 3 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || a.address.localeCompare(b.address));
  return { counts, items, changed: items.length > 0 };
}

const LABEL = { create: 'tạo', update: 'sửa', replace: 'THAY THẾ', delete: 'XÓA' };

export function formatSummary(summary, stack) {
  if (!summary.changed) return `[${stack}] Không có thay đổi.`;
  const { counts } = summary;
  const lines = [
    `[${stack}] ${counts.create} tạo · ${counts.update} sửa · ${counts.replace} thay thế · ${counts.delete} xóa`,
  ];
  for (const item of summary.items) {
    const danger = item.kind === 'delete' || item.kind === 'replace' ? '!! ' : '   ';
    lines.push(`${danger}${LABEL[item.kind]}  ${item.address}`);
  }
  return lines.join('\n');
}
