# Feature Specification: Xác thực tối thiểu – email + mật khẩu, phiên đăng nhập, 4 vai trò, chặn quyền ở API

**Feature Branch**: `004-minimal-auth-rbac`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "@TaiLieuDacTa Tôi muốn xây dựng tính năng Xác thực tối thiểu: email + mật khẩu, phiên đăng nhập, vai trò chủ / cộng tác viên / hỗ trợ / quản trị, chặn quyền ở API đáp ứng kiến trúc dự án"

**Truy vết**: WBS 2.1 (Tài khoản & Gói – phần lõi: đăng ký/đăng nhập email + mật khẩu, vai trò chủ/cộng
tác viên, tenant) · FR-15 (phần email + mật khẩu, xác minh email) · Đặc tả yêu cầu mục 3 (bảng phân quyền) · T7 (thư
viện xác thực mã nguồn mở chạy trong API, dữ liệu trong PostgreSQL) · ADR-02 (mã tài khoản lấy từ phiên
đăng nhập) · ADD tổng thể mục API/tenant · Kiến trúc dữ liệu mục 4 (schema `account`: `accounts`,
`users`, `login_identities`, `memberships`), mục 9 (Google/Meta), mục cache (phiên + vai trò ≤ 60 giây) ·
NFR bảo mật · Hiến pháp nguyên tắc I, VI, VII, VIII, IX.

**Phụ thuộc**: `001-monorepo-module-skeleton` (khung API, module `account`, lõi dùng chung, nhật ký có
cấu trúc) · `002-db-layer-tenant-rls` (giao dịch ngữ cảnh tenant/hệ thống/hỗ trợ, điểm gắn tài khoản vào
yêu cầu chỉ dành cho lớp xác thực, `infra.audit_log`, vai trò CSDL `support`) · `003-queue-layer-pgboss`
(chỉ khi gửi email qua hàng chờ `notify` – xem FR-008).

**Bối cảnh**: Đây là cửa vào của mọi tính năng khách hàng. Có hai nhóm người dùng tách biệt:
(1) **người dùng khách hàng** – chủ tài khoản và cộng tác viên, thuộc đúng một tài khoản (tenant);
(2) **nhân viên nội bộ** – đội hỗ trợ và quản trị nội bộ, không thuộc tài khoản khách hàng nào. Tính
năng cung cấp: đăng ký/đăng nhập/đăng xuất bằng email + mật khẩu, phiên đăng nhập an toàn, xác định vai
trò, và **một cơ chế chặn quyền dùng chung ở API** mà mọi module sau khai báo theo. Từ phiên đăng nhập,
mã tài khoản được gắn vào ngữ cảnh yêu cầu để lớp CSDL (002) áp chính sách cô lập – đây là con đường
duy nhất mã tài khoản đi vào yêu cầu API.

## Clarifications

### Session 2026-11-08

- Q: Đặt lại mật khẩu và xác minh email có làm ngay trong tính năng này không, khi chưa có module Thông
  báo/kênh email thật? → A: Làm cả hai. Có đặt lại mật khẩu qua email, và bắt buộc xác minh email: chưa
  xác minh thì chỉ dùng được các thao tác xác minh. Thư đi qua một giao diện gửi thư tối thiểu (hộp thư
  thử ở môi trường phát triển, SMTP ở môi trường chính thức), sau này module Thông báo thay phần triển
  khai (FR-008, FR-008a, FR-008b).
- Q: Nhân viên hỗ trợ/quản trị có bắt buộc bước xác thực thứ hai ngay ở tính năng này không? → A:
  Chưa làm. Nhân viên dùng mật khẩu, hạn phiên ngắn, có kiểm toán, giới hạn được theo dải địa chỉ mạng.
  Bước xác thực thứ hai đưa vào danh sách việc trước khi ra mắt (FR-016).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chủ kinh doanh đăng ký tài khoản và vào ứng dụng (Priority: P1)

Chủ kinh doanh mở ứng dụng trên điện thoại, nhập tên hiển thị, email, mật khẩu, tích ô đồng ý điều
khoản/chính sách dữ liệu (ô không được đặt sẵn) rồi bấm "Tạo tài khoản". Hệ thống tạo **một tài khoản
khách hàng mới**, một người dùng và gắn người đó làm **chủ tài khoản** – tất cả trong một thao tác
nguyên vẹn – rồi gửi thư xác minh email và hiện màn hình "Hãy kiểm tra email" có nút gửi lại thư.
Người dùng bấm liên kết trong thư thì được đăng nhập và vào màn hình đầu tiên. (Cập nhật theo plan
R8: đăng ký không tự đăng nhập, để phản hồi cho email mới và email đã có giống hệt nhau – FR-008b.)

**Why this priority**: Không có tài khoản thì không có tenant, không tính năng nào khác chạy được. Là
bước 1 của hành trình "người mới bắt đầu nhanh" (UI/UX mục 4).

**Independent Test**: Gửi đăng ký với email mới → có đúng 1 tài khoản, 1 người dùng, 1 vai trò chủ, 1
cách đăng nhập "mật khẩu"; hộp thư thử có 1 thư xác minh; đăng nhập bằng mật khẩu rồi gọi API thử
dành cho chủ → bị từ chối "chưa xác nhận email"; mở liên kết xác minh (được đăng nhập) rồi gọi lại →
thành công và dữ liệu ghi ra mang mã tài khoản vừa tạo.

