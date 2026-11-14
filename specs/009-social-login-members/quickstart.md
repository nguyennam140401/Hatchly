# Quickstart – kiểm chứng 009

Hướng dẫn chạy và các kịch bản chứng minh tính năng hoạt động từ đầu đến cuối. Chi tiết hợp đồng:
[auth-http-api](contracts/auth-http-api.md), [module-api](contracts/module-api.md),
[data-model](data-model.md).

## 0. Chuẩn bị

```bash
pnpm install
pnpm db:up                 # PostgreSQL + Mailpit (chỉ chạy ở MỘT checkout – trùng cổng 3000/3001/8080)
pnpm db:migrate
pnpm dev:seed-auth         # chủ + cộng tác viên + lời mời đang chờ + người ở tài khoản chờ
pnpm dev                   # api + worker + web; OAUTH_DRIVER=fake, MAIL_TRANSPORT=smtp (Mailpit)
```

Không cần khóa Google/Meta: bản giả lập thay nhà cung cấp. Thư xem ở Mailpit.

## 1. Bộ kiểm thử tự động

| Lệnh | Phải đạt |
|---|---|
| `pnpm test` | đơn vị: kiểm `signed_request`, máy trạng thái `oauth_flows`, quy tắc email của lời mời, khai báo `allowDetached` |
| `pnpm test:db` | `social-functions.db.spec.ts` (hàm mục 4 data-model), `invitations-isolation.db.spec.ts`, `seats-concurrency.db.spec.ts` (SC-005), `last-identity-concurrency.db.spec.ts` (SC-009), `cross-tenant-coverage` có đủ bảng mới |
| `pnpm --filter server test -- test/auth` | e2e: `oauth-login`, `oauth-link-confirm` (ma trận SC-003), `login-methods`, `members-invite`, `members-remove`, `no-account`, `meta-callbacks`, `access-matrix` (cột người ở tài khoản chờ), `auth-secrets-in-logs` (SC-008) |
| `pnpm --filter server test -- test/queue` | `account.detached_users`, `account.auth_housekeeping` chạy hai lần cho cùng kết quả (SC-010) |
| `pnpm --filter web test` | 7 trang mới qua `vitest-axe` ở 360 px (SC-011) |
| `pnpm db:check && pnpm check:boundaries && pnpm verify` | không vi phạm quy ước CSDL, ranh giới module, quét bí mật |

## 2. Kịch bản tay (trình duyệt ở 360 px)

### A. Người mới vào bằng Google (US1, SC-001)

1. `/login` → "Tiếp tục với Google" → trang giả lập, chọn `google_verified` với email mới.
2. Về `/oauth/result`: tên điền sẵn, ô đồng ý **chưa tích**. Tích, bấm "Tạo tài khoản".
3. **Mong đợi**: vào màn hình đầu tiên; `GET /api/v1/auth/me` trả `role: owner`, `emailVerified: true`.
   Đăng xuất, đăng nhập lại bằng Google → vào thẳng, không hỏi điều khoản.
4. Lặp lại bước 1 rồi đóng thẻ ở bước 2 → không có tài khoản nào được tạo.
5. Lặp lại bước 1–3 với "Tiếp tục với Facebook" → `facebook_with_email`: kết quả như Google (vào ngay,
   `emailVerified: true`, không có thư nào phải mở).

### B. Facebook không có email (US1 kịch bản 4)

1. "Tiếp tục với Facebook" → `facebook_no_email`.
2. Nhập email mới + tên + tích ô đồng ý → màn hình "Hãy kiểm tra email".
3. Mở thư ở Mailpit, bấm liên kết → được đăng nhập, là chủ tài khoản mới.
4. Làm lại với email **đã có người dùng**: màn hình bước 2 giống hệt; thư là "xác nhận liên kết"; bấm
   → Facebook gắn vào người dùng đã có.

### C. Trùng email với Google hoặc Facebook (US2)

1. Đăng ký bằng email + mật khẩu, xác minh email, đăng xuất.
2. "Tiếp tục với Google" (`google_verified`, cùng email) → màn hình xác nhận có hai lựa chọn; chưa được
   đăng nhập. Làm lại với `facebook_with_email` → cùng màn hình.
3. Nhập sai mật khẩu → báo lỗi, bộ đếm đăng nhập tăng. Nhập đúng → vào ứng dụng; Mailpit có thư "vừa
   thêm cách đăng nhập bằng Google".
4. Biến thể: người dùng đã có **chưa xác minh email** → chỉ có "Gửi liên kết qua email"; sau khi bấm
   liên kết, đăng nhập bằng mật khẩu cũ thất bại.

### D. Mời và tham gia (US3)

