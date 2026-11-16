# Hợp đồng giữa các module – 012

Quy ước chung: hàm nhận `tx: Db` chạy **trong giao dịch của người gọi** (như `notifications.emit`); không tự mở giao dịch; không nhận `accountId`;
lỗi nghiệp vụ trả kết quả hợp đóng (`kind`), chỉ lỗi lập trình/hạ tầng mới ném. Mọi thứ xuất qua `index.ts` của module.

## 1. `ContentPublicApi` (`modules/content`)

```ts
interface ContentPublicApi {
  // đọc (có thể không tx – tự dùng tenantTx)
  getPost(id: string): Promise<PostRecord | null>;
  listPendingReview(page: Page): Promise<Paged<PendingRecord>>;
  countPendingReview(): Promise<number>;
  // thao tác trong giao dịch của approval
  loadForUpdate(tx: Db, id: string): Promise<PostRecord | null>;
  validateForScheduling(tx: Db, post: PostRecord, at: Date): Promise<ValidationResult>;   // { ok } | { ok:false, channelIssues[], contentIssues[] }
  transition(tx: Db, input: {
    postId: string; expectedVersion: number;
    from: PostStatus[]; to: PostStatus;
    set?: Partial<{ scheduledAt: Date | null; approvedBy; approvedAt; submittedBy; submittedAt; submissionId;
                    returnedNote: string | null; returnedBy; returnedAt; editedAfterApproval: boolean }>;
    event: PostEventInput;                                   // ghi `post_events` cùng tx
  }): Promise<{ kind: 'ok'; post: PostRecord } | { kind: 'conflict'; current: PostRecord } | { kind: 'wrong_state'; current: PostRecord } | { kind: 'not_found' }>;
  saveContent(tx: Db, input: SaveContentInput): Promise<{ kind: 'ok'; post: PostRecord; contentChanged: boolean } | …>;   // so khớp nội dung để biết có phải "sửa nội dung"
  createDraft(tx: Db, input: CreateDraftInput): Promise<PostRecord>;
  deleteDraft(tx: Db, id: string, expectedVersion: number): Promise<DeleteResult>;
  calendar(range: { from: Date; to: Date }): Promise<CalendarRecord[]>;
  /** Cấu hình giới hạn theo kênh; cache trong tiến trình 5 phút. */
  channelRules(): Promise<ChannelRule[]>;
}
```

Phụ thuộc: `platform_gateway` (qua `PLATFORM_GATEWAY`: `getConnection`, `mediaRules`, `validateMedia`), `media` (mô tả media — dùng bản giả lập 005 tới khi có thư viện;
cổng `MEDIA_DESCRIBER` tùy chọn, thiếu → kênh bắt buộc media báo "chưa thể lên lịch" theo FR-007). `content` **không** gọi `publishing`/`approval`.

## 2. `PublishingPublicApi` (`modules/publishing`)

```ts
interface PublishingPublicApi {
  /** Tạo mục lịch đăng + việc `run_attempt` cho mỗi kênh, TRONG tx. Idempotent theo (post, kênh). */
  schedule(tx: Db, input: { postId: string; contentVersion: number; scheduledAt: Date;
                            channels: { connectionId: string; channelType: ChannelType }[]; traceId?: string }):
    Promise<{ kind: 'scheduled'; attempts: AttemptRef[] }
          | { kind: 'quota_exceeded'; connectionId: string; limit: number }
          | { kind: 'already_scheduled' }>;
  /** Hủy mọi mục `scheduled` của bài + việc tương ứng. Có mục đã rời `scheduled` → `already_publishing`, KHÔNG đổi gì. */
  cancelByPost(tx: Db, postId: string): Promise<{ kind: 'cancelled'; count: number } | { kind: 'already_publishing'; connectionIds: string[] }>;
  /** Đổi giờ mọi mục `scheduled` + `rescheduleJob`; kiểm lại hạn mức cục bộ ở giờ mới. */
  reschedule(tx: Db, postId: string, scheduledAt: Date): Promise<{ kind: 'rescheduled' } | { kind: 'already_publishing' } | { kind: 'quota_exceeded'; connectionId: string; limit: number }>;
  /** Đọc: trạng thái đăng theo bài (xấu nhất + từng kênh) cho Lịch / chi tiết. Không cache. */
  statusesByPosts(postIds: string[]): Promise<Map<string, PostPublishState>>;
  /** Trước giao dịch: kênh còn hoạt động + hạn mức nền tảng báo (gọi `checkAccount`, KHÔNG dùng trong tx). */
  precheckChannels(connectionIds: string[]): Promise<Map<string, { ok: true; quotaRemaining: number | null } | { ok: false; reason: 'inactive' | 'needs_reconnect' | 'unavailable'; remedies: Remedy[] }>>;
}
```

- `schedule` lấy `pg_advisory_xact_lock(hashtext('publish_quota:'||connectionId))` theo thứ tự `connectionId` tăng dần (tránh khóa chéo), đếm mục hiệu lực
  trong cửa sổ 24 giờ quanh `scheduledAt` với `channel_rules.max_posts_per_24h`, rồi `INSERT … ON CONFLICT DO NOTHING` và `enqueue` (`publish:{attemptId}`).
- Giao diện này là **hợp đồng ổn định** mà 013 giữ nguyên (spec 013 Assumptions): 013 chỉ thay phần thực thi và bổ sung hàm đọc chi tiết.
- Phụ thuộc: `content` (đọc `channel_rules` qua `ContentPublicApi.channelRules()`), `platform_gateway`, `queue` — đều đã có trong tệp kê khai của `publishing`.

## 3. `ApprovalPublicApi` (`modules/approval`, chỉ API)

