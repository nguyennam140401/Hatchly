# Research – 004 Xác thực tối thiểu

Quyết định Phase 0 cho [plan.md](plan.md). Mỗi mục: **Quyết định**, **Lý do**, **Phương án đã loại**.
Căn cứ: spec 004, hiến pháp 1.0.0, T7 (Lựa chọn công nghệ), `architecture.md` v1.2, mã của 001/002 trên
nhánh `dev` (003 mới có đặc tả, chưa có mã hàng chờ).

---

## R1. Thư viện xác thực (FR-021, T7)

**Quyết định**: Không dùng khung xác thực "trọn gói". Dùng một **bộ thư viện mã nguồn mở nhỏ, đã kiểm
chứng**, bọc sau giao diện nội bộ của module `account`:

| Việc | Thư viện | Ghi chú |
|---|---|---|
| Băm mật khẩu | `@node-rs/argon2` (argon2id, bản dựng sẵn cho Windows/Linux, không cần node-gyp) | R2 |
| Mã phiên, mã một lần | `node:crypto` (`randomBytes`, `createHash('sha256')`, `timingSafeEqual`, `createHmac`) | R3 – gọi hàm chuẩn, không tự viết thuật toán |
| Gửi thư SMTP | `nodemailer` | R9 |
| Đăng nhập Google/Facebook (tính năng sau) | `arctic` – có sẵn nhà cung cấp Google và Facebook | **Chưa cài**; ghi để T7 đủ điều kiện "hỗ trợ sẵn cả hai" |

Phiên lưu phía máy chủ theo mẫu do OWASP Session Management Cheat Sheet và hướng dẫn của Lucia (bản
"tự làm theo hướng dẫn", 2025) mô tả. Mọi phiên bản khóa chính xác (`pnpm add -E`).

**Lý do**: Ràng buộc cứng của dự án là RLS. Các khung trọn gói tự có bảng và tự chạy truy vấn qua bộ
chuyển đổi CSDL riêng, không qua `tenantTx`. Muốn tra phiên hay email trước khi biết tenant, khung đó
phải đọc bảng người dùng không có ngữ cảnh tenant. Như vậy hoặc phải có vai trò vượt RLS (cấm theo
nguyên tắc I), hoặc phải bỏ `account_id`/RLS khỏi bảng danh tính, tức là đổi nguyên tắc I và phải có PO
duyệt. Bộ thư viện nhỏ cho ta kiểm soát chính xác chỗ nào được truy cập ngoài tenant (R4), mà vẫn không
tự viết phần mật mã: băm do argon2, ngẫu nhiên và SHA-256 do `node:crypto`. Liên kết nhiều cách đăng
nhập là mô hình dữ liệu của ta (`login_identities`), không phụ thuộc thư viện.

**Phương án đã loại**:
- *Better Auth* (có Drizzle adapter, email/mật khẩu, mạng xã hội, liên kết tài khoản, xác minh email):
  khớp chức năng nhất. Nhưng nó tự truy vấn bảng `user`/`session`/`account`/`verification` ngoài ngữ
  cảnh tenant (trái nguyên tắc I như đã nêu), và tên/cột bảng bị khung chi phối. Ngoài ra còn kéo
  theo một bề mặt API lớn mà ta phải rà soát.
- *Auth.js*: hướng Next.js; nhà cung cấp "credentials" (email + mật khẩu) bị chính tài liệu khuyên
  tránh, không có sẵn đặt lại mật khẩu hay xác minh email.
- *Passport*: chỉ là lớp chiến lược đăng nhập. Phiên, đặt lại, xác minh, chống dò vẫn phải tự làm, nên
  thêm phụ thuộc mà ít giá trị.
- *Lucia v3*: tác giả đã ngừng phát triển (2025) và chuyển thành tài liệu hướng dẫn. Ta theo hướng dẫn
  đó, không cài gói.

**Việc kèm theo**: sửa T7 trong `TaiLieuDacTa/Lua_chon_Cong_nghe_App_AI_Content_MXH.md` và dòng
"Xác thực" (mục 2, mục 12) của `.specify/memory/architecture.md` thành "bộ thư viện: argon2 + phiên
máy chủ + arctic (sau)", kèm lý do RLS. Đây là cụ thể hóa T7 ("chọn cụ thể khi dựng framework"), không
đi ngược T7 nên không cần ADR mới.

## R2. Băm và chính sách mật khẩu (FR-005)

**Quyết định**:
- argon2id `memoryCost=19456 KiB, timeCost=2, parallelism=1` (mức tối thiểu OWASP 2024). Tham số là
  cấu hình. Đăng nhập thành công mà băm cũ dùng tham số khác thì băm lại.
