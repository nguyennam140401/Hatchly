# Research – 009 Đăng nhập Google / Facebook, cách đăng nhập, mời / gỡ cộng tác viên

Mỗi mục: **Quyết định** · **Lý do** · **Phương án đã loại**. Không còn điểm NEEDS CLARIFICATION.
Căn cứ: `spec.md` (đã clarify 2026-11-13), mã và tài liệu của 004 (`specs/004-minimal-auth-rbac/`,
`apps/server/src/modules/account/`), 003 (`apps/server/docs/queue.md`), 005 (`apps/server/docs/gateways.md`),
`.specify/memory/architecture.md` v1.4, hiến pháp.

## R1. Thư viện giao thức đăng nhập: `arctic`

- **Quyết định**: dùng `arctic` (khóa phiên bản chính xác khi cài) cho cả Google (OpenID Connect, có
  PKCE) và Facebook (OAuth 2.0). Bọc sau giao diện nội bộ `IdentityProvider`
  (`modules/account/internal/auth/oauth/`), hai bản cài: `arctic` (thật) và `fake` (R12). Sinh `state`,
  `code_verifier` bằng hàm của `arctic`; đọc ID token của Google bằng `decodeIdToken` của `arctic` rồi
  kiểm `iss`, `aud`, `exp`.
- **Lý do**: đã ghi nhận ở T7/004 R1; thư viện chỉ lo giao thức, không tự truy vấn CSDL nên không đụng
  RLS; hiến pháp VII cấm tự viết phần mật mã/giao thức.
- **Đã loại**: Better Auth / Auth.js (tự truy vấn bảng danh tính ngoài ngữ cảnh tenant – 004 R1);
  Passport (kéo theo phiên riêng, nhiều gói); tự viết bằng `fetch` (trái hiến pháp VII).
- **Cần kiểm khi cài**: chữ ký hàm của phiên bản `arctic` được khóa (đọc tài liệu đúng phiên bản, không
  dựa trí nhớ).

## R2. Dữ liệu lấy từ nhà cung cấp và mã quyền của lượt đăng nhập

- **Quyết định**: Google xin `openid profile email`, lấy `sub`, `email`, `email_verified`, `name` từ ID
  token (không gọi thêm API). Facebook xin `public_profile email`, đổi mã lấy mã quyền rồi gọi **một**
  lần `GET /me?fields=id,name,email` (kèm `appsecret_proof`), sau đó bỏ mã quyền – không ghi CSDL, không
  ghi nhật ký. Không lấy ảnh đại diện.
- **Lý do**: FR-005, FR-006; Kiến trúc dữ liệu mục 9 ("chỉ lưu mã người dùng phía nhà cung cấp và email").
- **Đã loại**: giữ mã quyền Facebook để dùng lại cho kết nối Page (trái FR-005 – tách hẳn FR-02).

## R3. Tín hiệu "email đã xác minh" của từng nhà cung cấp

- **Quyết định** (chủ sản phẩm chốt 2026-11-14): Google: chỉ khi ID token có `email_verified = true`.
  **Facebook: có trả email thì coi là đã xác minh**; không trả email thì người dùng tự nhập và xác minh
  qua thư (R4).
- **Lý do**: người dùng mục tiêu chủ yếu vào bằng Facebook, thêm bước mở thư làm chậm hành trình người
  mới. Graph API không có trường khẳng định email đã xác minh, nhưng Facebook không trả email chưa được
  người dùng xác nhận (tài liệu trường `email`: không trả khi không có email hợp lệ; Auth0 và
  OpenStreetMap ghi nhận cùng hành vi). Trùng email vẫn luôn phải xác nhận (FR-010), nên email đáng tin
  không mở đường tự gộp.