Chính là điều phối của `approval.service`; lớp HTTP gọi trực tiếp. Công khai cho module khác chỉ khi sau này AI tạo bài cần gọi `submit`:

```ts
interface ApprovalPublicApi {
  submit(input: { items: { postId: string; expectedVersion: number; scheduledAt?: Date }[] }): Promise<BulkResult>;
  withdraw(postId: string, expectedVersion: number): Promise<PostRecord>;
  approve(postId: string, expectedVersion: number, scheduledAt: Date): Promise<PostRecord>;
  approveBatch(items: ApproveItem[]): Promise<BulkResult>;
  returnPost(postId: string, expectedVersion: number, note: string): Promise<PostRecord>;
  returnBatch(items: { postId: string; expectedVersion: number }[], note: string): Promise<BulkResult>;
  unschedule(postId: string, expectedVersion: number): Promise<PostRecord>;
  reschedule(postId: string, expectedVersion: number, scheduledAt: Date): Promise<PostRecord>;
  savePost(postId: string, input: SaveContentInput): Promise<PostRecord>;
  suggestTimes(count: number, after?: Date): Promise<Date[]>;
}
```

Quy trình `approve` (một `tenantTx` cho mỗi bài):
1. **Trước tx**: quyền `post.approve` (guard), `AccountPublicApi` gói còn hạn, `publishing.precheckChannels(connectionIds)` (một lần mỗi kênh trong cả lô).
2. **Trong tx**: `content.loadForUpdate` → `validateForScheduling` → giờ ≥ now()+5' → `content.transition(draft|pending_review → approved)` →
   `publishing.schedule` → `notifications` không (duyệt không có thông báo) → `audit_log`.
3. Lỗi bất kỳ ở bước trong tx → hoàn tác cả bài (không mục, không việc, không sự kiện).

## 4. Việc nền

| Loại việc | Khai báo | Bộ xử lý |
|---|---|---|
| `publishing.run_attempt` | `modules/publishing/jobs.ts` — `queue: 'publish'`, `scope: 'tenant'`, `version: 1`, payload `z.strictObject({ attemptId: z.uuid() })`, `allowGenericRetry: false` | `executor.stub.ts` (R10), chạy ở Worker; 013 thay thân |

`approval` chỉ chạy ở API nên **không** khai báo việc. Khai báo việc dùng chung giữa API (tạo) và Worker (xử lý) nằm ở `publishing/jobs.ts`.

## 5. Thông báo (khuôn 005, `packages/shared/src/modules/notifications/events.ts`) – không đổi danh mục

| Khi | Sự kiện | `refs` |
|---|---|---|
| `submit` (một lần, nhiều bài) | `post_pending_review` | `{ submissionId, postIds ≤ 50, authorUserId }` |
| sửa bài đã duyệt | `post_pending_review` | `{ submissionId (mới), postIds:[id], authorUserId }` |
| `return` / `returnBatch` | `post_returned` (mỗi bài một sự kiện) | `{ postId, postVersion, authorUserId = submitted_by }` |
| cộng tác viên `reschedule` bài đã duyệt | `approved_post_rescheduled` | `{ postId, postVersion, byUserId }` |

`params`: `postTitle ≤ 60`. Hành động mặc định `open_post` (`targetId = postId`). Phát bằng `NOTIFICATIONS.emit(tx, …)` trong cùng giao dịch.

## 6. Cấu hình (`core/config`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `POST_MIN_LEAD_MINUTES` | `5` | giờ đăng tối thiểu kể từ bây giờ (FR-011) |
| `POST_SUGGEST_HOURS` | `09:00,12:00,19:00` | "giờ vàng" UTC+7 để gợi ý |
| `POST_BULK_APPROVE_LIMIT` | `100` | tối đa mỗi lần duyệt/trả lại |
| `POST_BULK_SUBMIT_LIMIT` | `50` | tối đa mỗi lần gửi duyệt (khớp `postIds ≤ 50` của thông báo) |
| `PUBLISH_EXECUTOR` | `none` | `fake` (dev/test/staging) hoặc `none`; production từ chối `fake` |

Bộ giới hạn theo kênh **không** ở biến môi trường mà ở bảng `content.channel_rules` (đổi không cần phát hành).

## 7. Kiểm thử bắt buộc theo hợp đồng

- **Truy cập chéo** cho 4 bảng tenant và mọi điểm cuối (A thử đọc/sửa/duyệt/trả lại/đổi giờ bài của B).
- **Đồng thời**: 20 yêu cầu `approve` cùng lúc cho một bài → đúng 1 thành công, đúng một mục/kênh, đúng một việc/mục; hai tài khoản cùng kênh khác nhau không ảnh hưởng.
- **Hạn mức Instagram**: hai bài khác nhau duyệt đồng thời vượt `max_posts_per_24h` → số mục hiệu lực không quá hạn mức.
- **Hoàn tác trọn gói**: lỗi sau `publishing.schedule` (giả lập ném) → không bài `approved`, không mục, không việc, không sự kiện, không thông báo.
- **Chạy lại hai lần** `publishing.run_attempt` (bộ thực thi tạm) cho cùng kết quả; mục `cancelled` bị bỏ qua.
- **Sửa sau duyệt**: với mỗi kiểu sửa (chữ, hashtag, media, thêm kênh, bớt kênh) bài về Chờ duyệt, mục bị hủy, việc bị hủy, không đăng nội dung cũ (SC-004).
- **Quyền**: cộng tác viên gọi `approve`, `return`, `unschedule` → 403 ở API; cộng tác viên `savePost` bài Chờ duyệt → `POST_NOT_EDITABLE`.
- **Hợp đồng `PublishingPublicApi`** có bộ kiểm thử dùng lại được cho 013 (cùng kết quả khi thay bộ thực thi).