- Trước khi kiểm tra và băm: chuẩn hóa Unicode **NFKC**; không cắt khoảng trắng. Độ dài 8–128 tính theo
  điểm mã sau chuẩn hóa. Quá 128 thì từ chối trước khi băm (chống làm treo máy chủ).
- Danh sách cấm: khoảng 10.000 mật khẩu phổ biến nhất (SecLists `10k-most-common`) cộng danh sách
  tiếng Việt thường gặp (`matkhau`, `123456789`, tên số điện thoại dạng `09xxxxxxxx`…). So sánh chữ
  thường. Danh sách là tệp trong mã (`common-passwords.txt`), không gọi dịch vụ ngoài. Thêm luật: mật
  khẩu không được trùng email hoặc phần trước `@`.
- Đăng nhập với email không tồn tại vẫn chạy `verify` trên một băm giả cố định, để thời gian phản hồi
  tương đương (FR-006, SC-006).

**Lý do**: NIST SP 800-63B: không bắt buộc kiểu ký tự, có danh sách cấm, có độ dài tối đa đủ lớn. NFKC
quan trọng với tiếng Việt: bàn phím điện thoại và máy tính có thể sinh dấu dựng sẵn hoặc dấu tổ hợp.
Không chuẩn hóa thì cùng một mật khẩu gõ ở hai thiết bị sẽ không khớp.

**Phương án đã loại**: bcrypt (giới hạn 72 byte, yếu hơn trước tấn công GPU); scrypt (OWASP xếp sau
argon2id); kiểm tra HaveIBeenPwned (gửi tiền tố băm ra nước ngoài, thêm bên nhận dữ liệu – nguyên tắc
VII).

## R3. Phiên đăng nhập (FR-010, FR-011, FR-012a)

**Quyết định**:
- Mã phiên là 32 byte ngẫu nhiên, mã hóa base64url. CSDL chỉ lưu `token_hash = sha256(mã)` (`bytea`,
  duy nhất). Mã có độ ngẫu nhiên cao nên SHA-256 là đủ, không cần băm chậm.
- Cookie khách hàng `__Host-sid`, cookie nhân viên `__Host-staff_sid`: `HttpOnly; Secure; SameSite=Lax;
  Path=/`, không đặt `Domain`. Cookie khách hàng có `Max-Age` bằng thời điểm hết hạn tuyệt đối; cookie
  nhân viên là cookie phiên trình duyệt.
- Mỗi lần đăng nhập, xác minh email hoặc đặt lại mật khẩu thành công đều cấp **mã mới** (chống cố định
  phiên). Đăng ký không cấp phiên (R8).
- Thời hạn mặc định (cấu hình được):

  | Loại | Hết hạn khi không hoạt động | Tuyệt đối |
  |---|---|---|
  | Khách hàng | 14 ngày | 30 ngày |
  | Nhân viên | 30 phút | 12 giờ |

  `last_seen_at` chỉ ghi lại khi đã cũ hơn 1 giờ (khách hàng) hoặc 1 phút (nhân viên), để không ghi CSDL
  ở mọi yêu cầu.
- Bộ nhớ đệm trong tiến trình: tra từ `token_hash` ra danh tính người gọi, sống 60 giây, tối đa 10.000
  mục, tự viết bằng `Map` (không thêm thư viện). Đăng xuất xóa mục ngay trên bản API xử lý yêu cầu. Các
  bản khác hết hạn mục trong ≤ 60 giây, đúng giới hạn đã chấp nhận ở Kiến trúc dữ liệu mục 8.
  Hiến pháp cấm cache *quyền truy cập nền tảng*; phiên không thuộc loại đó.
- Chống giả mạo yêu cầu từ trang khác (FR-012a): với mọi phương thức thay đổi dữ liệu (POST, PUT, PATCH,
  DELETE), kể cả điểm cuối công khai như đăng nhập, yêu cầu phải có `Origin` thuộc `WEB_ORIGINS`, hoặc
  `Sec-Fetch-Site: same-origin`. Thiếu cả hai thì từ chối 403 `CSRF_REJECTED`. Thêm vào đó là
  `SameSite=Lax`.
- Triển khai: SPA và API **cùng site**. Ingress chuyển `/api` sang API; ở môi trường dev, Vite làm
  proxy (đã có). Cookie không bao giờ là cookie bên thứ ba.

