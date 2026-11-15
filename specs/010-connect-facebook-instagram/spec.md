# Feature Specification: Kết nối kênh Facebook Page + Instagram + TikTok – cấp quyền, lưu mã hóa, điều kiện tài khoản, ngày hết hạn, nhiều kết nối mỗi nền tảng, bật/tắt TikTok theo khách hàng, màn hình "Kênh kết nối"

**Feature Branch**: `010-connect-facebook-instagram`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Bạn là PM của dự án, dựa vào tài liệu kiến trúc và nghiệp vụ mong muốn của dự án hãy lên tài liệu tính năng Kết nối kênh Facebook Page + Instagram: cấp quyền, lưu mã hóa, điều kiện tài khoản, ngày hết hạn, màn hình Kênh kết nối phù hợp với dự án"

**Bổ sung 2026-11-15 (theo yêu cầu của PO)**: (1) thêm kênh **TikTok**; (2) mỗi nền tảng cho phép **nhiều kết
nối** và có chức năng quản lý chúng; (3) TikTok nằm sau **công tắc cấu hình bật/tắt theo khách hàng** vì
ứng dụng chưa được TikTok xét duyệt để dùng cổng đăng bài. Ghi chú phạm vi: đặc tả yêu cầu, ADR-05 và hiến
pháp nguyên tắc IX xếp TikTok vào giai đoạn sau; yêu cầu này đưa **bộ chuyển đổi TikTok** vào giai đoạn 1
nhưng mặc định **tắt** với mọi khách hàng (ADR-05: thêm nền tảng = thêm bộ chuyển đổi, không sửa luồng đăng
chính). Cần ghi chú quyết định này vào đặc tả yêu cầu (mục phạm vi) khi hoàn thành.

**Truy vết**: WBS T2 (Kết nối kênh Facebook Page + Instagram; phụ thuộc K5, P5) · FR-02 (kết nối kênh, chỉ
chủ tài khoản; hiển thị trạng thái, ngày hết hạn quyền, điều kiện tài khoản – Instagram phải là tài khoản
chuyên nghiệp) · FR-09 (lỗi "quyền hết hạn" là lỗi cần người dùng xử lý) · FR-14 (ngắt kết nối kênh ngay khi
yêu cầu xóa tài khoản) · FR-15 (đăng nhập Facebook **tách biệt** với kết nối Page) · Đặc tả yêu cầu mục 3.1
(mã quyền `channel.manage`) và NFR giám sát (nhắc khi quyền còn < 7 ngày) · UI/UX mục 4 (bước 3 hành trình
người mới), màn hình **Kênh kết nối** (mục 8), thông báo "Quyền kênh sắp hết hạn" (mục 8), bảng phân quyền
(mục 9) · ADD module Đăng bài & Cổng nền tảng (mục 3 giao diện chung, mục 6 `ket_noi_kenh`, mục 7 ví dụ lỗi,
mục 9) · Kiến trúc dữ liệu (mục "Bí mật": mã quyền mã hóa, cấm cache; mục 9 dữ liệu gửi/nhận) · ADR-02,
ADR-05, ADR-09 · Hiến pháp nguyên tắc I, II, VI, VII, VIII, IX.

**Phụ thuộc**: `005-gateway-contracts-fakes` (giao diện chung của bộ chuyển đổi nền tảng, bản giả lập luồng
kết nối kênh và `ChannelConnection` – tính năng này thay bản giả bằng bản thật cho Facebook Page, Instagram
và thêm TikTok; 005 hiện có `test_channel`, chưa có loại kênh TikTok) · `004-minimal-auth-rbac` (phiên, vai trò, lớp chặn quyền, nhật ký kiểm toán) ·
`002-db-layer-tenant-rls` · K5 (khóa mã hóa của dịch vụ quản lý khóa) · P5 (ứng dụng đã đăng ký với Meta,
trang chính sách quyền riêng tư & điều khoản) · Module Thông báo (thông báo trong ứng dụng + email).

**Bối cảnh**: Mọi bài đăng đều cần một kênh đã kết nối. Hiện tại chỉ có bản giả lập (005) nên chưa thể đăng
thật, cũng chưa thể nộp xét duyệt ứng dụng của Meta – việc nộp đòi hỏi một bản chạy được luồng "kết nối kênh +
đăng bài" (WBS: nộp xét duyệt ngay khi T2 + T3 + T4 chạy được). Tính năng này cho chủ tài khoản **cấp quyền
cho ứng dụng đăng bài thay mình** lên các Facebook Page, tài khoản Instagram chuyên nghiệp (và TikTok khi được bật), giữ quyền đó
an toàn, báo rõ kênh nào dùng được / sắp hết hạn / đã hỏng, và cho kết nối lại hoặc ngắt bất cứ lúc nào.
Một chủ kinh doanh có thể quản lý nhiều Page / nhiều tài khoản Instagram / nhiều tài khoản TikTok. **Không**
thuộc phạm vi: Zalo OA (tính năng riêng), việc đăng bài (T4), đăng nhập bằng Facebook (009).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chủ tài khoản kết nối Facebook Page (Priority: P1)

Chị Lan (chủ một tiệm hoa) vào **Kênh kết nối**, bấm "Kết nối Facebook Page". Ứng dụng chuyển sang màn hình
của Facebook; chị đồng ý cấp quyền đăng bài cho các Page chị quản lý. Quay lại ứng dụng, chị thấy danh sách
Page chị có quyền đăng, chọn "Tiệm hoa Lan", rồi thấy thẻ kênh với tên Page, trạng thái "Đang hoạt động" và
ngày hết hạn quyền. Từ giờ chị có thể chọn kênh này khi tạo kế hoạch và đăng bài.

**Why this priority**: Không có kênh thì không đăng được bài nào – đây là giá trị cốt lõi của sản phẩm và là
bước 3 của hành trình người mới (≤ 15 phút đến kế hoạch tuần đầu). Facebook cũng là kênh có số người dùng
mục tiêu nhiều nhất.

**Independent Test**: Dùng nhà cung cấp Meta giả lập (đã có từ 005, chạy kịch bản "người dùng có 2 Page"):
chủ tài khoản bấm kết nối → chọn 1 Page → có đúng 1 kết nối kênh `Facebook Page` cho tài khoản đó, trạng thái
đang hoạt động, có ngày hết hạn; liệt kê kênh qua giao diện công khai không trả mã quyền; đăng nhập tài khoản
khác không thấy kênh này.

**Acceptance Scenarios**:

1. **Given** chủ tài khoản đang đăng nhập và chưa có kênh Facebook, **When** bấm "Kết nối Facebook Page" và
   đồng ý cấp quyền ở màn hình của Facebook, **Then** ứng dụng hiện danh sách các Page mà người đó có quyền
   đăng bài (tên + ảnh đại diện Page) để chọn.
2. **Given** người dùng chọn một Page trong danh sách, **When** xác nhận, **Then** hệ thống kiểm tra điều
   kiện tài khoản (User Story 3); nếu đạt, tạo kết nối kênh trạng thái "Đang hoạt động" gắn với tài khoản
   của họ, lưu tên Page, mã Page, quyền đã được cấp và ngày hết hạn; thẻ kênh hiện ra ngay trên màn hình
   **Kênh kết nối**.
3. **Given** người dùng chỉ có đúng một Page, **When** hoàn tất cấp quyền, **Then** Page đó được chọn sẵn
   và người dùng chỉ cần bấm "Xác nhận" (không bắt buộc phải tự tìm trong danh sách).
4. **Given** người dùng có nhiều Page, **When** hoàn tất cấp quyền, **Then** họ chọn **một hoặc nhiều** Page
   (tối đa bằng số chỗ còn lại theo giới hạn mỗi nền tảng – xem User Story 8); mỗi Page được chọn thành một
   kết nối riêng; Page đã kết nối ở tài khoản này hiện dạng "Đã kết nối" và không chọn lại được.