1. Chủ: Cài đặt → Thành viên → nhập email → "Mời". Thấy lời mời "Đang chờ", "Còn 1/2 chỗ".
2. Mời thêm một người → nút "Mời" bị khóa kèm lời giải thích; gọi thẳng `POST /members/invitations` →
   409 `SEATS_FULL`.
3. Mở thư mời ở cửa sổ ẩn danh → `/join`: đặt tên + mật khẩu + tích ô → vào với vai trò cộng tác viên.
   Gọi API duyệt bài → 403. Mở `/settings/members` → bị từ chối.
4. Chủ nhận thư "… đã tham gia".
5. "Gửi lại" một lời mời → liên kết cũ báo "Lời mời không còn hiệu lực". "Hủy lời mời" → chỗ được trả.
6. Tham gia bằng Google với email khác email được mời → `INVITE_EMAIL_MISMATCH` kèm hướng dẫn.

### E. Gỡ cộng tác viên và tài khoản chờ (US4)

1. Cộng tác viên đang đăng nhập ở cửa sổ thứ hai. Chủ bấm "Gỡ" → xác nhận.
2. **Mong đợi**: trong ≤ 60 giây mọi lời gọi của cộng tác viên bị từ chối; chủ thấy "Còn 2/2 chỗ"; bài
   người đó đã soạn vẫn còn và vẫn hiện tên.
3. Người bị gỡ đăng nhập lại → `/no-account`. Gọi bất kỳ API nghiệp vụ → 403 `NO_ACCOUNT`.
4. Nhánh 1: "Tạo tài khoản kinh doanh của riêng tôi" → thành chủ một tài khoản trống.
   Nhánh 2: chủ cũ mời lại → người đó thấy lời mời ở `/no-account`, chấp nhận → cùng `userId` như trước.

### F. Cách đăng nhập (US5)

1. Cài đặt → Cách đăng nhập: ba dòng. Bấm "Liên kết Google" khi phiên đã quá 10 phút → được yêu cầu
   xác nhận lại.
2. Liên kết Google có email khác → thành công, email chính không đổi, có thư thông báo.
3. Gỡ Google → đăng nhập bằng Google không vào được tài khoản đó nữa.
4. Khi chỉ còn một cách → "Gỡ" bị từ chối với hướng dẫn.
5. Người chỉ có Google: "Tạo mật khẩu" → thư → đặt mật khẩu → đăng nhập bằng email + mật khẩu.

### G. Thông báo của Meta (FR-009a)

```bash
pnpm --filter server exec tsx test/support/make-signed-request.ts <fb_user_id>   # in ra signed_request hợp lệ
curl -X POST http://localhost:3000/api/v1/auth/facebook/data-deletion \
  --data-urlencode "signed_request=<giá trị>"
```

**Mong đợi**: `{ url, confirmation_code }`; mở `url` thấy trạng thái "Đã xử lý"; cách đăng nhập Facebook
của người đó biến mất; Mailpit có thư bảo mật. Gửi lại cùng yêu cầu → cùng mã, không có thư thứ hai. Sửa
một ký tự của chữ ký → 400.

### H. Xóa sau 90 ngày (FR-028a)

Ở môi trường thử, lùi `users.detached_at` của người ở tài khoản chờ về 84 ngày trước rồi chạy việc
`account.detached_users` → một thư báo trước; chạy lại → không có thư thứ hai. Lùi tiếp về 91 ngày và
`deletion_notice_sent_at` về 8 ngày trước, chạy việc → người dùng và tài khoản chờ bị xóa; nhật ký kiểm
toán có `account.user.purged` không chứa email; tên trong `former_members` của tài khoản cũ còn nguyên.

## 3. Kiểm với nhà cung cấp thật (trước khi phát hành, không nằm trong CI)

Đặt `OAUTH_DRIVER=real` cùng khóa của ứng dụng thử nghiệm; đăng ký địa chỉ quay về ở Google Cloud
Console và Meta for Developers; chạy lại kịch bản A, B, C, G. Xác nhận màn hình cấp quyền của Facebook
chỉ có tên + email (FR-005) và nhật ký không có `code=`, `state=`.

**Kiểm giả định email Facebook (research R3, bắt buộc trước khi phát hành)**: tạo tài khoản Facebook thử
có email **chưa bấm xác nhận** rồi đăng nhập → `GET /me?fields=email` phải **không** trả email (ứng dụng
đi vào kịch bản B). Đối chiếu thêm mô tả trường `email` trong tài liệu Graph API hiện hành. Nếu Facebook
có trả email chưa xác nhận: đặt `emailVerified = false` cho Facebook ở bản `arctic` và báo chủ sản phẩm.