- **Rủi ro còn lại**: email cũ đã đổi chủ – kẻ giữ tài khoản Facebook gắn email đó tạo người dùng trước,
  chủ mới của hộp thư sau này xác nhận liên kết vào đúng người dùng đó. Chấp nhận ở giai đoạn 1. Nguồn
  tra là gián tiếp, nên giả định MUST được kiểm bằng tài liệu Meta hiện hành và tài khoản thử trước khi
  phát hành (quickstart mục 3).
- **Cách đổi lại**: độ tin chỉ nằm ở `ProviderProfile.emailVerified` của bản `arctic` cho Facebook; đặt
  về `false` là quay lại nhánh "chưa xác minh" của R4, không đổi CSDL hay API.
- **Đã loại**: (a) luôn coi email Facebook là chưa xác minh – an toàn nhất nhưng mọi người mới phải mở
  thư (Firebase Authentication chọn hướng này); (b) tạo người dùng chưa xác minh rồi cho vào ngay – theo
  FR-008a của 004 người chưa xác minh bị chặn mọi chức năng nghiệp vụ nên không nhanh hơn, lại làm lộ
  email đã đăng ký.

## R4. Hai nhánh xử lý theo độ tin của email

- **Quyết định**:
  - *Email đã được nhà cung cấp xác minh* (Google `email_verified`, Facebook có trả email): chưa có
    người dùng → bước xác nhận tên + ô đồng ý rồi tạo ngay và đăng nhập (US1). Trùng người dùng → màn
    hình xác nhận mật khẩu / gửi liên kết (US2).
  - *Email chưa xác minh hoặc do người dùng tự nhập* (Facebook không trả email, Google chưa xác minh): sau khi nhập
    email + đồng ý, phản hồi **luôn giống nhau** "Hãy kiểm tra email". Thư gửi tới địa chỉ đó chứa một
    liên kết; khi mở: email chưa có người dùng → tạo tài khoản + đăng nhập; email đã có người dùng →
    đó chính là cách xác nhận (b) của FR-010, liên kết rồi đăng nhập. Không có dữ liệu người dùng nào
    được tạo trước khi mở liên kết.
- **Lý do**: giữ nguyên tắc "không lộ email đã đăng ký" của 004 (FR-008b) – nếu cho nhập email tùy ý rồi
  hiện "Email này đã có tài khoản" thì ai cũng dò được. Với email nhà cung cấp đã xác minh, người dùng
  đã chứng minh giữ email đó nên báo trùng là chấp nhận được.
- **Đã loại**: tạo người dùng chưa xác minh ngay như đăng ký của 004 (phải phân biệt phản hồi khi trùng).

## R5. Lượt đăng nhập qua nhà cung cấp và yêu cầu xác nhận liên kết: một bảng `account.oauth_flows`

- **Quyết định**: một bảng **dùng chung** (không `account_id`) ghi cả vòng đi – về và phần chờ sau khi
  quay về (chờ đồng ý, chờ xác nhận liên kết, chờ mở thư). Gắn trình duyệt bằng cookie
  `__Host-oauth` (mã ngẫu nhiên 32 byte, CSDL chỉ lưu SHA-256); `state` lưu dạng băm; `code_verifier` lưu
  trong dòng và xóa ngay khi quay về. Chuyển giai đoạn bằng cập nhật có điều kiện (dùng một lần). Hạn:
  10 phút cho vòng đi – về, 30 phút cho bước chờ trên trình duyệt và liên kết xác nhận, 24 giờ cho liên
  kết hoàn tất đăng ký (theo quy tắc xác minh email của 004).
- **Lý do**: các bước này xảy ra trước khi biết tenant; hồ sơ nhà cung cấp phải nằm phía máy chủ (không
  tin trình duyệt); liên kết trong thư phải mở được trên thiết bị khác nên không thể chỉ dựa cookie.
  Gộp hai thực thể của spec vào một bảng giúp không cần thêm hàm `SECURITY DEFINER` để tra.
