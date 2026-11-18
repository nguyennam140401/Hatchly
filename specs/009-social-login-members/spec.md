# Feature Specification: Tài khoản & đăng nhập đầy đủ – đăng nhập Google / Facebook, liên kết nhiều cách đăng nhập, xác nhận khi trùng email, mời / gỡ cộng tác viên

**Feature Branch**: `009-social-login-members`

**Created**: 2026-11-13

**Status**: Ready for implementation

**Input**: User description: "Dựa trên tài liệu nghiệp vụ và kiến trúc dự án trong @TaiLieuKienTruc, hãy tạo tài liệu nghiệp vụ tính năng Tài khoản & đăng nhập đầy đủ: đăng nhập Facebook / Google, liên kết nhiều cách đăng nhập, xác nhận khi trùng email, mời / gỡ cộng tác viên"

**Truy vết**: WBS T1 (Tài khoản & đăng nhập đầy đủ; phụ thuộc K4) · FR-15 (đăng nhập email + mật khẩu,
Google, Facebook; liên kết nhiều cách đăng nhập; không tự gộp khi trùng email; Facebook không trả email;
tách khỏi kết nối Page – FR-02) · Đặc tả yêu cầu mục 3 và 3.1 (quyền `members.manage`, 1 chủ + tối đa 2
cộng tác viên) · UI/UX mục 4 (bước 1 hành trình người mới), màn hình **Thành viên** (mục 8, bảng quyền
mục 9), U2 · Lựa chọn công nghệ T7 · Kiến trúc dữ liệu mục 9 (Google, Meta – dữ liệu nhận về) và mục
cache (phiên + vai trò ≤ 60 giây) · ADR-02, ADR-08 · Hiến pháp nguyên tắc I, VI, VII, VIII, IX.

**Phụ thuộc**: `004-minimal-auth-rbac` (đăng ký/đăng nhập email + mật khẩu, xác minh email, phiên, lớp
chặn quyền, mô hình "một người dùng – nhiều cách đăng nhập", ràng buộc 1 chủ + 2 cộng tác viên, giao
diện gửi thư tối thiểu, nhật ký kiểm toán) · `002-db-layer-tenant-rls` · P5 (đăng ký ứng dụng với Meta
và Google, trang chính sách quyền riêng tư & điều khoản).

**Bối cảnh**: Tính năng 004 đã cho đăng ký/đăng nhập bằng email + mật khẩu và chỉ có thao tác nội bộ
để thêm/gỡ thành viên. Tính năng này hoàn thiện phần còn lại của FR-15 cho **người dùng khách hàng**:
(1) vào ứng dụng bằng tài khoản Google hoặc Facebook; (2) một người dùng gắn được nhiều cách đăng nhập
và tự quản lý chúng; (3) khi tài khoản Google/Facebook có email trùng với người dùng đã có thì **không
tự gộp** mà phải xác nhận; (4) chủ tài khoản mời cộng tác viên qua email và gỡ họ khi cần. Nhân viên
nội bộ (hỗ trợ, quản trị) không thuộc phạm vi – vẫn chỉ đăng nhập bằng email + mật khẩu ở lối vào riêng.

## Clarifications

### Session 2026-11-13

- Q: Sau khi bị chủ tài khoản gỡ, cộng tác viên có được tự tạo tài khoản kinh doanh riêng bằng chính
  email đó không? → A: Được. Màn hình "Bạn không còn là thành viên của tài khoản nào" có nút "Tạo tài
  khoản kinh doanh của riêng tôi" (trở thành chủ một tài khoản mới), hoặc chờ lời mời mới (FR-027).
- Q: Lời mời đang chờ (chưa được chấp nhận) có tính vào giới hạn 2 cộng tác viên của tài khoản không?
  → A: Có. Cộng tác viên đang hoạt động + lời mời đang chờ ≤ 2; muốn mời người khác thì hủy lời mời cũ
  hoặc chờ nó hết hạn sau 7 ngày (FR-021).
- Q: Khi người được mời chọn tham gia bằng Google hoặc Facebook, tài khoản đó có bắt buộc phải có email
  trùng với email được mời không? → A: Bắt buộc trùng. Email khác thì từ chối kèm hướng dẫn; Facebook
  không trả email thì vẫn nhận, vì liên kết mời đã chứng minh người đó giữ email được mời (FR-022).
- Q: Việc xử lý thông báo từ Meta khi người dùng gỡ ứng dụng hoặc yêu cầu xóa dữ liệu ở phía Facebook
  có làm ngay trong tính năng này không? → A: Làm phần tối thiểu: nhận thông báo, gỡ cách đăng nhập
  Facebook của người đó, trả mã xác nhận và trang trạng thái cho Meta, ghi kiểm toán. Xóa toàn bộ dữ
  liệu tài khoản vẫn thuộc FR-14 (FR-009a).
- Q: Người dùng không còn thuộc tài khoản nào thì hệ thống giữ thông tin đăng nhập của họ (email, tên,
  các cách đăng nhập) trong bao lâu? → A: 90 ngày kể từ lúc không còn thuộc tài khoản nào, gửi email
  báo trước 7 ngày, rồi xóa. Tên người tạo trên bài cũ vẫn giữ theo quy tắc nhật ký 12 tháng (FR-028a).
- Q: Email do Facebook trả về có được coi là đã xác minh không? → A: Có (chủ sản phẩm chốt 2026-11-14,
  thay cho lựa chọn "luôn chưa xác minh" trước đó; research R3). Facebook chỉ trả email mà người dùng đã
  xác nhận với Facebook, nên email Facebook có trả về được xử lý như email Google đã xác minh: người mới
  vào ngay, trùng email thì hiện màn hình xác nhận. Khi Facebook **không** trả email, hoặc Google ghi
  rõ email chưa xác minh, người dùng tự nhập email và phải xác minh qua thư; màn hình khi đó luôn là
  "Hãy kiểm tra email" dù email đã có người dùng hay chưa (FR-004, FR-010a).
- Q: Có cho đăng nhập bằng số điện thoại không? → A: Chưa. Để sau, thành một tính năng riêng (cần dịch
  vụ gửi mã OTP); ngoài phạm vi 009.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Vào ứng dụng bằng tài khoản Google hoặc Facebook (Priority: P1)

Chủ kinh doanh mở màn hình đăng nhập trên điện thoại, bấm "Tiếp tục với Google" hoặc "Tiếp tục với
Facebook", đồng ý ở màn hình của nhà cung cấp rồi quay lại ứng dụng. Nếu đây là lần đầu và email chưa có
trong hệ thống, ứng dụng hiện bước xác nhận ngắn (tên hiển thị lấy sẵn từ nhà cung cấp, ô đồng ý điều
khoản **không đặt sẵn**); bấm "Tạo tài khoản" thì có ngay tài khoản khách hàng mới với vai trò chủ và vào
màn hình đầu tiên, không phải đặt mật khẩu. Những lần sau, bấm nút là vào thẳng.

**Why this priority**: Đây là yêu cầu chính của FR-15 và là bước 1 của hành trình "người mới bắt đầu
nhanh" (≤ 15 phút đến kế hoạch tuần đầu); người dùng mục tiêu quen dùng Facebook/Google hơn là nhớ thêm
mật khẩu.