**Lý do**: Spec chỉ có ứng dụng web và cần thu hồi trong ≤ 60 giây. Phiên phía máy chủ thu hồi được
ngay; mã truy cập tự chứa (JWT) muốn thu hồi lại cần danh sách chặn, tức là vẫn phải lưu trạng thái.
Tiền tố `__Host-` ngăn tên miền con ghi đè cookie. Trình duyệt coi `localhost` là ngữ cảnh an toàn,
nên cookie `Secure` vẫn chạy ở dev qua http.

**Phương án đã loại**: JWT trong `localStorage` (bị XSS đọc được, khó thu hồi); mã CSRF đồng bộ
(thêm trạng thái mà không cần thiết, vì Origin, Fetch Metadata và SameSite đã đủ cho SPA cùng site);
bộ nhớ đệm phân tán (cấm ở giai đoạn 1 – ADR-08).

## R4. Truy cập CSDL trước khi có tenant (FR-020)

Bài toán: đăng ký, đăng nhập, tra phiên, tra mã xác minh/đặt lại, chống dò và đăng nhập nhân viên đều
xảy ra **trước khi** biết mã tài khoản. API chỉ có bể `app` (chịu RLS, không vượt được), còn `systemTx`
chỉ có ở Worker.

**Quyết định**: ba cơ chế hẹp, mỗi cơ chế có ranh giới tự động kiểm tra:

1. **Hàm `SECURITY DEFINER` trong schema `account`**, do `owner` sở hữu, `SET search_path = pg_catalog,
   account`, `REVOKE ALL FROM PUBLIC`, chỉ `GRANT EXECUTE TO "app"`. Mỗi hàm trả đúng các cột cần
   dùng. Chi tiết ở [data-model.md](data-model.md) mục 4:
   - `account.auth_register(...)` – tạo tài khoản, người dùng, cách đăng nhập, vai trò chủ và mã xác
     minh trong **một** câu gọi (FR-001: nguyên vẹn). Vai trò `app` không có quyền INSERT vào
     `account.accounts` (migration 0002 của 002), đây là "đường riêng có kiểm soát" mà 002 đã để lại.
   - `account.auth_lookup_email(email)` – trả mã người dùng, mã tài khoản, băm mật khẩu và các trạng
     thái. Dùng cho đăng nhập, quên mật khẩu, và thông báo "email đã có tài khoản".
   - `account.auth_resolve_session(token_hash)` – trả danh tính người gọi nếu phiên còn hiệu lực, đồng
     thời cập nhật `last_seen_at` khi đã cũ.
   - `account.auth_find_token(token_hash, purpose)` – trả mã tài khoản và người dùng của một mã xác
     minh/đặt lại còn hiệu lực.
2. **`authTx`** – giao dịch bể `app` **không** đặt ngữ cảnh tenant, thêm vào `core/db` với quy tắc
   ranh giới `auth-tx-restricted`: chỉ `core/auth/**` và `modules/account/internal/auth/**` được nhập.
   Chỉ dùng cho: gọi các hàm ở mục 1, các bảng `shared` của xác thực (`staff_users`, `staff_sessions`,
   `auth_throttle`), và ghi `infra.audit_log`. Bộ gác truy vấn của 002 vẫn chặn mọi truy cập bảng
   `tenant` trong `authTx` (dev/test ném lỗi, môi trường thật trả 0 dòng).
3. **`runInAccountScope(accountId, fn)`** trong `core/auth`. Sau khi danh tính đã được xác minh bằng
   mật khẩu, mã phiên hoặc mã một lần, hàm chạy `fn` trong ngữ cảnh thực thi con có `accountId` này,
   nên bên trong `fn` dùng được `tenantTx` bình thường. Ngữ cảnh yêu cầu gốc không bị đổi. Quy tắc
   `account-scope-restricted`: chỉ `modules/account/internal/auth/**` được nhập. Mã tài khoản ở đây
   luôn đến từ CSDL sau khi đã xác minh, không bao giờ từ đầu vào của người dùng (nguyên tắc I).

**Lý do**: Giữ `account_id` + RLS trên mọi bảng danh tính khách hàng (`users`, `login_identities`,
`memberships`, `sessions`, `auth_tokens`). Một lỗi lập trình ở module khác vẫn không đọc được email hay
phiên của tenant khác. Phần vượt RLS gói trong 4 hàm SQL, mỗi hàm vài dòng và có kiểm thử riêng.

**Phương án đã loại**:
- Bảng danh tính `shared`, không có `account_id`: đơn giản nhất, nhưng bể `app` sẽ đọc được email của
  mọi khách hàng. Trái nguyên tắc I và phải có PO duyệt.