- **Đánh đổi**: bảng dùng chung mà vai trò `app` đọc được có email/mã nhà cung cấp của lượt đang chờ.
  Bù lại: sống ≤ 24 giờ, chỉ truy cập qua `authTx` (quy tắc `auth-tx-restricted`), việc định kỳ xóa.
- **Đã loại**: giữ toàn bộ trong cookie mã hóa (phải tự làm mật mã); hai bảng riêng + hàm tra riêng.

## R6. Người dùng "không thuộc tài khoản nào" = chủ của một **tài khoản chờ** (`accounts.status = 'unclaimed'`)

- **Quyết định**: khi cộng tác viên bị gỡ, một hàm `SECURITY DEFINER` chuyển dòng `users`,
  `login_identities` của người đó sang một tài khoản mới có trạng thái `unclaimed`, nơi họ giữ ghế chủ.
  `AccessGuard` chặn mọi điểm cuối với tài khoản `unclaimed`, trừ điểm cuối khai báo
  `allowDetached: true` (R7). "Tạo tài khoản kinh doanh của riêng tôi" = đổi `unclaimed → active`. Chấp
  nhận lời mời = chuyển người dùng sang tài khoản mời rồi xóa tài khoản chờ. Xóa sau 90 ngày = xóa tài
  khoản chờ (xóa dây chuyền sẵn có).
- **Lý do**: `users` của 004 là bảng tenant có `account_id NOT NULL`; mọi cơ chế (phiên, RLS, `Actor`,
  `tenantTx`, kiểm thử truy cập chéo) dựa trên điều đó. Cách này giữ nguyên toàn bộ: không có dòng danh
  tính nào nằm ngoài tenant, người bị gỡ **không còn** chạy trong ngữ cảnh của tài khoản cũ, và mã người
  dùng không đổi nên bài cũ vẫn truy được người tạo.
- **Đã loại**:
  - Để dòng người dùng nằm lại tài khoản cũ: người bị gỡ vẫn thao tác trong ngữ cảnh tenant cũ (rủi ro
    lộ dữ liệu ở mọi điểm cuối không đòi quyền), và xóa tài khoản cũ sẽ xóa luôn người đó.
  - Cho `users.account_id` được NULL: phá khuôn `tenantTable`, mọi thao tác của người đó phải đi qua hàm
    `SECURITY DEFINER`.
  - Đưa bảng danh tính thành bảng dùng chung: `app` đọc được email mọi khách hàng (đã loại ở 004).

## R7. Lớp chặn quyền với tài khoản chờ

- **Quyết định**: `CustomerActor` thêm `detached: boolean` (lấy từ `accounts.status = 'unclaimed'` khi
  tra phiên). `@CustomerAccess({ allowDetached: true })` cho các điểm cuối cá nhân (tôi là ai, đăng xuất,
  cách đăng nhập, lời mời của tôi, tạo tài khoản riêng). Mặc định từ chối: `detached` mà không có cờ →
  403 `NO_ACCOUNT`. `MeResponse.permissions` rỗng khi `detached`. Khi nhận tài khoản hoặc chấp nhận lời
  mời: thu hồi phiên hiện tại và cấp phiên mới (mã mới chưa nằm trong bộ nhớ đệm của bản API nào, nên
  không bị dính trạng thái cũ ≤ 60 giây).
- **Lý do**: FR-027 ("MUST NOT truy cập dữ liệu nào"), mặc định từ chối của 004; mọi điểm cuối nghiệp vụ
  hiện có tự động bị chặn mà không phải sửa.
- **Đã loại**: chỉ ẩn trên web (trái hiến pháp VI).

## R8. Tên người tạo sau khi gỡ: bảng `account.former_members`

- **Quyết định**: khi gỡ, ghi `(account_id, user_id, display_name, removed_at)` vào bảng tenant
  `former_members` của tài khoản cũ. `describeMembers` (006) trả thêm người trong bảng này với trạng
  thái `removed`. Dòng bị xóa khi người đó tham gia lại, hoặc sau 12 tháng.