**Independent Test**: Dùng nhà cung cấp đăng nhập giả lập: đăng nhập bằng một tài khoản Google có email
chưa tồn tại → sau bước đồng ý có đúng 1 tài khoản khách hàng, 1 người dùng, 1 vai trò chủ, 1 cách đăng
nhập "Google"; đăng xuất rồi đăng nhập lại bằng Google → vào đúng tài khoản đó, không tạo thêm gì.

**Acceptance Scenarios**:

1. **Given** tài khoản Google có email đã được Google xác nhận, hoặc tài khoản Facebook có trả email, và
   email đó chưa có trong hệ thống, **When** người dùng hoàn tất đăng nhập ở nhà cung cấp và tích ô đồng
   ý điều khoản, **Then** hệ thống tạo cùng lúc tài khoản khách hàng, người dùng, vai trò chủ và cách
   đăng nhập tương ứng; email được coi là đã xác minh; thời điểm và phiên bản điều khoản đã đồng ý được
   ghi lại; người dùng được đăng nhập.
2. **Given** người dùng đã có cách đăng nhập "Google" gắn với tài khoản Google đó, **When** đăng nhập
   bằng Google, **Then** vào thẳng tài khoản của mình với đúng vai trò hiện tại, không hỏi lại điều khoản.
3. **Given** người dùng chưa tích ô đồng ý hoặc đóng trình duyệt ở bước xác nhận, **When** quay lại sau,
   **Then** chưa có tài khoản, người dùng hay cách đăng nhập nào được tạo.
4. **Given** đăng nhập Facebook lần đầu mà Facebook **không trả email** (người dùng đăng ký Facebook bằng
   số điện thoại hoặc từ chối chia sẻ email), **When** quay về ứng dụng, **Then** ứng dụng hiện bước nhập
   email, tên và ô đồng ý, rồi gửi thư và hiện "Hãy kiểm tra email"; chỉ sau khi bấm liên kết trong thư
   mới có tài khoản và người dùng mới vào được ứng dụng. Nếu email tự nhập trùng người dùng đã có, màn
   hình vẫn giống hệt; thư gửi đi là thư xác nhận liên kết, bấm vào thì Facebook được gắn vào người dùng
   đã có (FR-010a).