- Mã phiên chứa sẵn mã tài khoản (`<accountId>.<sessionId>.<secret>`), rồi đặt ngữ cảnh theo phần đầu
  và để RLS kiểm: không cần hàm, nhưng mã tài khoản lại đến từ dữ liệu người dùng gửi lên trước khi
  được xác minh. Dễ bị hiểu là trái nguyên tắc I khi review, và vẫn không giải được bài toán đăng nhập
  bằng email.
- Dùng bể `system` ở API: `system` có quyền ghi mọi schema dùng chung, rộng hơn mức cần nhiều.

## R5. Bảng dữ liệu và ràng buộc thành viên (FR-002, FR-003, FR-004)

**Quyết định**:
- `users.email_normalized` duy nhất **toàn cục** (chỉ mục `users_email_normalized_key`, ngoại lệ quy tắc
  `d` có ghi lý do). Ràng buộc duy nhất của PostgreSQL áp lên mọi dòng, không bị RLS che, nên hai yêu
  cầu đăng ký đồng thời luôn chỉ thắng một.
- Chuẩn hóa email: `trim` → NFC → chữ thường toàn bộ (cả phần trước `@`) → kiểm tra cú pháp (Zod
  `email()`, cho phép tên miền quốc tế). Lưu cả `email` (dạng người dùng nhập, đã cắt khoảng trắng) để
  hiển thị.
- **Ghế thành viên**: `memberships.seat smallint`, chủ = 0, cộng tác viên ∈ {1, 2}, cộng `CHECK (role
  = 'owner') = (seat = 0)` và chỉ mục duy nhất `(account_id, seat) WHERE status = 'active'`. CSDL bảo
  đảm "đúng 1 chủ, tối đa 2 cộng tác viên" kể cả khi thêm đồng thời, không cần trigger hay khóa. Thêm
  cộng tác viên chọn ghế trống nhỏ nhất; trùng ghế (`23505`) thì thử lại một lần rồi báo "đã đủ 2 cộng
  tác viên".
- Giai đoạn 1: một người dùng thuộc đúng một tài khoản (`users.account_id`, cộng duy nhất
  `memberships(account_id, user_id)`). Mô hình nhiều tài khoản cho một người là việc sau, chỉ cần thêm
  bảng.
- `login_identities(provider, provider_subject)` duy nhất toàn cục (ngoại lệ quy tắc `d`). Với
  `provider = 'password'`, `provider_subject` là mã người dùng và `password_hash` khác NULL.

**Phương án đã loại**: trigger đếm cộng tác viên (khó đọc, phải khóa dòng mới chống được thao tác đồng
thời); khóa `SELECT … FOR UPDATE` trên `accounts` rồi đếm trong ứng dụng (đúng, nhưng dễ bị bỏ quên ở
đường ghi khác).

## R6. Chống dò mật khẩu và giới hạn gửi thư (FR-007, FR-008)

**Quyết định**: bảng `shared` tên `account.auth_throttle(key_hash bytea, kind text, window_start, count,
blocked_until)`. Khóa là `HMAC-SHA256(AUTH_THROTTLE_SECRET, kind || ':' || giá trị)`, nên không lưu email
hay địa chỉ mạng ở dạng rõ. Mỗi lần đếm là **một** câu `INSERT … ON CONFLICT DO UPDATE … RETURNING`
nguyên tử: hết cửa sổ thì đặt lại, vượt ngưỡng thì đặt `blocked_until`. Các loại:

| `kind` | Ngưỡng mặc định | Khi chạm |
|---|---|---|
| `login_email` | 5 lần sai / 15 phút | chặn email 15 phút |
| `login_ip` | 30 lần sai / 15 phút | chặn địa chỉ mạng 15 phút |
| `mail_reset` / `mail_verify` | 3 thư / giờ / email | không gửi thêm, phản hồi vẫn như cũ |
| `register_ip` | 20 lần đăng ký / giờ / địa chỉ mạng | 429 |

Trong thời gian bị chặn, hệ thống **không** chạy kiểm tra mật khẩu, nên kẻ tấn công không dò tiếp
được. Đăng nhập thành công xóa bộ đếm `login_email` của email đó. Việc định kỳ dọn dòng hết hạn sẽ
đăng ký khi có hàng chờ (003). Trước đó, mỗi lần đếm tự xóa dòng của chính khóa đó khi đã hết hạn.

Địa chỉ mạng của khách lấy theo `TRUST_PROXY_HOPS` (cài `trust proxy` của Express). Ingress phải ghi đè
`X-Forwarded-For`.

