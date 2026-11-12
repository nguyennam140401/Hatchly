# Hợp đồng giao diện công khai – module `context` và phần bổ sung của `account`

## 1. `ContextPublicApi` (`apps/server/src/modules/context/public-api.ts`)

Xuất qua `modules/context/index.ts` với token `CONTEXT_PUBLIC_API`. Module khác chỉ dùng được khi có `context`
trong `allowedDeps` (hiện chỉ có `content`). Thêm `account` vào `allowedDeps` của `context` không tạo vòng
phụ thuộc (`account` chỉ phụ thuộc `queue`).

```ts
export interface ContextPublicApi {
  /**
   * Hồ sơ hiện hành của tài khoản trong ngữ cảnh (yêu cầu API hoặc việc nền).
   * - Chưa có hồ sơ → null (không phải lỗi).
   * - Không có ngữ cảnh tenant → ném TENANT_CONTEXT_MISSING (lỗi lập trình).
   * - Luôn đọc CSDL, không cache (FR-015).
   */
  getCurrentProfile(): Promise<CurrentBusinessProfile | null>;
}
```

`CurrentBusinessProfile`: data-model mục 6 – chỉ trường nghiệp vụ + `profileId`, `version`, `savedAt` (FR-014).

### Kiểm thử hợp đồng – `apps/server/test/context/public-api.contract.db.spec.ts`

| Kịch bản | Mong đợi |
|---|---|
| Tenant A có hồ sơ v3 | trả đúng nội dung v3 của A, `version = 3` |
| Tenant B chưa có hồ sơ | `null` |
| Không ngữ cảnh | `TENANT_CONTEXT_MISSING` |
| Ngay sau `PUT` thành công v4 | lần gọi kế tiếp trả v4 (SC-005) |
| Trong việc nền (`runJobInline` với `accountId: A`) | trả hồ sơ A |
| Kết quả | không có khóa `accountId`, `account_id`, `savedByUserId`, email, số điện thoại của chủ tài khoản |

## 2. Loại việc `context.profile_changed` (`apps/server/src/modules/context/jobs.ts`)

```ts
export const profileChanged = defineJobType({
  name: 'context.profile_changed',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
  payload: z.strictObject({ profileId: z.uuid(), version: z.int().min(1) }),
});
```

- Chỉ module `context` tạo việc này (trong `tenantTx` của lần lưu); chưa xuất qua `index.ts` vì chưa module nào cần.
- Bộ xử lý đăng ký ở Worker (`runsIn` của `context` gồm `worker`) – hành vi: data-model mục 5.
- Nhật ký: `context.profile_changed.processed` / `.superseded` với `job_id`, `version`, `current_version`, `trace_id`.

### Kiểm thử – `apps/server/test/queue/context-profile-changed.queue.spec.ts`

| Kịch bản | Mong đợi |
|---|---|
| Lưu thành công v1 | đúng 1 việc `context.profile_changed` `{ profileId, version: 1 }` của tài khoản đó |
| Lưu bị từ chối (hợp lệ / xung đột / lỗi giả lập sau `enqueue`) | 0 việc |
| Lưu "không có thay đổi" | 0 việc |
| `expectIdempotent` | hai lần chạy cho cùng ảnh chụp CSDL và cùng nhật ký |
| Việc v1 chạy khi hiện hành là v2 | nhật ký `superseded`, không lỗi |
| Hai Worker (`startTestWorkers(2)`) | mỗi việc chạy đúng một lần |

## 3. Bổ sung `AccountPublicApi.describeMembers`

```ts
/**
 * Tên hiển thị và trạng thái của các người dùng thuộc tài khoản trong ngữ cảnh.
 * Người không thuộc tài khoản này (hoặc mã không tồn tại) không có trong kết quả.
 * Chạy trong tenantTx của người gọi – không nhận accountId.
 */
describeMembers(userIds: readonly string[]): Promise<
  { userId: string; displayName: string; status: 'active' | 'removed' | 'disabled' }[]
>;
```

Tối đa 100 mã mỗi lần gọi (trang lịch sử 20 dòng). Kiểm thử: `apps/server/test/db/account-describe-members.db.spec.ts`
– mã của tài khoản khác không trả về; thành viên đã gỡ trả `removed`.

## 4. Ranh giới

- `modules.manifest.json`: `context.allowedDeps = ["account", "ai_gateway", "queue"]`.
- `pnpm check:boundaries` phải bắt: (1) module khác nhập `modules/context/internal/**` (quy tắc import sẵn có);
  (2) mã trong `modules/<m>/` có định danh SQL `"<schema>".` hoặc `<schema>.<bảng>` trong chuỗi `sql`/văn bản
  truy vấn, với `<schema>` thuộc module khác theo tệp kê khai (quy tắc MỚI của 006 – research R16, cổng CI số 3 của
  hiến pháp).
