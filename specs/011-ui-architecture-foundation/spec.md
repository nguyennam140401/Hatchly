# Feature Specification: Nền tảng kiến trúc giao diện – bộ thành phần dùng chung theo thiết kế, khung ứng dụng, nền tảng biểu mẫu, quản lý dữ liệu dùng chung phía giao diện

**Feature Branch**: `011-ui-architecture-foundation`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Dựa trên tài liệu kiến trúc, các tính năng của chương trình và thiết kế tại Figma ('Nhịp – Thư viện thiết kế', trang 'Thành phần'), hãy tạo yêu cầu thiết kế kiến trúc giao diện: dựng các base cần thiết cho các form, component cho thiết kế và cả cách quản lý data dùng chung của chương trình, component. Gợi ý giúp cả các thư viện cần thiết phục vụ thiết kế."

**Truy vết**: UI/UX mục 3 (nguyên tắc thiết kế), mục 4 (kiến trúc thông tin, điều hướng), mục 6 (mô tả màn
hình), mục 7 (hệ thống trạng thái hiển thị), mục 9 (phân quyền trên giao diện), mục 10 (yêu cầu chung: hiệu
năng cảm nhận, WCAG 2.1 AA, vùng chạm ≥ 44 × 44 px, từ 360 px, tiếng Việt UTC+7, trình duyệt, tải tệp) ·
FR-06 (AI đề xuất, chủ duyệt; "Đã sửa sau khi duyệt"), FR-08 (tiến trình đăng 5 bước), FR-09 (lỗi cần người
dùng xử lý), FR-11/FR-12 (ngân sách AI – chỉ hiện %, không hiện số tiền) · NFR hiệu năng (tải trang đầu ≤ 3 giây
trên 4G, chuyển màn hình ≤ 1 giây) · Hiến pháp nguyên tắc VI (AI đề xuất – người quyết định, tiếng Việt đời
thường, mỗi lỗi một hành động, WCAG), III (không hiện số tiền AI), I (mã tài khoản không do giao diện gửi), IX
(đơn giản, chuẩn mở, thư viện quan trọng cố định phiên bản) · ADD tổng thể mục 8.3 (quyền kiểm tra ở API) ·
Thiết kế Figma trang "Thành phần" (nút 4 kiểu × 2 trạng thái, huy hiệu trạng thái, thẻ kênh, thanh mức sử dụng,
thẻ chủ đề, thẻ bài, thanh điều hướng dưới/bên, thanh trên, cảnh báo nội dòng, chip, tab kênh, dòng bước, dòng
kênh, ô ngày, mục lịch, ô nhập, bộ biểu tượng).

**Phụ thuộc**: `001-monorepo-module-skeleton` (ứng dụng web một trang, quy tắc web chỉ nhập gói dùng chung) ·
`004-minimal-auth-rbac` (phiên, vai trò, mã quyền – nguồn của giao diện biết "được làm gì") · `006-sample-module-business-profile`
(trang Hồ sơ kinh doanh – mẫu biểu mẫu đầu tiên, có chặn rời trang khi chưa lưu, xử lý xung đột phiên bản) ·
`009-social-login-members` (các trang đăng nhập/thành viên đã có). Tính năng này **không** thêm chức năng
nghiệp vụ mới; nó là nền để các tính năng giao diện sau (kênh kết nối, soạn bài, lịch, duyệt, thư viện media,
tổng quan, gói & mức sử dụng) dựng nhanh và nhất quán.

**Bối cảnh**: Hiện tại web mới có vài trang (đăng nhập, đăng ký, bảo mật, hồ sơ kinh doanh) và mỗi nhóm trang tự
định nghĩa kiểu dáng riêng (khối kiểu dáng trong từng thư mục, màu và cỡ chữ viết cứng, không có khung điều
hướng, không có cơ chế dùng chung cho dữ liệu lấy từ máy chủ, quyền, thông báo). Thiết kế Figma đã chốt một bộ
thành phần đầy đủ cho các màn hình còn lại. Nếu mỗi tính năng tiếp theo tự dựng lại nút, huy hiệu trạng thái,
biểu mẫu, cách tải dữ liệu và cách báo lỗi thì giao diện sẽ lệch nhau, khó đạt WCAG, và mỗi lỗi hiển thị phải
sửa ở nhiều nơi. Tính năng này dựng **một nền duy nhất**: bộ giá trị thiết kế dùng chung, bộ thành phần khớp
Figma, khung ứng dụng có điều hướng theo quyền, nền tảng biểu mẫu, và quy tắc quản lý dữ liệu dùng chung; đồng
thời chuyển các trang hiện có sang nền này để chứng minh nền dùng được.

## Clarifications

### Session 2026-11-15

- Q: Cấu trúc điều hướng chính theo Figma hay theo UI/UX v1.3? → A: Theo Figma — thanh bên 7 mục (Tổng quan, Lịch, Bài viết, Thư viện ảnh & video, Hồ sơ kinh doanh, Kênh & gói, Cài đặt); thanh dưới 5 mục (Tổng quan, Lịch, Bài viết, Thêm, Tạo bài); cập nhật UI/UX mục 4 cho khớp.
- Q: "Đăng tay" trên thẻ kênh/dòng kênh nghĩa là gì? → A: Khả năng của kênh do máy chủ báo: kênh chưa có hoặc chưa bật cổng đăng tự động thì bài chuyển "chờ đăng tay"; người dùng tự đăng rồi bấm "Đã đăng". Giao diện chỉ hiển thị, không tự quyết.
- Q: Bản nháp chưa gửi giữ ở đâu khi phiên hết hạn? → A: Chỉ trong bộ nhớ của tab đang mở; mất khi đóng tab; xóa khi đăng xuất hoặc đổi tài khoản; không ghi ra bộ lưu lâu dài. Kèm yêu cầu bổ sung: hết phiên giữa lúc đang làm việc KHÔNG được đẩy người dùng ra đột ngột (xem FR-011a). Cơ chế phiên hiện có (tính năng 004) là cookie phiên có hạn không hoạt động trượt + hạn tuyệt đối, không có refresh token; giao diện không tự gia hạn mà chỉ xử lý phản hồi "chưa đăng nhập".
- Q: "Gợi ý hôm nay" có là trạng thái bài không; "Đã hủy" hiển thị thế nào? → A: "Gợi ý hôm nay" là nhãn riêng cho chủ đề/thẻ gợi ý, không thuộc bảng trạng thái bài. Bảng trạng thái bài có 7 trạng thái theo UI/UX mục 7 (Nháp, Chờ duyệt, Đã lên lịch, Đang đăng, Đã đăng, Cần bạn xử lý, Đã hủy); cần người thiết kế thêm biến thể "Đã hủy" vào Figma.
- Q: Thay đổi do người khác gây ra hiện cho người đang mở ứng dụng thế nào? → A: Chỉ làm mới khi mở màn hình hoặc quay lại tab, không làm mới định kỳ, không kênh đẩy. Bù lại, mọi thao tác ghi trên một bản ghi dùng chung (sửa, duyệt, trả lại, đổi giờ, đăng lại…) phải kiểm tra phiên bản: nếu bài đã bị người khác thay đổi thì hiện cảnh báo "Bài viết đã được thay đổi" để người dùng xem lại trước khi tiếp tục (FR-018).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Người phát triển dựng màn hình mới hoàn toàn từ bộ thành phần dùng chung (Priority: P1)