**Acceptance Scenarios**:

1. **Given** email chưa từng đăng ký, **When** gửi đăng ký hợp lệ có tích ô đồng ý, **Then** tài khoản,
   người dùng, vai trò chủ được tạo cùng lúc, email ở trạng thái "chưa xác minh"; thư xác minh được gửi;
   phản hồi không đăng nhập người dùng; thời điểm và phiên bản điều khoản đã đồng ý được ghi lại.
2. **Given** email đã có người dùng (khác chữ hoa/thường hoặc có khoảng trắng thừa), **When** đăng ký,
   **Then** không tạo tài khoản thứ hai; màn hình hiện cùng thông báo như đăng ký mới ("Hãy kiểm tra
   email"); chủ của email đó nhận thư kèm nút "Đăng nhập" / "Quên mật khẩu" (FR-008b).
3. **Given** mật khẩu không đạt chính sách (FR-005) hoặc chưa tích ô đồng ý, **When** đăng ký, **Then**
   bị từ chối, chỉ rõ trường cần sửa, không có dữ liệu nào được ghi.
4. **Given** lỗi xảy ra giữa chừng khi tạo, **When** đăng ký, **Then** không còn tài khoản/người dùng
   dở dang nào.
5. **Given** đăng ký thành công, **When** tra CSDL và nhật ký, **Then** mật khẩu chỉ được lưu dưới dạng
   băm một chiều; mật khẩu không xuất hiện trong nhật ký, chỉ số, thông báo lỗi.
6. **Given** người dùng chưa xác minh email, **When** mở liên kết xác minh còn hạn, **Then** email được
   đánh dấu đã xác minh, liên kết hết hiệu lực, người dùng vào được màn hình đầu tiên; liên kết đã dùng
   hoặc quá 24 giờ → bị từ chối kèm nút "Gửi lại thư".
7. **Given** người dùng chưa xác minh gõ sai email lúc đăng ký, **When** sửa email đăng ký, **Then** thư
   xác minh mới gửi tới email mới, liên kết cũ hết hiệu lực; email mới cũng phải chưa có tài khoản.
8. **Given** người dùng chưa xác minh email, **When** gọi API khách hàng không được khai báo là dùng được
   khi chưa xác minh, **Then** bị từ chối "Hãy xác nhận email để tiếp tục" (FR-008a).

---

### User Story 2 - Đăng nhập, giữ phiên và đăng xuất (Priority: P1)

Người dùng (chủ hoặc cộng tác viên) đăng nhập bằng email + mật khẩu, được giữ đăng nhập trên thiết bị
đó trong thời gian dài hợp lý để dùng hằng ngày trên điện thoại, và đăng xuất được – ở thiết bị hiện
tại hoặc ở mọi thiết bị.

**Why this priority**: Là điều kiện để mọi API nghiệp vụ biết "ai, thuộc tài khoản nào, vai trò gì".

**Independent Test**: Đăng nhập đúng → gọi API "tôi là ai" trả về người dùng, tài khoản, vai trò; đăng
xuất → cùng phiên đó gọi lại bị từ chối "chưa đăng nhập".

**Acceptance Scenarios**:

1. **Given** email + mật khẩu đúng, **When** đăng nhập, **Then** tạo phiên mới; API "tôi là ai" trả về
   tên hiển thị, email, tài khoản và vai trò hiện tại (không trả mật khẩu/băm/mã bí mật nào).
2. **Given** email không tồn tại hoặc mật khẩu sai, **When** đăng nhập, **Then** cùng một thông báo
   chung ("Email hoặc mật khẩu chưa đúng") và cùng khoảng thời gian phản hồi – không lộ email nào đã đăng
   ký.
3. **Given** một email/địa chỉ mạng thử sai liên tiếp vượt ngưỡng (FR-007), **When** thử tiếp, **Then**
   bị tạm chặn có thời hạn, thông báo cho biết khi nào thử lại được và gợi ý "Quên mật khẩu"; đăng nhập
   đúng sau khi hết hạn chặn vẫn được.
4. **Given** phiên đang hiệu lực, **When** người dùng bấm "Đăng xuất", **Then** phiên đó bị thu hồi ngay
   ở mọi bản API.
5. **Given** người dùng đăng nhập trên 2 thiết bị, **When** bấm "Đăng xuất khỏi mọi thiết bị" hoặc đổi
   mật khẩu, **Then** mọi phiên khác bị thu hồi (phiên hiện tại giữ lại khi đổi mật khẩu).
6. **Given** phiên quá hạn không hoạt động hoặc quá hạn tuyệt đối (FR-010), **When** gọi API, **Then**
   bị từ chối "chưa đăng nhập"; giao diện đưa về màn hình đăng nhập và quay lại đúng trang đang dở sau
   khi đăng nhập lại.
7. **Given** một trang web khác cố gửi yêu cầu thay đổi dữ liệu thay người dùng đang đăng nhập, **When**
   yêu cầu tới API, **Then** bị từ chối.

---

### User Story 3 - Mọi API bị chặn quyền theo vai trò, mặc định từ chối (Priority: P1)

Lập trình viên module nghiệp vụ khai báo cho mỗi điểm cuối API: có cần đăng nhập không, thuộc nhóm
khách hàng hay nội bộ, và **quyền** nào được phép (theo bảng phân quyền FR-012). Lớp chặn quyền dùng
chung kiểm tra trước khi vào nghiệp vụ; điểm cuối không khai báo bị từ chối mặc định và bị kiểm tra
tự động phát hiện. Ẩn nút trên giao diện chỉ là trải nghiệm, không thay cho chặn ở API (nguyên tắc VI).

**Why this priority**: Hiến pháp VI ("quyền MUST được kiểm tra ở API") và I (mã tài khoản chỉ lấy từ
phiên). Mọi module từ WBS 2.x trở đi dựa vào cơ chế này; làm sai một lần sẽ phải sửa khắp nơi.

**Independent Test**: Dựng các điểm cuối mẫu cho từng quyền; với từng vai trò (chủ, cộng tác viên, hỗ
trợ, quản trị, chưa đăng nhập) gọi từng điểm cuối → kết quả khớp đúng ma trận FR-012; thêm một điểm cuối
không khai báo quyền → kiểm tra tự động báo lỗi và gọi điểm cuối đó bị từ chối.

**Acceptance Scenarios**:

1. **Given** cộng tác viên đã đăng nhập, **When** gọi điểm cuối cần quyền "duyệt bài" hoặc "kết nối
   kênh", **Then** bị từ chối "không đủ quyền" với lời giải thích đời thường ("Chỉ chủ tài khoản mới duyệt
   được bài") và không có tác dụng phụ nào.
2. **Given** chủ tài khoản A, **When** gửi yêu cầu có mã tài khoản B trong đường dẫn, tham số hoặc thân
   yêu cầu, **Then** hệ thống bỏ qua giá trị đó; mọi thao tác chạy trong ngữ cảnh tài khoản A lấy từ
   phiên; không thấy, không sửa được dữ liệu B.
3. **Given** chưa đăng nhập, **When** gọi điểm cuối cần đăng nhập, **Then** bị từ chối "chưa đăng nhập";
   chỉ các điểm cuối được khai báo công khai (đăng ký, đăng nhập, quên mật khẩu, kiểm tra sức khỏe) mới
   gọi được.
4. **Given** nhân viên hỗ trợ đăng nhập, **When** gọi điểm cuối nghiệp vụ khách hàng (soạn bài, duyệt…),
   **Then** bị từ chối; nhân viên chỉ dùng được điểm cuối nội bộ, và việc đọc dữ liệu khách hàng đi qua
   đường hỗ trợ có kiểm toán của lớp CSDL.
5. **Given** người dùng khách hàng (kể cả chủ), **When** gọi điểm cuối nội bộ (hỗ trợ/quản trị), **Then**
   bị từ chối.
6. **Given** chủ gỡ vai trò/khóa một cộng tác viên (thao tác thử ở tính năng này), **When** cộng tác viên
   gọi API, **Then** bị từ chối chậm nhất 60 giây sau thay đổi.
7. **Given** mỗi lần bị từ chối vì quyền, **When** tra nhật ký kỹ thuật, **Then** có bản ghi có cấu trúc
   gắn mã theo dõi, mã người dùng, mã tài khoản, quyền bị thiếu – không có mật khẩu, mã phiên.

---

### User Story 4 - Nhân viên nội bộ (hỗ trợ, quản trị) đăng nhập riêng, mọi thao tác được ghi lại (Priority: P2)

Đội vận hành tạo tài khoản nhân viên bằng công cụ vận hành (không có đăng ký công khai cho nhân viên),
gán vai trò "hỗ trợ" hoặc "quản trị". Nhân viên đăng nhập ở lối vào nội bộ, phiên ngắn hơn khách hàng,
và mọi lần đăng nhập, xem dữ liệu khách hàng, thao tác quản trị đều vào nhật ký kiểm toán.

**Why this priority**: Cần cho hỗ trợ tra nhật ký đăng và quản trị kích hoạt gói (WBS 2.x/4.x), nhưng
không chặn luồng khách hàng P1.

**Independent Test**: Tạo nhân viên hỗ trợ bằng công cụ vận hành → đăng nhập lối vào nội bộ → gọi điểm
cuối hỗ trợ mẫu → thành công và có bản ghi kiểm toán; dùng email đó ở lối vào khách hàng → thất bại
như sai mật khẩu.

**Acceptance Scenarios**:

1. **Given** nhân viên vai trò "hỗ trợ", **When** gọi điểm cuối quản trị (kích hoạt/gia hạn/tạm dừng
   gói), **Then** bị từ chối; nhân viên "quản trị" gọi được.
2. **Given** nhân viên đăng nhập thành công hoặc thất bại, **When** tra nhật ký kiểm toán, **Then** có
   bản ghi gồm ai, khi nào, kết quả, từ địa chỉ mạng nào – không chứa mật khẩu.
3. **Given** nhân viên bị vô hiệu hóa bằng công cụ vận hành, **When** gọi API, **Then** mọi phiên của
   nhân viên đó bị từ chối chậm nhất 60 giây sau.
4. **Given** danh sách dải địa chỉ mạng cho phép của lối vào nội bộ đã cấu hình, **When** nhân viên
   đăng nhập từ địa chỉ ngoài danh sách, **Then** bị từ chối và có bản ghi kiểm toán.

---

### User Story 5 - Quên mật khẩu và đổi mật khẩu (Priority: P2)

Người dùng quên mật khẩu nhập email ở màn hình đăng nhập, nhận email có liên kết đặt lại dùng một lần,
có hạn ngắn; đặt mật khẩu mới thì mọi phiên cũ bị thu hồi. Người đang đăng nhập đổi mật khẩu được khi
nhập đúng mật khẩu hiện tại.

**Why this priority**: Người dùng là chủ kinh doanh cá nhân không có đội kỹ thuật; quên mật khẩu mà
không tự lấy lại được sẽ thành yêu cầu hỗ trợ thủ công. Phụ thuộc kênh gửi email.

**Independent Test**: Yêu cầu đặt lại cho email có thật → có đúng 1 email chứa liên kết; dùng liên kết
đặt mật khẩu mới → đăng nhập bằng mật khẩu mới được, mật khẩu cũ không được, phiên cũ bị thu hồi; dùng
lại liên kết lần 2 → bị từ chối.

**Acceptance Scenarios**:

1. **Given** email bất kỳ (có hay không có tài khoản), **When** yêu cầu đặt lại, **Then** luôn nhận cùng
   thông báo "Nếu email có tài khoản, chúng tôi đã gửi hướng dẫn"; chỉ email có thật mới nhận thư.
2. **Given** liên kết đặt lại đã dùng, đã quá hạn, hoặc đã có liên kết mới hơn, **When** mở liên kết,
   **Then** bị từ chối kèm nút "Gửi lại liên kết".
3. **Given** người dùng đang đăng nhập, **When** đổi mật khẩu với mật khẩu hiện tại sai, **Then** bị từ
   chối và lần sai được tính vào ngưỡng chống dò.
4. **Given** đặt lại/đổi mật khẩu thành công, **When** xong, **Then** người dùng nhận email thông báo
   "mật khẩu vừa được thay đổi" kèm hướng dẫn nếu không phải họ làm.

---

### Edge Cases

- Email nhập khác chữ hoa/thường, có khoảng trắng đầu/cuối → coi là cùng một email (chuẩn hóa trước khi
  so sánh và lưu); email có ký tự quốc tế hợp lệ vẫn đăng ký được.
- Hai yêu cầu đăng ký cùng email gửi đồng thời → đúng một yêu cầu thành công, yêu cầu kia nhận thông báo
  "email đã có tài khoản".
- Mật khẩu rất dài (vượt giới hạn trên của FR-005) → bị từ chối có thông báo, không làm chậm/treo máy chủ.
- Một người vừa là nhân viên nội bộ vừa muốn có tài khoản khách hàng với cùng email → hai danh tính tách
  biệt, phiên không dùng chéo được.
- Người dùng khách hàng thuộc tài khoản đã bị tạm dừng/hết hạn gói → vẫn đăng nhập được (để xem/gia hạn);
  việc chặn tính năng theo gói thuộc tính năng gói dịch vụ, không thuộc tính năng này.
- Tài khoản đã yêu cầu xóa (FR-14) hoặc người dùng bị vô hiệu hóa → không đăng nhập được, mọi phiên bị
  thu hồi.
- Một bản API khởi động lại hoặc yêu cầu rơi sang bản API khác → phiên vẫn hiệu lực (phiên lưu bền, không
  chỉ trong bộ nhớ một bản).
- Cộng tác viên thứ 3 được thêm vào một tài khoản → bị từ chối (tối đa 2 cộng tác viên, đúng 1 chủ).
- Chủ tài khoản không thể tự gỡ vai trò chủ của mình hoặc để tài khoản không có chủ.
- Yêu cầu đến với phiên hợp lệ nhưng người dùng không còn vai trò trong tài khoản → xử lý như chưa đăng
  nhập vào tài khoản đó.
- Thử dò mật khẩu phân tán (nhiều địa chỉ mạng, một email) hoặc rải (một địa chỉ mạng, nhiều email) →
  đều bị giới hạn theo FR-007.
- Gửi quá nhiều yêu cầu "quên mật khẩu" cho một email → giới hạn số thư mỗi giờ, không làm lộ email có
  tồn tại hay không.

## Requirements *(mandatory)*

### Functional Requirements

**Đăng ký & danh tính**

- **FR-001**: Hệ thống MUST cho người chưa có tài khoản đăng ký bằng tên hiển thị, email, mật khẩu và
  đồng ý điều khoản; ô đồng ý MUST NOT được đặt sẵn. Đăng ký thành công MUST tạo trong **một giao dịch**:
  một tài khoản khách hàng, một người dùng, một cách đăng nhập loại "mật khẩu", một vai trò "chủ"; ghi
  thời điểm và phiên bản điều khoản đã đồng ý.
- **FR-002**: Email MUST được chuẩn hóa (bỏ khoảng trắng, không phân biệt hoa thường) và là duy nhất
  trong danh tính khách hàng; danh tính nhân viên nội bộ MUST tách riêng khỏi danh tính khách hàng.
- **FR-003**: Mô hình dữ liệu MUST cho một người dùng có nhiều cách đăng nhập (mật khẩu ở tính năng này;
  Google/Facebook ở tính năng sau – FR-15) mà không đổi cấu trúc; cặp (nhà cung cấp, mã người dùng phía
  nhà cung cấp) MUST duy nhất.
- **FR-004**: Mỗi tài khoản khách hàng MUST có đúng 1 chủ và tối đa 2 cộng tác viên; ràng buộc MUST
  được giữ ở lớp dữ liệu, kể cả khi có thao tác đồng thời. Ở giai đoạn 1 một người dùng khách hàng thuộc
  đúng một tài khoản. Luồng mời/gỡ cộng tác viên cho người dùng cuối thuộc WBS 4.4; tính năng này chỉ
  cung cấp thao tác nội bộ (cho kiểm thử và dữ liệu mẫu) để thêm/gỡ/khóa thành viên.

**Mật khẩu & chống dò**

- **FR-005**: Mật khẩu MUST dài 8–128 ký tự, không bắt buộc kiểu ký tự; MUST bị từ chối nếu nằm trong
  danh sách mật khẩu phổ biến/đã lộ (danh sách lưu trong hệ thống, không gửi mật khẩu ra ngoài) hoặc
  trùng email. Mật khẩu MUST được lưu bằng thuật toán băm chậm có muối do thư viện xác thực mã nguồn mở
  đã kiểm chứng cung cấp; MUST NOT tự viết phần mật mã (nguyên tắc VII).
- **FR-006**: Đăng nhập sai MUST trả cùng thông báo cho "email không tồn tại" và "sai mật khẩu", với
  thời gian phản hồi tương đương, để không lộ email đã đăng ký.
- **FR-007**: Hệ thống MUST giới hạn số lần thử đăng nhập/đổi mật khẩu sai theo email và theo địa chỉ
  mạng: mặc định 5 lần sai/15 phút/email → tạm chặn email đó 15 phút; 30 lần sai/15 phút/địa chỉ mạng →
  tạm chặn địa chỉ đó 15 phút. Ngưỡng là cấu hình. Thông báo chặn MUST nêu khi nào thử lại và gợi ý
  "Quên mật khẩu".
- **FR-008**: Người dùng khách hàng MUST đặt lại được mật khẩu qua liên kết gửi email: dùng một lần, hết
  hạn sau 30 phút, liên kết mới làm vô hiệu liên kết cũ; phản hồi yêu cầu MUST giống nhau dù email có
  tồn tại hay không; tối đa 3 thư/giờ/email. Đặt lại thành công MUST thu hồi mọi phiên của người dùng.
  Thư (đặt lại, xác minh, thông báo bảo mật) MUST đi qua một giao diện gửi thư tối thiểu của tính năng
  này: môi trường phát triển/thử nghiệm ghi vào hộp thư thử để kiểm thử đọc lại, môi trường chính thức
  gửi qua SMTP. Module Thông báo thay phần triển khai sau mà không đổi luồng xác thực (Clarifications
  Q1).
- **FR-008a**: Email MUST được xác minh: đăng ký xong hệ thống gửi liên kết xác minh dùng một lần, hết hạn
  sau 24 giờ, gửi lại tối đa 3 thư/giờ/email. Khi chưa xác minh, người dùng đăng nhập được nhưng chỉ dùng
  được các điểm cuối "tôi là ai", gửi lại thư xác minh, sửa email đăng ký và đăng xuất; mọi điểm cuối
  khách hàng khác MUST bị từ chối với lời giải thích "Hãy xác nhận email để tiếp tục" kèm nút "Gửi lại
  thư". Lớp chặn quyền MUST coi "email đã xác minh" là điều kiện mặc định của mọi điểm cuối khách hàng,
  trừ điểm cuối được khai báo rõ là dùng được khi chưa xác minh.
- **FR-008b**: Đăng ký với email đã có tài khoản MUST trả cùng phản hồi như đăng ký mới ("Hãy kiểm tra
  email để xác nhận"); hệ thống gửi thư tới email đó báo "đã có người dùng email này để đăng ký" kèm nút
  "Đăng nhập" / "Quên mật khẩu", không tạo tài khoản thứ hai, để không lộ email nào đã đăng ký.
- **FR-009**: Người dùng đang đăng nhập MUST đổi được mật khẩu khi nhập đúng mật khẩu hiện tại; đổi thành
  công MUST thu hồi mọi phiên khác của người dùng và gửi thư báo "mật khẩu vừa được thay đổi" (khi kênh
  email sẵn sàng).

**Phiên đăng nhập**

- **FR-010**: Đăng nhập thành công MUST tạo phiên lưu bền phía máy chủ, dùng được trên mọi bản API và
  sống qua khởi động lại. Mã phiên MUST ngẫu nhiên đủ mạnh, chỉ lưu dạng băm, giữ ở trình duyệt theo
  cách mã trang không đọc được và chỉ gửi qua kết nối mã hóa. Hạn mặc định (cấu hình được): khách hàng –
  hết hạn khi không hoạt động 14 ngày, tuyệt đối 30 ngày; nhân viên nội bộ – không hoạt động 30 phút,
  tuyệt đối 12 giờ. Phiên MUST được cấp mã mới khi đăng nhập (chống cố định phiên).
- **FR-011**: Người dùng MUST đăng xuất được ở thiết bị hiện tại và "khỏi mọi thiết bị". Thu hồi phiên,
  vô hiệu hóa người dùng/nhân viên, đổi vai trò/gỡ thành viên MUST có hiệu lực ở mọi bản API chậm nhất
  **60 giây** (giới hạn bộ nhớ đệm phiên + vai trò của kiến trúc dữ liệu); đăng xuất ở thiết bị hiện tại
  MUST có hiệu lực ngay trên bản API xử lý yêu cầu đó.
- **FR-012a**: Mọi yêu cầu làm thay đổi dữ liệu gửi kèm phiên MUST được chống giả mạo từ trang web khác
  (chỉ chấp nhận từ nguồn giao diện của ứng dụng).

**Vai trò & chặn quyền ở API**

- **FR-012**: Hệ thống MUST có 4 vai trò: `owner` (chủ), `collaborator` (cộng tác viên) trong một tài
  khoản khách hàng; `support` (hỗ trợ), `admin` (quản trị nội bộ) cho nhân viên. Quyền theo đặc tả mục 3,
  biểu diễn thành danh mục quyền có tên (danh mục là một phần giao diện công khai để module khác dùng):

  | Quyền | owner | collaborator | support | admin |
  |---|---|---|---|---|
  | Xem/sửa ngữ cảnh kinh doanh | ✔ | – | – | – |
  | Kết nối/ngắt kênh | ✔ | – | – | – |
  | Soạn, sửa bài; tải media | ✔ | ✔ | – | – |
  | Duyệt bài, lên lịch bài mới duyệt | ✔ | – | – | – |
  | Đổi giờ bài đã duyệt; đăng lại bài lỗi | ✔ | ✔ | – | – |
  | Xem trạng thái, nhật ký đăng, mức sử dụng (%) của tài khoản mình | ✔ | ✔ | – | – |
  | Quản lý thành viên, yêu cầu xóa tài khoản | ✔ | – | – | – |
  | Tra cứu nhật ký đăng và chi phí AI (số tiền) mọi tài khoản – qua đường hỗ trợ có kiểm toán | – | – | ✔ | ✔ |
  | Kích hoạt, gia hạn, tạm dừng gói | – | – | – | ✔ |
  | Quản lý nhân viên nội bộ | – | – | – | ✔ |

  "Xem nhật ký đăng" của cộng tác viên: đặc tả mục 3 ghi "xem trạng thái" – coi là gồm nhật ký đăng của
  tài khoản mình. Không vai trò nào xem được mã quyền truy cập nền tảng.
- **FR-013**: Mỗi điểm cuối API MUST khai báo rõ một trong: "công khai", "khách hàng + danh sách quyền",
  hoặc "nội bộ + danh sách quyền". Lớp chặn quyền dùng chung MUST kiểm tra trước khi chạy nghiệp vụ;
  điểm cuối không khai báo MUST bị từ chối mặc định, và kiểm tra tự động MUST báo lỗi trong CI khi có
  điểm cuối thiếu khai báo.
- **FR-014**: Với yêu cầu khách hàng đã qua chặn quyền, lớp xác thực MUST gắn mã tài khoản **lấy từ
  phiên** vào ngữ cảnh yêu cầu (điểm gắn duy nhất do 002 cung cấp) trước khi vào nghiệp vụ; MUST NOT
  đọc mã tài khoản từ đường dẫn, tham số, thân yêu cầu hay tiêu đề do người dùng gửi. Yêu cầu nội bộ MUST
  NOT được gắn mã tài khoản theo cách này; nhân viên chỉ truy cập dữ liệu khách hàng qua đường hỗ trợ có
  kiểm toán của lớp CSDL, với mã nhân viên lấy từ phiên.
- **FR-015**: Module nghiệp vụ MUST đọc được "người đang gọi" (mã người dùng hoặc mã nhân viên, loại,
  vai trò, mã tài khoản nếu có) qua giao diện công khai của lớp xác thực, không tự đọc dữ liệu phiên.
- **FR-016**: Đăng nhập của nhân viên nội bộ MUST đi qua lối vào riêng, chỉ tạo/vô hiệu hóa được bằng
  công cụ vận hành hoặc bởi `admin`, không có đăng ký công khai. Giai đoạn này nhân viên đăng nhập bằng
  email + mật khẩu, không có bước xác thực thứ hai (Clarifications Q2). Bù lại: hạn phiên ngắn theo FR-010,
  kiểm toán mọi đăng nhập/thao tác (FR-018), cùng ngưỡng chống dò, và lối vào nội bộ MUST giới hạn được
  theo danh sách dải địa chỉ mạng cho phép (cấu hình; để trống = không giới hạn). Thiết kế MUST không
  chặn việc thêm bước xác thực thứ hai sau này mà không đổi cấu trúc phiên.
- **FR-017**: Từ chối vì quyền MUST trả lỗi phân biệt được "chưa đăng nhập" và "không đủ quyền", kèm lời
  giải thích tiếng Việt đời thường và ít nhất một hành động khắc phục; mã lỗi gốc chỉ trong phần chi
  tiết cho hỗ trợ (nguyên tắc VI).

**Nhật ký, kiểm toán, bí mật**

- **FR-018**: Hệ thống MUST ghi nhật ký kiểm toán (mã người thực hiện, loại, hành động, kết quả, thời
  điểm, địa chỉ mạng, mã theo dõi) cho: đăng ký, đăng nhập thành công/thất bại, tạm chặn do dò mật khẩu,
  đăng xuất mọi thiết bị, đặt lại/đổi mật khẩu, thay đổi vai trò/thành viên, mọi đăng nhập và thao tác
  của nhân viên nội bộ. Bản ghi MUST NOT chứa mật khẩu, mã phiên, liên kết đặt lại.
- **FR-019**: Mật khẩu, băm mật khẩu, mã phiên, mã đặt lại MUST NOT xuất hiện trong nhật ký kỹ thuật, chỉ
  số, thông báo lỗi, phản hồi API hay khung nhìn hỗ trợ; kiểm tra quét bí mật trong nhật ký mẫu MUST bao
  gồm các loại này.
- **FR-020**: Mọi bảng của tính năng có mã tài khoản MUST tuân thủ cô lập tenant của 002 (bật chính sách
  bảo mật mức dòng, nằm trong bộ kiểm thử truy cập chéo). Thao tác trước khi có tenant (đăng ký, đăng
  nhập, tra phiên) MUST dùng đường truy cập hệ thống được kiểm soát, giới hạn ở đúng các bảng xác thực,
  và lý do MUST được ghi ở plan.
- **FR-021**: Thư viện xác thực MUST là mã nguồn mở cho TypeScript, cố định phiên bản, bọc sau giao diện
  nội bộ của module `account`, dữ liệu trong schema `account`, và MUST hỗ trợ sẵn đăng nhập Google,
  Facebook cùng liên kết nhiều cách đăng nhập cho một người dùng (T7) để tính năng sau không phải đổi
  thư viện. Lựa chọn cụ thể ghi lý do ở plan và cập nhật bảng công nghệ.

**Giao diện**

- **FR-022**: Giao diện MUST có màn hình đăng ký, đăng nhập (khách hàng) và đăng nhập nội bộ, tiếng Việt
  đời thường, hoạt động từ 360 px, vùng chạm ≥ 44 × 44 px, đạt WCAG 2.1 AA (nhãn trường, thông báo lỗi
  đọc được bằng trình đọc màn hình, không chỉ dựa vào màu), có nút hiện/ẩn mật khẩu, hỗ trợ trình quản
  lý mật khẩu tự điền. Ngoài ra MUST có: màn hình "Hãy xác nhận email" (gửi lại thư, sửa email), quên mật
  khẩu, đặt mật khẩu mới, đổi mật khẩu, đăng xuất khỏi mọi thiết bị.

### Key Entities *(include if feature involves data)*

- **Tài khoản khách hàng (`account.accounts`)**: tenant; trạng thái (hoạt động / đã yêu cầu xóa…), thời
  điểm tạo. Gói và chu kỳ sử dụng không thuộc tính năng này.
- **Người dùng (`account.users`)**: người dùng khách hàng; tên hiển thị, email đã chuẩn hóa (duy nhất),
  trạng thái (hoạt động / vô hiệu hóa), thời điểm và phiên bản điều khoản đã đồng ý.
- **Cách đăng nhập (`account.login_identities`)**: gắn với người dùng; nhà cung cấp (mật khẩu / Google /
  Facebook), mã phía nhà cung cấp (duy nhất theo cặp), băm mật khẩu với loại "mật khẩu".
- **Thành viên (`account.memberships`)**: (tài khoản, người dùng, vai trò owner/collaborator, trạng thái);
  đúng 1 chủ, ≤ 2 cộng tác viên mỗi tài khoản.
- **Nhân viên nội bộ**: danh tính tách khỏi người dùng khách hàng; email, tên, vai trò support/admin,
  trạng thái, (dữ liệu bước xác thực thứ hai nếu có).
- **Phiên đăng nhập**: thuộc một người dùng hoặc một nhân viên; băm mã phiên, thời điểm tạo, hoạt động
  gần nhất, hết hạn, thời điểm thu hồi, thông tin thiết bị tóm tắt (để "đăng xuất mọi thiết bị").
- **Mã đặt lại mật khẩu / mã xác minh email**: thuộc người dùng; mục đích, băm mã, email áp dụng (với mã
  xác minh), hết hạn, đã dùng lúc.
- **Hộp thư thử** (chỉ phát triển/thử nghiệm): nơi giao diện gửi thư ghi thư ra để kiểm thử đọc lại; không
  tồn tại ở môi trường chính thức.
- **Bộ đếm thử sai**: theo email và theo địa chỉ mạng trong cửa sổ thời gian, dùng cho FR-007.
- **Danh mục quyền**: danh sách quyền có tên và ánh xạ vai trò → quyền (FR-012), là mã nguồn/cấu hình,
  không phải dữ liệu khách hàng sửa được.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Người mới hoàn tất đăng ký (≤ 4 trường nhập + 1 ô đồng ý) trong ≤ 1 phút trên điện thoại
  4G; 95% thư xác minh và thư đặt lại mật khẩu được giao cho bên gửi thư trong ≤ 1 phút sau yêu cầu.
- **SC-002**: 95% lần đăng nhập đúng hoàn tất (từ bấm nút tới thấy màn hình đầu) trong ≤ 2 giây; kiểm
  tra phiên + quyền không làm mỗi yêu cầu API chậm thêm quá 20 ms ở p95.
- **SC-003**: Ma trận kiểm thử 5 trạng thái người gọi (chưa đăng nhập, owner, collaborator, support,
  admin) × mọi quyền trong danh mục cho kết quả khớp 100% bảng FR-012.
- **SC-004**: 0 điểm cuối API thiếu khai báo quyền lọt qua CI; 0 trường hợp mã tài khoản từ yêu cầu
  người dùng thay được mã tài khoản lấy từ phiên (kiểm bằng bộ kiểm thử truy cập chéo).
- **SC-005**: Thu hồi phiên/vai trò có hiệu lực ở mọi bản API trong ≤ 60 giây ở 100% lần thử; đăng xuất
  thiết bị hiện tại có hiệu lực ngay.
- **SC-006**: Thử 1.000 mật khẩu cho một email từ nhiều địa chỉ mạng → tối đa 5 lần thử được đánh giá
  mỗi 15 phút cho email đó; phản hồi cho email có/không tồn tại không phân biệt được (thông báo giống nhau,
  chênh lệch thời gian trung bình < 50 ms).
- **SC-007**: 0 mật khẩu, mã phiên, mã đặt lại xuất hiện trong nhật ký, chỉ số, phản hồi lỗi khi chạy toàn
  bộ bộ kiểm thử (quét nhật ký mẫu).
- **SC-008**: 100% lần đăng nhập và thao tác của nhân viên nội bộ có bản ghi kiểm toán tương ứng.
- **SC-009**: Màn hình đăng ký/đăng nhập đạt WCAG 2.1 AA khi kiểm bằng công cụ tự động và thao tác hết
  được chỉ bằng bàn phím/trình đọc màn hình.

## Assumptions

- **Phạm vi** là WBS 2.1 phần xác thực. **Ngoài phạm vi**: đăng nhập Google/Facebook và liên kết nhiều
  cách đăng nhập (WBS 2.1 "Facebook cơ bản" và 4.4 – tách tính năng riêng, chỉ cần mô hình dữ liệu sẵn
  sàng theo FR-003); mời/gỡ cộng tác viên cho người dùng cuối (4.4); gói dịch vụ, chu kỳ, hạn mức, chặn
  tính năng theo gói; yêu cầu xóa tài khoản (FR-14); màn hình quản trị gói; module Thông báo đầy đủ
  (tính năng này chỉ có giao diện gửi thư tối thiểu, gửi thẳng khi yêu cầu chứ không qua hàng chờ
  `notify`, trừ khi plan chọn khác và ghi lý do); bước xác thực thứ hai cho nhân viên nội bộ (MUST thêm
  vào danh sách việc trước khi ra mắt, cùng nhóm với rà soát bảo mật WBS 5.3). Tính năng chỉ cung cấp
  điểm cuối mẫu để kiểm thử ma trận quyền.
- Gửi thư chính thức qua SMTP (Amazon SES theo bảng công nghệ) là cấu hình; nếu SES chưa sẵn sàng ở môi
  trường thử nghiệm thì dùng hộp thư thử. Nội dung thư không chứa mật khẩu và không chứa số tiền AI.
- Người dùng chỉ dùng trình duyệt (giai đoạn 1 là ứng dụng web, không có ứng dụng di động riêng); vì vậy
  dùng phiên lưu phía máy chủ thay vì mã truy cập tự chứa, để thu hồi được trong ≤ 60 giây.
- Hạn phiên, ngưỡng chống dò, hạn liên kết đặt lại là giá trị mặc định theo thông lệ ngành, đổi được
  bằng cấu hình; không có yêu cầu cụ thể trong tài liệu.
- Bộ nhớ đệm phiên + vai trò trong tiến trình API tối đa 60 giây là quyết định đã có trong kiến trúc dữ
  liệu (chấp nhận gỡ cộng tác viên chậm ≤ 60 giây); đây là ngoại lệ hợp lệ của quy tắc "không cache quyền
  truy cập nền tảng" vì phiên không phải quyền truy cập nền tảng.
- Bộ đếm thử sai có thể đếm trong CSDL hoặc trong bộ nhớ mỗi bản API (kiến trúc triển khai mục 8 ghi giới
  hạn tốc độ đếm trong bộ nhớ của từng bản); nếu đếm trong bộ nhớ, ngưỡng hiệu lực nhân với số bản API –
  plan chọn và ghi lý do, nhưng SC-006 MUST đạt.
- Đường truy cập hệ thống cho thao tác chưa có tenant (FR-020) cần plan xác định rõ: dùng vai trò CSDL
  nào, có cần hàm được cấp quyền riêng hay không, và cập nhật Clarifications/kiến trúc nếu khác 002.
- Mã định danh tiếng Anh theo bảng ánh xạ: chủ / cộng tác viên / hỗ trợ / quản trị nội bộ → `owner` /
  `collaborator` / `support` / `admin`; liên kết đăng nhập → `login_identities`; thuật ngữ mới (phiên đăng
  nhập → `sessions`, nhân viên nội bộ → `staff_users`, mã đặt lại → `password_reset_tokens`, danh mục quyền
  → `permissions`) do plan chốt và ghi vào data-model.
