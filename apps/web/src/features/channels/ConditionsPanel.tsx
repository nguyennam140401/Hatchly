import type { ChannelOverviewItem } from '@app/shared/platform_gateway';

/**
 * Điều kiện tài khoản của kênh (US3): loại tài khoản, quyền đã cấp dạng tick + CHỮ, dòng hạn mức CHỈ khi nền tảng báo (không số
 * giả). Dữ liệu đã lưu từ lần kiểm tra gần nhất – không gọi nền tảng.
 */
export function ConditionsPanel({ item }: { item: ChannelOverviewItem }) {
  const { accountType, scopes, quotaRemaining } = item.conditions;
  if (accountType === null && scopes.length === 0 && quotaRemaining === null) return null;
  return (
    <div className="flex flex-col gap-1 text-body">
      {accountType !== null && <p>Loại tài khoản: {accountType}</p>}
      {scopes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {scopes.map((s) => (
            <li key={s.nameVi}>
              <span aria-hidden="true">{s.granted ? '✔ ' : '✖ '}</span>
              {s.nameVi}: {s.granted ? 'đã cấp' : 'chưa cấp'}
            </li>
          ))}
        </ul>
      )}
      {quotaRemaining !== null && <p>Hạn mức đăng còn lại: {quotaRemaining} bài</p>}
    </div>
  );
}