**Lý do**: SC-006 yêu cầu ngưỡng theo email đúng trên **mọi** bản API. Đếm trong bộ nhớ từng bản
(architecture mục 8) sẽ nhân ngưỡng lên theo số bản. PostgreSQL đã có sẵn và tải nhỏ. Mục 8 nói về
giới hạn tốc độ chung, còn chống dò cần chính xác hơn.

**Phương án đã loại**: đếm trong bộ nhớ (sai ngưỡng khi có nhiều bản); Redis (cấm – ADR-08); bảng
tenant (lúc đếm chưa biết tenant, và có cả email không tồn tại).

## R7. Danh mục quyền và lớp chặn quyền (FR-012, FR-013, FR-015, FR-017)

**Quyết định**:
- `core/auth/permissions.ts` là danh mục `as const` gồm 13 quyền (bảng ở
  [contracts/authz-api.md](contracts/authz-api.md)), ánh xạ vai trò → quyền và kiểu `Permission`. Đặt ở
  lõi vì mọi module đều khai báo theo. `@app/shared` xuất lại danh mục để web ẩn/hiện nút theo cùng
  một nguồn.
- Bộ trang trí cho điểm cuối: `@Public()`, `@CustomerAccess(...perms)` (tùy chọn
  `{ allowUnverifiedEmail: true }`), `@StaffAccess(...perms)`. **Guard toàn cục** `AccessGuard` (đăng
  ký `APP_GUARD`) chạy trước pipe và nghiệp vụ, theo thứ tự:
  1. đọc khai báo của điểm cuối; thiếu thì 403 `ACCESS_NOT_DECLARED` và ghi nhật ký `error`;
  2. với `@Public` thì cho qua, nhưng vẫn gắn danh tính nếu có phiên;
  3. đọc cookie đúng loại, tra phiên qua bộ nhớ đệm và `SessionResolver`. Không có phiên thì 401
     `UNAUTHENTICATED`;
  4. sai loại người gọi (khách hàng gọi điểm cuối nội bộ hoặc ngược lại) thì 403 `FORBIDDEN`;
  5. email chưa xác minh mà điểm cuối không cho phép thì 403 `EMAIL_NOT_VERIFIED`;
  6. thiếu quyền thì 403 `FORBIDDEN`, lời giải thích lấy theo quyền
     (vd "Chỉ chủ tài khoản mới duyệt được bài");
  7. khách hàng: `bindAccountToRequest(principal.accountId)`; mọi trường hợp: gắn `actor` vào ngữ cảnh
     thực thi.
- **Đảo phụ thuộc**: `core/auth` không nhập module (quy tắc `core-no-modules`). Nó khai báo giao diện
  `SessionResolver` cùng token DI; `AccountModule` cung cấp phần triển khai.
- `ExecutionContext` thêm `actor?: { kind: 'user' | 'staff'; id; role }`. Mixin nhật ký thêm `actor_id`
  và `actor_kind` vào mọi dòng nhật ký. Hàm `currentActor()` (công khai) dành cho các module.
- Kiểm tra trong CI (FR-013, SC-004), hai lớp:
  (a) kiểm thử `access-declarations.spec.ts` dựng `ApiAppModule`, duyệt mọi route bằng
  `DiscoveryService` + `MetadataScanner`, khẳng định mọi handler có đúng một khai báo;
  (b) API khi khởi động chạy cùng phép duyệt đó: dev/test thì ném lỗi, staging/production thì ghi
  `error` và điểm cuối thiếu khai báo vẫn bị guard từ chối.
- Từ chối vì quyền: ghi nhật ký kỹ thuật có cấu trúc `auth.denied` gồm `trace_id`, `actor_id`,
  `account_id`, `required`, `reason`. Không ghi vào nhật ký kiểm toán (sẽ quá nhiều); riêng nhân viên
  bị từ chối thì có ghi kiểm toán.

**Phương án đã loại**: CASL hay thư viện chính sách (ma trận nhỏ và cố định, không cần ngôn ngữ chính
sách); kiểm tra quyền trong từng dịch vụ (dễ quên, không kiểm được tự động); guard theo từng controller
(mặc định cho qua, trái yêu cầu mặc định từ chối).

## R8. Xác minh email và các mã một lần (FR-008, FR-008a, FR-008b)

**Quyết định**:
- Bảng tenant `account.auth_tokens(purpose ∈ {verify_email, reset_password}, token_hash, email,
  expires_at, used_at)`. Mã là 32 byte ngẫu nhiên; chỉ lưu SHA-256. Tạo mã mới cùng mục đích thì đánh
  dấu `used_at` cho các mã cũ còn hiệu lực trong cùng giao dịch, nên liên kết cũ hết hiệu lực.