5. **Given** người dùng bấm "Hủy", từ chối một số quyền bắt buộc, hoặc Facebook gặp sự cố, **When** quay lại
   ứng dụng, **Then** thấy thông báo tiếng Việt đời thường ("Bạn chưa hoàn tất kết nối Facebook" / "Cần cấp
   đủ quyền đăng bài thì ứng dụng mới đăng được cho bạn") kèm nút "Thử lại"; không có kênh nào được tạo và
   không có dữ liệu quyền nào được lưu.
6. **Given** người dùng kết nối thành công, **When** xem màn hình, nhật ký, email hay phản hồi của ứng dụng,
   **Then** không có chỗ nào chứa mã quyền truy cập hoặc bí mật liên quan (User Story 4).
7. **Given** người dùng đã đăng nhập vào ứng dụng bằng "Tiếp tục với Facebook" (009), **When** vào Kênh kết
   nối, **Then** vẫn phải làm bước kết nối Page riêng; việc đăng nhập Facebook **không** tự kết nối Page nào.

---

### User Story 2 - Chủ tài khoản kết nối Instagram chuyên nghiệp (Priority: P1)

Chị Lan muốn đăng cả lên Instagram của tiệm. Chị bấm "Kết nối Instagram". Ứng dụng kiểm tra tài khoản
Instagram đã liên kết với Page của chị có phải tài khoản **chuyên nghiệp** (doanh nghiệp hoặc người sáng tạo
nội dung) không. Nếu đúng, thẻ "Instagram @tiemhoalan" xuất hiện với trạng thái đang hoạt động. Nếu chưa, ứng
dụng nói rõ cần làm gì (chuyển sang tài khoản chuyên nghiệp và liên kết với Facebook Page) kèm nút "Kiểm tra
lại" sau khi chị làm xong ở Instagram/Facebook.

**Why this priority**: Instagram là kênh thứ hai của giai đoạn 1 và hay bị nhầm điều kiện (tài khoản cá nhân
không đăng được qua ứng dụng). Báo rõ ngay lúc kết nối giúp tránh lỗi muộn lúc đến giờ đăng.

**Independent Test**: Với nhà cung cấp giả lập: (a) tài khoản chuyên nghiệp có liên kết Page → tạo được kết
nối `Instagram`; (b) tài khoản cá nhân → không tạo kết nối, hiện đúng hướng dẫn; (c) không có Instagram nào
gắn với Page → hiện hướng dẫn liên kết.

**Acceptance Scenarios**:

1. **Given** Page Facebook chủ tài khoản quản lý có liên kết với một tài khoản Instagram chuyên nghiệp,
   **When** chủ tài khoản bấm "Kết nối Instagram" và cấp quyền, **Then** hệ thống tạo kết nối kênh
   `Instagram` trạng thái "Đang hoạt động", hiển thị tên người dùng Instagram (@…), ngày hết hạn quyền.
2. **Given** tài khoản Instagram là tài khoản cá nhân, **When** kiểm tra điều kiện, **Then** không tạo kết
   nối; hiện: "Tài khoản Instagram cần chuyển sang tài khoản chuyên nghiệp và liên kết với Page", cùng các
   bước hướng dẫn ngắn và nút "Kiểm tra lại".
3. **Given** Page chưa liên kết với tài khoản Instagram nào, **When** kiểm tra điều kiện, **Then** hiện
   hướng dẫn liên kết Instagram với Page và nút "Kiểm tra lại"; không tạo kết nối.
4. **Given** người dùng bấm "Kiểm tra lại" sau khi đã sửa ở Instagram/Facebook, **When** kiểm tra đạt,
   **Then** kết nối được tạo mà không phải cấp quyền lại từ đầu nếu quyền cấp ban đầu còn hiệu lực.
5. **Given** người dùng đã kết nối Facebook Page, **When** bấm kết nối Instagram, **Then** ứng dụng dùng lại
   quyền đã cấp nếu đủ, chỉ hỏi cấp thêm khi còn thiếu quyền riêng cho Instagram – người dùng không phải đi
   qua màn hình đồng ý lặp lại không cần thiết.
6. **Given** người dùng kết nối Instagram mà **chưa** kết nối Facebook Page (hoặc ngược lại), **When**
   hoàn tất, **Then** mỗi kênh vẫn hoạt động độc lập; có thể có chỉ một trong hai kênh.

---

### User Story 3 - Kiểm tra điều kiện tài khoản và báo ngay khi không đủ (Priority: P1)

Trước khi chấp nhận một kết nối, hệ thống kiểm tra: người dùng có thật sự có quyền đăng bài trên Page/tài
khoản đó không; các quyền bắt buộc đã được cấp đủ chưa; loại tài khoản có phù hợp không (Instagram chuyên
nghiệp); hạn mức đăng còn lại nếu nền tảng cho biết. Kết quả được nói bằng lời thường, kèm việc cần làm.

**Why this priority**: FR-02 yêu cầu "hiển thị điều kiện tài khoản" và UI/UX nêu rõ "báo ngay nếu tài khoản
không đủ điều kiện". Phát hiện sớm giảm lỗi đăng bài muộn (Hiến pháp nguyên tắc II, VI) và giảm liên hệ hỗ
trợ.

**Independent Test**: Chạy lần lượt các kịch bản giả lập: thiếu một quyền bắt buộc, chỉ có vai trò quá thấp
trên Page (không đăng được), tài khoản Instagram cá nhân, Page đã bị gỡ – mỗi kịch bản cho đúng một thông
điệp và ít nhất một hành động khắc phục; không có kết nối nào được tạo.

**Acceptance Scenarios**:

1. **Given** người dùng không cấp một quyền bắt buộc, **When** hệ thống kiểm tra, **Then** thông báo nêu rõ
   quyền còn thiếu bằng lời thường ("Còn thiếu quyền đăng bài lên Page") và nút "Cấp quyền lại".
2. **Given** người dùng chỉ có vai trò trên Page không đủ để đăng bài, **When** kiểm tra, **Then** thông báo
   "Bạn cần là quản trị viên hoặc biên tập viên của Page này" (hoặc tương đương theo quy tắc nền tảng) và
   gợi ý nhờ quản trị viên Page cấp lại vai trò.
3. **Given** kết nối vượt qua kiểm tra, **When** xem thẻ kênh, **Then** thấy phần **Điều kiện tài khoản** với
   các dòng: loại tài khoản, quyền đã cấp (dạng tick/chữ), hạn mức còn lại (chỉ khi nền tảng cho biết; nếu
   không thì không hiện dòng này, không hiện số giả).
4. **Given** một kết nối đang hoạt động, **When** chủ tài khoản bấm "Kiểm tra lại", **Then** hệ thống chạy lại
   kiểm tra điều kiện, cập nhật thời điểm kiểm tra gần nhất và trạng thái; hạn chế số lần bấm (không quá
   vài lần mỗi phút) để tránh làm nền tảng chặn.
5. **Given** kiểm tra thất bại vì nền tảng tạm thời không phản hồi, **When** hiện kết quả, **Then** nói rõ
   "chưa kiểm tra được, thử lại sau" và **không** đổi trạng thái kênh đang hoạt động sang lỗi.
6. **Given** mọi thông điệp kiểm tra điều kiện, **When** hiển thị, **Then** mỗi thông điệp có ít nhất một
   hành động khắc phục; mã lỗi gốc của nền tảng chỉ nằm trong "Chi tiết cho hỗ trợ".

---

### User Story 4 - Quyền truy cập được lưu an toàn, không ai ngoài hệ thống đọc được (Priority: P1)

Chủ tài khoản giao cho ứng dụng quyền đăng bài lên Page của họ – đây là thứ nhạy cảm nhất của sản phẩm. Mã
quyền được lưu **đã mã hóa**, chỉ phần "Cổng nền tảng" mới giải mã được, và chỉ ngay trước khi gọi nền tảng.
Không màn hình, email, nhật ký, chỉ số hay giao diện hỗ trợ nào hiển thị nó; đội hỗ trợ tra cứu kênh chỉ
thấy trạng thái, ngày hết hạn, không thấy mã quyền.

**Why this priority**: Hiến pháp nguyên tắc VII (không thương lượng về bảo mật): lộ mã quyền nghĩa là kẻ xấu
đăng bài lên Page của khách hàng. Cũng là điều kiện để qua xét duyệt của Meta và để tin cậy ở thị trường.

**Independent Test**: Sau khi kết nối (giả lập), đọc trực tiếp dòng dữ liệu kênh → không thấy mã quyền ở dạng
rõ; quét toàn bộ nhật ký, phản hồi giao diện công khai, thông báo, màn hình hỗ trợ của lần kết nối → không có
chuỗi mã quyền; thử gọi giải mã từ module khác → bị từ chối.

**Acceptance Scenarios**:

1. **Given** kết nối vừa tạo, **When** xem dữ liệu lưu trữ, **Then** mã quyền chỉ tồn tại ở dạng đã mã hóa
   bằng khóa nằm ngoài cơ sở dữ liệu; sao lưu hay sao chép cơ sở dữ liệu một mình không đủ để đọc được mã.
2. **Given** bất kỳ module nào khác ngoài Cổng nền tảng, **When** cố đọc mã quyền, **Then** không có đường
   nào làm được (giao diện công khai của Cổng nền tảng không bao giờ trả mã quyền).
3. **Given** quá trình kết nối, làm mới, kiểm tra, ngắt kết nối, **When** kiểm tra nhật ký, chỉ số, thông
   báo lỗi, màn hình hỗ trợ và email, **Then** không có mã quyền, mã trao đổi, bí mật ứng dụng nào xuất hiện.
4. **Given** tài khoản A và tài khoản B, **When** A thử đọc, sửa, ngắt kết nối của B (kể cả bằng cách đoán mã
   kết nối), **Then** bị từ chối và không phân biệt được "không tồn tại" với "của người khác".
5. **Given** hai tài khoản khách hàng cùng cố kết nối **cùng một Page Facebook**, **When** tài khoản thứ hai
   hoàn tất, **Then** bị từ chối với "Page này đang được kết nối ở một tài khoản khác. Hãy ngắt ở tài khoản
   đó trước hoặc liên hệ hỗ trợ" – một Page chỉ thuộc một tài khoản tại một thời điểm.
6. **Given** thao tác kết nối/ngắt/kết nối lại, **When** kiểm tra nhật ký kiểm toán, **Then** mỗi thao tác có
   bản ghi: ai làm, kênh nào, lúc nào, kết quả (không chứa mã quyền hay dữ liệu cá nhân dư thừa).
7. **Given** dữ liệu tạm trong lúc chờ người dùng chọn Page, **When** quá 10 phút không hoàn tất hoặc đã
   dùng một lần, **Then** dữ liệu tạm bị hủy và không dùng lại được.

---

### User Story 5 - Biết ngày hết hạn, tự làm mới, nhắc khi sắp mất kết nối (Priority: P1)

Chủ tài khoản luôn thấy trên mỗi thẻ kênh: "Quyền có hiệu lực đến 12/01/2027" hoặc "còn 5 ngày". Hằng ngày
hệ thống tự làm mới quyền sắp hết hạn mà người dùng không phải làm gì. Nếu không làm mới được và còn dưới 7
ngày, chủ nhận cảnh báo nổi bật trên màn hình **Kênh kết nối**, thông báo trong ứng dụng và email có nút "Kết
nối lại". Nếu đã hết hạn hoặc bị thu hồi, kênh chuyển "Cần kết nối lại" và các bài sắp đến giờ đăng cho kênh
đó được báo rõ thay vì thất bại âm thầm.

**Why this priority**: Quyền hết hạn là nguyên nhân thất bại đăng bài dễ đoán nhất; hiến pháp nguyên tắc VIII
đặt cảnh báo "quyền còn < 7 ngày" và FR-02/UI/UX yêu cầu hiển thị ngày hết hạn.

**Independent Test**: Dùng đồng hồ giả: tạo kết nối hết hạn sau 10 ngày → chạy việc hằng ngày → làm mới được
(ngày hết hạn lùi ra); đặt kịch bản làm mới thất bại khi còn 6 ngày → có đúng một cảnh báo trong ứng dụng +
một email, thẻ kênh hiện trạng thái "Sắp hết hạn"; tới ngày hết hạn → trạng thái "Cần kết nối lại"; kết nối
lại → trở về "Đang hoạt động" và cảnh báo biến mất.

**Acceptance Scenarios**:

1. **Given** kết nối còn nhiều hơn 7 ngày hiệu lực, **When** việc làm mới hằng ngày chạy, **Then** hệ thống
   cố làm mới và cập nhật ngày hết hạn mới nếu thành công; người dùng không nhận thông báo nào.
2. **Given** làm mới thất bại và quyền còn dưới 7 ngày, **When** việc hằng ngày chạy, **Then** trạng thái
   chuyển "Sắp hết hạn"; chủ nhận một thông báo trong ứng dụng + một email ("Quyền Facebook của bạn sẽ hết
   hạn ngày …, hãy kết nối lại"); không gửi lại hằng ngày mà chỉ nhắc lại khi còn 1 ngày và khi đã hết hạn.
3. **Given** quyền đã hết hạn hoặc người dùng đã thu hồi quyền phía nền tảng, **When** hệ thống phát hiện
   (qua việc làm mới, kiểm tra điều kiện hoặc lỗi từ nền tảng lúc đăng), **Then** kênh chuyển "Cần kết nối
   lại" kèm lý do bằng lời thường ("Facebook báo quyền đã bị thu hồi"); không còn chọn được kênh này khi tạo
   bài mới; thông báo được gửi cho chủ.
4. **Given** có bài đã lên lịch cho kênh đó, **When** kênh chuyển "Cần kết nối lại", **Then** màn hình kênh
   và thông báo nêu số bài bị ảnh hưởng và giờ gần nhất; nếu chưa kết nối lại kịp, lượt đăng đến giờ được
   xử lý như lỗi cần người dùng (FR-09) với hành động "Kết nối lại" – không thử gửi bằng quyền hết hạn.
5. **Given** kênh đã kết nối lại thành công, **When** quay lại, **Then** các bài đã lên lịch giữ nguyên;
   lượt đăng chờ xử lý có thể "Đăng lại" bằng một thao tác theo FR-09.
6. **Given** nền tảng không trả về ngày hết hạn cụ thể cho loại quyền đang dùng, **When** hiển thị thẻ kênh,
   **Then** hiện "Không có ngày hết hạn cố định – sẽ báo ngay nếu bị thu hồi" thay vì ngày bịa; kiểm tra
   hằng ngày vẫn phát hiện thu hồi.
7. **Given** ngày hết hạn, **When** hiển thị, **Then** theo múi giờ UTC+7, dạng ngày đời thường; trạng thái
   luôn có chữ + biểu tượng, không chỉ màu.

---

### User Story 6 - Màn hình "Kênh kết nối": xem sức khỏe các kênh trên điện thoại (Priority: P1)

Chủ tài khoản mở **Kênh kết nối** từ menu và thấy mỗi kênh một thẻ: Facebook Page, Instagram. Mỗi thẻ cho biết
tên Page/tài khoản, trạng thái (Đang hoạt động / Sắp hết hạn / Cần kết nối lại / Chưa kết nối), ngày hết hạn
quyền, điều kiện tài khoản, hạn mức còn lại (nếu có) và các nút phù hợp: Kết nối, Kết nối lại, Kiểm tra lại,
Ngắt kết nối. Cộng tác viên mở cùng màn hình nhưng chỉ xem, không thấy nút thao tác.

**Why this priority**: Là màn hình duy nhất để người dùng biết kênh còn dùng được hay không và là nơi mọi cảnh
báo dẫn về. Là "điểm đến" của nhiều thông báo (UI/UX mục 8).

**Independent Test**: Với dữ liệu giả lập đủ các trạng thái, mở màn hình ở độ rộng 360 px: mỗi trạng thái hiện
đúng chữ + biểu tượng + nút; đăng nhập cộng tác viên → thấy cùng nội dung nhưng không có nút thao tác và gọi
trực tiếp thao tác kết nối bị từ chối ở API.

**Acceptance Scenarios**:

1. **Given** tài khoản chưa có kênh nào, **When** mở màn hình, **Then** thấy trạng thái trống hướng dẫn: giải
   thích ngắn "Kết nối Facebook/Instagram để ứng dụng đăng bài giúp bạn" và các nút "Kết nối Facebook Page",
   "Kết nối Instagram" (và "Kết nối TikTok" **chỉ khi** TikTok đã được bật cho tài khoản – User Story 9);
   nêu rõ ứng dụng **chỉ đăng bài khi bạn bấm Duyệt**.
2. **Given** tài khoản có kênh, **When** mở màn hình, **Then** mỗi kết nối một thẻ (nhóm theo nền tảng; xem
   User Story 8) có đủ: tên (Page/@Instagram/@TikTok),
   loại kênh, trạng thái (chữ + biểu tượng), ngày hết hạn (hoặc "không có ngày cố định"), điều kiện tài
   khoản, thời điểm kiểm tra gần nhất, hạn mức còn lại nếu có, ngày kết nối.
3. **Given** có kênh sắp hết hạn (< 7 ngày) hoặc cần kết nối lại, **When** mở màn hình, **Then** cảnh báo
   nổi bật xuất hiện **trên đầu** màn hình và thẻ liên quan được làm nổi; menu có dấu chỉ báo cần chú ý ở mọi
   màn hình khác.
4. **Given** chủ tài khoản bấm "Ngắt kết nối", **When** xác nhận, **Then** hộp xác nhận nói rõ hậu quả (số
   bài đã lên lịch cho kênh này sẽ không đăng được; dữ liệu bài cũ vẫn giữ) và sau khi xác nhận: mã quyền bị
   xóa khỏi hệ thống ngay, hệ thống yêu cầu nền tảng thu hồi quyền khi có thể, kênh về "Chưa kết nối".
5. **Given** người dùng là cộng tác viên, **When** mở màn hình, **Then** thấy trạng thái và ngày hết hạn của
   mọi kênh (để biết vì sao bài không đăng) nhưng **không** có nút Kết nối / Kết nối lại / Ngắt; có dòng giải
   thích "Chỉ chủ tài khoản mới kết nối được kênh – hãy báo chủ tài khoản".
6. **Given** màn hình ở độ rộng 360 px, **When** sử dụng, **Then** không cuộn ngang, vùng chạm ≥ 44 × 44 px,
   đạt WCAG 2.1 AA, trạng thái không chỉ dựa vào màu.
7. **Given** màn hình tải, **When** đo, **Then** hiển thị danh sách kênh trong ≤ 1 giây (chuyển màn hình theo
   yêu cầu chung của UI/UX), không phải gọi sang nền tảng để vẽ màn hình (dùng dữ liệu đã lưu; chỉ "Kiểm
   tra lại" mới gọi sang nền tảng).

---

### User Story 7 - Kết nối lại và ngắt kết nối an toàn (Priority: P2)

Khi quyền hết hạn, bị thu hồi, hoặc chị Lan đổi quản trị viên Page, chị bấm "Kết nối lại" trên đúng thẻ kênh.
Sau khi cấp quyền lại, **cùng kênh đó** được cập nhật quyền mới và ngày hết hạn mới – mã kênh cũ giữ nguyên nên
các bài đã lên lịch và lịch sử đăng không bị đứt. Nếu chị đăng nhập nhầm sang Page khác, ứng dụng không âm thầm
đổi kênh mà báo "Đây là Page khác với kênh đang kết nối".

**Why this priority**: Thiết yếu cho vận hành lâu dài nhưng chỉ cần sau lần kết nối đầu; vẫn phải đúng để
không phá lịch đăng đã duyệt.

**Independent Test**: Kết nối kênh, tạo một bài đã lên lịch (giả lập), cho kênh hết hạn, kết nối lại cùng Page
→ cùng mã kênh, ngày hết hạn mới, bài đã lên lịch còn nguyên; kết nối lại bằng Page khác → bị từ chối, kênh
cũ không đổi.

**Acceptance Scenarios**:

1. **Given** kênh ở trạng thái "Cần kết nối lại", **When** chủ tài khoản kết nối lại cùng Page/tài khoản,
   **Then** kênh trở lại "Đang hoạt động" với quyền và ngày hết hạn mới; mã kênh không đổi; các bài đã lên
   lịch và lịch sử đăng không bị ảnh hưởng.
2. **Given** kết nối lại nhưng người dùng chọn Page/tài khoản khác với kênh gốc, **When** hoàn tất, **Then**
   bị từ chối "Đây là Page khác với kênh đang kết nối. Hãy ngắt kênh hiện tại nếu muốn đổi sang Page khác"; kênh
   hiện tại không đổi.
3. **Given** kênh đã ngắt, **When** chủ kết nối lại cùng Page, **Then** tạo kết nối mới; các lượt đăng cũ vẫn
   truy vết được theo kết nối trước; bài đã lên lịch trước khi ngắt không tự chuyển sang kết nối mới (phải
   chọn lại kênh – xem Assumptions).
4. **Given** chủ tài khoản bấm "Kết nối" hai lần liên tiếp hoặc mở hai thẻ trình duyệt cùng lúc, **When**
   hai luồng cùng hoàn tất cho **cùng một** Page/tài khoản, **Then** chỉ có đúng một kết nối cho Page/tài
   khoản đó; luồng đến sau nhận thông báo "Kênh này đã được kết nối" (không tạo bản trùng, không lỗi khó
   hiểu).
5. **Given** chủ tài khoản yêu cầu xóa tài khoản (FR-14), **When** yêu cầu được ghi nhận, **Then** mọi kết
   nối kênh bị ngắt **ngay** và mã quyền bị xóa, không đợi 30 ngày.
6. **Given** tài khoản hết hạn gói (FR-13), **When** chủ cố **kết nối mới**, **Then** bị chặn với giải thích
   "Gói đã hết hạn" và cách liên hệ gia hạn; vẫn **xem** được kênh và **ngắt** được kênh.

---

### User Story 8 - Kết nối nhiều tài khoản mỗi nền tảng và quản lý chúng (Priority: P1)

Anh Minh có 2 Facebook Page (cửa hàng chính và chi nhánh) cùng 2 tài khoản Instagram. Anh kết nối cả hai Page
trong một lần cấp quyền, rồi thêm Instagram cho từng Page. Màn hình **Kênh kết nối** gom các kết nối theo nền
tảng; anh lọc theo nền tảng hoặc trạng thái, kiểm tra lại một kết nối, kết nối lại một Page bị lỗi mà không
ảnh hưởng Page còn lại, và ngắt một kết nối không dùng nữa. Khi tạo kế hoạch/bài, anh chọn đúng kết nối muốn
đăng.

**Why this priority**: Nhiều chủ kinh doanh có nhiều thương hiệu/chi nhánh; giới hạn một kênh mỗi loại sẽ chặn
họ ngay từ bước đầu. Yêu cầu của PO (2026-11-15) thay cho giả định "mỗi loại một kết nối" của bản đầu.

**Independent Test**: Với nhà cung cấp giả lập có 3 Page: kết nối 2 Page trong cùng lần cấp quyền → 2 kết nối
độc lập; làm một kết nối hết hạn → chỉ thẻ đó báo lỗi, kết nối kia vẫn "Đang hoạt động"; ngắt một kết nối →
kết nối kia và các bài của nó không đổi; kết nối vượt giới hạn → bị từ chối với hướng dẫn.

**Acceptance Scenarios**:

1. **Given** tài khoản đã có kết nối Facebook Page, **When** chủ bấm "Thêm Facebook Page", **Then** quy trình
   như kết nối đầu tiên, các Page đã kết nối được đánh dấu "Đã kết nối" và không bị tạo trùng.
2. **Given** tài khoản có nhiều kết nối, **When** mở màn hình, **Then** thấy danh sách nhóm theo nền tảng,
   mỗi nhóm có số lượng (ví dụ "Facebook Page (2/5)"), lọc được theo nền tảng và theo trạng thái, và mỗi thẻ
   phân biệt được bằng tên + ảnh đại diện + mã rút gọn (khi hai kênh trùng tên).
3. **Given** một trong các kết nối hết hạn / bị thu hồi, **When** xem màn hình, **Then** chỉ thẻ đó chuyển
   "Cần kết nối lại"; cảnh báo ở đầu màn hình liệt kê **từng kết nối** cần chú ý; kết nối khác vẫn dùng bình
   thường (trạng thái, làm mới, nhắc nhở tính **riêng từng kết nối**).
4. **Given** số kết nối đang hoạt động của một nền tảng đã đạt giới hạn, **When** chủ bấm thêm, **Then** bị
   từ chối với "Bạn đã kết nối tối đa N kênh Facebook. Hãy ngắt bớt kênh không dùng để thêm kênh mới"; hiển
   thị rõ số đã dùng/giới hạn trước khi bấm.
5. **Given** chủ ngắt một kết nối trong nhiều kết nối, **When** xác nhận, **Then** chỉ kết nối đó bị ngắt (mã
   quyền xóa ngay); hộp xác nhận nêu số bài đã lên lịch cho riêng kết nối đó; các kết nối khác không đổi.
6. **Given** nhiều người cùng thao tác (chủ ở hai thiết bị), **When** cùng sửa/ngắt một kết nối, **Then**
   kết quả nhất quán, không mất kết nối khác (cập nhật có kiểm soát phiên bản).
7. **Given** cộng tác viên, **When** mở danh sách nhiều kết nối, **Then** thấy đầy đủ trạng thái/ngày hết hạn
   nhưng không có nút thao tác (như User Story 6).
8. **Given** một Page/tài khoản đã ngắt, **When** đếm giới hạn, **Then** không tính vào số đang dùng (chỗ
   được trả lại ngay).

---

### User Story 9 - Kết nối kênh TikTok, mặc định tắt, bật/tắt theo từng khách hàng (Priority: P2)

Ứng dụng đã đăng ký với TikTok nhưng **chưa được xét duyệt** cho cổng đăng bài, nên chưa thể mở công khai.
Đội vận hành có một **cấu hình bật/tắt TikTok cho từng khách hàng** (kèm giá trị mặc định toàn hệ thống,
đang là **tắt**). Với khách chưa được bật, TikTok hoàn toàn vô hình: không có thẻ, nút hay mục nào nhắc tới
TikTok. Khi đội vận hành bật cho một khách thử nghiệm, chủ tài khoản đó thấy nút "Kết nối TikTok" và kết nối
được một hoặc nhiều tài khoản TikTok như các nền tảng khác; khi tắt lại, khách quay về trạng thái không thấy,
dữ liệu kết nối được giữ an toàn nhưng tạm dừng.

**Why this priority**: Cho phép phát triển, kiểm thử và dùng thử TikTok với một số khách chọn trước mà không
mở cho tất cả và không chờ xét duyệt; khi TikTok duyệt chỉ cần đổi mặc định sang bật, không phát hành lại.
Không chặn giá trị chính (Facebook, Instagram) nên P2.

**Independent Test**: Với nhà cung cấp TikTok giả lập: (a) khách A tắt → API kết nối TikTok bị từ chối, giao
diện không có TikTok; (b) bật cho A → A kết nối được, khách B (tắt) vẫn không thấy; (c) tắt lại cho A → kết
nối của A chuyển "Tạm tắt", không đăng được, vẫn ngắt được; (d) đổi mặc định hệ thống sang bật → khách chưa
có ghi đè theo mặc định thấy TikTok, khách có ghi đè tắt vẫn không thấy.

**Acceptance Scenarios**:

1. **Given** TikTok đang tắt cho tài khoản (mặc định hoặc ghi đè), **When** chủ hoặc cộng tác viên mở Kênh
   kết nối hoặc các màn hình chọn kênh, **Then** không thấy bất kỳ thẻ, nút, bộ lọc hay văn bản nào về TikTok
   (trừ trường hợp đã có kết nối – kịch bản 6).
2. **Given** TikTok tắt, **When** gọi trực tiếp thao tác kết nối/làm mới/đăng TikTok (bỏ qua giao diện),
   **Then** bị từ chối ở API với mã lỗi rõ ràng "tính năng chưa mở"; không có lời gọi nào sang nền tảng TikTok.
3. **Given** nhân viên quản trị nội bộ có quyền, **When** bật TikTok cho một tài khoản (hoặc đổi mặc định hệ
   thống), **Then** thay đổi có hiệu lực cho tài khoản đó trong ≤ 1 phút **không cần phát hành**; mọi thay
   đổi được ghi nhật ký (ai, tài khoản nào, giá trị cũ → mới, lúc nào, lý do).
4. **Given** TikTok bật cho tài khoản, **When** chủ bấm "Kết nối TikTok" và cấp quyền, **Then** hệ thống kiểm
   tra điều kiện (User Story 3 áp dụng cho TikTok: tài khoản dùng được cho đăng bài, quyền đăng video đã cấp,
   hạn mức/thời lượng video tối đa của tài khoản nếu nền tảng cho biết) rồi tạo kết nối với trạng thái, ngày
   hết hạn và mã quyền mã hóa như Facebook/Instagram.
5. **Given** TikTok bật, **When** xem thẻ TikTok, **Then** có chú thích "TikTok chỉ đăng video" và giới hạn
   thời lượng/dung lượng (nếu biết) để người dùng không chọn nhầm bài chỉ có chữ/ảnh; ghi chú "đang thử
   nghiệm" nếu ứng dụng chưa qua xét duyệt (bài có thể bị nền tảng giới hạn hiển thị).
6. **Given** tài khoản đã có kết nối TikTok và cấu hình chuyển sang **tắt**, **When** việc kiểm tra cấu hình
   có hiệu lực, **Then** các kết nối TikTok chuyển "Tạm tắt do tính năng chưa mở": không chọn được cho bài
   mới, không làm mới/gửi bài, mã quyền **vẫn mã hóa và được giữ**, thẻ hiện duy nhất để người dùng **xem và
   ngắt**; bài đã lên lịch cho kênh đó được báo và xử lý như lỗi cần người dùng khi đến giờ (không gửi).
7. **Given** TikTok bật lại cho tài khoản đó, **When** hiệu lực, **Then** các kết nối quay về trạng thái đúng
   theo quyền hiện tại (kiểm tra lại điều kiện; hết hạn thì "Cần kết nối lại"); bài đã lên lịch dùng lại
   được qua "Đăng lại".
8. **Given** quyền của chính khách hàng, **When** khách muốn tự bật TikTok, **Then** không có cách nào (chỉ
   nhân viên quản trị nội bộ được đổi cấu hình); cộng tác viên, hỗ trợ **không** đổi được.
9. **Given** cấu hình bật/tắt, **When** kiểm tra giá trị, **Then** trạng thái "bật" chỉ đúng khi: có ghi
   đè theo tài khoản = bật, hoặc không có ghi đè và mặc định hệ thống = bật; ghi đè = tắt luôn thắng.

---

### Edge Cases

- **Người dùng đóng trình duyệt giữa chừng** ở màn hình của nền tảng hoặc ở bước chọn Page: không tạo kênh,
  không lưu mã quyền; dữ liệu tạm hết hạn sau 10 phút; lần sau bắt đầu lại sạch.
- **Quay lại bằng liên kết cũ / dùng lại mã trao đổi**: bị từ chối, nói "Phiên kết nối đã hết hạn, hãy bắt
  đầu lại"; mỗi phiên kết nối gắn với đúng người đang đăng nhập đã khởi động nó và chỉ dùng được một lần
  (chặn giả mạo luồng cấp quyền).
- **Người khác (không phải chủ) bấm liên kết kết nối đã bị chuyển tiếp**: bị từ chối vì phiên kết nối không
  thuộc người đó.
- **Chủ gỡ ứng dụng ngay trong cài đặt của Facebook/Instagram**: phát hiện qua việc kiểm tra hằng ngày hoặc
  lỗi lúc đăng; kênh chuyển "Cần kết nối lại" với lý do "quyền đã bị thu hồi".
- **Page bị xóa, bị khóa hoặc người dùng mất vai trò trên Page**: kiểm tra điều kiện báo lỗi tương ứng; kênh
  "Cần kết nối lại" (hoặc "Không đủ điều kiện") kèm hướng dẫn.
- **Instagram bị chuyển lại sang tài khoản cá nhân sau khi đã kết nối**: kiểm tra định kỳ/kiểm tra lại phát
  hiện và đổi trạng thái kèm hướng dẫn; không xóa kênh.
- **Nền tảng trả về lỗi tạm thời khi kiểm tra/làm mới**: không đổi kênh sang lỗi vì một lần thất bại; thử
  lại ở lần chạy sau; chỉ nhắc người dùng theo ngưỡng 7 ngày.
- **Cùng lúc Worker làm mới quyền và người dùng kết nối lại**: kết quả cuối phải nhất quán (không ghi đè
  quyền mới bằng quyền cũ); cập nhật quyền chặn ghi đè bằng số phiên bản.
- **Làm mới thành công nhưng quyền được cấp bị rút bớt**: kiểm tra điều kiện lại; thiếu quyền bắt buộc →
  "Cần kết nối lại" lý do "thiếu quyền".
- **Người dùng không có kết nối mạng ổn định trên điện thoại**: màn hình trạng thái hiển thị lỗi tải thân
  thiện kèm "Thử lại"; không hiện trạng thái cũ như thể mới.
- **Tên Page rất dài hoặc có ký tự đặc biệt/emoji**: hiển thị cắt gọn không vỡ bố cục (≤ 120 ký tự), không
  chạy mã lạ trong giao diện.
- **Chu kỳ hết hạn rơi vào ngày không tồn tại hoặc múi giờ**: ngày hết hạn lưu UTC, hiển thị UTC+7.
- **Cộng tác viên gọi trực tiếp API kết nối/ngắt** (bỏ qua giao diện): bị từ chối ở API, ghi nhật ký.
- **Hỗ trợ tra cứu kênh của khách**: chỉ thấy loại kênh, tên, trạng thái, ngày hết hạn, thời điểm kiểm tra,
  mã lỗi gốc gần nhất; mọi lần xem được ghi nhật ký kiểm toán; không thấy mã quyền.
- **Meta chưa duyệt ứng dụng (chế độ thử nghiệm)**: chỉ người được thêm làm thử nghiệm kết nối được; người
  khác nhận thông báo thân thiện "Tính năng kết nối đang được chuẩn bị", không phải lỗi thô.
- **Cấu hình TikTok đổi giữa chừng khi người dùng đang kết nối**: bước hoàn tất kiểm tra lại cấu hình; nếu đã
  tắt thì hủy phiên kết nối, không tạo kết nối, báo "Tính năng chưa mở cho tài khoản của bạn".
- **Cấu hình TikTok không đọc được** (lỗi tạm thời): coi như **tắt** (an toàn), ghi nhật ký; không làm hỏng
  màn hình Kênh kết nối của Facebook/Instagram.
- **Tắt TikTok khi có lượt đăng TikTok đang xử lý**: lượt đang xử lý hoàn tất theo luồng thường (không bỏ giữa
  chừng gây trạng thái không xác định); từ lượt kế tiếp mới bị chặn.
- **Một nền tảng đạt giới hạn kết nối, trong khi kết nối cũ đang "Cần kết nối lại"**: vẫn tính vào giới hạn;
  kết nối lại không tốn thêm chỗ.
- **Nhiều kết nối cùng hết hạn một ngày**: thông báo gom thành một email/một thông báo liệt kê từng kênh,
  không gửi N email riêng lẻ.
- **Hai Page được chọn nhưng một Page lỗi điều kiện**: Page đạt được kết nối, Page lỗi hiện lý do riêng; kết
  quả từng Page độc lập (không "tất cả hoặc không có gì").
- **Vượt giới hạn giữa lúc chọn nhiều Page** (số chọn > số chỗ còn lại): chặn ở bước xác nhận, không kết nối
  một phần ngoài ý muốn.
- **Khách có cấu hình ghi đè TikTok nhưng bị xóa tài khoản**: cấu hình bị xóa cùng dữ liệu tài khoản.

## Requirements *(mandatory)*

### Functional Requirements

**Cấp quyền và kết nối**

- **FR-001**: Hệ thống MUST cho **chủ tài khoản** (và chỉ chủ) bắt đầu kết nối **Facebook Page**, **Instagram
  chuyên nghiệp** và (khi được bật – FR-036) **TikTok** từ màn hình Kênh kết nối; quyền thao tác kiểm tra ở API (mã quyền
  `channel.manage`), không chỉ ẩn nút trên giao diện.
- **FR-002**: Việc cấp quyền MUST do người dùng chủ động đồng ý trên màn hình của nền tảng; hệ thống chỉ xin
  **các quyền tối thiểu cần để đăng bài và đọc trạng thái/đối soát bài của chính kênh đó** (danh sách quyền
  ghi ở kế hoạch), MUST NOT xin quyền ngoài nhu cầu đăng bài, MUST NOT xin quyền đọc dữ liệu cá nhân của
  người theo dõi.
- **FR-003**: Hệ thống MUST cho người dùng chọn đúng Page/tài khoản (hoặc xác nhận cái duy nhất) trong số
  những cái họ có quyền; MUST hiển thị tên + ảnh đại diện để nhận ra; được chọn **một hoặc nhiều** trong
  một lần cấp quyền, mỗi cái thành một kết nối riêng, kết quả kiểm tra điều kiện độc lập từng cái.
- **FR-004**: Phiên kết nối MUST gắn với người dùng và tài khoản đã khởi động nó (lấy từ phiên đăng nhập,
  MUST NOT nhận mã tài khoản từ tham số hay đường dẫn gửi lên), MUST chống giả mạo luồng cấp quyền, chỉ dùng
  được **một lần**, hết hạn sau **10 phút**; dữ liệu tạm giữa các bước MUST bị hủy khi hết hạn hoặc đã dùng.
- **FR-005**: Việc đăng nhập bằng Facebook (FR-15, tính năng 009) MUST độc lập với kết nối kênh: đăng nhập
  Facebook không tự kết nối Page; kết nối Page không tạo hay thay đổi cách đăng nhập.
- **FR-006**: Một Page Facebook, một tài khoản Instagram hoặc một tài khoản TikTok MUST chỉ thuộc **một tài khoản khách hàng** tại
  một thời điểm; kết nối thứ hai vào cùng kênh MUST bị từ chối với thông điệp nêu cách xử lý.
- **FR-007**: Một tài khoản MUST có thể có **nhiều kết nối cùng một nền tảng**, tối đa **N kết nối chưa ngắt
  cho mỗi nền tảng** (N là cấu hình, mặc định 5, có thể khác theo gói – xem Assumptions); vượt giới hạn MUST
  bị từ chối kèm số đã dùng/giới hạn và gợi ý ngắt bớt; kết nối đã ngắt không tính vào giới hạn; kết nối
  "Cần kết nối lại" vẫn tính.
- **FR-008**: Kết nối lại MUST giữ nguyên mã kênh và chỉ chấp nhận **cùng Page/tài khoản Instagram**; khác
  kênh gốc MUST bị từ chối, kênh hiện tại không đổi.

**Điều kiện tài khoản**

- **FR-009**: Trước khi lưu kết nối, hệ thống MUST kiểm tra điều kiện qua giao diện chung của bộ chuyển đổi
  nền tảng (ADR-05): (a) đủ quyền bắt buộc đã cấp; (b) người dùng có vai trò đủ để đăng bài trên Page; (c)
  với Instagram: là tài khoản chuyên nghiệp và đã liên kết với Page; (d) hạn mức đăng còn lại nếu nền tảng
  cho biết.
- **FR-010**: Khi không đủ điều kiện, hệ thống MUST **không** tạo kết nối, MUST nói bằng tiếng Việt đời thường
  điều kiện nào chưa đạt và MUST kèm ít nhất một hành động khắc phục (nguyên tắc VI); mã lỗi gốc chỉ hiện ở
  "Chi tiết cho hỗ trợ".
- **FR-011**: Hệ thống MUST cho chủ tài khoản "Kiểm tra lại" điều kiện của kênh bất cứ lúc nào, cập nhật
  trạng thái và thời điểm kiểm tra gần nhất; thao tác MUST bị giới hạn tần suất.
- **FR-012**: Kết quả kiểm tra thất bại **tạm thời** (nền tảng không phản hồi) MUST NOT làm đổi trạng thái
  kênh đang hoạt động; chỉ kết quả kiểm tra khẳng định "không đủ điều kiện" hoặc "quyền bị thu hồi" mới đổi.

**Lưu trữ mã hóa**

- **FR-013**: Mã quyền truy cập của nền tảng MUST được mã hóa khi lưu, bằng khóa do dịch vụ quản lý khóa giữ
  (không nằm trong cơ sở dữ liệu); chỉ module Cổng nền tảng được giải mã, chỉ trong lúc gọi nền tảng;
  MUST NOT lưu ở dạng rõ ở bất cứ nơi nào (kể cả hàng chờ, bộ nhớ đệm, tệp tạm).
- **FR-014**: Mã quyền, mã trao đổi và bí mật ứng dụng MUST NOT xuất hiện trong phản hồi giao diện, nhật ký,
  chỉ số, thông báo lỗi, email, màn hình hỗ trợ hay dữ liệu việc nền; giao diện công khai của Cổng nền tảng
  MUST NOT bao giờ trả mã quyền.
- **FR-015**: Dữ liệu kết nối MUST thuộc đúng một tài khoản khách hàng, cô lập theo nguyên tắc I (mã tài
  khoản từ phiên, bảo mật mức dòng, kiểm thử truy cập chéo bắt buộc); MUST NOT cache mã quyền đã giải mã và
  trạng thái quyền (Kiến trúc dữ liệu – cấm cache).
- **FR-016**: Hệ thống MUST lưu **dữ liệu tối thiểu**: loại kênh, mã và tên Page/tài khoản (≤ 120 ký tự),
  loại tài khoản, danh sách quyền đã cấp, ngày hết hạn, trạng thái, thời điểm kiểm tra/làm mới gần nhất, mã
  lỗi gốc gần nhất; MUST NOT lưu danh sách người theo dõi, tin nhắn, email hay số điện thoại của người dùng
  Facebook/Instagram.
- **FR-017**: Khi ngắt kết nối hoặc khi chủ yêu cầu xóa tài khoản (FR-14), mã quyền MUST bị xóa khỏi hệ thống
  **ngay**; hệ thống MUST cố yêu cầu nền tảng thu hồi quyền (nếu thất bại, vẫn xóa phía mình và báo người
  dùng có thể gỡ ứng dụng trong cài đặt nền tảng).

**Ngày hết hạn, làm mới, nhắc nhở**

- **FR-018**: Hệ thống MUST ghi và hiển thị **ngày hết hạn quyền** của từng kênh (UTC lưu, UTC+7 hiển thị);
  nếu nền tảng không có ngày hết hạn cố định thì MUST hiển thị rõ điều đó thay vì ngày giả.
- **FR-019**: Việc nền **hằng ngày** MUST cố làm mới quyền sắp hết hạn của mọi kênh đang hoạt động, chạy
  trong hàng chờ bền vững, mang mã tài khoản, đặt lại ngữ cảnh tenant, **chạy lại an toàn** (hai lần cho kết
  quả như một lần) và không làm mới đồng thời trùng cho cùng một kênh.
- **FR-020**: Khi quyền còn **< 7 ngày** mà chưa làm mới được, hệ thống MUST đặt trạng thái "Sắp hết hạn",
  gửi chủ tài khoản thông báo trong ứng dụng + email kèm nút "Kết nối lại"; nhắc lại khi còn 1 ngày và khi
  hết hạn, **không** gửi hằng ngày liên tục.
- **FR-021**: Khi quyền đã hết hạn / bị thu hồi / thiếu quyền bắt buộc, hệ thống MUST đặt trạng thái "Cần kết
  nối lại" kèm lý do dễ hiểu; kênh MUST không còn chọn được cho bài mới; MUST thông báo chủ tài khoản và nêu
  số bài đã lên lịch bị ảnh hưởng.
- **FR-022**: Lượt đăng đến giờ trên kênh "Cần kết nối lại" MUST được xử lý như lỗi **cần người dùng** theo
  FR-09 (không cố gửi bằng quyền hết hạn; thông điệp "Kết nối Facebook đã hết hạn. Vào Kết nối kênh để kết
  nối lại." kèm nút "Kết nối lại"); sau khi kết nối lại, có thể "Đăng lại" bằng một thao tác.
- **FR-023**: Khi bộ chuyển đổi nền tảng phát hiện lỗi quyền lúc đăng bài (Đăng bài – T4), kết quả MUST
  được phản ánh lại vào trạng thái kênh thông qua giao diện công khai của Cổng nền tảng (không để module
  Đăng bài ghi thẳng vào bảng kết nối).

**Màn hình Kênh kết nối**

- **FR-024**: Màn hình **Kênh kết nối** MUST liệt kê **mọi kết nối** của tài khoản (Facebook Page, Instagram
  và TikTok khi được bật), nhóm theo nền tảng, mỗi kết nối gồm: tên, ảnh đại diện, loại, trạng thái (chữ + biểu tượng), ngày hết hạn quyền, điều kiện tài khoản, hạn mức còn lại (chỉ khi
  có), thời điểm kiểm tra gần nhất; hành động theo trạng thái: Kết nối / Kết nối lại / Kiểm tra lại / Ngắt
  kết nối (UI/UX mục 8).
- **FR-025**: Trạng thái kênh MUST thuộc một trong: **Chưa kết nối, Đang hoạt động, Sắp hết hạn (< 7 ngày),
  Cần kết nối lại (hết hạn / thu hồi / thiếu quyền), Không đủ điều kiện, Tạm tắt (chỉ TikTok khi cấu hình tắt)**; mỗi trạng thái có chữ, biểu tượng
  và hành động khắc phục; không chỉ dựa vào màu.
- **FR-026**: Kênh sắp hết hạn hoặc cần kết nối lại MUST có cảnh báo nổi bật ở đầu màn hình và dấu chỉ báo ở
  menu điều hướng; trạng thái trống MUST có hướng dẫn kết nối kèm giải thích "chỉ đăng khi bạn bấm Duyệt".
- **FR-027**: Cộng tác viên MUST **xem** được màn hình (trạng thái, ngày hết hạn) nhưng MUST NOT kết nối, kết
  nối lại, kiểm tra lại hay ngắt; kiểm tra ở API. Hỗ trợ/quản trị chỉ đọc qua đường hỗ trợ có kiểm toán và
  MUST NOT thấy mã quyền. Cần bổ sung mã quyền xem kênh (`channel.view`) vào danh mục quyền (đặc tả mục 3.1
  hiện ghi "quyền xem kênh chưa có mã – chốt ở WBS 2.2").
- **FR-028**: Màn hình MUST dùng tiếng Việt đời thường, hoạt động từ 360 px, vùng chạm ≥ 44 × 44 px, đạt
  WCAG 2.1 AA; danh sách kênh hiển thị ≤ 1 giây và MUST NOT gọi sang nền tảng khi chỉ xem (dữ liệu đã lưu).
- **FR-029**: Hộp xác nhận "Ngắt kết nối" MUST nêu hậu quả (số bài đã lên lịch cho kênh bị ảnh hưởng) trước
  khi thực hiện; ngắt kết nối MUST không xóa bài và lịch sử đăng đã có.

**Truy vết, vận hành**

- **FR-030**: Mọi thao tác kết nối, kết nối lại, kiểm tra lại, ngắt kết nối và thay đổi trạng thái kênh MUST
  được ghi nhật ký kiểm toán (ai, kênh, lúc nào, kết quả, mã theo dõi), không chứa mã quyền hay dữ liệu cá
  nhân dư thừa; mỗi lần hỗ trợ xem thông tin kênh khách hàng MUST được ghi nhật ký.
- **FR-031**: Hệ thống MUST xuất chỉ số vận hành (số kênh theo trạng thái, số quyền sắp hết hạn, tỷ lệ làm
  mới thành công) gắn mã tài khoản theo chuẩn đo đạc của dự án; cảnh báo vận hành "quyền còn < 7 ngày" dùng
  chung cho nhắc người dùng (Hiến pháp VIII).
- **FR-032**: Lỗi từ nền tảng MUST được phân loại bằng bảng ánh xạ lỗi (cấu hình, đổi không cần phát hành):
  chắc chắn chưa nhận / cần người dùng / không xác định; mỗi dòng có thông điệp tiếng Việt và cách khắc phục.
- **FR-033**: Khi tài khoản hết hạn gói (FR-13), hệ thống MUST chặn kết nối mới nhưng vẫn cho xem và ngắt
  kết nối kênh hiện có.

**Quản lý nhiều kết nối**

- **FR-034**: Màn hình MUST cho **lọc theo nền tảng và theo trạng thái**, hiển thị số kết nối/giới hạn mỗi
  nền tảng, phân biệt kết nối trùng tên bằng ảnh đại diện + mã rút gọn; mọi thao tác (kết nối lại, kiểm tra
  lại, ngắt) áp dụng cho **từng kết nối riêng**, không ảnh hưởng kết nối khác.
- **FR-035**: Trạng thái, làm mới quyền, nhắc nhở hết hạn, kiểm tra điều kiện và giới hạn tần suất MUST tính
  **riêng từng kết nối**; thông báo cùng loại trong một đợt MUST được gom (một thông báo/một email liệt kê
  từng kênh). Mọi nơi chọn kênh để đăng (kế hoạch, bài, lịch) MUST chỉ cho chọn kết nối "Đang hoạt động" hoặc
  "Sắp hết hạn", và phân biệt được các kết nối cùng nền tảng.

**Kênh TikTok và công tắc bật/tắt theo khách hàng**

- **FR-036**: Hệ thống MUST có **cấu hình bật/tắt TikTok** gồm (a) **mặc định toàn hệ thống** (giá trị ban đầu
  **tắt**) và (b) **ghi đè theo từng tài khoản khách hàng** (bật hoặc tắt hoặc "theo mặc định"); TikTok được
  coi là bật cho tài khoản khi ghi đè = bật, hoặc không có ghi đè và mặc định = bật; ghi đè = tắt luôn thắng.
  Cấu hình MUST đổi được **không cần phát hành**, hiệu lực ≤ 1 phút.
- **FR-037**: Chỉ **quản trị nội bộ** (có quyền riêng, đề xuất mã quyền `feature.manage`; hỗ trợ, chủ, cộng tác
  viên không có) được đổi cấu hình; mỗi thay đổi MUST ghi nhật ký (ai, tài khoản, giá trị cũ → mới, thời
  điểm, lý do bắt buộc nhập) và không chứa dữ liệu cá nhân dư thừa.
- **FR-038**: Khi TikTok **tắt** cho tài khoản, hệ thống MUST: ẩn mọi giao diện nói về TikTok; từ chối ở API
  mọi thao tác kết nối/làm mới/kiểm tra/gửi bài TikTok (mã lỗi "tính năng chưa mở"); MUST NOT gọi sang
  TikTok. Kiểm tra MUST thực hiện ở API và Worker, không chỉ ở giao diện. Nếu không đọc được cấu hình MUST coi
  là tắt.
- **FR-039**: Khi TikTok chuyển từ bật sang tắt, kết nối TikTok đã có MUST chuyển "Tạm tắt": giữ mã quyền
  (vẫn mã hóa), không làm mới, không đăng, không chọn được cho bài mới; vẫn hiển thị để chủ **xem và ngắt**;
  bài đã lên lịch MUST được xử lý như lỗi cần người dùng khi đến giờ (FR-09). Bật lại MUST kiểm tra lại điều
  kiện và đặt trạng thái đúng theo quyền hiện tại.
- **FR-040**: Kết nối TikTok MUST tuân thủ cùng quy tắc với các nền tảng khác: cấp quyền tối thiểu do người
  dùng đồng ý (FR-002), kiểm tra điều kiện (FR-009; gồm quyền đăng video đã cấp và hạn mức/thời lượng video
  tối đa nếu nền tảng cho biết), mã hóa khi lưu (FR-013…FR-017), ngày hết hạn + làm mới + nhắc (FR-018…FR-022),
  không trùng giữa các tài khoản (FR-006), kiểm toán (FR-030). Giao diện MUST nêu rõ **TikTok chỉ đăng video**
  và, khi ứng dụng chưa qua xét duyệt của TikTok, đánh dấu "đang thử nghiệm".
- **FR-041**: TikTok MUST được thêm bằng **một bộ chuyển đổi nền tảng** sau giao diện chung (ADR-05) cùng bảng
  ánh xạ lỗi riêng; MUST NOT sửa luồng đăng chính; MUST có kiểm thử hợp đồng của bộ chuyển đổi và kịch bản
  giả lập cho phát triển/kiểm thử (khi chưa được TikTok duyệt, mọi kiểm thử dùng bản giả; staging/production
  MUST từ chối chạy bản giả như 005).

### Key Entities *(include if feature involves data)*

- **Feature setting (cấu hình tính năng, `feature_flags`)**: công tắc bật/tắt TikTok – giá trị mặc định toàn
  hệ thống (dữ liệu dùng chung, không có `account_id`) và ghi đè theo tài khoản (có `account_id`, bảo mật mức
  dòng; chỉ quản trị nội bộ ghi qua đường riêng có kiểm toán); kèm lý do, người đổi, thời điểm. Module sở hữu
  (Tài khoản & Gói hay Cổng nền tảng) chốt ở kế hoạch.
- **Channel connection (`channel_connections`, kết nối kênh)**: một kênh đã nối của một tài khoản – loại kênh
  (`facebook_page`, `instagram`, `tiktok`), mã và tên Page/tài khoản phía nền tảng, loại tài khoản, quyền đã cấp, mã
  quyền **đã mã hóa**, ngày hết hạn, trạng thái, thời điểm kiểm tra/làm mới gần nhất, mã lỗi gốc gần nhất,
  số phiên bản (chặn ghi đè), thời điểm kết nối/ngắt. Thuộc schema `platform_gateway`, có `account_id` và
  bảo mật mức dòng; các module khác chỉ tham chiếu theo mã kết nối (ADR-09), không khóa ngoại.
- **Connection session (phiên kết nối, tạm)**: dữ liệu giữa lúc cấp quyền và lúc chọn Page – gắn với người
  dùng khởi động, dùng một lần, hết hạn sau 10 phút, chứa mã quyền tạm ở dạng mã hóa, tự bị hủy.
- **Connection event / audit record**: bản ghi kiểm toán thao tác kết nối, kết nối lại, kiểm tra lại, ngắt,
  đổi trạng thái; không chứa mã quyền.
- **Error mapping (`error_mappings`)**: ánh xạ mã lỗi gốc của nền tảng sang loại lỗi + thông điệp + cách
  khắc phục (dùng chung với T4, dữ liệu dùng chung, không có `account_id`).
- **Notification**: thông báo "Quyền kênh sắp hết hạn / cần kết nối lại" gửi cho chủ qua module Thông báo.

*Ánh xạ tên (VN → EN) dùng trong tài liệu này:* `ket_noi_kenh` → `channel_connections`; `anh_xa_loi` →
`error_mappings`; `ket_noi_kenh_id` → `channel_connection_id`; `Cổng nền tảng` → `platform_gateway`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: ≥ 90% chủ tài khoản mới kết nối được Facebook Page đầu tiên **trong ≤ 3 phút** kể từ lúc bấm
  "Kết nối" (đo trên người dùng thử nghiệm và hệ thống kiểm thử giả lập), không cần hỗ trợ.
- **SC-002**: 100% kết nối thất bại vì điều kiện tài khoản (thiếu quyền, Instagram cá nhân, vai trò thấp)
  hiện thông điệp tiếng Việt đời thường **có ít nhất một hành động khắc phục** ngay tại màn hình kết nối;
  0 trường hợp phải nhìn mã lỗi gốc để hiểu việc cần làm.
- **SC-003**: **0** lần mã quyền hoặc bí mật xuất hiện ở dạng rõ trong dữ liệu lưu, phản hồi giao diện, nhật
  ký, chỉ số, thông báo, email, màn hình hỗ trợ – được kiểm tự động trong CI (quét bí mật trên nhật ký mẫu,
  kiểm thử đọc dữ liệu thô).
- **SC-004**: **0** truy cập chéo thành công giữa hai tài khoản trên kết nối kênh (đọc, sửa, ngắt, đoán mã) –
  kiểm thử truy cập chéo bắt buộc pass; một Page chỉ thuộc tối đa một tài khoản.
- **SC-005**: ≥ 95% quyền sắp hết hạn được **tự làm mới thành công** mà người dùng không phải làm gì; với
  phần còn lại, chủ tài khoản được cảnh báo **≥ 7 ngày trước** khi hết hạn trong ≥ 99% trường hợp.
- **SC-006**: Sau khi quyền bị thu hồi hoặc hết hạn, trạng thái kênh được cập nhật và người dùng được thông
  báo trong **≤ 24 giờ** (hoặc ngay khi một lượt đăng phát hiện); **0** bài bị gửi lên nền tảng bằng quyền đã
  biết là hết hạn.
- **SC-007**: Màn hình Kênh kết nối hiển thị trong **≤ 1 giây**, dùng được ở 360 px, đạt WCAG 2.1 AA; 100%
  trạng thái có chữ + biểu tượng.
- **SC-008**: Kết nối lại cùng Page **không làm mất hay đổi** bất kỳ bài đã lên lịch nào (100% bài giữ nguyên
  kênh và giờ) – kiểm thử tự động.
- **SC-009**: Thu hồi quyền khi ngắt kết nối hoặc yêu cầu xóa tài khoản: mã quyền bị xóa khỏi hệ thống ngay
  trong cùng thao tác (100%).
- **SC-011**: Với khách hàng có TikTok **tắt**, **0** thành phần giao diện nhắc tới TikTok và **0** lời gọi
  sang TikTok (kiểm thử tự động trên giao diện, API và Worker); đổi cấu hình có hiệu lực ≤ 1 phút và 100% lần
  đổi có bản ghi kiểm toán.
- **SC-012**: Khi bật TikTok theo mặc định hệ thống sau khi được TikTok duyệt, việc mở cho toàn bộ khách hàng
  **không cần phát hành** phiên bản mới (chỉ đổi cấu hình).
- **SC-013**: Với tài khoản có nhiều kết nối (≥ 3 mỗi nền tảng), lỗi/hết hạn của một kết nối ảnh hưởng **0**
  kết nối khác; người dùng tìm đúng kết nối cần xử lý trong ≤ 10 giây (lọc theo trạng thái); vượt giới hạn
  luôn bị từ chối rõ lý do.
- **SC-010**: Có bản chạy được luồng kết nối thật (môi trường thử nghiệm) để đưa vào video và hồ sơ **nộp xét
  duyệt Meta**, thể hiện đủ: cấp quyền, chọn Page, điều kiện tài khoản, ngắt kết nối/thu hồi.

## Assumptions

- **Phạm vi kênh**: Facebook Page, Instagram chuyên nghiệp và TikTok (sau công tắc). Zalo OA là tính năng
  riêng (cùng giao diện chung và màn hình, nhưng ngoài phạm vi). Màn hình thiết kế để thêm nhóm kênh mới mà
  không đổi bố cục (ADR-05).
- **TikTok đưa vào giai đoạn 1 ở dạng tắt**: theo yêu cầu của PO; trái với ghi chú "TikTok giai đoạn sau"
  ở đặc tả yêu cầu/ADR-05 nên cần cập nhật các tài liệu đó. Rủi ro: ứng dụng chưa được TikTok xét duyệt nên
  chưa thể kiểm chứng với dịch vụ thật; mọi phát triển/kiểm thử dùng bản giả lập, và hành vi thật (hạn chế
  của ứng dụng chưa duyệt, thời hạn quyền, hạn mức thời lượng video) kiểm chứng sau, cùng POC-2.
- **Số lượng kết nối**: tối đa **N = 5 kết nối chưa ngắt cho mỗi nền tảng mỗi tài khoản** (mặc định đề xuất;
  cấu hình, có thể thay theo gói). Con số này không đổi hạn mức 100 bài/chu kỳ hay 5 GB. Nếu khách cần hơn là
  quyết định gói/giá cần PO duyệt riêng (làm ở `/speckit-clarify`).
- **Công tắc TikTok**: do quản trị nội bộ đặt, không có màn hình khách hàng tự bật; mặc định toàn hệ thống =
  tắt; ghi đè theo tài khoản dùng để mở cho khách thử nghiệm. Khi TikTok duyệt: đổi mặc định sang bật. Công
  tắc không dùng để chặn Facebook/Instagram (nằm ngoài phạm vi, nhưng cơ chế đủ chung để dùng cho tính năng
  khác sau này mà không cần làm lại).
- **Hiệu lực cấu hình**: ≤ 1 phút nên được phép lưu đệm ngắn; không thuộc nhóm "cấm cache" của Kiến trúc dữ
  liệu (không phải ngân sách, hạn mức, trạng thái đăng hay quyền truy cập nền tảng).
- **Instagram đi cùng Page**: mỗi tài khoản Instagram chuyên nghiệp phải liên kết với một Facebook Page (đúng
  ADD module Đăng bài mục 7). Người dùng có thể kết nối Instagram mà không kết nối Facebook Page đăng bài và
  ngược lại; hệ thống không bắt buộc cả hai.
- **TikTok chỉ đăng video**: bộ chuyển đổi TikTok giai đoạn đầu chỉ nhận bài có video; quy tắc media (định
  dạng, thời lượng) lấy qua giao diện chung "quy tắc media của kênh" (đặc tả mục 5 ghi TikTok giới hạn thời
  lượng theo từng tài khoản).
- **Ngày hết hạn**: nhiều loại quyền của nền tảng có thể không có ngày hết hạn cố định; khi đó giao diện
  nói rõ như vậy và việc kiểm tra hằng ngày vẫn phát hiện thu hồi. Hạn chính xác và cách làm mới xác nhận ở
  POC-2 / giai đoạn kế hoạch.
- **Quyền xem kênh của cộng tác viên**: bổ sung mã quyền `channel.view` (chủ + CTV), `channel.manage` giữ
  cho chủ – cập nhật danh mục quyền ở đặc tả mục 3.1 khi hoàn thành tính năng.
- **Bài đã lên lịch khi ngắt kênh rồi kết nối lại**: bài giữ gắn với kết nối cũ nên không tự đăng; chủ phải
  chọn lại kênh cho bài – tránh đăng nhầm lên kênh khác. Kết nối lại **không ngắt** (cùng mã kênh) thì lịch
  giữ nguyên.
- **Ngưỡng nhắc**: nhắc khi còn < 7 ngày, nhắc lại ở 1 ngày và khi hết hạn (theo UI/UX mục 8 và hiến pháp
  VIII); gom thông báo để tránh spam.
- **Xét duyệt của Meta**: trước khi được duyệt, chỉ người được thêm làm tài khoản thử nghiệm của ứng dụng
  kết nối được; sau duyệt mới mở cho khách hàng thật. Hồ sơ nộp cần luồng kết nối + đăng bài (phụ thuộc T3,
  T4) và đã có trang chính sách quyền riêng tư & điều khoản (P5).
- **Dữ liệu xuyên biên giới**: Meta nhận nội dung bài chủ động duyệt đăng; trong luồng kết nối hệ thống chỉ
  nhận về thông tin kênh tối thiểu (tên, mã, loại, quyền). Meta đã nằm trong danh sách bên nhận nước ngoài
  (Kiến trúc dữ liệu mục 9); hồ sơ đánh giá tác động Q-D3/C6 chốt trước ngày ra mắt.
- **Hạ tầng**: khóa mã hóa do dịch vụ quản lý khóa của nhà cung cấp đám mây (K5); chưa có môi trường thật thì
  dùng bản khóa giả lập cho phát triển, và môi trường staging/production từ chối chạy với bản giả (như 005).
- **Hạn mức bài/ngày của nền tảng**: chỉ hiển thị khi nền tảng cho biết; việc áp dụng hạn mức khi lên lịch
  thuộc tính năng Duyệt & lịch (FR-06) và Đăng bài (T4).
- **Người dùng và thiết bị**: chủ kinh doanh cá nhân, ưu tiên điện thoại, mạng 4G, không có đội kỹ thuật –
  mọi thông điệp dùng ngôn ngữ đời thường.
- **Ngoài phạm vi**: thực hiện đăng bài/đối soát (T4), tạo hàng loạt, công cụ hỗ trợ sửa kết nối thay khách,
  đăng nhập bằng Facebook (009), quản trị gói, màn hình quản trị cấu hình riêng (giai đoạn 1 có thể đổi qua
  thao tác nội bộ có kiểm toán; giao diện quản trị chốt ở kế hoạch), Zalo OA.
- **Quyền mới đề xuất**: `channel.view` (chủ + CTV), `feature.manage` (chỉ quản trị nội bộ) – cập nhật danh
  mục quyền ở đặc tả mục 3.1.