Một người phát triển nhận việc "màn hình Chờ duyệt". Họ mở danh mục thành phần, thấy đủ các khối cần dùng
(thẻ bài, huy hiệu trạng thái, thẻ kênh, nút, cảnh báo nội dòng, thanh điều hướng) với đầy đủ biến thể giống
thiết kế, ghép chúng thành màn hình mà **không tự viết màu, cỡ chữ, khoảng cách hay kích thước vùng chạm**. Khi
đặt cạnh thiết kế, màn hình khớp; khi thiết kế đổi một giá trị (ví dụ màu chủ đạo), chỉ sửa ở một nơi.

**Why this priority**: Đây là lý do tồn tại của tính năng. Mọi màn hình sau này (≥ 14 màn hình trong UI/UX mục
6) phụ thuộc vào bộ thành phần; thiếu nó thì mỗi màn hình tự làm lại và lệch nhau.

**Independent Test**: Dựng một trang thử trong danh mục thành phần chỉ bằng các thành phần dùng chung rồi so với
Figma: mọi biến thể trong thiết kế (4 kiểu nút × 2 trạng thái, 7 trạng thái bài, 4 kênh × có/không "đăng tay", 3 mức
sử dụng, 2 kiểu thẻ chủ đề, 3 loại cảnh báo, các thanh điều hướng) hiển thị được; kiểm thử tự động xác nhận không có
giá trị màu/cỡ chữ viết cứng ngoài bộ giá trị thiết kế.

**Acceptance Scenarios**:

1. **Given** bộ thành phần dùng chung, **When** người phát triển dựng một màn hình mẫu từ các thành phần, **Then**
   mọi nút, huy hiệu, thẻ có biến thể và trạng thái tương ứng thiết kế, không phải viết kiểu dáng riêng.
2. **Given** một giá trị thiết kế (màu, cỡ chữ, bo góc, khoảng cách) được đổi ở một nơi, **When** xem lại các màn
   hình, **Then** mọi thành phần dùng giá trị đó đổi theo, không còn bản cũ ở nơi nào.
3. **Given** một thành phần nhận trạng thái "khóa", **When** hiển thị, **Then** người dùng thấy nút ở dạng khóa,
   có dòng giải thích lý do (do hết giới hạn AI, thiếu quyền…) thay vì chỉ mờ đi.
4. **Given** trạng thái bài (7 trạng thái ở UI/UX mục 7), **When** hiển thị trên bất kỳ màn hình nào, **Then**
   luôn có **chữ + biểu tượng**, không chỉ dựa vào màu, và dùng cùng một nhãn, cùng một bảng quy đổi từ trạng
   thái hệ thống.

---

### User Story 2 - Khung ứng dụng có điều hướng theo quyền, dùng được trên điện thoại và máy tính (Priority: P1)

Chủ tài khoản mở ứng dụng trên điện thoại 360 px: thấy thanh trên (logo/quay lại), nội dung, thanh điều hướng dưới
cùng với các mục hay dùng và nút "Tạo bài" nổi bật; mục còn lại nằm trong "Thêm". Trên máy tính, cùng các mục nằm
ở thanh bên và nội dung rộng hơn. Cộng tác viên đăng nhập thì **không thấy** mục/nút mà họ không có quyền (duyệt,
thành viên, xóa tài khoản); nhân viên hỗ trợ nội bộ thấy khu vực nội bộ riêng.

**Why this priority**: Không có khung thì các trang chỉ là những trang rời rạc; điều hướng theo vai trò là điều
kiện của luồng F3 (duyệt ≤ 3 thao tác trên điện thoại) và mục tiêu "Tổng quan → việc cần làm".

**Independent Test**: Đăng nhập lần lượt với chủ, cộng tác viên, hỗ trợ, quản trị: kiểm tra từng mục điều hướng và
nút hành động xuất hiện/ẩn đúng bảng phân quyền (UI/UX mục 9); thu nhỏ viewport từ 1280 xuống 360 px: bố cục chuyển
từ thanh bên sang thanh dưới, không có cuộn ngang, mọi vùng chạm ≥ 44 × 44 px.

**Acceptance Scenarios**:

1. **Given** phiên của chủ tài khoản ở màn ≥ 1024 px, **When** vào ứng dụng, **Then** thấy thanh bên với các mục
   Tổng quan, Lịch, Bài viết, Thư viện ảnh & video, Hồ sơ kinh doanh, Kênh & gói, Cài đặt; mục đang mở được
   đánh dấu bằng chữ/biểu tượng ngoài màu.
2. **Given** cùng phiên ở màn 360 px, **When** vào ứng dụng, **Then** thấy thanh điều hướng dưới cùng, nút "Tạo bài"
   nổi bật, mục còn lại trong "Thêm"; thanh trên đổi giữa kiểu logo (màn gốc) và kiểu quay lại (màn con).
3. **Given** phiên của cộng tác viên, **When** xem điều hướng và màn hình, **Then** nút "Duyệt", "Trả lại", mục
   Thành viên, nút "Yêu cầu xóa tài khoản" không hiển thị; tuy vậy gọi thẳng bằng đường dẫn vẫn bị API từ chối và
   giao diện hiện thông báo "bạn không có quyền" kèm lối quay lại (quyền được chặn ở API, giao diện chỉ ẩn).
4. **Given** phiên hết hạn trong khi đang dùng (chạm hạn tuyệt đối hoặc bị thu hồi), **When** thao tác tiếp theo gặp
   lỗi chưa đăng nhập, **Then** giao diện giữ nguyên màn hình và bản nháp đang soạn, hiện hộp thoại đăng nhập lại
   tại chỗ; đăng nhập đúng tài khoản xong thì tiếp tục thao tác dở (FR-011a); không bị chuyển trang đột ngột.
5. **Given** một đường dẫn không tồn tại hoặc một màn hình bị lỗi hiển thị, **When** người dùng truy cập, **Then**
   thấy trang "Không tìm thấy" / "Có lỗi xảy ra" bằng tiếng Việt đời thường kèm nút quay về Tổng quan; lỗi không
   làm sập cả khung điều hướng.

---

### User Story 3 - Nền tảng biểu mẫu dùng chung cho mọi form (Priority: P1)

Người phát triển dựng biểu mẫu "Hồ sơ kinh doanh", "Kết nối kênh", "Lập kế hoạch", "Soạn bài", "Mời cộng tác
viên" đều dùng cùng một bộ ô nhập, nhãn, thông báo lỗi, nút gửi và quy tắc kiểm tra. Người dùng thấy cách hoạt
động giống nhau ở mọi nơi: nhãn rõ, lỗi hiện ngay cạnh ô kèm cách sửa, nút gửi tự khóa khi đang gửi, rời trang khi
chưa lưu thì được hỏi, hai người sửa cùng lúc thì được báo xung đột thay vì ghi đè.

