# Feature Specification: Thư viện media cơ bản – tải thẳng (nhiều tệp, có tiếp tục), chuẩn hóa JPEG, ảnh thu nhỏ, giới hạn 5 GB, đường dẫn công khai có hạn

**Feature Branch**: `014-media-library-basic`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Dựa vào tài liệu kiến trúc và mô tả phần mềm của chương trình, viết tài liệu mô tả tính năng 'Thư viện media cơ bản: tải thẳng (nhiều tệp, có tiếp tục), chuẩn hóa JPEG, ảnh thu nhỏ, giới hạn 5 GB, đường dẫn công khai có hạn' đáp ứng mô tả, kiến trúc dự án"

**Truy vết**: FR-03 (phần **cơ bản**: tải ảnh (FR-03 ghi ≤ 10 MB; **đã làm rõ: nhận tới 20 MB**, hệ thống tự nén khi chuẩn hóa) và video ≤ 500 MB; từ chối khi vượt 5 GB/tài khoản; tệp trùng
nội dung không bị xử lý lại; cảnh báo media không hợp giới hạn kênh) · FR-07 (nền tảng tải media qua đường dẫn công
khai có hạn) · FR-14 (xóa tệp media khi xóa tài khoản ≤ 30 ngày) · NFR Hiệu năng (tải trang đầu ≤ 3 giây trên 4G) ·
NFR Dung lượng (≤ 500 GB cho 100 tài khoản, chịu gấp 10) · Đặc tả yêu cầu mục 3.1 (mã quyền `media.upload`) · Kiến
trúc dữ liệu D-5, mục 7 (bố cục kho tệp), mục 8.3 (nhất quán giữa CSDL và kho tệp), mục 9 (bên nhận dữ liệu – CDN) ·
Kiến trúc triển khai mục 7.3 (luồng media), mục 6 (hàng chờ `media`) · ADD tổng thể (module Thư viện media) · ADD Đăng
bài (lấy đường dẫn công khai có hạn) · UI/UX mục 6 (màn hình **Thư viện ảnh & video**) · ADR-07a (tải thẳng lên kho
tệp, chuẩn hóa JPEG, đường dẫn công khai có hạn) · WBS **T5** · Hiến pháp nguyên tắc **I** (tệp dưới tiền tố tài
khoản), **V** (tải thẳng, việc nền chạy lại an toàn, tệp trùng), **IV** (module sở hữu schema riêng), **VII** (dữ
liệu trong nước), **VI** (giao diện tiếng Việt, hướng dẫn khắc phục).

**Phụ thuộc**: `002-db-layer-tenant-rls` (bảng của tài khoản, RLS) · `003-queue-layer-pgboss` (hàng chờ `media`,
khóa chống trùng, giới hạn đồng thời theo tenant) · `004-minimal-auth-rbac` (phiên, quyền `media.upload`) ·
`005-gateway-contracts-fakes` (giao diện kho tệp, cấp đường dẫn ký sẵn) · `011-ui-architecture-foundation` (khung
giao diện, hệ thống trạng thái). Tính năng **cung cấp** cho `012-manual-compose-approval-calendar` (đính media vào
bài) và `013-publish-five-steps` (bước 2 "chuẩn bị media" lấy đường dẫn công khai có hạn).

**Bối cảnh**: Bài đăng của chủ cửa hàng gần như luôn cần ảnh hoặc video, và Instagram **bắt buộc** có media. Hiện
chưa có nơi nào để người dùng cất ảnh/video của mình: soạn bài (012) chỉ có vùng đính media rỗng, còn đăng bài (013)
chưa có tệp thật để đưa cho nền tảng. Tính năng này tạo **kho ảnh & video của từng tài khoản**: người dùng tải nhiều
tệp một lúc (kể cả video lớn, mạng yếu vẫn tiếp tục được), hệ thống tự chuẩn hóa ảnh để mọi kênh đăng được, tạo ảnh
thu nhỏ để lướt thư viện nhanh, chặn khi vượt 5 GB, và cấp đường dẫn công khai **có thời hạn** để nền tảng tải tệp khi
đăng. Tệp không đi qua máy chủ ứng dụng. **Không** thuộc phạm vi (thuộc T11 và các tính năng sau): gán nhãn bằng AI
(ảnh, video, lời nói), tìm theo nhãn, sửa/xóa nhãn, gợi ý media cho bài, chuẩn hóa video theo từng kênh, chỉnh sửa
ảnh/video, thư mục/album, chia sẻ giữa các tài khoản. Vì chưa có gán nhãn, thư viện cơ bản tìm theo **tên tệp, loại,
ngày tải**.

## Clarifications

### Session 2026-11-16

- Q: Cộng tác viên có được xóa media không, hay chỉ chủ tài khoản? → A: C – cộng tác viên chỉ xóa được tệp do chính mình tải lên; chủ tài khoản xóa được mọi tệp.
- Q: Tải lại tệp trùng nội dung thì xử lý thế nào? → A: A – luôn dùng lại tệp cũ, chỉ báo "đã có" kèm liên kết; không có lựa chọn giữ thêm bản.
- Q: Xóa media đang nằm trong bài nháp thì sao? → A: A – cho xóa sau cảnh báo + xác nhận, cảnh báo phải nêu rõ **bài nào** đang dùng media; bài nháp hiện "Media đã bị xóa" và phải chọn media khác trước khi gửi duyệt.
- Q: Ảnh nặng hơn 10 MB (ảnh điện thoại đời mới) xử lý thế nào? → A: C – nhận ảnh tới 20 MB, hệ thống nén phía máy chủ khi chuẩn hóa; vẫn trừ dung lượng theo tệp gốc. **Lệch với FR-03 (≤ 10 MB) và ADR-07 – cần sửa Đặc tả yêu cầu/ADR hoặc ghi nhận ở plan (hiến pháp: mâu thuẫn tài liệu phải được giải quyết).**
- Q: Độ phân giải của bản JPEG chuẩn hóa? → A: A – thu nhỏ để cạnh dài nhất ≤ 2048 px với chất lượng JPEG cố định; ảnh nhỏ hơn giữ nguyên kích thước.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tải nhiều ảnh/video lên thư viện (Priority: P1)

Chủ cửa hàng hoặc cộng tác viên mở **Thư viện ảnh & video**, kéo thả (hoặc chọn) nhiều tệp cùng lúc. Mỗi tệp hiện
một dòng tiến độ riêng; khi xong, tệp xuất hiện trong lưới với ảnh thu nhỏ. Tệp lớn không làm giao diện đứng, tệp lỗi
không chặn các tệp còn lại.