- **Lý do**: FR-026 (tên vẫn hiển thị), FR-028a (giữ theo hạn 12 tháng của nhật ký); dòng `users` đã
  rời tenant theo R6. Chỉ giữ tên, không giữ email.
- **Đã loại**: chép tên vào từng bài (đụng schema module khác); giữ dòng `users` ở tài khoản cũ (R6).

## R9. Giới hạn 2 chỗ: ghế trên lời mời + khóa theo tài khoản

- **Quyết định**: `invitations.seat ∈ {1, 2}`, chỉ mục duy nhất `(account_id, seat) WHERE status =
  'pending'`. Chấp nhận lời mời dùng **đúng ghế của lời mời** cho `memberships`. Mọi thao tác đổi ghế
  (mời, chấp nhận, mở khóa/thêm thành viên nội bộ) chạy dưới
  `pg_advisory_xact_lock(hashtextextended('account.seats:' || account_id, 0))`, đọc ghế đã dùng ở cả hai
  bảng rồi mới ghi. Hết hạn được **ghi thành trạng thái**: việc định kỳ mỗi 10 phút + dọn tại chỗ (cập
  nhật có điều kiện) ngay trước khi mời.
- **Lý do**: FR-021, SC-005. Hai chỉ mục duy nhất ở hai bảng không tự loại trừ nhau (một giao dịch có
  thể đọc hai bảng ở hai thời điểm), nên cần khóa; chỉ mục vẫn là chốt chặn cuối. Chỉ mục không dùng
  được `now()`, nên hết hạn phải là trạng thái.
- **Đã loại**: dòng `memberships` trạng thái "được mời" với `user_id` NULL (đổi nghĩa bảng của 004, ảnh
  hưởng `describeMembers`, `listActiveMembers`); chỉ đếm trong ứng dụng (sai khi đồng thời).

## R10. Chấp nhận lời mời

- **Quyết định**: tra lời mời theo băm mã qua `auth_find_invitation`; chấp nhận qua hai hàm
  `SECURITY DEFINER` (người mới / người đã có đang ở tài khoản chờ), mỗi hàm là một thao tác nguyên vẹn:
  khóa ghế → kiểm lời mời còn `pending` và chưa quá hạn → tạo hoặc chuyển người dùng → `memberships`
  (thêm mới, hoặc kích hoạt lại dòng `removed` của chính tài khoản đó) → lời mời `accepted` → xóa tài
  khoản chờ (nếu có). Quy tắc email:
  - Mật khẩu: người dùng mới mang email của lời mời, coi là đã xác minh.
  - Google/Facebook: email nhà cung cấp trả về (dù đã xác minh hay chưa) phải trùng email được mời;
    không có email thì nhận (Clarifications Q3). Ô đồng ý điều khoản tích **trước** khi chuyển sang nhà
    cung cấp.
  - Người đã có: phải đang đăng nhập, email đã xác minh và trùng email được mời, tài khoản của họ đang
    `unclaimed`. Người đang là chủ/cộng tác viên của tài khoản khác → `INVITE_EMAIL_IN_USE`.
- **Lý do**: FR-022, FR-023; bước này trước khi biết tenant và phải tạo dữ liệu ở tenant của người mời.
- **Đã loại**: chấp nhận trong `tenantTx` của tài khoản mời bằng mã tài khoản lấy từ lời mời rồi nhiều
  câu lệnh rời (không nguyên vẹn, không chuyển được người dùng giữa hai tenant dưới RLS).

## R11. Xác nhận lại danh tính (FR-012)

