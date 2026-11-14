// Tài nguyên chứa dữ liệu được bảo vệ (T091, data-model.md mục 8; contracts/infra-cli.md mục 4 lớp (c)).
// Thêm tài nguyên chứa dữ liệu mới vào hạ tầng mà quên danh sách này → kiểm thử protected-coverage lỗi.

/** Luật: `type` bắt buộc; `address` (RegExp) thu hẹp khi một loại vừa có tài nguyên dữ liệu vừa không. */
export const PROTECTED_RULES = Object.freeze([
  { label: 'bucket (media, sao lưu)', type: 'aws_s3_bucket' },
  {
    label: 'cụm CSDL CloudNativePG',
    type: 'helm_release',
    address: /\.helm_release\.pg_cluster(\[|$)/,
  },
  { label: 'CSDL quản lý sẵn', type: 'vngcloud_vdb_postgresql_cluster' },
  { label: 'đĩa dữ liệu', type: 'vngcloud_vserver_volume' },
  {
    label: 'không gian tên database',
    type: 'kubernetes_namespace_v1',
    address: /\["database"\]$/,
  },
]);

export function isProtected(resourceChange) {
  return PROTECTED_RULES.some(
    (rule) =>
      rule.type === resourceChange.type &&
      (rule.address === undefined || rule.address.test(resourceChange.address)),
  );
}

const actionOf = (actions) => {
  if (actions.includes('delete') && actions.includes('create')) return 'replace';
  return actions.includes('delete') ? 'delete' : null;
};

/** Thao tác xóa/thay thế trên tài nguyên được bảo vệ. @returns {{ address: string, action: 'delete' | 'replace' }[]} */
export function protectedChanges(planJson) {
  const out = [];
  for (const rc of planJson.resource_changes ?? []) {
    const action = actionOf(rc.change?.actions ?? []);
    if (action !== null && isProtected(rc)) out.push({ address: rc.address, action });
  }
  return out;
}

/** Tài nguyên mang nhãn `data = "true"` trong bản xem trước (dùng cho kiểm thử độ phủ). */
export function dataTaggedAddresses(planJson) {
  const out = [];
  for (const rc of planJson.resource_changes ?? []) {
    const after = rc.change?.after ?? {};
    const labels = after.tags ?? after.labels ?? after.metadata?.[0]?.labels ?? {};
    if (labels.data === 'true') out.push({ address: rc.address, type: rc.type });
  }
  return out;
}

/**
 * Tài nguyên bị GỠ bảo vệ xóa trong bản xem trước: `force_destroy` false→true (bucket), hoặc `values` Helm đổi
 * `deletionProtect: true` → `false`. Ghi vào bản ghi áp dụng để lần sau cho phép `--confirm-data-loss`.
 */
export function protectionRemovals(planJson) {
  const out = [];
  for (const rc of planJson.resource_changes ?? []) {
    if (!isProtected(rc)) continue;
    const before = rc.change?.before ?? {};
    const after = rc.change?.after ?? {};
    const bucket = before.force_destroy === false && after.force_destroy === true;
    const helm =
      /deletionProtect:\s*true/.test(JSON.stringify(before.values ?? '')) &&
      /deletionProtect:\s*false/.test(JSON.stringify(after.values ?? ''));
    if (bucket || helm) out.push(rc.address);
  }
  return out;
}

export { componentTypes } from './component-types.mjs';