**Why this priority**: Không có media trong kho thì mọi tính năng phía sau (đính vào bài, đăng Instagram, gán nhãn)
đều không có gì để làm. Đây là lát cắt nhỏ nhất đã có giá trị: người dùng cất được ảnh/video của mình.

**Independent Test**: Đăng nhập, chọn cùng lúc 5 ảnh hợp lệ và 1 video 200 MB → cả 6 tệp lên trạng thái "Sẵn sàng",
có ảnh thu nhỏ trong lưới, dung lượng đã dùng tăng đúng bằng tổng kích thước tệp.

**Acceptance Scenarios**:

1. **Given** người dùng có quyền tải media và còn dung lượng, **When** kéo thả 6 tệp hợp lệ vào thư viện, **Then**
   mỗi tệp hiện tiến độ riêng (phần trăm, "Đang tải" → "Đang xử lý" → "Sẵn sàng"), các tệp tải song song có giới hạn
   (không tải cả chục tệp cùng lúc làm nghẽn mạng), và khi xong thì lưới hiện đủ 6 ô.
2. **Given** đang tải 6 tệp, **When** 1 tệp không hợp lệ (sai định dạng, ảnh > 20 MB, video > 500 MB), **Then** tệp đó
   bị từ chối ngay **trước khi tải** với lý do bằng chữ + cách khắc phục ("Ảnh tối đa 20 MB – hãy giảm kích thước rồi
   tải lại"), 5 tệp còn lại vẫn tải bình thường.
3. **Given** người dùng đang ở điện thoại, **When** mở thư viện, **Then** có nút chọn tệp/chụp từ máy ảnh, vùng chạm
   ≥ 44 × 44 px, hoạt động từ chiều rộng 360 px.
4. **Given** vai trò **hỗ trợ** hoặc quản trị nội bộ, **When** gọi thao tác tải lên, **Then** bị từ chối ở API (quyền
   kiểm tra ở máy chủ, không chỉ ẩn nút).

---

### User Story 2 - Tải lên bị gián đoạn vẫn tiếp tục được (Priority: P1)

Người dùng tải video 400 MB bằng 4G, giữa chừng mất sóng, đóng tab, hoặc điện thoại khóa màn hình. Khi quay lại và
chọn lại đúng tệp đó, hệ thống tiếp tục từ phần đã lên thay vì bắt đầu lại từ đầu.

**Why this priority**: Khách hàng là chủ cửa hàng dùng điện thoại, mạng không ổn định; video tới 500 MB mà phải tải
lại từ 0 mỗi lần rớt mạng sẽ khiến họ bỏ cuộc. Đây là yêu cầu rõ ràng trong mô tả ("có tiếp tục").

**Independent Test**: Bắt đầu tải một video 300 MB, ngắt mạng khi đạt ~50%, bật lại → tải tiếp tục từ khoảng 50% (không
tải lại phần đã lên) và hoàn tất; thử thêm trường hợp đóng tab rồi mở lại, chọn lại cùng tệp.

**Acceptance Scenarios**:

1. **Given** đang tải một tệp lớn, **When** mất mạng, **Then** tiến độ chuyển sang "Tạm dừng – đang chờ mạng", tự động
   thử tiếp khi có mạng trở lại, không mất phần đã tải và không cần người dùng bấm gì.
2. **Given** người dùng đã đóng tab khi tải dở, **When** mở lại thư viện và chọn lại đúng tệp đó, **Then** hệ thống
   nhận ra phiên tải dở của tệp này (cùng tài khoản) và chỉ tải phần còn thiếu; tiến độ hiển thị bắt đầu từ phần đã
   có.
3. **Given** một lần tải dở đã quá thời hạn giữ (xem FR-009), **When** người dùng chọn lại tệp, **Then** hệ thống bắt đầu
   lại từ đầu như tệp mới và nói rõ "Lần tải trước đã hết hạn, đang tải lại từ đầu".
4. **Given** quyền tải (đường dẫn ký sẵn) hết hạn giữa chừng khi tải rất lâu, **When** tiếp tục tải, **Then** hệ thống
   tự xin quyền mới trong cùng phiên tải mà người dùng không thấy lỗi.
5. **Given** tải xong nhưng tệp đến kho bị sai/hỏng (kích thước hoặc dấu tệp không khớp), **When** hệ thống xác nhận,
   **Then** tệp không được chuyển sang "Sẵn sàng", báo "Tệp bị lỗi khi tải – tải lại", dung lượng giữ chỗ được trả
   lại.

---

### User Story 3 - Ảnh được chuẩn hóa và có ảnh thu nhỏ (Priority: P1)

Sau khi tải, mỗi ảnh được hệ thống chuyển thành một bản JPEG chuẩn để mọi kênh (đặc biệt Instagram, chỉ nhận JPEG) đăng
được, và có thêm ảnh thu nhỏ để lưới thư viện, màn hình soạn bài tải nhanh trên 4G. Video có ảnh thu nhỏ lấy từ một
khung hình. Người dùng không phải biết gì về định dạng.

**Why this priority**: Nếu ảnh PNG/WebP/HEIC của điện thoại không đăng được lên Instagram thì người dùng chỉ nhận lỗi
ở phút chót; không có ảnh thu nhỏ thì thư viện 100+ ảnh tải rất chậm (NFR ≤ 3 giây).

**Independent Test**: Tải 1 ảnh PNG, 1 ảnh HEIC chụp từ iPhone, 1 ảnh JPEG xoay bằng thông tin hướng → mỗi ảnh có bản
JPEG chuẩn đúng chiều, ảnh thu nhỏ đúng chiều; lưới thư viện chỉ tải ảnh thu nhỏ, không tải ảnh gốc.

**Acceptance Scenarios**:

1. **Given** ảnh hợp lệ định dạng không phải JPEG, **When** xử lý xong, **Then** có bản JPEG chuẩn dùng cho việc đăng;
   ảnh gốc được giữ nguyên, bản chuẩn không thay thế ảnh gốc.
2. **Given** ảnh chụp bằng điện thoại có thông tin xoay (hướng chụp), **When** chuẩn hóa và tạo ảnh thu nhỏ, **Then**
   cả hai hiển thị đúng chiều như người dùng thấy trên máy.
3. **Given** ảnh JPEG đã đúng chuẩn, **When** xử lý, **Then** vẫn có bản chuẩn và ảnh thu nhỏ (luồng đồng nhất, không
   nhánh đặc biệt cho người dùng thấy).
4. **Given** video, **When** xử lý xong, **Then** có ảnh thu nhỏ từ một khung hình đại diện và hiển thị biểu tượng
   video + thời lượng; video **giữ nguyên** (không chuyển mã trong tính năng này).
5. **Given** xử lý chuẩn hóa thất bại (tệp hỏng, không đọc được), **When** hệ thống hết số lần thử lại tự động, **Then**
   tệp hiện "Không xử lý được" kèm cách khắc phục ("Hãy thử xuất lại ảnh từ máy rồi tải lên lại") và nút **Xóa**;
   không chặn các tệp khác, không giữ chỗ dung lượng vô ích.
6. **Given** một việc xử lý bị chạy lại (Worker khởi động lại, hết hạn khóa), **When** chạy lại, **Then** kết quả cuối
   giống hệt, không sinh tệp trùng hay ghi đè sai.

---

### User Story 4 - Giới hạn 5 GB mỗi tài khoản và biết mình đã dùng bao nhiêu (Priority: P1)

Thư viện luôn hiển thị "Đã dùng x / 5 GB". Khi tệp mới sẽ làm vượt 5 GB, hệ thống từ chối **trước khi tải** và gợi ý
xóa bớt, không để người dùng tải xong 400 MB rồi mới biết bị chặn. Nhiều người trong cùng tài khoản tải cùng lúc cũng
không vượt được trần.

**Why this priority**: Giới hạn 5 GB là điều kiện kinh tế của gói (≤ 500 GB cho 100 tài khoản) và là yêu cầu của FR-03;
nếu kiểm tra sau khi tải thì tốn băng thông, và nếu không chặn đồng thời thì có thể vượt trần.

**Independent Test**: Tài khoản đang dùng 4,9 GB; tải một video 300 MB → bị từ chối ngay với lời gợi ý xóa. Hai người
cùng tài khoản đồng thời tải mỗi người 400 MB khi còn trống 500 MB → đúng một tệp được nhận, tệp kia bị từ chối.

**Acceptance Scenarios**:

1. **Given** dung lượng còn lại nhỏ hơn kích thước tệp, **When** người dùng chọn tệp, **Then** tệp bị từ chối ngay với
   "Thư viện đã đầy (4,9/5 GB). Hãy xóa bớt ảnh/video cũ rồi tải lại" và nút dẫn tới danh sách để xóa; không có
   byte nào được tải lên.
2. **Given** thư viện đầy 5 GB, **When** người dùng mở thư viện, **Then** vùng tải lên bị chặn kèm giải thích, nhưng
   mọi chức năng khác (xem, xóa, soạn tay, duyệt, đăng) vẫn dùng bình thường.
3. **Given** hai thao tác tải cùng lúc trong một tài khoản, **When** tổng kích thước vượt dung lượng còn lại, **Then**
   tổng dung lượng đã giữ chỗ + đã dùng **không bao giờ vượt 5 GB** (kể cả khi bấm nhiều lần nhanh, từ nhiều thiết
   bị).
4. **Given** một lần tải bị hủy, lỗi, hoặc quá hạn chưa hoàn tất, **When** hệ thống dọn dẹp, **Then** phần dung lượng
   giữ chỗ cho tệp đó được trả lại đầy đủ (không rò rỉ dung lượng).
5. **Given** người dùng xóa một tệp, **When** hoàn tất, **Then** dung lượng đã dùng giảm đúng bằng kích thước tệp đó
   (xem User Story 6).
6. **Given** dung lượng đã dùng ≥ 80% (4 GB), **When** mở thư viện, **Then** hiện cảnh báo "Sắp đầy" bằng chữ + biểu
   tượng (không chỉ dựa vào màu).

---

### User Story 5 - Nền tảng tải media qua đường dẫn công khai có hạn (Priority: P2)

Khi đăng bài, tính năng Đăng bài (013) cần đưa ảnh/video cho Facebook/Instagram bằng một đường dẫn mà nền tảng tải
được mà **không cần đăng nhập**. Thư viện cấp đường dẫn đó **chỉ cho đúng một tệp** và **tự hết hạn** sau một thời gian
(mặc định 24 giờ). Người dùng cuối không phải làm gì; còn trong giao diện, ảnh xem trước dùng đường dẫn ngắn hạn riêng.

**Why this priority**: Là điều kiện để đăng thật (013) và để xem trước ảnh trong ứng dụng. Xếp P2 vì người dùng không
thao tác trực tiếp; nhưng là hợp đồng bắt buộc với tính năng 013 và là điểm rủi ro riêng tư lớn nhất của thư viện.

**Independent Test**: Gọi thao tác cấp đường dẫn cho một media → mở đường dẫn trong cửa sổ ẩn danh thấy đúng tệp; sau
khi hết hạn (dùng đồng hồ giả lập) → không tải được nữa; dùng đường dẫn của tài khoản A để đoán đường dẫn tệp khác →
không tải được.

**Acceptance Scenarios**:

1. **Given** media "Sẵn sàng" của tài khoản A, **When** module Đăng bài xin đường dẫn công khai, **Then** nhận được
   đường dẫn tới **bản chuẩn hóa** (ảnh) hoặc bản gốc (video) với thời hạn mặc định 24 giờ, tải được không cần đăng
   nhập.
2. **Given** đường dẫn đã hết hạn, **When** có người (hoặc nền tảng) mở lại, **Then** bị từ chối; muốn dùng tiếp phải xin
   đường dẫn mới.
3. **Given** đường dẫn của một tệp, **When** sửa đường dẫn để trỏ tới tệp khác (kể cả tệp của tài khoản khác), **Then**
   không tải được: mỗi đường dẫn chỉ mở được đúng một tệp cụ thể.
4. **Given** thư viện hiển thị lưới, **When** nạp ảnh thu nhỏ/ảnh xem trước, **Then** dùng đường dẫn **ngắn hạn** (≤ 1
   giờ) cấp riêng cho người đang đăng nhập, và chỉ cấp cho media của chính tài khoản đó.
5. **Given** media đã bị xóa (đánh dấu xóa), **When** có yêu cầu cấp đường dẫn mới, **Then** từ chối ("Tệp đã bị xóa");
   đường dẫn đã cấp trước đó còn tác dụng tối đa đến hết hạn (chấp nhận, ghi rõ).
6. **Given** vai trò người dùng bất kỳ, **When** muốn tự lấy đường dẫn công khai 24 giờ để dán ở chỗ khác, **Then** giao
   diện **không** cung cấp (đường dẫn này chỉ do hệ thống cấp cho việc đăng; tránh lộ ảnh ngoài ý muốn).

---

### User Story 6 - Xem, tìm, xóa media (Priority: P2)

Người dùng xem lưới ảnh/video, xem một tệp ở kích thước lớn, lọc theo loại/ngày tải, tìm theo tên tệp, và xóa tệp
không còn cần để lấy lại dung lượng. Tệp đang dùng trong bài đã lên lịch thì không xóa được và nói rõ vì sao.

**Why this priority**: Thư viện đầy 5 GB mà không xóa được thì User Story 4 thành ngõ cụt. Xếp P2 vì có thể phát hành
thư viện chỉ tải lên + dùng trước, nhưng xóa là cần để vận hành lâu dài.

**Independent Test**: Tải 3 tệp, lọc "Video" chỉ còn video; tìm theo tên; xóa 1 ảnh chưa dùng → biến mất khỏi lưới
ngay, dung lượng giảm; thử xóa ảnh đang dùng trong bài "Đã lên lịch" → bị chặn kèm danh sách bài dùng.

**Acceptance Scenarios**:

1. **Given** thư viện có nhiều tệp, **When** mở, **Then** hiện lưới sắp xếp mới nhất trước, mỗi ô có ảnh thu nhỏ, loại
   (ảnh/video + thời lượng), trạng thái bằng chữ + biểu tượng, và thanh "Đã dùng x / 5 GB".
2. **Given** lưới, **When** lọc theo loại (ảnh/video), khoảng ngày tải, hoặc nhập tên tệp, **Then** kết quả đúng và
   chỉ gồm media của tài khoản hiện tại.
3. **Given** thư viện rỗng, **When** mở lần đầu, **Then** hiện trạng thái trống có hướng dẫn "Tải ảnh/video đầu tiên"
   và nêu giới hạn (ảnh ≤ 20 MB, video ≤ 500 MB).
4. **Given** người dùng có quyền xóa tệp đó (chủ: mọi tệp; cộng tác viên: tệp mình tải), **When** xóa một tệp **chưa**
   được bài nào dùng, **Then** tệp biến mất khỏi lưới
   ngay, dung lượng đã dùng giảm đúng kích thước, việc xóa tệp thật trong kho chạy nền sau đó.
5. **Given** tệp đang được ít nhất một bài **đã lên lịch/đã duyệt** dùng, **When** xóa, **Then** bị chặn với "Ảnh đang
   dùng trong 2 bài đã lên lịch" kèm danh sách từng bài (liên kết mở bài) và cách xử lý (đổi media của bài trước); không có trạng thái xóa dở.
6. **Given** tệp đang được bài **nháp** hoặc bài đã đăng dùng, **When** xóa, **Then** hộp xác nhận liệt kê **từng bài**
   đang dùng (tiêu đề + trạng thái, mỗi bài là liên kết mở bài đó) trước khi cho xóa; sau khi xác nhận, bài nháp mất
   tham chiếu, hiển thị "Media đã bị xóa" thay vì lỗi và không gửi duyệt được cho tới khi chọn media khác (nếu kênh
   cần media); bài đã đăng không bị ảnh hưởng (nền tảng đã có bản riêng).
7. **Given** người dùng bấm vào một ô, **When** mở xem chi tiết, **Then** thấy ảnh/video kích thước lớn (đường dẫn ngắn
   hạn), tên, kích thước, kích thước điểm ảnh, thời lượng (video), ngày tải, người tải.

---

### User Story 7 - Tệp trùng nội dung không tốn chỗ và không xử lý lại (Priority: P3)

Người dùng lỡ tải lại đúng tệp đã có (cùng nội dung, kể cả đổi tên). Hệ thống nhận ra, không tạo bản thứ hai, không
tính thêm dung lượng, không xử lý lại, và báo "Tệp này đã có trong thư viện".

**Why this priority**: Tiết kiệm dung lượng, tài nguyên xử lý và là nền cho T11 (gán nhãn không chạy AI lại cho tệp
trùng). Không chặn việc dùng thư viện nên P3.

**Independent Test**: Tải một ảnh, rồi tải lại cùng ảnh đã đổi tên → thư viện vẫn một ô, dung lượng không đổi, thông
báo "đã có" dẫn tới ô hiện có. Tài khoản B tải đúng ảnh đó → vẫn được tạo bản riêng, không biết tệp có ở tài khoản A.

**Acceptance Scenarios**:

1. **Given** tệp X "Sẵn sàng" trong tài khoản A, **When** A (hoặc cộng tác viên của A) tải lại tệp cùng nội dung, **Then**
   không tạo bản mới, không tốn dung lượng, hiện "Tệp này đã có trong thư viện" kèm liên kết tới tệp hiện có.
2. **Given** tệp X ở tài khoản A, **When** tài khoản B tải cùng nội dung, **Then** B có bản riêng đầy đủ, tính dung
   lượng của B; hệ thống **không** tiết lộ cho B rằng tệp từng tồn tại ở nơi khác (không dùng chung giữa tài
   khoản).
3. **Given** hai thiết bị cùng tài khoản tải cùng một tệp gần như đồng thời, **When** cả hai xong, **Then** chỉ còn một
   media và dung lượng chỉ tính một lần.
4. **Given** tệp X đã bị xóa, **When** tải lại, **Then** được xem là tệp mới hoàn toàn.

---

### Edge Cases

- **Tên tệp chứa ký tự đặc biệt/tiếng Việt có dấu/rất dài**: giữ tên hiển thị gốc (cắt gọn khi hiển thị), nhưng đường
  dẫn lưu trữ không phụ thuộc tên tệp; không lỗi, không cho phép "../" hay ký tự điều khiển chuyển thành đường dẫn.
- **Sai đuôi tệp**: tệp đặt đuôi `.jpg` nhưng bên trong là loại khác (kể cả tệp thực thi/HTML/SVG có script) → bị từ
  chối dựa trên **nội dung thật**, không chỉ đuôi hoặc loại do trình duyệt khai báo.
- **Ảnh rất lớn về điểm ảnh nhưng nhỏ về dung lượng** (vd 20.000 × 20.000): bị từ chối với lý do rõ khi vượt giới hạn
  kích thước điểm ảnh, tránh làm treo xử lý.
- **Ảnh động (GIF/WebP động)**: giai đoạn này **không nhận** (xem Assumptions); thông báo rõ, không âm thầm lấy khung
  hình đầu.
- **Tệp 0 byte, tệp hỏng, tệp tải thiếu**: bị từ chối/đánh dấu lỗi, không ở trạng thái lửng lơ.
- **Đóng tab lúc đang tải rồi không bao giờ quay lại**: bản ghi "Đang tải" và phần tệp dở bị dọn sau thời hạn, dung
  lượng giữ chỗ được trả lại; không để tệp mồ côi trong kho.
- **Tệp có trong kho nhưng không có bản ghi (mồ côi)** hoặc có bản ghi mà tệp mất: việc dọn dẹp định kỳ phát hiện và
  xử lý; tệp mất hiển thị lỗi cho người dùng + cách khắc phục (tải lại) thay vì ô trống.
- **Hai người cùng xóa một tệp / một người xóa khi người kia đang gắn vào bài**: kết quả nhất quán, không âm; kiểm tra
  "đang dùng" tại thời điểm xóa.
- **Mất kết nối giữa lúc API xác nhận tải xong**: xác nhận có thể gọi lại an toàn (cùng kết quả), không tạo hai media.
- **Xử lý (chuẩn hóa) chậm vì nhiều tệp**: giới hạn số việc media đồng thời mỗi tài khoản để một tài khoản tải 100 ảnh
  không làm nghẽn việc đăng bài của tài khoản khác; ảnh vẫn hiện trong lưới (trạng thái "Đang xử lý") và dùng được
  ngay khi xử lý xong.
- **Ảnh đã có nhưng bản chuẩn hóa chưa xong khi đến giờ đăng**: Đăng bài (013) coi đó là chưa sẵn sàng (xem hợp đồng
  ở FR-016); không đăng ảnh gốc sai định dạng.
- **Xóa tài khoản / hết hạn gói giữ 90 ngày**: toàn bộ tệp của tài khoản (gốc, bản chuẩn, ảnh thu nhỏ, tạm) bị xóa theo
  vòng đời dữ liệu; không còn đường dẫn mới nào được cấp sau yêu cầu xóa.
- **Gói hết hạn**: vẫn xem và xóa được; việc tải lên bị chặn theo quy tắc gói (xem FR-018).
- **Hết giờ đăng nhập khi đang tải dở**: phiên tải dở không bị mất; sau khi đăng nhập lại có thể tiếp tục như User
  Story 2.

## Requirements *(mandatory)*

### Functional Requirements

**Tải lên (FR-03, ADR-07a)**

- **FR-001**: Người dùng có quyền `media.upload` (chủ và cộng tác viên) MUST tải được **nhiều tệp trong một lần chọn**
  (kéo thả hoặc chọn tệp; trên điện thoại có thể chụp trực tiếp); mỗi tệp có tiến độ và trạng thái riêng, một tệp lỗi
  không làm hỏng các tệp khác.
- **FR-002**: Tệp MUST được tải **thẳng từ trình duyệt lên kho tệp** bằng đường dẫn ký sẵn có hạn; tệp MUST NOT đi qua
  máy chủ API. API chỉ kiểm tra, cấp quyền tải và xác nhận khi tải xong.
- **FR-003**: Hệ thống MUST kiểm tra **trước khi cho tải**: loại tệp thuộc danh sách chấp nhận (xem Assumptions), ảnh ≤
  20 MB, video ≤ 500 MB, tệp không rỗng, và còn đủ dung lượng (FR-008). Tệp vi phạm bị từ chối kèm lý do bằng tiếng Việt
  và cách khắc phục; các tệp hợp lệ khác trong cùng lần chọn vẫn tiếp tục.
- **FR-004**: Sau khi tải xong, API MUST **xác nhận** (tệp có tồn tại, kích thước đúng, tính dấu nội dung) và kiểm tra
  loại tệp theo **nội dung thật** (không tin đuôi tệp/loại khai báo). Tệp không đạt MUST bị loại, dung lượng giữ chỗ trả
  lại, người dùng nhận thông báo kèm cách khắc phục. Thao tác xác nhận MUST an toàn khi gọi lặp lại (không tạo hai
  media).
- **FR-005**: Việc tải MUST **tiếp tục được** sau khi gián đoạn (mất mạng, đóng tab, tắt máy): tải lại từ phần đã lên
  mà không gửi lại phần đã có, bao gồm cả khi người dùng quay lại sau và chọn lại đúng tệp. Phiên tải dở MUST được giữ
  tối thiểu **24 giờ** rồi bị dọn (xem FR-009). Tải lớn MUST chia thành nhiều phần để chỉ phần lỗi phải gửi lại.
- **FR-006**: Khi quyền tải hết hạn giữa chừng, hệ thống MUST tự cấp quyền mới cho cùng phiên tải; người dùng không
  thấy lỗi. Tải tiếp tục MUST chỉ dùng được cho đúng tài khoản đã bắt đầu phiên đó.
- **FR-007**: Giao diện MUST giới hạn số tệp tải song song (mặc định 3), hiển thị tiến độ từng tệp, cho **hủy** từng
  tệp đang tải, và cho **thử lại** tệp lỗi mà không phải chọn lại.

**Giới hạn dung lượng (FR-03, D-5)**

- **FR-008**: Mỗi tài khoản MUST có tối đa **5 GB** media. Trước khi cấp quyền tải, hệ thống MUST **giữ chỗ** đúng kích
  thước tệp bằng một cập nhật có điều kiện trong cùng giao dịch với việc tạo bản ghi; không đủ chỗ → từ chối, không tải
  byte nào. Tổng (đã dùng + đang giữ chỗ) MUST NOT vượt 5 GB dù nhiều người/nhiều thiết bị tải đồng thời. Dung lượng
  đã dùng MUST được tính bằng **kích thước tệp gốc** người dùng tải lên; bản chuẩn hóa và ảnh thu nhỏ do hệ thống tạo
  MUST NOT tính vào hạn mức của người dùng.
- **FR-009**: Giữ chỗ dung lượng MUST được trả lại khi: người dùng hủy, tải lỗi/không đạt kiểm tra, xử lý thất bại hẳn,
  hoặc bản ghi "Đang tải" quá hạn (tối đa 24 giờ kể từ lần hoạt động cuối). Một việc dọn dẹp định kỳ MUST xóa bản ghi
  và tệp dở quá hạn, và phát hiện tệp mồ côi trong kho. Việc dọn dẹp MUST chạy lại an toàn.
- **FR-010**: Giao diện MUST luôn hiển thị "Đã dùng x / 5 GB" dạng chữ + thanh tiến độ, cảnh báo khi ≥ 80%, và khi đầy
  MUST chặn **chỉ** việc tải lên (kèm hướng dẫn xóa bớt) mà không chặn xem, xóa, soạn, duyệt, lên lịch, đăng.

**Chuẩn hóa & ảnh thu nhỏ (ADR-07a)**

- **FR-011**: Sau khi xác nhận tải xong, hệ thống MUST xử lý nền (hàng chờ `media`): mỗi **ảnh** → tạo bản **JPEG chuẩn
  hóa** (sửa đúng chiều theo thông tin hướng chụp, loại bỏ thông tin vị trí và dữ liệu cá nhân nhúng trong ảnh) và
  **ảnh thu nhỏ**; mỗi **video** → tạo **ảnh thu nhỏ** từ một khung hình đại diện và ghi thời lượng. Tệp gốc MUST được giữ
  nguyên, không bị ghi đè. Bản JPEG chuẩn hóa MUST có cạnh dài nhất ≤ 2048 px (ảnh nhỏ hơn giữ nguyên kích thước, không phóng to) và chất lượng JPEG cố định, để ảnh tải lên tới 20 MB vẫn cho ra bản đăng được, đủ nét cho bài đăng và nhỏ gọn.
- **FR-012**: Xử lý MUST **chạy lại an toàn**: chạy lại cùng một việc cho cùng kết quả, không nhân đôi tệp, không để dở
  trạng thái. Lỗi tạm thời MUST tự thử lại có giãn cách (mặc định tối đa 3 lần); hết lần thử MUST chuyển media sang
  "Không xử lý được" kèm cách khắc phục và **trả lại** dung lượng giữ chỗ.
- **FR-013**: Media MUST dùng được (đính vào bài, đăng) ngay khi xử lý xong, **không phụ thuộc** gán nhãn AI hay ngân
  sách AI (tính năng này không gọi AI). Trong lúc "Đang xử lý", media hiển thị trong thư viện nhưng chưa chọn được để
  đính vào bài, kèm lời giải thích.
- **FR-014**: Mỗi tài khoản MUST có giới hạn số việc media chạy đồng thời (mặc định theo cấu hình hàng chờ `media`,
  hiện **1 việc/tài khoản**; chỉnh được không cần phát hành), để một tài khoản tải số lượng lớn không làm chậm việc của
  tài khoản khác hay làm trễ việc đăng bài.

**Đường dẫn công khai có hạn (ADR-07a, FR-07)**

- **FR-015**: Module Thư viện media MUST cung cấp cho module Đăng bài một thao tác nội bộ cấp **đường dẫn công khai có
  hạn** cho **một media cụ thể** (mặc định 24 giờ, cấu hình được), mở được không cần đăng nhập, **không** mở được tệp
  nào khác, và tự hết hạn. Thao tác này chỉ cấp cho media ở trạng thái sẵn sàng của chính tài khoản đang xử lý lượt đăng
  (không nhận mã tài khoản từ tham số của người dùng).
- **FR-016**: Hợp đồng với Đăng bài MUST nêu rõ: ảnh trả về bản **JPEG chuẩn hóa**; video trả về bản gốc; media chưa
  sẵn sàng hoặc đã xóa → trả lỗi phân loại rõ ("chưa sẵn sàng", "đã xóa") để Đăng bài xử lý theo FR-08/FR-09 của mình;
  thông tin về quy tắc media của từng kênh (định dạng, dung lượng, thời lượng) thuộc bộ chuyển đổi nền tảng, thư viện chỉ
  cung cấp thuộc tính của tệp (loại, kích thước byte, kích thước điểm ảnh, thời lượng) để so sánh.
- **FR-017**: Giao diện MUST hiển thị ảnh thu nhỏ/ảnh xem trước bằng đường dẫn **ngắn hạn** (≤ 1 giờ) cấp cho người
  đang đăng nhập và chỉ cho media của tài khoản của họ. Giao diện MUST NOT cung cấp cách tự lấy đường dẫn công khai dài
  hạn.

**Phân quyền, cô lập, vòng đời**

- **FR-018**: Quyền MUST được kiểm tra ở API: tải lên theo `media.upload` (chủ, cộng tác viên); xem thư viện: chủ và
  cộng tác viên; **xóa** media: **chủ tài khoản** xóa được mọi media của tài khoản, **cộng tác viên chỉ xóa được media do chính
  mình tải lên** (kiểm tra ở API theo người tải; thử xóa tệp của người khác → từ chối kèm giải thích); vai trò
  hỗ trợ/quản trị nội bộ không thao tác trên thư viện của khách hàng. Khi gói hết hạn, tải lên MUST bị chặn nhưng xem và xóa vẫn được.
- **FR-019**: Mọi media MUST thuộc đúng một tài khoản lấy từ phiên đăng nhập (không từ tham số/đường dẫn do người dùng
  gửi); mọi tệp MUST nằm dưới tiền tố riêng của tài khoản trong kho tệp; bảng media của khách hàng MUST bật cô lập mức
  dòng. Đường dẫn ký sẵn MUST chỉ cấp đúng tiền tố đó, và tài khoản này MUST NOT đọc, tải, xem, xóa được media của tài
  khoản khác dù biết mã.
- **FR-020**: Tệp **trùng nội dung trong cùng tài khoản** MUST NOT tạo bản thứ hai, MUST NOT tính thêm dung lượng, MUST
  NOT bị xử lý lại; người dùng nhận thông báo và liên kết tới tệp đã có; giao diện MUST NOT cho giữ thêm bản
  thứ hai, và tên hiển thị của tệp hiện có giữ nguyên (không bị đổi theo tên tệp tải lại). Tệp trùng **giữa các tài khoản** MUST NOT dùng
  chung hay bị tiết lộ cho nhau.
- **FR-021**: Xóa media MUST: đánh dấu xóa trước (biến mất khỏi lưới và trả dung lượng ngay), việc nền xóa các tệp thật
  (gốc, chuẩn hóa, ảnh thu nhỏ) sau, chạy lại an toàn; MUST chặn nếu media đang được **bài đã duyệt/đã lên lịch** dùng
  và liệt kê **từng bài** đó (tiêu đề, trạng thái, liên kết) cùng cách xử lý. Với bài **nháp** và bài đã đăng, MUST
  cho xóa sau khi cảnh báo liệt kê đúng các bài đang dùng và người dùng xác nhận. Việc tra cứu "bài nào đang dùng
  media" MUST đi qua giao diện công khai của module sở hữu bài, không đọc bảng của module khác, và chỉ trả bài của
  chính tài khoản.
- **FR-022**: Khi tài khoản bị xóa hoặc quá thời hạn lưu giữ, toàn bộ tệp media (gốc, bản chuẩn, ảnh thu nhỏ, tệp
  tạm) MUST bị xóa theo vòng đời dữ liệu; sau yêu cầu xóa không cấp thêm đường dẫn nào cho tài khoản đó.
- **FR-023**: Dữ liệu media MUST lưu ở kho tệp đặt tại đám mây trong nước; ảnh MUST được loại thông tin vị trí khi tạo
  bản dùng để đăng (FR-011); mã/đường dẫn ký sẵn MUST NOT xuất hiện trong nhật ký, chỉ số hay thông báo lỗi.

**Tìm, xem, trải nghiệm**

- **FR-024**: Thư viện MUST có lưới ảnh/video mới nhất trước, lọc theo loại và khoảng ngày tải, tìm theo tên tệp, xem
  chi tiết một tệp, phân trang/nạp dần để vẫn nhanh với hàng trăm tệp, ảnh thu nhỏ nạp theo nhu cầu.
- **FR-025**: Mọi trạng thái (Đang tải, Tạm dừng, Đang xử lý, Sẵn sàng, Lỗi, Không xử lý được) MUST hiển thị bằng chữ +
  biểu tượng, không chỉ màu; thông báo lỗi MUST bằng tiếng Việt đời thường, kèm ít nhất một hành động khắc phục; mã lỗi
  gốc chỉ nằm trong "Chi tiết cho hỗ trợ".
- **FR-026**: Giao diện MUST đạt WCAG 2.1 AA, vùng chạm ≥ 44 × 44 px, hoạt động từ chiều rộng 360 px, hỗ trợ bàn phím
  cho thao tác chọn tệp/xóa; thao tác tải bằng kéo thả MUST có cách thay thế bằng nút chọn tệp.

**Quan sát & tin cậy**

- **FR-027**: Mỗi lần tải/xử lý/xóa MUST ghi nhật ký có cấu trúc gắn mã tài khoản và mã theo dõi; chỉ số MUST gồm số tệp
  tải thành công/thất bại, thời gian xử lý, tuổi việc `media` chờ lâu nhất, dung lượng đã dùng toàn hệ thống. Việc `media`
  chờ lâu hơn ngưỡng (mặc định > 10 phút) MUST kích hoạt cảnh báo vận hành.
- **FR-028**: Hệ thống MUST NOT đưa vào bộ nhớ đệm các số liệu quyết định hạn mức (dung lượng đã dùng/giữ chỗ); số
  liệu này MUST luôn đọc/ghi trực tiếp từ nguồn dữ liệu chính.

### Key Entities *(include if feature involves data)*

- **Media**: một ảnh hoặc video của một tài khoản. Thuộc tính: tài khoản sở hữu, loại (ảnh/video), tên hiển thị, kích
  thước byte của tệp gốc, kích thước điểm ảnh, thời lượng (video), dấu nội dung, trạng thái (Đang tải · Đang xử lý ·
  Sẵn sàng · Lỗi · Không xử lý được), người tải, thời điểm tải, dấu thời gian xóa mềm. Duy nhất theo (tài khoản, dấu
  nội dung). Là nguồn tham chiếu cho bài (012) và lượt đăng (013) qua mã tham chiếu, không qua khóa ngoại chéo module.
- **Phiên tải lên (Upload Session)**: một lần tải của một tệp: media đích, dung lượng đã giữ chỗ, các phần đã lên,
  thời điểm hoạt động cuối, hạn giữ. Cho phép tiếp tục tải; quá hạn thì bị dọn và trả giữ chỗ.
- **Bản biểu diễn (Rendition)**: tệp phái sinh do hệ thống tạo từ gốc: bản JPEG chuẩn hóa (ảnh), ảnh thu nhỏ (ảnh và
  video). Không tính vào hạn mức của người dùng; xóa cùng media.
- **Dung lượng tài khoản (Storage Quota)**: số byte đã dùng và đang giữ chỗ của tài khoản so với trần 5 GB; cập nhật
  có điều kiện cùng giao dịch với thao tác tải/xóa.
- **Đường dẫn truy cập có hạn (Expiring Link)**: quyền tải tạm thời cho đúng một tệp; loại ngắn hạn cho giao diện
  (≤ 1 giờ), loại cho nền tảng (24 giờ) chỉ do hệ thống cấp; không lưu thành dữ liệu lâu dài.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Người dùng chọn 10 ảnh hợp lệ (mỗi ảnh ≤ 5 MB) trên mạng 4G và thấy cả 10 ảnh ở trạng thái "Sẵn sàng"
  trong lưới trong **≤ 2 phút** từ khi chọn, không cần thao tác gì thêm.
- **SC-002**: Khi một lần tải video bị ngắt (mất mạng/đóng tab) rồi tiếp tục, **không quá 5%** dung lượng tệp phải tải
  lại (đo trên video 300 MB ngắt ở nhiều thời điểm khác nhau); 95% lần tiếp tục thành công không cần người dùng chọn
  lại ngoài việc chọn đúng tệp.
- **SC-003**: Với lô **≤ 10 tệp**, 95% ảnh có bản JPEG chuẩn và ảnh thu nhỏ **≤ 30 giây** sau khi tải xong; 95% video có
  ảnh thu nhỏ **≤ 2 phút**. (Lô lớn hơn xử lý nối đuôi theo giới hạn ở FR-014 nên thời gian chờ tăng theo số tệp.)
- **SC-004**: **100%** ảnh hợp lệ (JPEG, PNG, WebP, HEIC) sau xử lý được Instagram chấp nhận về mặt định dạng; **0** ảnh
  hiển thị sai chiều trong bộ kiểm tra ảnh chụp bằng điện thoại.
- **SC-005**: **0 trường hợp** tổng dung lượng của một tài khoản vượt 5 GB trong kiểm thử tải đồng thời (≥ 20 yêu cầu
  song song/nhiều thiết bị); thông báo "thư viện đầy" xuất hiện **trước** khi tải byte đầu tiên trong **100%** trường
  hợp.
- **SC-006**: **0 trường hợp** tài khoản này xem, tải, sửa hoặc xóa được media của tài khoản khác ở mọi cổng (giao diện,
  API, đường dẫn ký sẵn, đường dẫn công khai); **100%** đường dẫn công khai ngừng tải được sau khi hết hạn (kiểm thử
  bằng đồng hồ giả lập).
- **SC-007**: Mở thư viện có 200 tệp trên 4G hiện được lưới đầu tiên trong **≤ 3 giây**; chuyển bộ lọc **≤ 1 giây**.
- **SC-008**: Tệp trùng nội dung trong cùng tài khoản: **100%** không tạo bản thứ hai, không tốn thêm dung lượng, không
  chạy lại xử lý.
- **SC-009**: Sau mọi tình huống lỗi/hủy/quá hạn, dung lượng giữ chỗ được trả lại đầy đủ: sau 24 giờ + một chu kỳ dọn
  dẹp, chênh lệch giữa dung lượng ghi nhận và tổng tệp thực tế của mọi tài khoản = **0**; **0** tệp mồ côi tồn tại quá 7
  ngày.
- **SC-010**: Một tài khoản tải 100 ảnh liên tiếp **không** làm việc đăng bài của tài khoản khác trễ quá 5 phút (không
  vượt lệch lịch cho phép).
- **SC-011**: Người dùng mới hoàn thành "tải ảnh đầu tiên và thấy nó trong thư viện" ở **lần thử đầu tiên** trong ≥ 90%
  phiên kiểm thử người dùng; mọi thông báo lỗi trong thử nghiệm đều có hướng dẫn khắc phục mà người thử hiểu được.

## Assumptions

- **Định dạng chấp nhận**: ảnh JPEG, PNG, WebP, HEIC/HEIF (ảnh iPhone); video MP4 và MOV. Ảnh động (GIF/WebP động),
  RAW, SVG và các định dạng khác chưa nhận ở giai đoạn này. Danh sách cuối cùng chốt ở `/speckit-plan` theo khả năng
  của thư viện xử lý ảnh/video đã chọn; thay đổi danh sách không đổi hành vi của đặc tả.
- **Giới hạn bổ sung (mặc định, cấu hình được)**: ảnh tối đa **20 MB** (đã làm rõ; FR-03 gốc ghi 10 MB – xem mục Clarifications) và tối đa **~50 triệu điểm ảnh** mỗi ảnh; video tối
  đa 500 MB; chưa giới hạn thời lượng video (khớp FR-03: video dài vẫn tải được); tối đa 3 tệp tải song song mỗi trình
  duyệt; việc `media` đồng thời mỗi tài khoản theo `infra.queue_settings` (hiện 1 – đối chiếu ở plan, kiến trúc triển
  khai mục 6).
- **Video không chuyển mã** trong tính năng này: chuẩn hóa video theo quy tắc từng kênh (nếu cần) thuộc bộ chuyển đổi
  nền tảng/tính năng Đăng bài; thư viện chỉ cung cấp tệp gốc, thuộc tính (thời lượng, kích thước) và ảnh thu nhỏ.
- **Hạn mức tính theo tệp gốc** người dùng tải lên; bản chuẩn hóa và ảnh thu nhỏ do hệ thống tạo là chi phí lưu trữ
  của nền tảng, không trừ vào 5 GB của người dùng (ước tính thêm ~10–20% dung lượng kho, vẫn trong ngân sách 500 GB
  ×1,2 của kiến trúc; kiểm lại ở plan).
- **Gán nhãn AI, tìm theo nhãn, gợi ý media cho bài** là T11 (FR-03 phần còn lại); tính năng này chuẩn bị chỗ gắn
  (trạng thái, dấu nội dung duy nhất theo tài khoản) nhưng **không gọi AI** nên không phụ thuộc Cổng AI, ngân sách AI
  hay chi phí; không hiển thị số tiền nào cho khách hàng.
- **Quyền xóa** (đã làm rõ 2026-11-16): chủ xóa được mọi media; cộng tác viên chỉ xóa media do mình tải lên. Đặc tả
  yêu cầu ghi "sửa nhãn, xóa tệp chốt ở WBS 2.6" nên cần cập nhật bảng phân quyền (thêm mã quyền xóa media, ghi
  điều kiện "chỉ tệp của mình" cho cộng tác viên) khi lập kế hoạch.
- **Thời hạn mặc định**: phiên tải dở giữ **24 giờ** (kiến trúc dữ liệu nêu bản ghi "Đang tải" quá 1 giờ bị dọn – ở
  đây phiên **có thể tiếp tục** giữ lâu hơn để tiếp tục tải; **đã đối chiếu ở plan: giữ 24 giờ**, và sửa Kiến trúc dữ liệu 8.1/Kiến trúc triển khai
  mục 6 theo – plan.md mục "Sửa tài liệu gốc", D4–D5); quyền tải ký sẵn ≤ 15 phút mỗi lần cấp (tự cấp lại); đường dẫn xem trong giao diện ≤ 1
  giờ; đường dẫn công khai cho nền tảng 24 giờ.
- **Tính năng 012 và 013 hiện dùng media giả lập (005)** cho tới khi thư viện này sẵn sàng; khi có thư viện thật,
  việc nối là thay bản giả lập bằng giao diện công khai của module (đính media, cấp đường dẫn công khai, kiểm tra
  "đang dùng"), không đổi luồng của hai tính năng đó.
- **Giao diện** dùng khung và hệ thống trạng thái của `011-ui-architecture-foundation`; màn hình theo UI/UX mục 6
  "Thư viện ảnh & video". Người dùng đã đăng nhập, có chủ và tối đa 2 cộng tác viên mỗi tài khoản (`004`).
- **Giai đoạn 1 chỉ có kho tệp tương thích S3 của nhà cung cấp trong nước** (ADR-10) và CDN trong nước phân phối ảnh
  xem trước; không thêm dịch vụ mới (hiến pháp IX).
- **Dung lượng toàn hệ thống** ≤ 500 GB cho 100 tài khoản (D-5); thiết kế không đổi kiến trúc khi gấp 10 lần.