- **Quyết định**: cột `sessions.reauthenticated_at`. Phiên "mới xác nhận" khi
  `coalesce(reauthenticated_at, created_at) ≥ now() − 10 phút`. Phiên được cấp do **xoay vòng** (nhận tài
  khoản, tham gia lại qua lời mời) không phải là xác thực lại: phiên mới mang `reauthenticated_at` =
  `coalesce(reauthenticated_at, created_at)` của phiên cũ, nên phiên cũ bị lộ không tự làm mới được. Xác nhận lại bằng `POST /auth/reauth` (mật khẩu, có đếm chống
  dò) hoặc một vòng đăng nhập nhà cung cấp mục đích `reauth` với danh tính **đã liên kết**. Kiểm tra bằng
  đọc dòng phiên trong giao dịch, không qua bộ nhớ đệm.
- **Lý do**: phiên vừa tạo bằng đăng nhập đã là bằng chứng; không cần cơ chế phiên thứ hai.
- **Đã loại**: mã xác nhận gửi email mỗi lần (chậm, thêm thư); cờ trong bộ nhớ (không dùng chung giữa
  các bản API).

## R12. Nhà cung cấp giả lập cho dev/test

- **Quyết định**: `OAUTH_DRIVER = real | fake`. Bản `fake` trả địa chỉ ủy quyền trỏ về điểm cuối
  `GET /api/v1/dev/oauth/fake/authorize` (chỉ đăng ký khi `fake`), nơi chọn một hồ sơ kịch bản (có/không
  email, đã/chưa xác minh, hủy, lỗi) rồi chuyển về callback thật với mã giả. staging/production từ chối
  khởi động khi `fake` (cùng quy tắc với các bản giả của 005).
- **Lý do**: Assumptions của spec (kiểm thử không gọi ra ngoài); SC-003 đòi phủ mọi tổ hợp.
- **Đã loại**: giả lập bằng mock HTTP trong từng kiểm thử (không chạy được luồng trình duyệt ở dev).

## R13. Gỡ cách đăng nhập và quy tắc "còn ít nhất một"

- **Quyết định**: trong `tenantTx`: `SELECT … FROM login_identities WHERE user_id = $1 FOR UPDATE` (khóa
  mọi dòng của người dùng), đếm, chỉ xóa khi còn ≥ 2. Liên kết thêm: `INSERT`, vi phạm
  `login_identities_provider_subject_key` → `IDENTITY_IN_USE`, vi phạm `(account_id, user_id, provider)`
  → `LOGIN_METHOD_EXISTS`. Gỡ theo thông báo Meta bỏ qua bước đếm (ngoại lệ FR-016).
- **Lý do**: FR-015, FR-016, SC-009 (hai yêu cầu gỡ đồng thời).
- **Đã loại**: ràng buộc trigger đếm dòng (khó kiểm soát với xóa dây chuyền).

## R14. Tạo mật khẩu cho người chưa có mật khẩu (FR-017)

- **Quyết định**: dùng lại mã `reset_password` của 004. `forgot` gửi thư cả khi người dùng chưa có mật
  khẩu (trước đây im lặng bỏ qua); `reset` ghi kiểu thêm-hoặc-cập-nhật dòng `password`. Nút "Tạo mật
  khẩu" trong Cài đặt gọi cùng đường này cho email của phiên (đòi xác nhận lại danh tính).
- **Lý do**: cùng chính sách, hạn, giới hạn thư; phản hồi vốn đã không phân biệt.
- **Đã loại**: mục đích mã mới `set_password` (trùng chức năng, thêm nhánh kiểm thử).

## R15. Thông báo gỡ ứng dụng / xóa dữ liệu của Meta (FR-009a)

- **Quyết định**: hai điểm cuối công khai nhận `signed_request` (thân `application/x-www-form-urlencoded`):
  `POST /auth/facebook/deauthorize` và `POST /auth/facebook/data-deletion`. Kiểm chữ ký HMAC-SHA256 bằng
  bí mật ứng dụng với `node:crypto` (`createHmac` + `timingSafeEqual`), chỉ nhận `algorithm =
  HMAC-SHA256`. Hợp lệ → tra danh tính `('facebook', user_id)` → trong tenant của người đó: xóa dòng danh
  tính, kiểm toán, tạo việc gửi thư bảo mật. Ghi một dòng `account.meta_deletion_requests` (mã xác nhận
  ngẫu nhiên, HMAC của mã người dùng Facebook để nhận ra thông báo lặp). Điểm cuối xóa dữ liệu trả
  `{ url, confirmation_code }`; trang trạng thái công khai `/data-deletion/{mã}`. Hai điểm cuối này được
  miễn kiểm tra nguồn gửi (CSRF) vì do máy chủ Meta gọi – thay bằng kiểm chữ ký.