- Liên kết đặt **mã ở phần `#fragment`**: `${WEB_BASE_URL}/verify-email#token=…` và
  `…/reset-password#token=…`. Trình duyệt không gửi fragment lên máy chủ, cũng không đưa vào
  `Referer`, nên mã không lọt vào nhật ký ingress hay CDN. SPA đọc fragment, xóa nó khỏi thanh địa chỉ
  bằng `history.replaceState`, rồi POST mã lên API.
- Tiêu thụ mã: một câu `UPDATE … SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at >
  now() RETURNING` trong `tenantTx`. 0 dòng thì báo `TOKEN_INVALID`. Vì là cập nhật có điều kiện nên
  dùng hai lần không bao giờ thành công cả hai.
- Đã có `users.email_verified_at` thì danh tính có `emailVerified = true`. Xác minh thành công thì thu
  hồi phiên hiện tại và cấp phiên mới (R3), để mục cũ trong bộ nhớ đệm của các bản API khác (vẫn ghi
  "chưa xác minh") không còn dùng được nữa.
- Sửa email khi chưa xác minh: chỉ cho phép khi `email_verified_at IS NULL`. Email mới đã có người dùng
  thì xử lý như đăng ký trùng (FR-008b): phản hồi giống thành công, gửi thư báo tới email kia, không đổi
  gì. Cách này không làm lộ email nào đã đăng ký.
- Điểm cuối khách hàng dùng được khi chưa xác minh: `GET /auth/me`, `PATCH /auth/email`,
  `POST /auth/logout`, `POST /auth/logout-all`. `POST /auth/email/resend` là `@Public` và nhận email
  trong thân yêu cầu, nên dùng được cả khi chưa đăng nhập.
- **Đăng ký không tự đăng nhập**. Nếu đăng ký mới đặt cookie còn email trùng thì không, riêng sự khác
  biệt đó đã làm lộ email nào đã đăng ký, phá FR-008b. Vì vậy phản hồi đăng ký luôn giống hệt nhau,
  và phiên được cấp khi người dùng mở liên kết xác minh (`POST /auth/email/verify`) hoặc khi đăng nhập
  bằng mật khẩu. Spec US1 đã cập nhật theo (xem plan, mục "Điều chỉnh spec"). Hệ quả: ai mở được liên
  kết xác minh (dùng một lần, 24 giờ) sẽ được đăng nhập vào tài khoản. Chấp nhận, vì người đó phải
  kiểm soát hộp thư, mà hộp thư vốn đã đủ để đặt lại mật khẩu.

**Phương án đã loại**: mã nằm ở query string (bị ghi trong nhật ký truy cập và `Referer`); mã 6 số nhập
tay (phải chống dò riêng; không cần khi người dùng mở liên kết ngay trên điện thoại).

## R9. Giao diện gửi thư tối thiểu (FR-008, Clarifications Q1)

**Quyết định**:
- `core/mail`: giao diện `Mailer.send(message: { to; subject; text; html })`. Có hai bộ triển khai,
  chọn qua `MAIL_TRANSPORT`:
  - `smtp`: `nodemailer`, nhận `SMTP_URL` (bí mật) và `MAIL_FROM`. Môi trường thật dùng Amazon SES qua
    SMTP (bảng công nghệ). Dev trỏ tới **Mailpit** chạy trong `docker-compose` (cổng 1025/8025).
  - `memory`: dùng trong kiểm thử, giữ thư trong mảng để kiểm thử đọc lại.
- Mẫu thư (tiếng Việt, có bản chữ và bản HTML đơn giản) nằm ở `modules/account/internal/auth/mail/`.
  Thư không bao giờ chứa mật khẩu hay số tiền AI.
- Gửi **sau khi giao dịch xác nhận**, không chờ trong luồng phản hồi (`setImmediate`, giới hạn 10 giây).
  Thời gian phản hồi vì vậy không phụ thuộc việc có gửi thư hay không (FR-008b, SC-006). Gửi lỗi thì ghi
  `mail.send_failed` với `user_id` và `template`, không ghi địa chỉ thư. Người dùng có nút "Gửi lại".
- Khi có hàng chờ `notify` (003) và module Thông báo, thay bằng tạo việc trong cùng giao dịch, để thư
  không mất khi API khởi động lại giữa chừng. Phần này ghi ở "Phạm vi giao cho đầu việc sau".

**Lý do**: `dev` chưa có mã hàng chờ, và spec cho phép gửi trực tiếp. Mailpit chỉ chạy ở môi trường
phát triển, không triển khai, nên không phải "dịch vụ mới" theo nguyên tắc IX. Tách `core/mail` giúp
module Thông báo dùng lại cùng giao diện.