**Why this priority**: Phần lớn màn hình là biểu mẫu; thông điệp lỗi, trạng thái tải và chặn mất dữ liệu là nơi
dễ lệch và dễ hại nhất. Trang Hồ sơ kinh doanh (006) đã có các hành vi này nhưng viết riêng, cần rút ra dùng chung.

**Independent Test**: Dựng 3 biểu mẫu mẫu (một ô nhập đơn, một biểu mẫu có danh sách thẻ nhập từ khóa, một biểu mẫu
có tải tệp) từ nền tảng; kiểm tra hành vi: kiểm tra dữ liệu, lỗi từ máy chủ gắn đúng ô, khóa nút khi gửi, chặn rời
trang, xung đột phiên bản, đọc được bằng bộ đọc màn hình, thao tác hoàn toàn bằng bàn phím.

**Acceptance Scenarios**:

1. **Given** một ô nhập từ nền tảng biểu mẫu, **When** dữ liệu sai, **Then** thông báo lỗi tiếng Việt hiện ngay
   dưới ô, được liên kết với ô để bộ đọc màn hình đọc, kèm gợi ý cách sửa; không dựa vào chỉ màu đỏ.
2. **Given** máy chủ trả về lỗi theo trường (ví dụ email đã tồn tại), **When** biểu mẫu nhận phản hồi, **Then** lỗi
   gắn đúng ô, trỏ con trỏ tới ô lỗi đầu tiên; lỗi chung (mất mạng, hệ thống) hiện ở cảnh báo nội dòng đầu biểu mẫu
   với nút "Thử lại".
3. **Given** biểu mẫu đang gửi, **When** người dùng bấm lần nữa hoặc nhấn Enter, **Then** không gửi trùng; nút hiện
   trạng thái đang xử lý.
4. **Given** biểu mẫu có thay đổi chưa lưu, **When** người dùng đóng tab hoặc chuyển trang, **Then** được hỏi xác
   nhận; chọn ở lại thì giữ nguyên nội dung.
5. **Given** hai người cùng sửa một bản ghi, **When** người sau lưu và máy chủ báo xung đột phiên bản, **Then** biểu
   mẫu hiển thị lựa chọn "Tải bản mới nhất" hoặc "Giữ bản của tôi để xem lại", không âm thầm ghi đè (hiến pháp:
   cột phiên bản chặn ghi đè).
6. **Given** người dùng không có quyền sửa (cộng tác viên với Hồ sơ kinh doanh), **When** mở biểu mẫu, **Then**
   biểu mẫu ở chế độ chỉ xem, các trường bị khóa kèm dòng giải thích.
7. **Given** biểu mẫu tải tệp (ảnh/video lớn), **When** chọn nhiều tệp, **Then** hiện tiến độ từng tệp, cho thử
   lại từng tệp lỗi, và tệp lớn tiếp tục được khi mạng chập chờn (UI/UX mục 10).

---

### User Story 4 - Dữ liệu dùng chung được quản lý tập trung, không màn hình nào tự lấy lại một kiểu (Priority: P2)

Chủ tài khoản bấm "Duyệt" ở màn Chờ duyệt: số bài chờ duyệt trên thanh điều hướng, thẻ "Bài chờ duyệt" ở Tổng quan
và danh sách đều cập nhật mà không phải tải lại trang. Khi đổi từ Lịch sang Bài viết rồi quay lại, dữ liệu hiện
ngay (không trắng màn hình) rồi tự làm mới ngầm. Cùng một dữ liệu (bài, kênh, mức sử dụng, thông báo, hồ sơ) chỉ có
**một nguồn** trong giao diện nên không bao giờ hai nơi hiển thị hai giá trị khác nhau.

**Why this priority**: Chạm tới mục tiêu cảm nhận "chuyển màn hình ≤ 1 giây" và tính nhất quán, nhưng giao diện
vẫn dùng được (chậm hơn) nếu thiếu; nên xếp sau ba nền P1.

**Independent Test**: Dùng máy chủ giả lập; thực hiện thao tác thay đổi dữ liệu ở một màn và kiểm tra các màn
khác cùng dùng dữ liệu đó hiển thị giá trị mới ngay; kiểm tra quay lại màn đã xem hiện dữ liệu cũ tức thì rồi cập
nhật; kiểm tra khi mất mạng vẫn thấy dữ liệu đã tải kèm nhãn "dữ liệu có thể chưa mới".

**Acceptance Scenarios**:

1. **Given** dữ liệu "bài viết" đang hiển thị ở nhiều nơi, **When** một thao tác (duyệt, đổi giờ, đăng lại) thành
   công, **Then** mọi nơi hiển thị bài đó và các số đếm liên quan cập nhật mà không cần tải lại trang.
2. **Given** thao tác đổi giờ bài trên lịch, **When** người dùng kéo thả, **Then** giao diện hiện giờ mới ngay;
   nếu máy chủ từ chối (đã qua giờ, hạn mức kênh) thì tự hoàn lại giờ cũ kèm thông báo lý do và cách khắc phục.
3. **Given** việc nền chạy lâu (tạo 10 bài, gán nhãn media), **When** người dùng ở lại hoặc rời màn, **Then** thấy
   tiến độ x/N khi ở lại màn đó (làm mới ngắn hạn chỉ cho việc đang hiển thị), và thấy thông báo hoàn tất trong
   trung tâm thông báo ở lần làm mới kế tiếp (chuyển màn hình hoặc quay lại tab); số thông báo chưa đọc ở thanh
   điều hướng đúng sau mỗi lần làm mới.
4. **Given** mức sử dụng (bài x/100, AI %, dung lượng x/5 GB) được lấy một lần, **When** nhiều thành phần cần
   (Tổng quan, Gói & mức sử dụng, nút AI bị khóa), **Then** dùng chung một nguồn; khi AI chạm ngưỡng 80% hoặc 100%,
   mọi nút AI chuyển trạng thái khóa cùng lúc kèm ngày mở lại, và **không nơi nào hiện số tiền** chi phí AI.
5. **Given** người dùng đăng xuất hoặc đổi tài khoản trên cùng trình duyệt, **When** phiên mới bắt đầu, **Then**
   toàn bộ dữ liệu của tài khoản trước bị xóa khỏi bộ nhớ giao diện và bộ lưu cục bộ; không bao giờ thấy dữ liệu
   của tài khoản khác.
6. **Given** chủ tài khoản đang xem một bài mà cộng tác viên vừa sửa, **When** chủ bấm "Duyệt" (hoặc sửa, đổi giờ, đăng
   lại), **Then** giao diện hiện cảnh báo "Bài viết đã được thay đổi" kèm nút "Xem bản mới", không duyệt/đăng bản cũ;
   sau khi xem bản mới chủ chọn làm tiếp hoặc dừng.
7. **Given** danh mục dùng chung không đổi theo người dùng (nhãn trạng thái bài, danh mục kênh và điều kiện,
   thông điệp lỗi chuẩn, bảng quy đổi mã lỗi → lời giải thích + hành động), **When** nhiều màn hình cần, **Then**
   cùng đọc từ một nơi duy nhất, không sao chép nhãn ở từng màn.

---

### User Story 5 - Mô hình trạng thái hiển thị thống nhất: đang tải, trống, lỗi, bị khóa, một phần (Priority: P2)