- **Lý do**: Clarifications Q4; định dạng theo tài liệu Meta ("Data Deletion Request Callback",
  "Deauthorize Callback"). Kiểm chữ ký bằng hàm chuẩn của thư viện chuẩn không phải tự viết mật mã.
- **Đã loại**: xử lý qua hàng chờ (SC-010 đòi ≤ 1 phút; thao tác nhỏ, làm ngay trong yêu cầu và chạy
  lại được an toàn).
- **Cần kiểm khi làm**: đối chiếu định dạng `signed_request` và thân phản hồi với tài liệu Meta hiện
  hành.

## R16. Gửi thư

- **Quyết định**:
  - Thư **có mã một lần** (mời, xác nhận liên kết, hoàn tất đăng ký, đặt mật khẩu): giữ cách của 004 –
    gửi trong tiến trình sau khi giao dịch xác nhận, có nút "Gửi lại".
  - Thư **không có mã** (thêm/gỡ cách đăng nhập, lời mời được chấp nhận, báo trước khi xóa): loại việc
    mới `account.mail_notice` trên hàng chờ `notify`, tạo trong cùng giao dịch; dữ liệu việc chỉ có tên
    mẫu và mã tham chiếu; bộ xử lý tra người nhận trong tenant rồi gọi `Mailer.deliver`.
  - Thư "bạn đã bị gỡ": gửi trong tiến trình sau khi xác nhận (người nhận đã rời tenant của giao dịch).
- **Lý do**: dữ liệu việc cấm chứa bí mật (003, FR-030: liên kết chỉ lưu dạng băm) nên thư có mã không
  qua hàng chờ được; thư không mã đi hàng chờ đúng nguyên tắc V. Module `account` không được phụ thuộc
  `notifications` (tệp kê khai), nên dùng thẳng `queue` + `core/mail`.
- **Đã loại**: mã hóa mã một lần trong dữ liệu việc (thêm quản lý khóa); phụ thuộc ngược sang
  `notifications`.

## R17. Tên cửa hàng trong thư mời / thư gỡ

- **Quyết định**: cổng ở lõi `ACCOUNT_LABEL_RESOLVER` (`core/auth`), module `context` cung cấp (tên trong
  hồ sơ kinh doanh của tài khoản trong ngữ cảnh). `account` tiêm tùy chọn; không có hoặc chưa có hồ sơ →
  dùng "tài khoản của {tên người mời}". Nhãn được chép vào `invitations.account_label` lúc gửi.
- **Lý do**: FR-020; `account` không được nhập `context` (chiều phụ thuộc ngược), cùng kiểu đảo phụ
  thuộc với `SESSION_RESOLVER`.
- **Đã loại**: web gửi tên lên (không tin được nội dung đưa vào thư); `account` đọc bảng của `context`.

## R18. Xóa người dùng ở tài khoản chờ quá 90 ngày (FR-028a)

- **Quyết định**: `users.detached_at`, `users.deletion_notice_sent_at`. Việc định kỳ
  `account.detached_users` (mỗi giờ, hàng chờ `scheduled`, phạm vi `system`):
  1. Báo trước: hàm `detached_users_due('notice')` trả danh sách; với từng người, trong ngữ cảnh tài
     khoản chờ: cập nhật có điều kiện `deletion_notice_sent_at` + tạo việc `account.mail_notice` cùng
     giao dịch (không gửi trùng).
  2. Xóa: hàm `purge_detached_account(account_id)` tự kiểm lại mọi điều kiện (`unclaimed`, đủ 90 ngày,
     đã báo ≥ 7 ngày) rồi xóa tài khoản chờ; sau đó ghi kiểm toán `account.user.purged` (không có dữ
     liệu cá nhân) và xóa việc còn lại của tài khoản đó (queue.md mục 7).