**Phương án đã loại**: ghi liên kết vào nhật ký ở dev (làm lọt mã, trái FR-019); bảng "hộp thư" trong
CSDL (thêm bảng chỉ cho dev, mà Mailpit đã có giao diện xem thư).

## R10. Nhân viên nội bộ (FR-016, US4)

**Quyết định**:
- Bảng `shared`: `account.staff_users(id, email_normalized unique, display_name, role ∈ {support,
  admin}, password_hash, status, created_at…)` và `account.staff_sessions` (cấu trúc như `sessions`,
  không có `account_id`). Truy cập qua `authTx`.
- Lối vào nội bộ: điểm cuối `/api/v1/internal/auth/*`, cookie `__Host-staff_sid`, trang web
  `/internal/login`. Danh tính nhân viên không bao giờ hợp lệ ở điểm cuối khách hàng và ngược lại
  (guard bước 4).
- `STAFF_ALLOWED_CIDRS` (danh sách CIDR, để trống là không giới hạn). Kiểm tra khi đăng nhập và ở mọi
  yêu cầu nội bộ; địa chỉ ngoài danh sách thì 403 và ghi kiểm toán.
- Tạo, vô hiệu hóa, đặt lại mật khẩu, liệt kê nhân viên: dùng lệnh vận hành `pnpm staff <lệnh>`
  (`apps/server/src/ops/staff.ts`), chạy bằng `DATABASE_APP_URL`, ghi kiểm toán với `actor_type =
  'system'` và `actor_id = 'ops-cli'`. Mật khẩu đọc từ stdin, không nhận qua tham số dòng lệnh (sẽ
  nằm trong lịch sử shell). `admin` quản lý nhân viên qua API là việc sau (US4 chỉ cần lệnh vận hành).
- Mọi lần đăng nhập nhân viên (thành công hoặc thất bại) và mọi yêu cầu nội bộ thay đổi dữ liệu đều ghi
  `infra.audit_log`.
- `supportSearch`/`supportViewAccount` nhận `staffId` từ `currentActor()`. Lối vào nội bộ chưa có điểm
  cuối hỗ trợ thật. Điểm cuối mẫu nằm trong mô-đun chỉ dùng cho kiểm thử.
- Thiết kế để thêm bước thứ hai sau: `staff_sessions.assurance` ('password' hiện tại) và quyền nội bộ có
  thể đòi mức `assurance` cao hơn. Thêm TOTP không phải đổi cấu trúc phiên.

## R11. Nhật ký kiểm toán cho xác thực (FR-018)

**Quyết định**: migration tay mở rộng `CHECK` của `infra.audit_log.actor_type` thành `{support, admin,
system, user, anonymous}`. Đây là mở rộng nên tương thích ngược: mã cũ vẫn ghi được. Danh mục hành
động: `auth.register`, `auth.login.succeeded`, `auth.login.failed`, `auth.login.throttled`,
`auth.logout_all`, `auth.password.reset`, `auth.password.changed`, `auth.email.verified`,
`auth.email.changed`, `account.member.added|removed|disabled`, `staff.login.succeeded|failed|denied_ip`,
`staff.created|disabled|password_reset`, `staff.request` (yêu cầu nội bộ thay đổi dữ liệu).
`metadata` chỉ chứa `{ ip, ua_family }` và lý do thất bại dạng mã (`bad_password`, `unknown_email`,
`blocked`). **Không** chứa email, mật khẩu, mã.

Địa chỉ mạng là dữ liệu cá nhân. Nó được giữ cùng phân vùng nhật ký (12 tháng) và được ẩn danh hóa
(`metadata = NULL`) khi xóa tài khoản (FR-14, cơ chế ẩn danh hóa của 002). Phải ghi vào danh mục dữ
liệu cá nhân (Kiến trúc dữ liệu mục 9) ở bước tasks.

Ghi kiểm toán trong cùng giao dịch với thao tác khi có giao dịch. Đăng nhập thất bại không có giao dịch
nghiệp vụ nên ghi bằng `authTx` riêng.

## R12. Giao diện web (FR-022)

**Quyết định**: thêm `react-router` (chế độ thư viện, `createBrowserRouter`, khóa phiên bản). Trang
mới: `/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`,
`/settings/security` (đổi mật khẩu, đăng xuất mọi thiết bị), `/internal/login`. Đường dẫn tiếng Anh,
còn chữ hiển thị là tiếng Việt. Có thêm "cổng phiên" dùng chung:
- gọi `GET /auth/me` khi tải trang;
- gặp 401 thì chuyển về `/login?next=<đường dẫn hiện tại>`, và chỉ chấp nhận `next` là đường dẫn nội
  bộ (chống chuyển hướng mở);
