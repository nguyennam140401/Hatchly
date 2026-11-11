# Quickstart – kiểm chứng 004 Xác thực tối thiểu

Hướng dẫn chạy và kiểm chứng; không chứa mã triển khai. Chi tiết hành vi ở
[contracts/auth-http-api.md](contracts/auth-http-api.md),
[contracts/authz-api.md](contracts/authz-api.md), [contracts/auth-ops.md](contracts/auth-ops.md) và
[data-model.md](data-model.md).

## 0. Chuẩn bị

```bash
pnpm install
cp apps/server/.env.example apps/server/.env      # đã có các biến mới của auth-ops.md mục 1
pnpm db:up                                        # postgres (+ mailpit: db:up được mở rộng để bật cả mailpit)
pnpm db:setup                                     # bootstrap vai trò + migrate (gồm 0005–0007)
pnpm db:check                                     # → 0 vi phạm
pnpm dev:seed-auth                                # tài khoản mẫu + 2 nhân viên, in mật khẩu một lần
pnpm dev:api                                      # API :3000
pnpm dev:web                                      # web :5173 (terminal khác)
```

Hộp thư thử (Mailpit): http://localhost:8025.

## 1. Cổng tự động (phải xanh trước khi review)

```bash
pnpm verify          # lint, typecheck, ranh giới (gồm auth-tx-restricted, account-scope-restricted), test
pnpm test:db         # tích hợp CSDL: hàm SECURITY DEFINER, ghế thành viên, chống dò, truy cập chéo
```

| Kiểm thử | Chứng minh |
|---|---|
| `test/auth/access-declarations.spec.ts` | Mọi route có đúng một khai báo truy cập (FR-013, SC-004) |
| `test/auth/access-matrix.e2e.spec.ts` | 5 loại người gọi × 13 quyền khớp bảng FR-012 (SC-003) |
| `test/auth/register-login.e2e.spec.ts` | US1, US2 |
| `test/auth/password-reset.e2e.spec.ts` | US5 |
| `test/auth/staff.e2e.spec.ts` | US4 |
| `test/db/auth-functions.db.spec.ts` | 4 hàm chỉ trả cột cho phép; `support`/`system` không có `EXECUTE` |
| `test/db/auth-concurrency.db.spec.ts` | Đăng ký cùng email đồng thời; thêm cộng tác viên thứ 3; tiêu thụ mã hai lần |
| `test/db/auth-throttle.db.spec.ts` | Ngưỡng theo email đúng trên 2 bể `app` (SC-006) |
| `test/db/auth-isolation.db.spec.ts` | Truy cập chéo cho `users`, `login_identities`, `memberships`, `sessions`, `auth_tokens` |
| `test/auth/revocation.e2e.spec.ts` | Thu hồi có hiệu lực ≤ 60 giây trên bản API thứ hai (SC-005) |
| `test/auth/auth-secrets-in-logs.e2e.spec.ts` | 0 mật khẩu, mã phiên, mã một lần, băm trong nhật ký và phản hồi (SC-007) |
| `test/auth/timing.e2e.spec.ts` | Chênh lệch thời gian có/không có email < 50 ms (SC-006); p95 đăng nhập (SC-002) |
| `apps/web/src/**/*.test.tsx` | Các trang auth đạt `vitest-axe` không lỗi, dùng được bằng bàn phím (SC-009) |

## 2. Kịch bản thủ công trên điện thoại (360 px)

1. **Đăng ký → xác minh (US1)**: mở `/register`, nhập tên, email mới, mật khẩu `matkhau` → báo mật khẩu
   quá phổ biến. Đổi sang mật khẩu đủ mạnh, **chưa** tích ô đồng ý → báo lỗi ở ô đồng ý. Tích ô rồi gửi
   → màn hình "Hãy kiểm tra email". Ở Mailpit có 1 thư; mở liên kết → được đăng nhập, vào màn hình đầu.
2. **Đăng ký trùng (FR-008b)**: dùng lại email đó, kể cả gõ chữ hoa → vẫn màn hình "Hãy kiểm tra email"
   như lần trước. Mailpit nhận thư "email đã có tài khoản". Trong CSDL không có tài khoản thứ hai.
3. **Chưa xác minh (FR-008a)**: đăng ký email khác, đăng nhập bằng mật khẩu khi chưa mở thư → chỉ thấy
   màn hình "Hãy xác nhận email". Gọi `GET /api/v1/diagnostics/…` (bất kỳ điểm cuối khách hàng nào) →
   403 `EMAIL_NOT_VERIFIED`.
4. **Chống dò (US2-AS3)**: sai mật khẩu 5 lần → lần thứ 6 báo "thử lại sau 15 phút" kèm nút "Quên mật
   khẩu". Email không tồn tại → cùng thông điệp với sai mật khẩu.
5. **Hai thiết bị (US2-AS5)**: đăng nhập ở điện thoại và máy tính. Ở máy tính vào
   `/settings/security` → "Đăng xuất khỏi mọi thiết bị". Trong ≤ 60 giây, điện thoại bị đưa về
   `/login`; sau khi đăng nhập lại thì quay về đúng trang đang dở.
6. **Quên mật khẩu (US5)**: `/forgot-password` → thư có liên kết. Đặt mật khẩu mới → đăng nhập bằng
   mật khẩu cũ thất bại. Mở lại liên kết lần 2 → "Liên kết đã hết hạn hoặc đã được dùng".
7. **Cộng tác viên (US3-AS1)**: đăng nhập `collab1@example.test` (dữ liệu mẫu), thử duyệt bài bằng
   điểm cuối mẫu → "Chỉ chủ tài khoản mới duyệt được bài".
8. **Nhân viên (US4)**: `/internal/login` bằng tài khoản `support` mẫu → vào được. Dùng cùng thông tin
   ở `/login` → "Email hoặc mật khẩu chưa đúng". Đặt `STAFF_ALLOWED_CIDRS=203.0.113.0/24` rồi khởi động
   lại API → đăng nhập nội bộ báo "Lối vào nội bộ không mở cho mạng này"; nhật ký kiểm toán có
   `staff.login.denied_ip`.

## 3. Tra cứu sau khi chạy

```sql
-- (chạy bằng vai trò owner) mỗi đăng ký có đúng 1 chủ, ≤ 2 cộng tác viên
SELECT account_id, count(*) FILTER (WHERE role = 'owner') AS owners,
       count(*) FILTER (WHERE role = 'collaborator') AS collaborators
FROM account.memberships WHERE status = 'active' GROUP BY account_id;

-- nhật ký kiểm toán xác thực, không có email/mật khẩu trong metadata
SELECT occurred_at, actor_type, action, metadata FROM infra.audit_log
WHERE action LIKE 'auth.%' OR action LIKE 'staff.%' ORDER BY occurred_at DESC LIMIT 20;
```