- **Lý do**: Clarifications Q5, SC-010; việc định kỳ chạy lại an toàn vì mọi điều kiện kiểm trong CSDL.
  Xóa chậm hơn nếu thư báo trước bị trễ – an toàn hơn xóa mà chưa báo.
- **Đã loại**: tính hạn từ nhật ký kiểm toán (không truy vấn được theo người).

## R19. Bí mật trong nhật ký với đường quay về

- **Quyết định**: đường quay về là `GET /api/v1/auth/oauth/{provider}/callback?code=…&state=…` trên API
  (cùng site với web). Nhật ký yêu cầu của API ghi **đường dẫn mẫu, không ghi chuỗi truy vấn** cho các
  route `/auth/oauth/*`; kiểm thử quét bí mật có thêm mẫu `code=`, `state=`, `signed_request=`. Sau khi
  xử lý, API chuyển hướng 303 sang `/oauth/result` của web, không có tham số. Lưu ý vận hành: nhật ký
  truy cập của ingress cũng phải bỏ chuỗi truy vấn cho tiền tố này (việc cho 007/008).
- **Lý do**: FR-030, SC-008.

## R20. Tương thích khi phát hành

- **Quyết định**: migration chỉ thêm. Hàm tra phiên mới là `auth_resolve_session_v2` (thêm cột
  `detached`), giữ hàm cũ cho bản API cũ; bỏ hàm cũ ở lần phát hành sau. `CHECK` của `accounts.status`,
  `auth_throttle.kind`, `sessions.revoke_reason` mở rộng tập giá trị. Tài khoản `unclaimed` chỉ do mã mới
  tạo ra.
- **Lý do**: hiến pháp (API/Worker cũ và mới chạy song song khi phát hành).
- **Lưu ý**: số migration `0014`, `0015` có thể trùng với nhánh tính năng khác đang mở – đánh số lại khi
  hợp nhất.

## Thuật ngữ mới (Việt → Anh)

| Tài liệu | Mã nguồn |
|---|---|
| lời mời cộng tác viên (`loi_moi`) | `account.invitations` |
| lượt đăng nhập qua nhà cung cấp; yêu cầu xác nhận liên kết | `account.oauth_flows` (cột `stage`) |
| thành viên cũ (tên người tạo sau khi gỡ) | `account.former_members` |
| yêu cầu xóa dữ liệu từ Meta | `account.meta_deletion_requests` |
| tài khoản chờ | `accounts.status = 'unclaimed'`; trong tham số hàm CSDL gọi là `shell_*` (`p_shell_account_id`, `p_shell_membership_id`) |
| người dùng không thuộc tài khoản nào | `detached` (`Actor.detached`, `users.detached_at`, `allowDetached`) |
| nhận tài khoản (tạo tài khoản kinh doanh riêng) | `claim` (`POST /account/claim`) |
| xác nhận lại danh tính | `reauth` (`sessions.reauthenticated_at`) |
| nhà cung cấp đăng nhập | `IdentityProvider`; `OAUTH_DRIVER` |
| nhãn tài khoản (tên cửa hàng) | `AccountLabelResolver`, `ACCOUNT_LABEL_RESOLVER` |
| thư thông báo không mã | loại việc `account.mail_notice` |
| trùng tài khoản cùng nhà cung cấp (đã gắn Facebook A, đăng nhập bằng Facebook B cùng email) | `PROVIDER_ACCOUNT_CONFLICT`; thư `identity_link_blocked` |