Mỗi danh sách/màn hình cho người dùng cùng một cách thể hiện năm tình huống: đang tải (khung chờ có hình dạng
giống nội dung), trống (có lời nhắn và nút hành động), lỗi (nói đời thường, có nút khắc phục), bị khóa (do quyền, hết
giới hạn, chưa kết nối kênh – có dòng giải thích) và một phần (một số kênh ổn, một số cần xử lý – như "Đã đăng:
Facebook, Instagram · Cần bạn xử lý: Zalo").

**Why this priority**: Là nguyên tắc 2, 3, 4, 7 của UI/UX mục 3; không chặn dựng màn hình nhưng quyết định chất
lượng cảm nhận và tính "không chặn người dùng khi không cần".

**Independent Test**: Cho từng loại danh sách mẫu nhận lần lượt 5 tình huống từ máy chủ giả lập; kiểm tra hiển thị
đúng mẫu, mọi lỗi có ít nhất một nút hành động, mã lỗi gốc chỉ nằm trong phần "Chi tiết cho hỗ trợ" thu gọn.

**Acceptance Scenarios**:

1. **Given** dữ liệu đang tải lần đầu, **When** màn hình mở, **Then** hiện khung chờ giữ đúng chỗ (không nhảy bố
   cục khi dữ liệu tới), thông báo cho bộ đọc màn hình là đang tải.
2. **Given** danh sách rỗng, **When** hiển thị, **Then** có lời nhắn đời thường và một hành động gợi ý (ví dụ "Không
   có bài chờ duyệt" hoặc "Thêm bài" ở ngày trống).
3. **Given** lỗi từ máy chủ có mã nghiệp vụ, **When** hiển thị, **Then** người dùng thấy lời giải thích + nút hành
   động tra từ bảng quy đổi chung; mã lỗi gốc và mã lượt đăng nằm trong phần thu gọn "Chi tiết cho hỗ trợ" và có
   nút "Gửi cho hỗ trợ" tự đính kèm mã.
4. **Given** hết giới hạn AI, **When** mở màn có nút AI, **Then** nút ở trạng thái khóa kèm dòng giải thích và ngày
   mở lại, còn soạn tay/duyệt/đăng vẫn dùng được.
5. **Given** thời gian hiển thị, **When** có giá trị thời điểm từ máy chủ (UTC), **Then** luôn hiển thị theo
   UTC+7, định dạng ngày tiếng Việt thống nhất.

---

### User Story 6 - Danh mục thành phần, kiểm thử tự động và chuyển các trang hiện có sang nền mới (Priority: P3)

Người phát triển và người thiết kế mở danh mục thành phần (chạy độc lập, không cần máy chủ thật) để xem từng thành
phần, biến thể, trạng thái, thử trên các kích thước màn hình và chế độ bàn phím. CI tự kiểm: truy cập (a11y), không
dùng giá trị thiết kế viết cứng, và khớp thiết kế. Các trang đăng nhập/đăng ký/bảo mật/Hồ sơ kinh doanh được chuyển
sang dùng nền mới mà không đổi hành vi (các kiểm thử cũ vẫn qua).

**Why this priority**: Giữ nền không bị mục nát theo thời gian và chứng minh nền thay được kiểu dáng cũ; có thể làm
sau khi các thành phần P1 đã có.

**Independent Test**: Chạy bộ kiểm thử web hiện có (auth, context) sau khi chuyển: toàn bộ vẫn qua; chạy kiểm tra
truy cập tự động trên mọi thành phần trong danh mục: không có vi phạm mức nghiêm trọng.

**Acceptance Scenarios**:

1. **Given** danh mục thành phần, **When** mở, **Then** mỗi thành phần có mô tả, đầy đủ biến thể/trạng thái, ghi
   chú truy cập (vai trò bộ đọc màn hình, phím tắt) và có thể xem ở 360 px / 768 px / 1280 px.
2. **Given** một thay đổi mã thêm màu hoặc cỡ chữ viết cứng ngoài bộ giá trị thiết kế, **When** CI chạy, **Then**
   kiểm tra thất bại và chỉ ra vị trí.
3. **Given** các trang hiện có đã chuyển sang nền mới, **When** chạy kiểm thử của tính năng 004, 006, 009,
   **Then** toàn bộ vẫn qua và không còn khối kiểu dáng riêng theo từng thư mục tính năng.

---

### Edge Cases

- Chữ tiếng Việt dài (tên Page, tiêu đề bài) trong thẻ và huy hiệu: phải cắt gọn có dấu "…" kèm gợi ý đầy đủ khi
  chạm/di chuột, không làm vỡ bố cục ở 360 px.
- Người dùng đặt cỡ chữ hệ thống lớn hơn 200%: nội dung vẫn đọc và thao tác được, không bị cắt mất nút hành động.
- Thanh điều hướng dưới trên iPhone có vùng an toàn dưới màn hình: nút không bị che.
- Máy chủ trả về trạng thái bài chưa biết (thêm trạng thái mới ở bản sau): giao diện hiện nhãn trung tính "Đang
  cập nhật" thay vì lỗi trắng trang.
- Kênh "Đăng tay" (kênh chưa có/chưa bật cổng đăng tự động, theo khả năng do máy chủ báo): thẻ kênh hiển thị biến
  thể đặc biệt, bài của kênh đó hiện "chờ đăng tay" kèm nút "Đã đăng"; giao diện không giả định kênh nào cũng đăng
  tự động và không có công tắc để người dùng tự chuyển chế độ.
- Mất mạng giữa lúc gửi biểu mẫu: giữ nguyên dữ liệu đã nhập, báo "Chưa gửi được" kèm nút gửi lại; tuyệt đối
  không báo thành công khi chưa có xác nhận từ máy chủ.
- Gửi biểu mẫu trả lời chậm hoặc đến sau khi người dùng đã rời màn: kết quả không làm đổi màn hình khác; nếu thành
  công vẫn cập nhật dữ liệu dùng chung.
- Nhiều tab cùng mở một tài khoản: đăng xuất ở một tab thì các tab còn lại cũng chuyển về đăng nhập.
- Giá trị nhạy cảm (mã quyền kênh, mật khẩu, mã phiên) không được lưu ở bộ lưu cục bộ, không đưa vào địa chỉ trang,
  không ghi vào nhật ký trình duyệt.
- Người dùng bật chế độ giảm chuyển động: hiệu ứng "nhấp nháy" của bước đang đăng và khung chờ dừng chuyển động
  nhưng vẫn có chữ báo trạng thái.

## Requirements *(mandatory)*

### Functional Requirements

**Giá trị thiết kế và thành phần dùng chung**

- **FR-001**: Hệ thống giao diện MUST có **một bộ giá trị thiết kế duy nhất** (màu, cỡ chữ, độ đậm, khoảng cách, bo
  góc, bóng, kích thước vùng chạm, điểm ngắt theo màn hình, thời lượng chuyển động) trích từ thiết kế Figma; mọi
  thành phần và màn hình MUST dùng bộ này, không viết cứng giá trị.
- **FR-002**: Hệ thống MUST cung cấp các thành phần dùng chung tương ứng thiết kế Figma, mỗi thành phần đủ biến
  thể và trạng thái đã thiết kế: **Nút** (Chính, Thường, Nhẹ, Nguy hiểm × Mặc định, Khóa), **Huy hiệu trạng thái bài**
  (Nháp, Chờ duyệt, Đã lên lịch, Đang đăng, Đã đăng, Cần bạn xử lý, **Đã hủy** – biến thể Đã hủy cần bổ sung vào Figma), **Nhãn "Gợi ý hôm nay"** (nhãn riêng của chủ đề/thẻ gợi ý, không phải trạng thái bài), **Thẻ kênh** (Facebook, Instagram,
  TikTok, Zalo OA × có/không "Đăng tay"), **Thanh mức sử dụng** (Bình thường, Cảnh báo, Hết), **Thẻ chủ đề đề xuất** (nổi
  bật/không), **Thẻ bài**, **Thanh điều hướng dưới**, **Thanh bên**, **Thanh trên** (kiểu logo/quay lại), **Cảnh báo nội dòng**
  (Thông tin, Cảnh báo, Lỗi), **Chip**, **Tab kênh**, **Dòng bước tiến trình** (Xong, Lỗi, Chờ), **Dòng kênh** (Đã kết nối,
  Sắp hết hạn, Chưa kết nối, Đăng tay), **Ô ngày** và **Mục lịch** (Chờ duyệt, Đã lên lịch, Cần xử lý, Đã đăng), **Ô nhập** và **bộ biểu
  tượng** (≥ 26 biểu tượng trong thiết kế).
- **FR-003**: Mọi thành phần MUST đạt WCAG 2.1 AA: độ tương phản chữ đủ chuẩn, vùng chạm ≥ 44 × 44 px, thao tác được
  hoàn toàn bằng bàn phím với thứ tự tiêu điểm hợp lý và dấu hiệu tiêu điểm nhìn thấy, có vai trò/nhãn cho bộ đọc
  màn hình, trạng thái không chỉ dựa vào màu.
- **FR-004**: Mọi thành phần MUST hoạt động từ 360 px đến màn hình máy tính, không gây cuộn ngang; văn bản tiếng Việt
  dài MUST được cắt gọn có kiểm soát thay vì làm vỡ bố cục.
- **FR-005**: Trạng thái bài MUST có **một bảng quy đổi duy nhất** từ trạng thái hệ thống sang trạng thái hiển thị
  (UI/UX mục 7: gồm quy tắc "trạng thái tổng = trạng thái xấu nhất của các kênh" và việc ẩn "Chờ thử lại/Không xác
  định" khỏi người dùng) với nhãn, biểu tượng và màu cố định; trạng thái chưa biết MUST rơi về nhãn trung tính.
- **FR-006**: Giao diện MUST dùng tiếng Việt đời thường; tất cả chuỗi chữ hiển thị MUST nằm ở một nơi quản lý
  chung (không rải trong mã màn hình) để dễ rà soát giọng văn và để mở rộng ngôn ngữ về sau; thời điểm MUST hiển
  thị theo UTC+7 với định dạng thống nhất.

**Khung ứng dụng và điều hướng**

- **FR-007**: Hệ thống MUST có **khung ứng dụng** dùng chung: thanh bên 7 mục trên màn rộng (Tổng quan, Lịch, Bài
  viết, Thư viện ảnh & video, Hồ sơ kinh doanh, Kênh & gói, Cài đặt); thanh điều hướng dưới 5 mục + thanh trên trên
  điện thoại (Tổng quan, Lịch, Bài viết, Thêm, Tạo bài – nút "Tạo bài" nổi bật, các mục còn lại như Thư viện, Hồ sơ
  kinh doanh, Kênh & gói, Cài đặt nằm trong "Thêm");
  vùng nội dung có tiêu đề màn hình, thông báo và vùng hành động thống nhất.
- **FR-008**: Cây điều hướng MUST được khai báo ở một nơi duy nhất (mục, biểu tượng, đường dẫn, quyền cần có,
  hiển thị trên điện thoại hay trong "Thêm") và cả thanh bên lẫn thanh dưới MUST sinh từ đó.
- **FR-009**: Giao diện MUST nhận biết quyền của phiên (vai trò + mã quyền do API trả về) qua **một cơ chế duy nhất**
  để ẩn/khóa mục điều hướng và nút hành động; MUST NOT suy ra quyền từ chuỗi vai trò rải rác ở từng màn hình. Giao
  diện MUST coi việc ẩn nút chỉ là tiện lợi: mọi lời gọi vẫn có thể bị API từ chối và MUST được xử lý thân thiện.
- **FR-010**: Giao diện MUST NOT tự gửi mã tài khoản (tenant) trong đường dẫn, tham số hay thân yêu cầu; ngữ cảnh
  tài khoản MUST đến hoàn toàn từ phiên (hiến pháp nguyên tắc I).
- **FR-011**: Khung MUST xử lý tập trung: chưa đăng nhập/hết phiên (về đăng nhập, giữ đường dẫn cũ), không đủ
  quyền, không tìm thấy, lỗi bất ngờ ở một màn (cô lập, không sập cả khung), và khu vực nội bộ (hỗ trợ, quản trị)
  tách biệt khỏi khu vực khách hàng.
- **FR-011a**: Khi một lời gọi API trả về "chưa đăng nhập / hết phiên" giữa lúc người dùng đang làm việc, giao diện
  MUST NOT chuyển trang đột ngột và MUST NOT làm mất nội dung đang soạn: giữ nguyên màn hình hiện tại, hiện hộp
  thoại "Phiên đã hết hạn – đăng nhập lại để tiếp tục" ngay tại chỗ; đăng nhập đúng **cùng tài khoản** xong thì tự
  gửi lại thao tác vừa thất bại (nếu an toàn gửi lại, ví dụ lưu nháp) hoặc báo "bạn bấm lại để gửi". Nếu đăng nhập
  sang tài khoản khác, MUST xóa toàn bộ dữ liệu và bản nháp của tài khoản trước rồi về Tổng quan. Nếu máy chủ cho biết
  phiên bị thu hồi vì lý do khác (đổi/đặt lại mật khẩu, bị gỡ khỏi tài khoản, bị khóa), MUST hiện thông điệp tương ứng
  đời thường và đưa về đăng nhập, không đề nghị "tiếp tục". Giao diện MUST NOT tự đọc hay giữ mã phiên (cookie
  HttpOnly); nhiều lời gọi cùng thất bại một lúc MUST chỉ hiện một hộp thoại.
- **FR-012**: Giao diện MUST tách việc nạp mã theo màn hình để tải trang đầu ≤ 3 giây trên 4G và chuyển màn hình
  ≤ 1 giây; khu vực nội bộ MUST NOT được tải cho người dùng khách hàng.

**Nền tảng biểu mẫu**

- **FR-013**: Hệ thống MUST cung cấp nền tảng biểu mẫu dùng chung gồm: ô nhập (văn bản, nhiều dòng, chọn, chọn
  nhiều, ngày giờ, công tắc, thẻ nhập danh sách như từ khóa/hashtag, tải tệp) với nhãn, văn bản trợ giúp, bộ đếm
  ký tự (khi có giới hạn), thông báo lỗi liên kết với ô.
- **FR-014**: Quy tắc kiểm tra dữ liệu MUST dùng **cùng lược đồ** với phía máy chủ (gói dùng chung) để hai phía không
  lệch; thông điệp lỗi MUST tiếng Việt đời thường kèm cách sửa; giao diện kiểm tra sớm để giúp người dùng nhưng
  máy chủ vẫn là nơi quyết định.
- **FR-015**: Nền tảng MUST ánh xạ lỗi từ máy chủ (theo trường, theo biểu mẫu, theo hệ thống) lên đúng ô hoặc cảnh
  báo nội dòng, đưa tiêu điểm tới lỗi đầu tiên; lỗi chung luôn kèm ít nhất một hành động khắc phục.
- **FR-016**: Nền tảng MUST chống gửi trùng (khóa nút/Enter khi đang gửi), hiển thị trạng thái đang xử lý, và MUST
  NOT báo thành công trước khi có xác nhận của máy chủ.
- **FR-017**: Nền tảng MUST có cơ chế **chặn mất dữ liệu**: hỏi xác nhận khi rời biểu mẫu chưa lưu (đóng tab, chuyển
  trang trong ứng dụng), và giữ bản nháp khi hết phiên rồi đăng nhập lại **chỉ trong bộ nhớ của tab đang mở** (mất
  khi đóng tab, xóa khi đăng xuất/đổi tài khoản; không ghi ra bộ lưu lâu dài, không lưu dữ liệu nhạy cảm).
- **FR-018**: Nền tảng MUST hỗ trợ **ghi đè an toàn nhiều người sửa**: gửi kèm số phiên bản của bản ghi; khi máy chủ
  báo xung đột, hiển thị lựa chọn tải bản mới nhất hoặc giữ bản của mình để đối chiếu (hiến pháp: cột phiên bản).
  Quy tắc này áp dụng cho **mọi thao tác ghi trên bản ghi dùng chung**, không chỉ biểu mẫu sửa: sửa nội dung, duyệt,
  trả lại, đổi giờ, đăng lại, hủy. Khi bài đã bị người khác thay đổi, giao diện MUST hiện cảnh báo nội dòng "Bài viết
  đã được thay đổi" kèm nút "Xem bản mới" và chưa thực hiện thao tác cho đến khi người dùng xem lại và xác nhận làm tiếp
  (đặc biệt với duyệt và đăng: chủ không duyệt nhầm bản cũ).
- **FR-019**: Nền tảng MUST hỗ trợ **chế độ chỉ xem theo quyền**: cùng một biểu mẫu hiển thị ở chế độ sửa hoặc chỉ
  xem, trường khóa có dòng giải thích.
- **FR-020**: Nền tảng MUST hỗ trợ biểu mẫu nhiều bước (ví dụ hành trình "Bắt đầu" 5 bước, mỗi bước bỏ qua được và
  quay lại sau) và biểu mẫu động (thêm/bớt dòng, ví dụ danh sách chủ đề đề xuất có thể chọn/sửa/bỏ/thêm).
- **FR-021**: Thành phần tải tệp MUST hỗ trợ chọn/kéo thả nhiều tệp, hiện tiến độ từng tệp, hủy/thử lại từng tệp,
  kiểm tra loại/dung lượng trước khi tải (video ≤ 500 MB), tải thẳng lên kho tệp bằng đường dẫn ký sẵn (không đi
  qua API) và tiếp tục khi mạng chập chờn; báo rõ khi đầy dung lượng 5 GB kèm gợi ý xóa tệp.

**Quản lý dữ liệu dùng chung phía giao diện**

- **FR-022**: Giao diện MUST phân tách rõ **bốn loại trạng thái** và mỗi loại có một nơi quản lý: (a) *dữ liệu từ máy
  chủ* (bài, kế hoạch, kênh, thư viện, thông báo, mức sử dụng, hồ sơ); (b) *phiên và quyền* của người đang đăng
  nhập; (c) *trạng thái giao diện tạm thời* (bộ lọc, tab đang mở, ngăn mở/đóng, lựa chọn nhiều bài); (d) *dữ liệu
  danh mục tĩnh dùng chung* (nhãn trạng thái, danh mục kênh, thông điệp lỗi chuẩn). MUST NOT sao chép dữ liệu loại
  (a) sang kho riêng của từng màn hình.
- **FR-023**: Dữ liệu từ máy chủ MUST có **một nguồn duy nhất** cho mỗi loại đối tượng trong giao diện; MUST có khóa
  nhận dạng nhất quán để sau mỗi thao tác thay đổi, các nơi liên quan được làm mới đúng phạm vi (danh sách, chi tiết,
  số đếm trên điều hướng, tổng quan).
- **FR-024**: Giao diện MUST hiển thị dữ liệu đã có ngay khi quay lại một màn rồi làm mới ngầm; MUST có quy tắc làm
  mới theo loại dữ liệu (ví dụ danh mục tĩnh ít làm mới hơn bài, mức sử dụng và số thông báo) và làm mới khi mở màn
  hình hoặc khi người dùng quay lại tab. Giai đoạn 1 MUST NOT làm mới định kỳ nền (ngoại lệ duy nhất: tiến độ việc nền đang hiển thị, FR-030) và MUST NOT dùng kênh đẩy; độ tươi
  của thay đổi do người khác được bảo đảm bằng kiểm tra phiên bản lúc thao tác (FR-018).
- **FR-025**: Các thao tác chắc chắn thành công trong đa số trường hợp (đổi giờ, đánh dấu đã đọc, sắp xếp lại) MAY
  cập nhật lạc quan nhưng MUST hoàn lại và giải thích khi máy chủ từ chối. Các thao tác đắt/không đảo ngược (duyệt,
  đăng lại, xóa, ngắt kết nối) MUST chờ xác nhận của máy chủ và (với thao tác nguy hiểm) hỏi xác nhận trước.
- **FR-026**: **Dữ liệu cấm lưu lâu ở giao diện** (đúng với hiến pháp "không cache ngân sách AI, hạn mức, trạng thái lượt
  đăng, quyền truy cập nền tảng" ở phía máy chủ): giao diện MUST NOT coi các giá trị này là bền; MUST làm mới trước khi
  dựa vào để chặn/cho phép một thao tác quan trọng, và MUST NOT lưu chúng ở bộ lưu cục bộ của trình duyệt.
- **FR-027**: Bộ lưu cục bộ của trình duyệt chỉ được dùng cho tiện ích của riêng người xem (tab/bộ lọc đã chọn,
  trạng thái thu gọn, bản nháp chưa gửi); MUST NOT chứa mã phiên, mã quyền nền tảng, dữ liệu cá nhân hay số liệu
  của tài khoản; MUST bị xóa khi đăng xuất hoặc đổi tài khoản.
- **FR-028**: Mọi dữ liệu của tài khoản đang giữ trong bộ nhớ giao diện MUST bị xóa khi đăng xuất, hết phiên, đổi
  tài khoản hoặc khi nhận lỗi cho biết phiên không còn hợp lệ; các tab khác của cùng trình duyệt MUST được báo để
  đồng bộ.
- **FR-029**: Giao diện MUST có **một lớp gọi API duy nhất**: tự gửi thông tin phiên an toàn, kiểm tra mọi phản hồi
  bằng lược đồ dùng chung, chuẩn hóa lỗi (mất mạng, hết phiên, không đủ quyền, xung đột phiên bản, vượt hạn mức,
  lỗi nghiệp vụ có mã, lỗi hệ thống) thành một dạng thống nhất cho các thành phần hiển thị; MUST NOT để mã màn hình
  tự gọi mạng trực tiếp.
- **FR-030**: Việc nền (tạo bài hàng loạt, gán nhãn, đăng bài) MUST có cơ chế **theo dõi tiến độ dùng chung**: một
  thành phần cung cấp trạng thái x/N, đang chạy/xong/lỗi cho mọi màn cần; thông báo hoàn tất MUST xuất hiện trong
  trung tâm thông báo dù người dùng đang ở màn nào (ở lần làm mới kế tiếp), và số chưa đọc ở điều hướng đúng sau mỗi
  lần làm mới. Làm mới nhanh (vài giây, dừng khi việc xong hoặc khi rời màn) chỉ được dùng cho tiến độ của việc nền
  đang hiển thị trên màn hình.
- **FR-031**: Mức sử dụng (bài, AI %, dung lượng) MUST đến giao diện dưới dạng **tỷ lệ/phần trăm và số đếm**; giao
  diện MUST NOT hiển thị, tính toán hay lưu số tiền chi phí AI ở bất kỳ màn hình nào của khách hàng (hiến pháp III,
  FR-12); chỉ khu vực nội bộ hỗ trợ mới được hiển thị số tiền.
- **FR-032**: Giao diện MUST có **một cơ chế khóa theo giới hạn** dùng chung: khi AI/bài/dung lượng hết, mọi nút phụ
  thuộc chuyển trạng thái khóa kèm lý do và ngày mở lại, trong khi các hành động thủ công vẫn dùng được (hiến pháp VI:
  không chặn khi không cần).

**Kiểm thử, tài liệu và kỷ luật chất lượng**

- **FR-033**: Hệ thống MUST có **danh mục thành phần** chạy độc lập (không cần máy chủ thật, dùng dữ liệu giả lập)
  liệt kê từng thành phần, biến thể, trạng thái, ghi chú sử dụng và truy cập; xem được ở 360/768/1280 px và với chế độ
  tương phản/cỡ chữ lớn.
- **FR-034**: CI MUST chạy tự động: kiểm tra kiểu nghiêm ngặt và lint cho web; kiểm tra truy cập tự động trên mọi
  thành phần trong danh mục; kiểm tra không có giá trị thiết kế viết cứng ngoài bộ giá trị thiết kế; kiểm thử hành vi
  của nền tảng biểu mẫu và quản lý dữ liệu; và kiểm tra ranh giới (web chỉ nhập gói dùng chung, không nhập từ máy chủ).
- **FR-035**: Mọi thành phần MUST có kiểm thử cho từng biến thể/trạng thái ở mức người dùng thấy (hiển thị, tương
  tác, truy cập); kiểm tra khớp thiết kế bằng so sánh ảnh MAY được thêm cho các thành phần có hình dạng phức tạp
  (lịch, thẻ bài).
- **FR-036**: Các trang đã có (đăng nhập, đăng ký, xác minh email, quên/đặt lại mật khẩu, bảo mật, hồ sơ kinh doanh,
  thành viên) MUST được chuyển sang nền mới mà không đổi hành vi; sau chuyển MUST không còn khối kiểu dáng riêng theo
  từng thư mục tính năng và bộ kiểm thử hiện có MUST vẫn qua.
- **FR-037**: Tài liệu "Hướng dẫn giao diện" MUST mô tả: cách thêm thành phần, cách thêm một mục điều hướng, cách dựng
  một biểu mẫu, cách khai báo dữ liệu từ máy chủ và quy tắc làm mới, quy tắc khóa theo quyền/giới hạn, danh sách đóng
  góp thư viện bên thứ ba và cách cập nhật khi thiết kế Figma đổi (quy trình đồng bộ giá trị thiết kế).
- **FR-038**: Thư viện bên thứ ba cho giao diện MUST cố định phiên bản chính xác, được bọc/đặt sau lớp dùng chung
  của dự án khi chúng chi phối hành vi quan trọng (gọi mạng, kho dữ liệu, biểu mẫu), và MUST là mã nguồn mở có giấy
  phép cho phép dùng thương mại (hiến pháp IX); danh sách đề xuất nằm ở `library-suggestions.md` cùng thư mục.

### Key Entities *(include if feature involves data)*

Tính năng không tạo bảng dữ liệu máy chủ. Các thực thể là khái niệm của tầng giao diện:

- **Giá trị thiết kế**: một cặp tên – giá trị (màu chủ đạo, cỡ chữ tiêu đề, khoảng cách, bo góc…) có nguồn là thiết
  kế Figma; là thứ duy nhất được phép tham chiếu khi tạo kiểu dáng.
- **Thành phần**: khối giao diện dùng lại có tên, danh sách biến thể và trạng thái, quy tắc truy cập; tương ứng một
  thành phần trong Figma.
- **Mục điều hướng**: tên hiển thị, biểu tượng, đường dẫn, quyền cần có, vị trí (hiển thị trực tiếp hay trong "Thêm",
  khu vực khách hàng hay nội bộ).
- **Quyền của phiên**: vai trò + tập mã quyền của người đang đăng nhập, dùng để hiện/ẩn/khóa; không phải nơi ra quyết
  định bảo mật.
- **Trạng thái hiển thị của bài**: tập 7 trạng thái hiển thị + bảng quy đổi từ trạng thái hệ thống, kèm nhãn, biểu
  tượng, màu.
- **Khóa dữ liệu**: định danh nhất quán cho một loại dữ liệu từ máy chủ (ví dụ "danh sách bài theo trạng thái", "chi
  tiết bài", "mức sử dụng") dùng để chia sẻ và làm mới đúng phạm vi.
- **Tiến độ việc nền**: x/N, trạng thái (đang chạy, xong, lỗi một phần), đối tượng liên quan, dùng cho mọi màn theo dõi.
- **Lỗi chuẩn hóa**: loại (mất mạng, hết phiên, không đủ quyền, xung đột, vượt hạn mức, nghiệp vụ, hệ thống), thông
  điệp đời thường, hành động khắc phục, mã gốc (chỉ cho "Chi tiết cho hỗ trợ").
- **Bản nháp biểu mẫu**: nội dung chưa gửi giữ tạm cho một biểu mẫu của một người xem, không chứa dữ liệu nhạy cảm.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% biến thể và trạng thái của các thành phần trong thiết kế Figma (nút, huy hiệu, thẻ kênh, thanh
  sử dụng, thẻ chủ đề, thẻ bài, điều hướng, cảnh báo, chip, tab, dòng bước, dòng kênh, ô ngày, mục lịch, ô nhập, biểu
  tượng) có thành phần tương ứng xem được trong danh mục thành phần.
- **SC-002**: Một màn hình mẫu có danh sách + thẻ + biểu mẫu được dựng chỉ bằng thành phần dùng chung mà không có
  dòng nào viết cứng màu, cỡ chữ hay khoảng cách; kiểm tra tự động xác nhận 0 vi phạm.
- **SC-003**: 0 vi phạm truy cập mức nghiêm trọng (kiểm tra tự động) trên mọi thành phần và màn hình hiện có; mọi vùng
  chạm ≥ 44 × 44 px; mọi màn hình dùng được ở 360 px không cuộn ngang.
- **SC-004**: Người phát triển dựng thêm một màn hình danh sách + chi tiết mới (ví dụ "Chờ duyệt") chỉ bằng thành
  phần và quy tắc dữ liệu dùng chung trong ≤ 1 ngày làm việc, không phải thêm kiểu dáng riêng hay cách gọi mạng riêng.
- **SC-005**: Sau một thao tác thay đổi dữ liệu (duyệt, đổi giờ, đăng lại), 100% nơi hiển thị cùng dữ liệu đó (danh
  sách, chi tiết, số đếm điều hướng, Tổng quan) hiển thị giá trị mới trong ≤ 1 giây mà không tải lại trang.
- **SC-006**: Trang đầu tải ≤ 3 giây trên 4G và chuyển màn hình ≤ 1 giây ở 95% lượt đo trên thiết bị tầm trung;
  người dùng thấy dữ liệu đã có ngay khi quay lại màn đã xem.
- **SC-007**: 100% biểu mẫu mới và biểu mẫu chuyển đổi có: lỗi gắn đúng ô, khóa gửi trùng, chặn rời trang khi chưa
  lưu, xử lý xung đột phiên bản và chế độ chỉ xem – được xác nhận bằng bộ kiểm thử dùng chung; 0 trường hợp gửi
  trùng trong kiểm thử bấm nhanh.
- **SC-008**: Kiểm thử chéo giữa hai tài khoản trên cùng trình duyệt (đăng xuất/đổi tài khoản) cho kết quả 0 lần thấy
  dữ liệu của tài khoản trước; 0 giá trị nhạy cảm trong bộ lưu cục bộ (quét tự động).
- **SC-009**: 0 màn hình nào của khách hàng hiển thị số tiền chi phí AI (quét tự động chuỗi định dạng tiền ở khu vực
  khách hàng); 100% nút AI chuyển sang khóa có giải thích khi mức AI ≥ 100%.
- **SC-010**: 100% thông báo lỗi hiển thị cho khách hàng có ≥ 1 nút hành động và dùng tiếng Việt đời thường; mã lỗi
  gốc chỉ xuất hiện trong phần "Chi tiết cho hỗ trợ".
- **SC-011**: Sau khi chuyển, bộ kiểm thử web của tính năng 004, 006 và 009 vẫn qua 100%, và không còn khối kiểu dáng
  riêng theo từng thư mục tính năng.
- **SC-013**: Trong kiểm thử hai người dùng, khi người này sửa bài thì người kia bấm duyệt/đăng/đổi giờ trên bản cũ
  100% lần nhận cảnh báo "Bài viết đã được thay đổi" và 0 lần duyệt hay đăng nhầm bản cũ; khi phiên hết hạn giữa
  lúc soạn, 100% lần giữ nguyên nội dung đang soạn và tiếp tục được sau khi đăng nhập lại cùng tài khoản.
- **SC-012**: Khi thiết kế đổi một giá trị (ví dụ màu chủ đạo), việc cập nhật tới toàn bộ giao diện chỉ cần sửa ở một
  nơi trong ≤ 30 phút, không phải sửa từng màn hình.

## Assumptions

- Thiết kế Figma trang "Thành phần" là **nguồn chuẩn cho hình thức** (thành phần, biến thể, trạng thái); UI/UX
  v1.3 là nguồn chuẩn cho **luồng, nội dung màn hình và phân quyền**. Khi hai nơi lệch, hình thức theo Figma, quyền và
  luồng theo UI/UX, và ghi sự lệch vào tài liệu để PO xác nhận.
- Sự lệch giữa Figma và UI/UX: (1) và (2) về cấu trúc điều hướng **đã chốt theo Figma** (xem Clarifications); UI/UX
  mục 4 cần được cập nhật cho khớp ở bước hoàn tất. (3) "Đăng tay" **đã chốt**: là khả năng của kênh do máy chủ báo (xem Clarifications), không phải lựa chọn của người dùng. (4) "Gợi ý hôm nay" **đã chốt** là nhãn riêng, không phải trạng thái bài; "Đã hủy" cần bổ sung vào Figma. Kênh
  **TikTok** có trong Figma mặc định tắt theo khách hàng (tính năng 010); UI/UX v1.3 cần được cập nhật để mô tả TikTok,
  "Đăng tay" và "Gợi ý hôm nay".
- Giá trị cụ thể của bộ giá trị thiết kế (mã màu, cỡ chữ…) được **trích từ Figma ở bước lập kế hoạch**; đặc tả này
  chỉ yêu cầu có một bộ duy nhất và quy trình đồng bộ.
- Giai đoạn 1 chỉ có ứng dụng web chạy tốt trên điện thoại (đã chốt U1); không có ứng dụng di động riêng; không làm
  chế độ nền tối trừ khi Figma có thiết kế tương ứng (không thấy trong trang "Thành phần").
- Chỉ tiếng Việt ở giai đoạn 1; yêu cầu gom chuỗi chữ về một nơi chỉ để dễ quản lý và mở rộng, không phải làm đa ngôn
  ngữ ngay.
- Trình duyệt mục tiêu: 2 phiên bản mới nhất của Chrome, Safari (kể cả iOS), Edge, Cốc Cốc (theo UI/UX mục 10).
- Không dùng máy chủ trung gian riêng cho giao diện: ứng dụng web một trang phục vụ tĩnh, nói chuyện trực tiếp với API
  hiện có (hiến pháp IV, IX); không thêm bộ nhớ đệm phân tán hay dịch vụ mới.
- Giai đoạn 1 không có cập nhật gần thời gian thực: dữ liệu làm mới khi mở màn hình hoặc quay lại tab, không làm
  mới định kỳ và không có kênh đẩy (push) từ máy chủ; thay đổi của người khác được chặn ghi đè bằng kiểm tra phiên
  bản và cảnh báo "Bài viết đã được thay đổi" (FR-018). Nếu cần làm mới định kỳ hay kênh đẩy sau này phải có ADR.
- Các màn hình nghiệp vụ cụ thể (Tổng quan, Lịch, Soạn bài, Chờ duyệt, Thư viện, Kênh kết nối…) **không** thuộc tính
  năng này; chúng dùng nền này ở các tính năng sau. Riêng một "màn hình mẫu" trong danh mục thành phần được dựng để
  chứng minh nền.
- Gợi ý thư viện cụ thể (khung thành phần, kho dữ liệu máy chủ, biểu mẫu, kiểm tra, biểu tượng, lịch/kéo thả, kiểm
  thử, danh mục) được tách ra `library-suggestions.md` để giữ đặc tả không phụ thuộc công nghệ; việc chốt thư viện nằm
  ở `/speckit-plan` và, nếu đổi ngăn xếp đã chốt, phải có ADR.