- gặp `EMAIL_NOT_VERIFIED` thì chuyển về `/verify-email`.

`api-client` gửi kèm `credentials: 'same-origin'`. Biểu mẫu dùng `autocomplete` chuẩn (`email`,
`current-password`, `new-password`), có nút hiện/ẩn mật khẩu, lỗi gắn `aria-describedby`, vùng chạm ≥
44 px, chạy từ 360 px. Lược đồ Zod của đầu vào (đăng ký, đăng nhập…) nằm ở `@app/shared/auth`, dùng
chung cho web và API (giống `toFieldErrors` của 001). Kiểm tra trợ năng: thêm `vitest-axe` vào kiểm
thử web (SC-009).

**Phương án đã loại**: TanStack Router (thêm khái niệm khi mới có vài trang); tự viết router (không cần
thiết).

## R13. Nhật ký và che bí mật (FR-019, SC-007)

**Quyết định**: bổ sung `redact` của pino: `req.headers.cookie`, `res.headers["set-cookie"]`,
`req.headers.authorization`, các trường thân yêu cầu `*.password`, `*.currentPassword`,
`*.newPassword`, `*.token`. Lớp xác thực không bao giờ ghi `token_hash`. Kiểm thử
`auth-secrets-in-logs` chạy toàn bộ luồng (đăng ký → xác minh → đăng nhập sai/đúng → đặt lại → đổi mật
khẩu), bắt mọi dòng nhật ký và phản hồi, rồi khẳng định không có mật khẩu thử, mã phiên, mã một lần hay
băm. Mở rộng cổng quét bí mật của CI để nhận ra mẫu `__Host-sid=`.

## R14. Kiểm thử

**Quyết định**:
- Kiểm thử đơn vị (`pnpm test`): chính sách mật khẩu, chuẩn hóa email, ma trận vai trò → quyền, kiểm
  tra Origin, bộ nhớ đệm phiên (TTL, xóa mục), kiểm tra CIDR, khai báo truy cập của mọi route.
- Kiểm thử tích hợp CSDL (`pnpm test:db`, PostgreSQL thật, như 002): 4 hàm `SECURITY DEFINER` (chỉ trả
  cột cho phép, `support`/`system` không có `EXECUTE`), đăng ký đồng thời cùng email, ghế thành viên
  đồng thời, tiêu thụ mã hai lần, chống dò trên 2 bản API (2 bể `app`), thu hồi trong ≤ 60 giây (đồng
  hồ giả cho bộ nhớ đệm), bộ kiểm thử truy cập chéo cho mọi bảng tenant mới.
- Kiểm thử e2e API (supertest + CSDL thật + `MAIL_TRANSPORT=memory`): các kịch bản US1–US5, ma trận
  quyền 5 loại người gọi × 13 quyền (SC-003) qua `AccessMatrixTestModule`. Mô-đun này nằm trong `test/`,
  mỗi quyền một điểm cuối, không vào bản phát hành.
- Đo SC-002 (p95 đăng nhập ≤ 2 giây ở máy dev; guard thêm ≤ 20 ms p95 khi bộ nhớ đệm trúng) và SC-006
  (chênh lệch thời gian trung bình có/không có email < 50 ms trên 200 lần thử).
- Kiểm thử web: Vitest + Testing Library + `vitest-axe` cho từng trang.

## Thuật ngữ mới (thêm vào bảng ánh xạ `architecture.md` mục 11)

| Tiếng Việt | Định danh |
|---|---|
| Phiên đăng nhập | `account.sessions`, cookie `__Host-sid` |
| Nhân viên nội bộ / phiên nhân viên | `account.staff_users` / `account.staff_sessions`, cookie `__Host-staff_sid` |
| Mã một lần (xác minh email, đặt lại mật khẩu) | `account.auth_tokens` (`purpose`: `verify_email`, `reset_password`) |
| Bộ đếm chống dò | `account.auth_throttle` |
| Ghế thành viên | `memberships.seat` |
| Danh mục quyền | `core/auth/permissions.ts`, kiểu `Permission` |
| Người gọi | `actor` trong `ExecutionContext`; `currentActor()` |
| Khai báo truy cập điểm cuối | `@Public`, `@CustomerAccess`, `@StaffAccess`; `AccessGuard` |
| Giao dịch xác thực không tenant | `authTx` |
| Chạy trong phạm vi tài khoản đã xác minh | `runInAccountScope` |
| Giao diện gửi thư | `core/mail`, `Mailer` |