5. **Given** người dùng bấm "Hủy" ở màn hình của nhà cung cấp, từ chối chia sẻ thông tin, hoặc nhà cung
   cấp gặp sự cố, **When** quay lại ứng dụng, **Then** thấy thông báo tiếng Việt đời thường ("Bạn chưa
   hoàn tất đăng nhập bằng Facebook") kèm nút "Thử lại" và "Đăng nhập bằng email"; không có dữ liệu nào
   được tạo.
6. **Given** người dùng đăng nhập bằng Facebook, **When** xem màn hình cấp quyền của Facebook, **Then**
   ứng dụng chỉ xin thông tin cơ bản (tên, email); không xin quyền quản lý Page. Sau khi vào ứng dụng,
   **không** có Page nào được tự kết nối – kết nối kênh vẫn là bước riêng (FR-02).
7. **Given** đăng nhập Google/Facebook thành công, **When** tra dữ liệu và nhật ký, **Then** hệ thống chỉ
   lưu mã người dùng phía nhà cung cấp, email và tên hiển thị; không lưu mã quyền truy cập của lần đăng
   nhập; không có mã bí mật nào trong nhật ký.

---

### User Story 2 - Email trùng với người dùng đã có: xác nhận trước khi liên kết, không tự gộp (Priority: P1)

Chị Lan đã đăng ký bằng email + mật khẩu. Hôm sau chị bấm "Tiếp tục với Google" bằng tài khoản Google có
cùng email. Ứng dụng **không** tự cho vào và cũng **không** tạo tài khoản thứ hai, mà hiện màn hình "Email
này đã có tài khoản. Hãy xác nhận đây là bạn để dùng Google cho những lần sau" với hai cách: nhập mật
khẩu hiện tại, hoặc nhận liên kết xác nhận qua email. Xác nhận xong, Google được gắn vào người dùng của
chị và chị vào ứng dụng; từ đó đăng nhập cách nào cũng vào cùng một tài khoản.

**Why this priority**: Là tiêu chí chấp nhận bắt buộc của FR-15 và hiến pháp VII ("MUST xác nhận trước
khi liên kết, không tự gộp"). Tự gộp theo email cho phép người khác chiếm tài khoản – và quyền đăng bài
lên Page của khách hàng.

**Independent Test**: Tạo người dùng bằng email + mật khẩu; đăng nhập bằng Google giả lập có cùng email →
không được đăng nhập, không có người dùng thứ hai; nhập đúng mật khẩu → người dùng có 2 cách đăng nhập và
được đăng nhập; lặp lại với đường "xác nhận qua email" cho kết quả tương đương.

**Acceptance Scenarios**:

1. **Given** người dùng đã có (email đã xác minh, có mật khẩu) và một tài khoản Google (email đã được
   Google xác minh) hoặc Facebook (có trả email) cùng email chưa được liên kết, **When** đăng nhập bằng
   tài khoản đó, **Then** không tạo phiên đăng nhập, không tạo người dùng mới; hiện màn hình xác nhận với
   hai lựa chọn "Nhập mật khẩu" và "Gửi liên kết qua email". Với email người dùng tự nhập (Facebook
   không trả email) hoặc email Google chưa xác minh: không hiện màn hình này mà xác nhận qua thư theo
   FR-010a.
2. **Given** màn hình xác nhận, **When** nhập đúng mật khẩu, **Then** cách đăng nhập mới được gắn vào
   người dùng đã có, người dùng được đăng nhập và nhận email "Tài khoản của bạn vừa được thêm cách đăng
   nhập bằng Google" kèm hướng dẫn nếu không phải họ làm.
3. **Given** màn hình xác nhận, **When** nhập sai mật khẩu, **Then** không liên kết; lần sai được tính vào
   ngưỡng chống dò mật khẩu của 004 (cùng bộ đếm với đăng nhập).
4. **Given** người dùng chọn "Gửi liên kết qua email", **When** mở liên kết còn hạn (dùng một lần, 30
   phút), **Then** cách đăng nhập được liên kết và người dùng được đăng nhập; liên kết đã dùng, quá hạn
   hoặc đã có liên kết mới hơn → bị từ chối kèm nút "Gửi lại".
5. **Given** người dùng đã có chỉ đăng nhập bằng Facebook (không có mật khẩu), **When** đăng nhập bằng
   Google cùng email, **Then** màn hình xác nhận chỉ có lựa chọn "Gửi liên kết qua email" và gợi ý "hoặc
   đăng nhập bằng Facebook rồi thêm Google trong Cài đặt".
6. **Given** người dùng đã có nhưng **email chưa xác minh** (ai đó đã đăng ký bằng email này mà chưa từng
   bấm thư xác minh), **When** chủ thật của email đăng nhập bằng Google/Facebook cùng email, **Then** chỉ
   cho xác nhận qua email; xác nhận xong, mật khẩu cũ bị gỡ, mọi phiên cũ bị thu hồi, email được đánh dấu
   đã xác minh – người đặt mật khẩu trước đó không còn vào được.
7. **Given** người dùng bỏ dở màn hình xác nhận, **When** quay lại sau, **Then** không có liên kết nào
   được tạo; đăng nhập bằng cách cũ vẫn bình thường.
8. **Given** email trùng thuộc về một **nhân viên nội bộ**, **When** đăng nhập Google/Facebook ở lối vào
   khách hàng, **Then** xử lý như email chưa có người dùng khách hàng (hai nhóm danh tính tách biệt, không
   liên kết chéo).

---

### User Story 3 - Chủ tài khoản mời cộng tác viên qua email (Priority: P1)

Chủ tài khoản mở Cài đặt → **Thành viên**, thấy danh sách (mình là "Chủ tài khoản", các cộng tác viên, lời
mời đang chờ) và dòng "Còn 2/2 chỗ cộng tác viên". Chủ nhập email của nhân viên, bấm "Mời". Người được mời
nhận thư có tên cửa hàng/người mời và nút "Tham gia"; bấm vào, chọn đặt mật khẩu hoặc tiếp tục với
Google/Facebook, tích ô đồng ý điều khoản, và vào ứng dụng với vai trò cộng tác viên – soạn/sửa bài, tải
media được, nhưng không duyệt và không kết nối kênh.

**Why this priority**: Luồng "cộng tác viên soạn – chủ duyệt trên điện thoại" (UI/UX F3) là giá trị cốt
lõi của sản phẩm; hiện chưa có cách nào để khách hàng tự thêm cộng tác viên.

**Independent Test**: Chủ gửi lời mời tới email mới → hộp thư thử có đúng 1 thư mời; mở liên kết, đặt tên
và mật khẩu → người mới đăng nhập được, API "tôi là ai" trả vai trò cộng tác viên của đúng tài khoản đã
mời; gọi API cần quyền duyệt → bị từ chối; danh sách Thành viên của chủ hiện người mới.

**Acceptance Scenarios**:

1. **Given** chủ tài khoản còn chỗ trống, **When** nhập email hợp lệ và bấm "Mời", **Then** lời mời ở
   trạng thái "Đang chờ" hiện trong danh sách kèm ngày hết hạn; thư mời được gửi; lời mời chiếm 1 chỗ.
2. **Given** người được mời chưa có người dùng trong hệ thống, **When** mở liên kết còn hạn, nhập tên hiển
   thị + mật khẩu đạt chính sách và tích ô đồng ý, **Then** người dùng được tạo với email của lời mời (coi
   là đã xác minh vì đã mở liên kết gửi tới email đó), trở thành cộng tác viên của tài khoản, được đăng
   nhập; lời mời chuyển "Đã chấp nhận" và không dùng lại được.
3. **Given** người được mời chọn "Tiếp tục với Google/Facebook" ở màn hình tham gia, **When** tài khoản
   Google/Facebook có email trùng email được mời (hoặc Facebook không trả email), **Then** người dùng được
   tạo với cách đăng nhập đó và trở thành cộng tác viên; nếu email của tài khoản Google/Facebook **khác**
   email được mời → bị từ chối với hướng dẫn "Hãy dùng tài khoản có email … hoặc nhờ chủ tài khoản mời lại
   bằng email này".
4. **Given** tổng số cộng tác viên đang hoạt động + lời mời đang chờ đã là 2, **When** chủ mở màn hình
   Thành viên, **Then** nút "Mời" bị khóa kèm lời giải thích "Đã đủ 2 cộng tác viên. Gỡ một người hoặc hủy
   một lời mời để mời người khác"; gọi thẳng API mời cũng bị từ chối.
5. **Given** hai lời mời/lượt chấp nhận xảy ra đồng thời khi chỉ còn 1 chỗ, **When** cả hai được xử lý,
   **Then** đúng một cái thành công; tài khoản không bao giờ có quá 2 cộng tác viên.
6. **Given** lời mời đang chờ, **When** chủ bấm "Gửi lại", **Then** thư mới được gửi, liên kết cũ hết hiệu
   lực, hạn được tính lại; **When** chủ bấm "Hủy lời mời", **Then** liên kết hết hiệu lực ngay và chỗ được
   trả lại.
7. **Given** lời mời đã quá 7 ngày, đã bị hủy, hoặc đã được chấp nhận, **When** mở liên kết, **Then** thấy
   thông báo "Lời mời không còn hiệu lực" kèm gợi ý "Nhờ chủ tài khoản gửi lại lời mời"; không có dữ liệu
   nào được tạo. Lời mời quá hạn tự trả lại chỗ.
8. **Given** email được mời đã thuộc một người dùng đang là chủ hoặc cộng tác viên của một tài khoản (kể
   cả chính tài khoản này), **When** chủ bấm "Mời", **Then** màn hình của chủ phản hồi giống hệt lời mời
   bình thường (không lộ email đó đã có tài khoản hay chưa); người nhận thư mở liên kết sẽ thấy "Email này
   đang dùng cho một tài khoản khác nên chưa tham gia được" kèm cách khắc phục (dùng email khác).
9. **Given** cộng tác viên đã đăng nhập, **When** mở màn hình Thành viên hoặc gọi API mời/gỡ/xem danh
   sách, **Then** bị từ chối "Chỉ chủ tài khoản mới quản lý được thành viên".
10. **Given** lời mời được chấp nhận, **When** chủ mở ứng dụng, **Then** chủ nhận email báo "… đã tham gia
    với vai trò cộng tác viên" và danh sách Thành viên cập nhật.

---

### User Story 4 - Chủ tài khoản gỡ cộng tác viên (Priority: P2)

Nhân viên nghỉ việc. Chủ mở Thành viên, bấm "Gỡ" cạnh tên người đó, đọc hộp xác nhận ("… sẽ không vào
được tài khoản này nữa. Bài và media họ đã tạo vẫn được giữ lại") và bấm đồng ý. Người bị gỡ mất quyền
truy cập gần như ngay, chỗ trống được trả lại để mời người khác.

**Why this priority**: Bắt buộc để chủ kiểm soát ai được đụng vào nội dung sẽ đăng lên Page của mình;
đứng sau P1 vì phải có mời trước mới có gỡ.

**Independent Test**: Với tài khoản có 1 cộng tác viên đang đăng nhập: chủ gỡ → trong ≤ 60 giây mọi lời
gọi API của cộng tác viên bị từ chối; danh sách hiện "Còn 2/2 chỗ"; bài cộng tác viên đã soạn vẫn còn
trong tài khoản.

**Acceptance Scenarios**:

1. **Given** cộng tác viên đang hoạt động, **When** chủ xác nhận gỡ, **Then** vai trò của người đó trong
   tài khoản kết thúc, mọi phiên của họ bị thu hồi, hiệu lực ở mọi nơi chậm nhất 60 giây; chỗ được trả lại.
2. **Given** cộng tác viên vừa bị gỡ, **When** tra dữ liệu tài khoản, **Then** bài, media, lịch sử duyệt/
   đăng do người đó tạo vẫn nguyên, vẫn hiện tên người tạo; việc nền đang chạy cho các bài đó không bị ảnh
   hưởng.
3. **Given** người bị gỡ, **When** đăng nhập lại, **Then** thấy màn hình "Bạn không còn là thành viên của
   tài khoản nào" với hai hành động: "Tạo tài khoản kinh doanh của riêng tôi" (trở thành chủ một tài khoản
   mới) hoặc chờ lời mời mới; không thấy bất kỳ dữ liệu nào của tài khoản cũ.
4. **Given** người bị gỡ, **When** chủ (của tài khoản cũ hoặc tài khoản khác) mời lại email đó và họ chấp
   nhận, **Then** họ đăng nhập bằng cách đăng nhập sẵn có và trở thành cộng tác viên, không phải tạo người
   dùng mới.
5. **Given** chủ tài khoản, **When** thử gỡ chính mình hoặc gỡ người không thuộc tài khoản của mình,
   **Then** bị từ chối; tài khoản luôn có đúng 1 chủ.
6. **Given** gỡ thành công, **When** xong, **Then** người bị gỡ nhận email báo đã bị gỡ khỏi tài khoản
   (nêu tên cửa hàng, không nêu lý do); nhật ký kiểm toán có bản ghi ai gỡ ai, khi nào.

---

### User Story 5 - Tự quản lý các cách đăng nhập của mình (Priority: P2)

Người dùng đã đăng nhập mở Cài đặt → **Cách đăng nhập**, thấy ba dòng: Email + mật khẩu, Google, Facebook,
mỗi dòng ghi "Đã liên kết" (kèm email/tên tài khoản phía nhà cung cấp) hoặc nút "Liên kết". Họ thêm được
cách còn thiếu, gỡ được cách không dùng nữa miễn là còn ít nhất một cách để vào, và người chỉ dùng
Google/Facebook có thể "Tạo mật khẩu" để có đường dự phòng.

**Why this priority**: Hoàn tất tiêu chí "một người dùng liên kết được nhiều cách đăng nhập" của FR-15 và
giảm yêu cầu hỗ trợ khi người dùng mất quyền vào Facebook/Google; không chặn luồng P1.

**Independent Test**: Người dùng có mật khẩu liên kết thêm Google → đăng xuất, đăng nhập bằng Google vào
đúng tài khoản; gỡ Google → đăng nhập bằng Google không còn vào được tài khoản đó; thử gỡ cách đăng nhập
cuối cùng → bị từ chối.

**Acceptance Scenarios**:

1. **Given** người dùng đang đăng nhập và vừa xác nhận lại danh tính trong 10 phút gần nhất (FR-012),
   **When** bấm "Liên kết Google" và hoàn tất ở Google, **Then** Google được gắn vào người dùng dù email
   Google khác email của người dùng; email đăng nhập chính của người dùng không đổi; người dùng nhận email
   thông báo bảo mật.
2. **Given** tài khoản Google/Facebook đó đã gắn với **người dùng khác**, **When** liên kết, **Then** bị
   từ chối với lời giải thích "Tài khoản Google này đang dùng cho một tài khoản khác"; không chuyển, không
   gộp.
3. **Given** người dùng có từ 2 cách đăng nhập trở lên, **When** gỡ một cách (sau khi xác nhận lại danh
   tính), **Then** cách đó không còn dùng để vào được; các phiên hiện có vẫn giữ; có email thông báo bảo
   mật.
4. **Given** người dùng chỉ còn 1 cách đăng nhập, **When** thử gỡ, **Then** bị từ chối với hướng dẫn "Hãy
   thêm cách đăng nhập khác trước khi gỡ".
5. **Given** người dùng chỉ đăng nhập bằng Google/Facebook, **When** bấm "Tạo mật khẩu", **Then** hệ thống
   gửi liên kết đặt mật khẩu tới email của người dùng (cùng quy tắc với đặt lại mật khẩu của 004); đặt xong
   thì đăng nhập được bằng email + mật khẩu.
6. **Given** người dùng chỉ đăng nhập bằng Google/Facebook bấm "Quên mật khẩu" ở màn hình đăng nhập,
   **When** mở liên kết trong thư, **Then** đặt được mật khẩu như trên (phản hồi màn hình vẫn giống hệt mọi
   email khác, không lộ email có tài khoản hay không).
7. **Given** cộng tác viên, **When** mở Cách đăng nhập, **Then** dùng được đầy đủ như chủ (đây là thiết
   lập của cá nhân, không phải của tài khoản khách hàng).

---

### Edge Cases

- Người dùng bấm quay lại, mở hai thẻ, hoặc dùng lại đường dẫn quay về từ nhà cung cấp lần thứ hai → lần
  thứ hai bị từ chối an toàn, đưa về màn hình đăng nhập; không tạo trùng người dùng hay cách đăng nhập.
- Yêu cầu quay về từ nhà cung cấp không khớp với lượt đăng nhập đã bắt đầu trên cùng trình duyệt (giả
  mạo, quá hạn 10 phút) → bị từ chối, có bản ghi kiểm toán.
- Hai lần đăng nhập lần đầu bằng cùng một tài khoản Google gửi đồng thời → đúng một người dùng được tạo.
- Người dùng đổi email ở phía Google/Facebook sau khi đã liên kết → vẫn đăng nhập được (nhận diện theo mã
  người dùng phía nhà cung cấp, không theo email); email trong ứng dụng không tự đổi.
- Google trả email nhưng ghi rõ **chưa xác nhận** → coi như chưa có email đáng tin: yêu cầu xác minh qua
  thư trước khi dùng, và không dùng email đó làm căn cứ liên kết.
- Người dùng thu hồi quyền của ứng dụng ở phía Google → lần đăng nhập sau Google hỏi lại quyền; cách
  đăng nhập khác (nếu có) không bị ảnh hưởng. Ở phía Facebook → Meta gửi thông báo, cách đăng nhập
  Facebook bị gỡ (FR-009a); người dùng đăng nhập Facebook lại sau đó thì đi qua luồng trùng email như
  một tài khoản Facebook chưa liên kết.
- Thông báo của Meta đến cho người dùng mà Facebook là cách đăng nhập duy nhất → cách đó vẫn bị gỡ, người
  dùng và dữ liệu tài khoản giữ nguyên; email thông báo hướng dẫn vào lại bằng "Quên mật khẩu".
- Người dùng bị vô hiệu hóa hoặc tài khoản đã yêu cầu xóa (FR-14) đăng nhập bằng Google/Facebook → bị từ
  chối như với mật khẩu; không tạo người dùng mới thay thế.
- Tài khoản bị tạm dừng/hết hạn gói → vẫn đăng nhập, vẫn quản lý cách đăng nhập và thành viên được (chặn
  theo gói thuộc tính năng gói dịch vụ).
- Người đang đăng nhập (ở tài khoản khác hoặc chính tài khoản đó) mở liên kết mời → nếu người đó đang là
  chủ/cộng tác viên của một tài khoản thì báo "Bạn đang thuộc một tài khoản khác" kèm cách khắc phục; nếu
  email phiên đang đăng nhập khác email được mời thì đề nghị đăng xuất và mở lại liên kết.
- Chủ mời chính email của mình, hoặc mời lại email đang có lời mời chờ → trường hợp đầu bị từ chối có giải
  thích; trường hợp sau coi như "Gửi lại", không chiếm thêm chỗ.
- Chủ gỡ cộng tác viên đúng lúc người đó đang lưu bài → thao tác đã vào trước thời điểm gỡ có hiệu lực vẫn
  hoàn tất; sau đó mọi yêu cầu bị từ chối.
- Lời mời đang chờ khi tài khoản bị yêu cầu xóa → mọi lời mời hết hiệu lực ngay.
- Gửi quá nhiều thư mời/thư xác nhận tới một email → giới hạn theo FR-020; không làm lộ email có tồn tại.
- Người không thuộc tài khoản nào chấp nhận lời mời hoặc tạo tài khoản riêng ở ngày thứ 89 → không bị
  xóa; thư báo trước đã gửi không còn hiệu lực. Lời mời đang chờ gửi tới email của họ **không** làm dừng
  mốc 90 ngày – chỉ việc chấp nhận mới dừng.
- Việc xóa định kỳ chạy hai lần hoặc bị ngắt giữa chừng → không xóa nhầm người vừa tham gia lại, không
  gửi trùng thư báo trước.
- Người bị gỡ chọn "Tạo tài khoản kinh doanh của riêng tôi" rồi lại được mời → áp dụng quy tắc "một người
  dùng thuộc đúng một tài khoản": không chấp nhận được lời mời.
- Email trùng một người dùng **đã liên kết sẵn một tài khoản khác của cùng nhà cung cấp** (vd đã gắn
  Facebook A, nay đăng nhập bằng Facebook B cùng email) → không liên kết được (mỗi loại tối đa một –
  FR-014): email do nhà cung cấp xác minh thì báo "Email này đã liên kết với một tài khoản Facebook khác"
  kèm nút đăng nhập bằng cách vẫn dùng; email tự nhập thì màn hình vẫn là "Hãy kiểm tra email" và người
  dùng đã có nhận thư thông tin (không có liên kết) báo có người vừa thử đăng nhập.
- Xoay phiên (tạo tài khoản riêng, tham gia lại qua lời mời) không được tính là xác nhận lại danh tính
  (FR-012): phiên mới giữ mốc xác nhận của phiên cũ.

## Requirements *(mandatory)*

### Functional Requirements

**Đăng nhập bằng Google / Facebook**

- **FR-001**: Màn hình đăng nhập và đăng ký của khách hàng MUST có hai lựa chọn "Tiếp tục với Google" và
  "Tiếp tục với Facebook" bên cạnh email + mật khẩu. Lối vào nhân viên nội bộ MUST NOT có hai lựa chọn này.
- **FR-002**: Người dùng được nhận diện theo cặp (nhà cung cấp, mã người dùng phía nhà cung cấp); cặp này
  MUST duy nhất trong toàn hệ thống. Email do nhà cung cấp trả về MUST NOT được dùng để tự đăng nhập vào
  người dùng đã có.
- **FR-003**: Đăng nhập lần đầu bằng Google/Facebook với email chưa có người dùng MUST chỉ tạo dữ liệu sau
  khi người dùng xác nhận tên hiển thị và tích ô đồng ý điều khoản (ô MUST NOT đặt sẵn); khi đó tạo trong
  **một thao tác nguyên vẹn**: tài khoản khách hàng, người dùng, vai trò chủ, cách đăng nhập tương ứng,
  thời điểm + phiên bản điều khoản đã đồng ý.
- **FR-004**: Email do nhà cung cấp trả về kèm xác nhận "đã được xác minh" MUST được coi là đã xác minh
  trong ứng dụng: với Google là khi Google khẳng định email đã xác minh; với Facebook là mọi email
  Facebook có trả về (Facebook chỉ trả email người dùng đã xác nhận). Nếu nhà cung cấp không trả email
  hoặc trả email chưa xác minh, hệ thống MUST yêu cầu người dùng nhập/xác nhận email và xác minh qua thư
  theo quy tắc xác minh email của 004; khi đó tài khoản và người dùng MUST chỉ được tạo sau khi liên kết
  trong thư được mở. Email đã xác minh theo quy tắc này vẫn MUST NOT là căn cứ để tự liên kết (FR-010).
- **FR-005**: Đăng nhập Facebook MUST chỉ xin thông tin cơ bản (tên, email) và MUST tách biệt hoàn toàn
  với kết nối Page để đăng bài (FR-02): đăng nhập không tạo kết nối kênh nào; ngắt kết nối kênh không ảnh
  hưởng cách đăng nhập và ngược lại.
- **FR-006**: Hệ thống MUST chỉ lưu từ nhà cung cấp: mã người dùng phía nhà cung cấp, email, tên hiển thị.
  MUST NOT lưu mã quyền truy cập của lần đăng nhập, ảnh đại diện, danh sách bạn bè hay dữ liệu khác; MUST
  NOT gửi dữ liệu khách hàng nào tới nhà cung cấp ngoài những gì giao thức đăng nhập bắt buộc.
- **FR-007**: Mỗi lượt đăng nhập qua nhà cung cấp MUST gắn với đúng trình duyệt đã bắt đầu nó, dùng một
  lần, hết hạn sau 10 phút; yêu cầu quay về không khớp, lặp lại hoặc quá hạn MUST bị từ chối. Phần giao
  thức và mật mã MUST do thư viện mã nguồn mở đã kiểm chứng đảm nhận (hiến pháp VII).
- **FR-008**: Phiên tạo ra sau khi đăng nhập bằng Google/Facebook MUST tuân theo đúng mọi quy tắc phiên
  của 004 (hạn, thu hồi, đăng xuất mọi thiết bị, chống giả mạo yêu cầu); người dùng bị vô hiệu hóa hoặc
  thuộc tài khoản đã yêu cầu xóa MUST NOT đăng nhập được bằng bất kỳ cách nào.
- **FR-009**: Khi người dùng hủy, từ chối quyền hoặc nhà cung cấp lỗi, hệ thống MUST hiện thông báo tiếng
  Việt đời thường kèm ít nhất một hành động khắc phục (thử lại, đăng nhập bằng email); mã lỗi gốc chỉ nằm
  trong "Chi tiết cho hỗ trợ". Sự cố của một nhà cung cấp MUST NOT ảnh hưởng các cách đăng nhập khác.
- **FR-009a**: Hệ thống MUST nhận thông báo của Meta khi người dùng gỡ ứng dụng hoặc yêu cầu xóa dữ liệu
  ở phía Facebook. Với thông báo đã kiểm tra là thật sự do Meta gửi, hệ thống MUST: gỡ cách đăng nhập
  Facebook của người dùng tương ứng (xóa mã người dùng, email, tên phía Facebook đã lưu); trả cho Meta
  một mã xác nhận và địa chỉ trang trạng thái công khai, trang này chỉ hiện trạng thái xử lý theo mã,
  không hiện dữ liệu cá nhân; ghi kiểm toán; gửi email thông báo bảo mật cho người dùng (FR-013). Thông
  báo không kiểm tra được nguồn MUST bị từ chối; thông báo lặp lại hoặc cho người dùng không tồn tại
  MUST được trả lời thành công mà không có tác dụng phụ. Thao tác này MUST NOT xóa người dùng, vai trò
  thành viên, bài, media hay kết nối kênh – xóa toàn bộ dữ liệu là FR-14. Nếu Facebook là cách đăng
  nhập cuối cùng, cách đó vẫn bị gỡ và người dùng vào lại bằng "Quên mật khẩu" (FR-017).

**Trùng email – xác nhận trước khi liên kết**

- **FR-010**: Khi tài khoản Google/Facebook chưa liên kết có email (đã chuẩn hóa) trùng với một người dùng
  khách hàng đã có, hệ thống MUST NOT tạo phiên, MUST NOT tạo người dùng mới và MUST NOT tự liên kết; MUST
  yêu cầu xác nhận quyền sở hữu bằng một trong hai cách: (a) mật khẩu hiện tại của người dùng đó, hoặc (b)
  liên kết gửi tới email đó (dùng một lần, hết hạn 30 phút, liên kết mới vô hiệu liên kết cũ). Chỉ sau khi
  xác nhận thành công mới liên kết và đăng nhập. Màn hình báo trùng với hai cách (a)/(b) MUST chỉ hiện
  khi email đã được nhà cung cấp xác minh.
- **FR-010a**: Khi email chưa được nhà cung cấp xác minh (email người dùng tự nhập vì Facebook không trả
  email, email Google ghi rõ chưa xác minh), hệ thống MUST phản hồi giống hệt nhau ("Hãy kiểm tra email") dù email đó đã có người dùng hay
  chưa, và MUST chỉ cho cách (b). Thư gửi đi là thư hoàn tất đăng ký (email chưa có người dùng, liên kết
  hạn 24 giờ) hoặc thư xác nhận liên kết (email đã có người dùng, hạn 30 phút).
- **FR-011**: Cách (a) MUST chỉ được đưa ra khi người dùng đã có có mật khẩu **và** email đã xác minh; nhập
  sai MUST tính vào ngưỡng chống dò mật khẩu của 004. Nếu email của người dùng đã có **chưa xác minh**, hệ
  thống MUST chỉ cho cách (b); khi xác nhận thành công MUST gỡ mật khẩu đã đặt trước đó, thu hồi mọi phiên
  cũ và đánh dấu email đã xác minh.
- **FR-012**: Liên kết thêm, gỡ cách đăng nhập và tạo mật khẩu từ Cài đặt MUST yêu cầu người dùng đã xác
  nhận lại danh tính trong 10 phút gần nhất (nhập mật khẩu, hoặc đăng nhập lại bằng một cách đã liên kết).
- **FR-013**: Sau mỗi lần thêm hoặc gỡ cách đăng nhập (kể cả qua luồng trùng email), người dùng MUST nhận
  email thông báo bảo mật nêu cách đăng nhập nào, lúc nào, kèm hướng dẫn nếu không phải họ làm. Thư MUST NOT
  chứa mã bí mật.

**Quản lý cách đăng nhập**

- **FR-014**: Người dùng khách hàng (chủ và cộng tác viên) MUST xem được danh sách cách đăng nhập của mình
  (loại, email/tên phía nhà cung cấp, ngày liên kết) và MUST liên kết thêm được mỗi loại tối đa một: mật
  khẩu, Google, Facebook. Liên kết từ Cài đặt MUST cho phép email phía nhà cung cấp khác email của người
  dùng; email đăng nhập chính MUST NOT tự đổi.
- **FR-015**: Liên kết MUST bị từ chối nếu tài khoản Google/Facebook đó đã gắn với người dùng khác; hệ
  thống MUST NOT chuyển hay gộp người dùng.
- **FR-016**: Người dùng MUST gỡ được một cách đăng nhập khi còn ít nhất một cách khác dùng được; gỡ cách
  cuối cùng MUST bị từ chối kể cả khi hai yêu cầu gỡ gửi đồng thời. Ngoại lệ duy nhất: gỡ theo thông báo
  của Meta (FR-009a).
- **FR-017**: Người dùng chưa có mật khẩu MUST tạo được mật khẩu qua liên kết gửi tới email đã xác minh
  của mình (cùng chính sách mật khẩu, hạn liên kết và giới hạn thư như đặt lại mật khẩu của 004); "Quên mật
  khẩu" MUST hoạt động cho người dùng chưa có mật khẩu với phản hồi không phân biệt được.

**Mời cộng tác viên**

- **FR-018**: Chỉ người có quyền `members.manage` (chủ tài khoản) MUST xem được danh sách thành viên, mời,
  gửi lại, hủy lời mời và gỡ cộng tác viên; kiểm tra ở API. Tài khoản thao tác MUST lấy từ phiên đăng nhập,
  không nhận từ yêu cầu.
- **FR-019**: Danh sách Thành viên MUST hiện: chủ tài khoản, từng cộng tác viên (tên, email, ngày tham
  gia), từng lời mời đang chờ (email, ngày gửi, ngày hết hạn) và số chỗ còn lại trên 2. Trạng thái hiển thị
  bằng chữ + biểu tượng.
- **FR-020**: Chủ MUST mời được cộng tác viên bằng email. Lời mời: dùng một lần, hết hạn sau 7 ngày, gắn
  với đúng một email và một tài khoản; "Gửi lại" làm vô hiệu liên kết cũ và tính lại hạn. Giới hạn: tối đa
  3 thư mời/giờ cho một email và 10 lời mời mới/ngày cho một tài khoản (ngưỡng theo tài khoản cấu hình được). Thư mời MUST nêu
  tên hiển thị của người mời và tên cửa hàng (nếu đã có hồ sơ), vai trò sẽ nhận và hạn của lời mời.
- **FR-021**: Tổng (cộng tác viên đang hoạt động + lời mời đang chờ) của một tài khoản MUST NOT vượt 2;
  kiểm tra MUST đúng kể cả khi mời/chấp nhận đồng thời. Lời mời bị hủy hoặc quá hạn MUST trả lại chỗ.
- **FR-022**: Người được mời MUST chấp nhận được bằng: đặt tên hiển thị + mật khẩu, hoặc Google/Facebook
  có email trùng email được mời (hoặc không trả email), hoặc – nếu đã có người dùng với email đó mà hiện
  không thuộc tài khoản nào – đăng nhập bằng cách sẵn có. Người dùng mới MUST tích ô đồng ý điều khoản (ô
  không đặt sẵn). Chấp nhận thành công MUST trong một thao tác nguyên vẹn: (tạo người dùng nếu cần) + tạo
  vai trò cộng tác viên + đánh dấu lời mời đã dùng. Email của lời mời được coi là đã xác minh khi chấp nhận
  qua liên kết gửi tới email đó.
- **FR-023**: Ở giai đoạn 1 một người dùng khách hàng thuộc đúng một tài khoản: lời mời tới email của
  người đang là chủ hoặc cộng tác viên của bất kỳ tài khoản nào MUST NOT chấp nhận được, kèm lời giải thích
  và cách khắc phục cho người nhận. Phản hồi cho **người mời** MUST giống nhau dù email đó đã có người dùng
  hay chưa.
- **FR-024**: Chủ MUST nhận email khi lời mời được chấp nhận. Lời mời của tài khoản đã yêu cầu xóa MUST hết
  hiệu lực ngay.

**Gỡ cộng tác viên**

- **FR-025**: Chủ MUST gỡ được cộng tác viên sau một bước xác nhận nêu rõ hệ quả. Gỡ MUST: kết thúc vai
  trò của người đó trong tài khoản, thu hồi mọi phiên của họ, có hiệu lực ở mọi nơi chậm nhất 60 giây, trả
  lại chỗ. Chủ MUST NOT gỡ được chính mình; tài khoản MUST luôn có đúng 1 chủ.
- **FR-026**: Gỡ cộng tác viên MUST NOT xóa hay đổi bài, media, nhật ký duyệt/đăng người đó đã tạo; tên
  người tạo vẫn hiển thị trong lịch sử. Người dùng bị gỡ MUST được giữ (cùng các cách đăng nhập) để có thể
  được mời lại hoặc tự tạo tài khoản riêng.
- **FR-027**: Người dùng không còn thuộc tài khoản nào, khi đăng nhập, MUST chỉ thấy màn hình trung gian
  với các hành động: tạo tài khoản kinh doanh của riêng mình (trở thành chủ, cần tích ô đồng ý điều
  khoản), mở lời mời đang chờ, quản lý cách đăng nhập, đăng xuất. MUST NOT truy cập được
  bất kỳ dữ liệu nào của tài khoản cũ.
- **FR-028**: Người bị gỡ MUST nhận email thông báo (nêu tên cửa hàng, không nêu lý do).
- **FR-028a**: Người dùng không thuộc tài khoản nào liên tục 90 ngày MUST bị xóa thông tin đăng nhập
  (email, tên hiển thị trong hồ sơ người dùng, mọi cách đăng nhập, mọi phiên); hệ thống MUST gửi email báo
  trước 7 ngày, nêu ngày xóa và cách giữ lại (tạo tài khoản riêng hoặc chấp nhận lời mời). Mốc 90 ngày
  MUST tính lại từ đầu mỗi khi người đó thuộc một tài khoản rồi lại rời đi. Việc xóa MUST chạy lại được an
  toàn, MUST ghi kiểm toán không chứa dữ liệu cá nhân, và MUST NOT đổi bài, media hay nhật ký duyệt/đăng
  của các tài khoản khách hàng: tên người tạo trong các bản ghi đó giữ theo hạn 12 tháng của nhật ký. Sau
  khi xóa, email đó đăng ký hoặc được mời lại như một người hoàn toàn mới.

**Kiểm toán, bí mật, cô lập**

- **FR-029**: Hệ thống MUST ghi nhật ký kiểm toán (ai, hành động, kết quả, thời điểm, địa chỉ mạng, mã theo
  dõi) cho: đăng nhập Google/Facebook thành công/thất bại, tạo tài khoản qua nhà cung cấp, yêu cầu và kết
  quả xác nhận trùng email, thêm/gỡ cách đăng nhập (kể cả gỡ theo thông báo của Meta – FR-009a), tạo mật khẩu, gửi/gửi lại/hủy/chấp nhận/hết hạn lời
  mời, gỡ cộng tác viên, xóa người dùng không thuộc tài khoản nào (FR-028a). Bản ghi MUST NOT chứa mật khẩu, mã phiên, liên kết hay mã do nhà cung cấp cấp.
- **FR-030**: Mã bí mật của ứng dụng với nhà cung cấp, mã do nhà cung cấp cấp trong lượt đăng nhập, liên
  kết mời và liên kết xác nhận MUST NOT xuất hiện trong nhật ký kỹ thuật, chỉ số, thông báo lỗi, phản hồi
  API hay màn hình hỗ trợ; liên kết chỉ được lưu dạng băm.
- **FR-031**: Lời mời và mọi dữ liệu mới có mã tài khoản MUST tuân thủ cô lập tenant (chính sách bảo mật
  mức dòng, nằm trong bộ kiểm thử truy cập chéo): chủ tài khoản A không xem, hủy hay gỡ được lời mời/thành
  viên của tài khoản B. Các bước chưa biết tenant (quay về từ nhà cung cấp, mở liên kết mời/xác nhận) MUST
  đi qua đường truy cập hẹp, được kiểm soát theo cùng cách 004 đã dùng; lý do ghi ở plan.
- **FR-032**: Google và Meta (đăng nhập) MUST có trong danh sách bên nhận/chuyển dữ liệu xuyên biên giới
  với đúng phạm vi "nhận về tên, email, mã người dùng"; màn hình đồng ý và chính sách quyền riêng tư MUST
  nêu hai bên này.

**Giao diện**

- **FR-033**: Giao diện MUST có: nút Google/Facebook trên màn hình đăng nhập và đăng ký; bước xác nhận tạo
  tài khoản lần đầu; màn hình nhập + xác minh email (Facebook không có email); màn hình xác nhận trùng
  email; Cài đặt → Cách đăng nhập; Cài đặt → Thành viên (chỉ chủ thấy mục này); màn hình tham gia từ lời
  mời; màn hình "không còn thuộc tài khoản nào". Tất cả bằng tiếng Việt đời thường, hoạt động từ 360 px,
  vùng chạm ≥ 44 × 44 px, đạt WCAG 2.1 AA, mỗi lỗi kèm ít nhất một hành động khắc phục.

### Key Entities *(include if feature involves data)*

- **Cách đăng nhập (`account.login_identities` – đã có từ 004)**: gắn với một người dùng; loại (mật khẩu /
  Google / Facebook), mã người dùng phía nhà cung cấp (duy nhất theo cặp với loại), email và tên phía nhà
  cung cấp tại thời điểm liên kết, ngày liên kết. Mỗi người dùng tối đa một cách mỗi loại, tối thiểu một
  cách (trừ khi cách cuối cùng bị gỡ theo thông báo của Meta – FR-009a).
- **Yêu cầu xóa dữ liệu từ Meta**: mã xác nhận đã trả cho Meta, thời điểm nhận, trạng thái xử lý; không
  chứa dữ liệu cá nhân, dùng cho trang trạng thái.
- **Lượt đăng nhập qua nhà cung cấp**: bản ghi ngắn hạn cho một lần chuyển sang Google/Facebook và quay về;
  gắn với trình duyệt đã bắt đầu, mục đích (đăng nhập / liên kết từ Cài đặt / chấp nhận lời mời), hạn 10
  phút, dùng một lần.
- **Yêu cầu xác nhận liên kết**: phát sinh khi trùng email; gồm người dùng đã có, tài khoản phía nhà cung
  cấp đang chờ gắn, cách xác nhận được phép, băm liên kết email, hạn, thời điểm đã dùng.
- **Lời mời cộng tác viên (thuật ngữ mới: `loi_moi` → `invitations`)**: thuộc một tài khoản khách hàng;
  email được mời (đã chuẩn hóa), người mời, vai trò (cộng tác viên), trạng thái (đang chờ / đã chấp nhận /
  đã hủy / hết hạn), băm liên kết, ngày gửi gần nhất, ngày hết hạn, người dùng đã chấp nhận.
- **Thành viên (`account.memberships` – đã có từ 004)**: (tài khoản, người dùng, vai trò, trạng thái); đúng
  1 chủ, ≤ 2 cộng tác viên đang hoạt động; trạng thái "đã gỡ" giữ lại để truy vết.
- **Người dùng (`account.users` – đã có từ 004)**: thêm khả năng tồn tại mà không thuộc tài khoản nào (sau
  khi bị gỡ) và không có mật khẩu (chỉ đăng nhập qua nhà cung cấp). Cần biết thời điểm bắt đầu không
  thuộc tài khoản nào và thời điểm đã gửi thư báo trước, để xóa sau 90 ngày (FR-028a).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Người mới vào được màn hình đầu tiên bằng Google hoặc Facebook trong ≤ 1 phút và ≤ 3 thao
  tác trong ứng dụng (bấm nút, tích ô đồng ý, bấm tạo tài khoản), không phải đặt mật khẩu. Riêng khi
  Facebook không trả email: thêm bước nhập email và mở liên kết trong thư, tổng ≤ 3 phút.
- **SC-002**: Người đã liên kết đăng nhập lại bằng Google/Facebook trong ≤ 5 giây kể từ khi quay về từ nhà
  cung cấp ở 95% lần.
- **SC-003**: 0 trường hợp tài khoản Google/Facebook chưa liên kết vào được người dùng đã có mà không qua
  xác nhận mật khẩu hoặc email; 0 trường hợp một email tạo ra hai người dùng khách hàng – kiểm bằng bộ kiểm
  thử tự động phủ mọi tổ hợp (có/không mật khẩu × email đã/chưa xác minh × Google/Facebook × có/không email
  từ nhà cung cấp).
- **SC-004**: Chủ tài khoản gửi xong một lời mời trong ≤ 30 giây; người được mời từ lúc mở thư đến lúc vào
  ứng dụng ≤ 2 phút; 95% thư mời được giao cho bên gửi thư trong ≤ 1 phút.
- **SC-005**: Trong 1.000 lượt mời/chấp nhận đồng thời trên cùng một tài khoản, số cộng tác viên đang hoạt
  động + lời mời đang chờ không bao giờ vượt 2.
- **SC-006**: Sau khi chủ gỡ cộng tác viên, 100% yêu cầu của người đó bị từ chối trong ≤ 60 giây; 0 bài,
  media hay nhật ký của tài khoản bị mất do thao tác gỡ.
- **SC-007**: Ma trận kiểm thử truy cập chéo cho lời mời và thành viên: 100% thao tác của tài khoản A lên
  dữ liệu tài khoản B thất bại; 100% thao tác quản lý thành viên của cộng tác viên bị từ chối ở API.
- **SC-008**: 0 mã bí mật (mã do nhà cung cấp cấp, liên kết mời, liên kết xác nhận, mật khẩu, mã phiên)
  xuất hiện trong nhật ký, chỉ số, phản hồi lỗi khi chạy toàn bộ bộ kiểm thử; 100% hành động ở FR-029 có
  bản ghi kiểm toán tương ứng.
- **SC-009**: Không người dùng nào tự khóa mình: 100% lần thử gỡ cách đăng nhập cuối cùng bị từ chối, kể
  cả khi gửi đồng thời.
- **SC-010**: 100% người dùng không thuộc tài khoản nào quá 90 ngày bị xóa thông tin đăng nhập trong
  vòng 24 giờ sau mốc đó và đã nhận thư báo trước ít nhất 7 ngày; 0 người đang thuộc một tài khoản bị
  xóa nhầm; 100% thông báo hợp lệ của Meta (FR-009a) được xử lý xong trong ≤ 1 phút.
- **SC-011**: Các màn hình mới đạt WCAG 2.1 AA khi kiểm bằng công cụ tự động và thao tác hết được chỉ bằng
  bàn phím/trình đọc màn hình ở bề rộng 360 px.

## Assumptions

- **Nguồn tài liệu**: thư mục `TaiLieuKienTruc` nêu trong yêu cầu không tồn tại; đặc tả này dựa trên
  `TaiLieuDacTa/` và `.specify/memory/architecture.md`, cùng đặc tả/kết quả của tính năng 004.
- **Ngoài phạm vi**: đăng nhập Google/Facebook và bước xác thực thứ hai cho nhân viên nội bộ; chuyển quyền
  chủ tài khoản; cộng tác viên tự rời tài khoản; một người dùng thuộc nhiều tài khoản; đổi email đăng nhập
  chính sau khi đã xác minh; tự gộp hai người dùng; kết nối Page/Instagram/Zalo (FR-02); yêu cầu xóa tài
  khoản (FR-14) – với thông báo "người dùng gỡ ứng dụng / yêu cầu xóa dữ liệu" từ Meta, tính năng này chỉ gỡ
  cách đăng nhập Facebook (FR-009a), phần xóa toàn bộ dữ liệu làm cùng FR-14; gói dịch vụ và chặn theo gói; thông báo trong ứng dụng (module
  Thông báo) – tính năng này chỉ gửi email qua giao diện gửi thư tối thiểu của 004.
- **Một người dùng – một tài khoản** (004 FR-004) được giữ nguyên; vì vậy email đang là chủ/cộng tác viên
  ở nơi khác không nhận lời mời được. Người bị gỡ được phép tự tạo tài khoản riêng để email không bị "kẹt"
  (đã chốt – Clarifications 2026-11-13).
- **Lời mời đang chờ chiếm chỗ** (tính vào giới hạn 2; đã chốt – Clarifications 2026-11-13) để "đủ 2 CTV → khóa nút mời" của UI/UX luôn đúng và
  không có lời mời nào được chấp nhận rồi mới báo hết chỗ.
- **Chấp nhận lời mời bằng Google/Facebook yêu cầu trùng email được mời** (đã chốt – Clarifications
  2026-11-13), để liên kết mời bị chuyển tiếp
  không cho người khác vào tài khoản; chủ muốn mời email khác thì mời lại.
- Các giá trị mặc định theo thông lệ, đổi được bằng cấu hình: hạn lời mời 7 ngày; hạn liên kết xác nhận 30
  phút; hạn lượt đăng nhập qua nhà cung cấp 10 phút; cửa sổ xác nhận lại danh tính 10 phút; số lời mời mới
  mỗi ngày của một tài khoản. Các ngưỡng thư theo email (3 thư/giờ) và số lượt bắt đầu đăng nhập theo địa
  chỉ mạng là hằng số trong mã.
- Email Facebook có trả về được coi là đã xác minh (đã chốt 2026-11-14 – Clarifications, FR-004). Giả
  định nền: Facebook chỉ trả qua API email mà người dùng đã xác nhận; Facebook không có cờ "đã xác minh"
  riêng như Google. Giả định này MUST được kiểm lại với tài liệu hiện hành của Meta và bằng tài khoản
  thử trước khi phát hành; nếu sai thì quay về xử lý email Facebook như chưa xác minh (FR-010a). Rủi ro
  còn lại đã chấp nhận: email cũ đã đổi chủ; được giới hạn vì trùng email không bao giờ tự liên kết.
- Đăng nhập bằng số điện thoại (OTP) ngoài phạm vi, để thành tính năng riêng sau.
- Đăng nhập Facebook dùng chung ứng dụng Meta đã đăng ký cho đăng bài nhưng chỉ xin quyền cơ bản (T7); ứng
  dụng Google và Meta đã được đăng ký, có trang chính sách quyền riêng tư & điều khoản (P5). Kiểm thử tự
  động dùng nhà cung cấp đăng nhập giả lập, không gọi ra ngoài.
- Gỡ cộng tác viên có hiệu lực chậm ≤ 60 giây là giới hạn đã chấp nhận của bộ nhớ đệm phiên + vai trò
  (ADR-08, Kiến trúc dữ liệu mục cache).
- Tên người tạo trên bài/media sau khi người đó bị gỡ vẫn hiển thị vì nhật ký duyệt/đăng phải giữ 12 tháng
  (NFR bảo mật); việc ẩn danh khi người dùng yêu cầu xóa dữ liệu cá nhân thuộc FR-14.
- Mã định danh tiếng Anh: tái dùng ánh xạ của 004 (`login_identities`, `memberships`, `owner`,
  `collaborator`); thuật ngữ mới `loi_moi` → `invitations`; các tên còn lại (lượt đăng nhập qua nhà cung
  cấp, yêu cầu xác nhận liên kết) do plan chốt và ghi vào data-model.
