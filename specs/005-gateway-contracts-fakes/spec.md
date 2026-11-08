# Feature Specification: Khung giao diện công khai + bản giả lập – Cổng nền tảng, Cổng AI, Thông báo, Kho tệp

**Feature Branch**: `005-gateway-contracts-fakes`

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "Xây dựng cho tôi khung Giao diện công khai + bản giả lập: bộ chuyển đổi nền tảng
(7 thao tác – ADR-05), Cổng AI (giữ chỗ → gọi → quyết toán – ADR-06), Thông báo, Kho tệp đáp ứng yêu cầu
@TaiLieuDacTa (Trong đó có đầy đủ tài liệu kiến trúc và giao diện)"

**Truy vết**: WBS 1.8 (chốt giao diện công khai: bộ chuyển đổi nền tảng 7 thao tác, Cổng AI giữ chỗ → gọi →
quyết toán) · mở rộng sang Thông báo (chuẩn bị WBS 4.3) và Kho tệp (chuẩn bị WBS 2.6) · ADR-03, ADR-04,
ADR-05, ADR-06, ADR-07a, ADR-08, ADR-10 · ADD module Đăng bài mục 3 (bảng 7 thao tác), mục 7 (phân loại lỗi) ·
ADD module Cổng AI mục 2–7 · ADD module Worker mục 7.4 (thông báo) · Kiến trúc dữ liệu mục bố cục kho tệp,
8.3, 9 · UI/UX mục 8 (danh mục thông báo), mục 9 (phân quyền) · FR-02, FR-03, FR-07, FR-08, FR-09, FR-11,
FR-12 · Hiến pháp nguyên tắc II, III, IV, V, VII, VIII, IX.

**Phụ thuộc**: `001-monorepo-module-skeleton` (module `platform_gateway`, `ai_gateway`, `notifications`,
`media`, tệp kê khai module, kiểm tra ranh giới, cấm SDK AI ngoài `ai_gateway`) · `002-db-layer-tenant-rls`
(ngữ cảnh tenant của yêu cầu/việc nền – nguồn duy nhất của mã tài khoản) · `003-queue-layer-pgboss` (tạo
việc `notify` trong cùng giao dịch) · `004-minimal-auth-rbac` (vai trò chủ / cộng tác viên để xác định người
nhận thông báo).

**Bối cảnh**: Bốn điểm này là chỗ các module phụ thuộc nhau và phụ thuộc bên ngoài (Meta, Zalo, nhà cung cấp
AI, email, kho tệp). WBS nguyên tắc 4 yêu cầu **chốt giao diện giữa module trước khi viết bên trong**. Tính
năng này cung cấp:

1. **Giao diện công khai** (hợp đồng) của bốn thành phần – thao tác, dữ liệu vào/ra, các kết quả và loại lỗi có
   thể xảy ra, quy tắc bất biến.
2. **Bản giả lập** cho mỗi hợp đồng – chạy hoàn toàn cục bộ, không gọi mạng ra ngoài, điều khiển được kịch bản –
   để đội Đăng bài, Nội dung, Media, Xu hướng, Giao diện làm việc song song ngay, không chờ App Review của
   Meta, kết quả POC-1/POC-4 hay hợp đồng đám mây.
3. **Bộ kiểm thử hợp đồng** dùng lại được: bản giả lập phải qua, và mọi bản thật sau này (bộ chuyển đổi
   Facebook/Instagram/Zalo OA, Cổng AI thật, Thông báo thật, kho tệp thật) cũng phải qua cùng bộ đó.

**Ngoài phạm vi** (thuộc tính năng sau): bộ chuyển đổi Facebook/Instagram/Zalo OA thật (WBS 2.3, 4.1); kết nối
kênh, lưu mã quyền mã hóa KMS (WBS 2.2); bảng ngân sách, sổ chi phí, bảng giá trong CSDL và nhà cung cấp AI thật
(WBS 3.1); bảng thông báo trong ứng dụng, gộp email 10 phút, màn hình Thông báo (WBS 4.3, 4.8); bản ghi media,
dung lượng 5 GB (WBS 2.6, 4.4); luồng đăng 5 bước (WBS 2.4).

## User Scenarios & Testing *(mandatory)*

Người dùng của tính năng này là **đội phát triển và kiểm thử** (BE-2, BE-3, FE-1, Kiểm thử). Giá trị cho chủ
kinh doanh đến gián tiếp: đăng không trùng, không vượt trần AI, thông báo đúng người, tệp không lộ sang tài
khoản khác – vì mọi module sau đều được xây và kiểm trên cùng một hợp đồng.

### User Story 1 - Đội Đăng bài viết luồng đăng trên hợp đồng bộ chuyển đổi nền tảng, kiểm được mọi loại lỗi không cần Meta (Priority: P1)

Lập trình viên module Đăng bài gọi Cổng nền tảng qua giao diện công khai với **mã kết nối kênh**, không bao giờ
thấy mã quyền truy cập. Phía sau là bộ chuyển đổi giả lập, có thể được dàn kịch bản cho từng lần gọi: thành công
ngay; nền tảng xử lý bất đồng bộ rồi xong; lỗi chắc chắn chưa nhận; lỗi cần người dùng; hết thời gian chờ sau khi
gửi mà bài **thật ra đã lên**; hết thời gian mà bài **chưa lên**; kênh không đối soát được; quyền sắp hết hạn.

**Why this priority**: Đăng bài là đường găng tới mốc M2 (nộp App Review Meta) và nơi tập trung cam kết "0 đăng
trùng" (nguyên tắc II). Không có hợp đồng + bản giả lập thì WBS 2.4 phải chờ 2.3 và chờ ứng dụng Meta.

**Independent Test**: Chạy bộ kiểm thử hợp đồng bộ chuyển đổi với bản giả lập → qua toàn bộ; viết một luồng thử
gọi lần lượt 7 thao tác theo từng kịch bản → mỗi kịch bản cho đúng kết quả và đúng loại lỗi đã khai báo; bản giả
lập đếm được số bài thực sự "lên" cho mỗi dấu nội dung.

**Acceptance Scenarios**:

1. **Given** bản giả lập được dàn kịch bản "hết thời gian chờ sau khi gửi, bài đã lên", **When** gọi Gửi bài rồi
   Đối soát với cùng dấu nội dung trong khoảng thời gian hợp lệ, **Then** Gửi bài trả kết quả *không xác định*,
   Đối soát trả *tìm thấy* kèm mã bài và đường dẫn bài trên nền tảng; bộ đếm của bản giả lập cho thấy dấu nội dung
   đó lên đúng 1 lần.
2. **Given** kịch bản "hết thời gian, bài chưa lên", **When** Đối soát, **Then** trả *không tìm thấy*; nếu bên gọi
   gửi lại một lần thì bộ đếm là 1, không phải 2.
3. **Given** kênh giả lập khai báo *không hỗ trợ đối soát*, **When** Đối soát, **Then** trả *không đối soát được*
   (khác với *không tìm thấy*), để luồng đăng chuyển "Cần kiểm tra".
4. **Given** một mã lỗi gốc bất kỳ của nền tảng, **When** gọi Phân loại lỗi, **Then** nhận đúng một trong ba loại
   *chắc chắn chưa nhận* / *cần người dùng* / *không xác định*, kèm mã lỗi gốc, thông điệp tiếng Việt đời thường và
   ít nhất một cách khắc phục; mã lỗi chưa có trong bảng ánh xạ → *không xác định* (an toàn – không gửi lại ngay).
5. **Given** kịch bản nền tảng xử lý bất đồng bộ (kiểu Instagram), **When** Gửi bài, **Then** nhận *đang xử lý* kèm
   mã theo dõi xử lý; Kiểm tra trạng thái xử lý trả *đang xử lý* rồi *xong* (kèm đường dẫn bài) hoặc *lỗi* (kèm lỗi
   đã phân loại).
6. **Given** media không hợp quy tắc kênh (định dạng, dung lượng, thời lượng, tỷ lệ, số lượng), **When** gọi Quy
   tắc media của kênh và kiểm tra media theo quy tắc đó, **Then** nhận danh sách vi phạm có lời giải thích tiếng Việt,
   dùng được cả lúc gắn media vào bài (cảnh báo sớm) và ở bước 1–2.
7. **Given** quyền truy cập còn < 7 ngày, **When** gọi Làm mới quyền, **Then** kịch bản thành công trả hạn mới;
   kịch bản thất bại trả lỗi *cần người dùng* với hành động "Kết nối lại".
8. **Given** Kiểm tra điều kiện tài khoản, **When** tài khoản không đủ điều kiện (vd Instagram không phải tài khoản
   chuyên nghiệp, thiếu quyền đăng), **Then** trả không đạt kèm lý do đã phân loại *cần người dùng*; khi đạt thì trả
   loại tài khoản, quyền đã cấp, hạn mức còn lại (nếu nền tảng cho biết) và ngày hết hạn quyền.

---

### User Story 2 - Thêm nền tảng mới chỉ bằng một bộ chuyển đổi, không sửa luồng đăng (Priority: P1)

Kiến trúc sư (SA) cần chứng minh cam kết ADR-05 ngay từ khung: thêm một nền tảng = thêm một bộ chuyển đổi + bảng
ánh xạ lỗi. Đội đăng ký thêm một **kênh giả lập thứ tư** chỉ dùng cho kiểm thử và chứng minh luồng gọi phía Đăng bài
không đổi một dòng nào.

**Why this priority**: Nếu hợp đồng rò rỉ chi tiết riêng của Facebook (vd khái niệm "container" của Instagram nằm
ngoài thao tác chung), mọi bộ chuyển đổi sau phải sửa luồng chính – vi phạm nguyên tắc II.

**Independent Test**: Đăng ký kênh giả lập thứ tư với năng lực khác (không đối soát, không xử lý bất đồng bộ, quy
tắc media khác) → bộ kiểm thử hợp đồng chạy tự động trên mọi bộ chuyển đổi đã đăng ký, kể cả kênh mới; không có tệp
nào ngoài phần đăng ký bộ chuyển đổi thay đổi.

**Acceptance Scenarios**:

1. **Given** danh sách bộ chuyển đổi đã đăng ký, **When** chạy bộ kiểm thử hợp đồng, **Then** mỗi bộ chuyển đổi được
   kiểm đủ 7 thao tác, và một bộ chuyển đổi thiếu thao tác hoặc trả kết quả ngoài các giá trị đã khai báo thì kiểm
   thử thất bại.
2. **Given** mỗi bộ chuyển đổi khai báo **năng lực** của kênh (có đối soát không, có xử lý bất đồng bộ không, có làm
   mới quyền không, có báo hạn mức không), **When** bên gọi đọc năng lực, **Then** quyết định nhánh luồng chỉ dựa vào
   năng lực, không dựa vào tên nền tảng.
3. **Given** một loại kênh chưa đăng ký bộ chuyển đổi, **When** gọi bất kỳ thao tác nào, **Then** nhận lỗi rõ ràng
   "kênh chưa được hỗ trợ", không có hành vi mặc định ngầm.

---

### User Story 3 - Đội Nội dung/Media/Xu hướng gọi AI qua Cổng AI với giữ chỗ → gọi → quyết toán (Priority: P1)

Lập trình viên module Nội dung (tạo bài, đề xuất chủ đề), Media (gán nhãn, chuyển giọng nói) và Xu hướng (tóm tắt
theo ngành) gọi **một** giao diện của Cổng AI, khai báo loại việc, các phần lời nhắc theo thứ tự cố định, giới hạn
đầu ra. Cổng AI tự ước tính chi phí tối đa, giữ chỗ, chọn mô hình theo ngưỡng, gọi nhà cung cấp (bản giả lập),
quyết toán hoặc trả lại giữ chỗ. Bên gọi nhận kết quả (có thể trả dần) hoặc một trong các lỗi đã khai báo – nổi bật
là *hết giới hạn AI của chu kỳ*.

**Why this priority**: Nguyên tắc III không thương lượng. Hợp đồng phải chốt sớm để mọi module gọi AI xử lý đúng các
trạng thái "mô hình rẻ" và "đã chặn" từ ngày đầu, và để WBS 3.1 thay bản giả lập bằng bản thật mà bên gọi không đổi.

**Independent Test**: Với nhà cung cấp giả lập và ngân sách giả lập trong bộ nhớ: đặt trần, gọi tuần tự và đồng thời,
kiểm tổng *đã dùng + đã giữ* không bao giờ vượt trần; kiểm chuyển mô hình ở ngưỡng mềm; kiểm trả lại giữ chỗ khi nhà
cung cấp lỗi/hết thời gian; kiểm số tiền không lọt ra kết quả dành cho khách hàng.

**Acceptance Scenarios**:

1. **Given** chu kỳ còn đủ ngân sách, **When** gọi tạo bài, **Then** trình tự là ước tính chi phí tối đa (token đầu
   vào đếm trước × giá + giới hạn đầu ra × giá theo mô hình dự kiến) → giữ chỗ → gọi → quyết toán (đã dùng += chi phí
   thực, đã giữ −= ước tính) → ghi một dòng sổ chi phí (tài khoản, chu kỳ, loại việc, mô hình, nhà cung cấp, token
   vào/ra/bộ đệm, chi phí micro-USD, mã theo dõi).
2. **Given** *đã dùng + đã giữ + ước tính* > trần, **When** gọi, **Then** không gọi nhà cung cấp; bên gọi nhận lỗi
   *hết giới hạn AI* với thông điệp "Đã sử dụng hết giới hạn AI của chu kỳ", không kèm số tiền; chức năng thủ công
   không bị ảnh hưởng.
3. **Given** chủ và 2 cộng tác viên (hoặc nhiều việc nền) gọi đồng thời sát trần, **When** các lời gọi chạy cùng lúc,
   **Then** chỉ các lời gọi giữ chỗ được trong trần mới chạy; tổng không bao giờ vượt trần.
4. **Given** *đã dùng + đã giữ* < ngưỡng mềm (2.000.000 micro-USD), **When** gọi tạo bài, **Then** dùng mô hình mặc
   định; khi ≥ ngưỡng mềm thì dùng mô hình rẻ; gán nhãn và tóm tắt xu hướng luôn dùng mô hình rẻ (bảng ADD Cổng AI mục 5).
5. **Given** nhà cung cấp chính lỗi hoặc hết thời gian, **When** gọi, **Then** giữ chỗ được trả lại, thử nhà cung cấp
   dự phòng đúng 1 lần (giữ chỗ lại); dự phòng cũng lỗi → bên gọi nhận *nhà cung cấp AI tạm thời không phản hồi*, không
   còn giữ chỗ treo.
6. **Given** lời gọi trả kết quả dần, **When** bên gọi hủy giữa chừng hoặc kết nối đứt, **Then** chi phí của phần đã
   sinh được quyết toán, phần còn lại của giữ chỗ được trả.
7. **Given** chuyển giọng nói một đoạn âm thanh, **When** gọi, **Then** ước tính tối đa theo `min(thời lượng, 5 phút) ×
   giá/phút`, đi qua cùng trình tự giữ chỗ → gọi → quyết toán.
8. **Given** màn hình khách hàng cần mức sử dụng, **When** hỏi Cổng AI, **Then** nhận phần trăm làm tròn xuống
   `floor((đã dùng + đã giữ) / trần × 100)`, trạng thái (bình thường / mô hình rẻ / đã chặn) và ngày bắt đầu chu kỳ mới –
   **không** có trường số tiền nào.

---

### User Story 4 - Module nghiệp vụ phát thông báo theo danh mục, đúng người nhận, không gửi lặp (Priority: P2)

Lập trình viên module Đăng bài, Nội dung, Cổng nền tảng, Cổng AI, Tài khoản phát một **sự kiện thông báo** thuộc danh
mục đã chốt (UI/UX mục 8) trong cùng giao dịch với dữ liệu nghiệp vụ, kèm đối tượng liên quan và khóa chống trùng.
Thông báo tự xác định người nhận theo quy tắc của loại (chủ / cộng tác viên soạn bài / người tạo) và kênh gửi (trong
ứng dụng, email). Bản giả lập ghi lại mọi thông báo và email "đã gửi" để kiểm thử khẳng định.

**Why this priority**: Cần cho FR-09 (lỗi cần người dùng → trong ứng dụng + email) và cảnh báo 80% AI, nhưng luồng gửi
thật (WBS 4.3) đến sau; các module chỉ cần hợp đồng ổn định để phát sự kiện ngay.

**Independent Test**: Phát lần lượt từng loại sự kiện trong danh mục → bản giả lập ghi đúng người nhận và kênh; phát
hai lần cùng khóa chống trùng → chỉ một thông báo; phát sự kiện có trường bị cấm (số tiền AI, mã quyền, nội dung bài)
→ bị từ chối.

**Acceptance Scenarios**:

1. **Given** sự kiện "Bài cần xử lý / cần kiểm tra", **When** phát, **Then** người nhận là chủ và cộng tác viên soạn bài,
   kênh trong ứng dụng + email, đánh dấu thuộc nhóm được gộp email trong 10 phút.
2. **Given** sự kiện "Mức sử dụng AI 80%", **When** phát hai lần trong cùng chu kỳ (cùng khóa chống trùng), **Then** chỉ
   một thông báo được tạo.
3. **Given** một loại sự kiện không có trong danh mục, **When** phát, **Then** bị từ chối ngay khi lập trình (không qua
   kiểm tra kiểu) và khi chạy.
4. **Given** sự kiện được phát trong giao dịch nghiệp vụ, **When** giao dịch bị hủy, **Then** không có thông báo nào được
   tạo/gửi.
5. **Given** mọi thông báo, **When** xem nội dung gửi đi, **Then** có ít nhất một hành động khắc phục/đi tới đối tượng,
   tiếng Việt đời thường, không chứa số tiền AI, mã quyền, mật khẩu, nội dung bài (chỉ được tên ngắn của bài để nhận ra).
6. **Given** địa chỉ email bị báo lỗi vĩnh viễn, **When** bộ gửi email trả kết quả đó, **Then** hợp đồng phân biệt được
   *lỗi vĩnh viễn* (không thử lại, đánh dấu) với *lỗi tạm thời* (thử lại theo hàng chờ `notify`).

---

### User Story 5 - Kho tệp chỉ cấp đường dẫn trong đúng tiền tố của tài khoản (Priority: P2)

Lập trình viên module Media, Ngữ cảnh kinh doanh, Tài khoản (xóa dữ liệu) dùng một giao diện kho tệp: xin đường dẫn
ký sẵn để trình duyệt tải thẳng lên, đọc thông tin tệp sau tải (tồn tại, kích thước, dấu tệp), đọc/ghi tệp phía Worker,
sao chép, xóa, liệt kê theo tiền tố, cấp đường dẫn xem trước và đường dẫn công khai có hạn cho nền tảng. Vị trí tệp do
hợp đồng dựng từ mã tài khoản trong ngữ cảnh – bên gọi không tự ghép đường dẫn.

**Why this priority**: Là điều kiện cho WBS 2.6 (tải media cơ bản) và cho bước "chuẩn bị media" của đăng bài, đồng thời
là điểm cô lập tenant ở lớp tệp (nguyên tắc I).

**Independent Test**: Với bản giả lập: xin đường dẫn tải lên cho tài khoản A, dùng nó để đặt tệp, đọc thông tin tệp →
đúng kích thước/dấu tệp; thử mọi cách chỉ tới tệp của tài khoản B từ ngữ cảnh A → đều bị từ chối; đường dẫn hết hạn →
không dùng được.

**Acceptance Scenarios**:

1. **Given** ngữ cảnh tài khoản A, **When** xin đường dẫn tải lên cho một media, **Then** đường dẫn chỉ ghi được vào
   `tenants/{A}/media/{mediaId}/original`, có hạn ≤ 15 phút, ràng buộc loại tệp và kích thước tối đa khai báo.
2. **Given** ngữ cảnh A, **When** yêu cầu bất kỳ thao tác nào trên vị trí thuộc tài khoản B hoặc vị trí ngoài các khuôn
   đã khai báo, **Then** bị từ chối và ghi nhật ký cảnh báo (không lộ đường dẫn của B trong thông báo lỗi).
3. **Given** tệp đã tải lên, **When** đọc thông tin tệp, **Then** nhận tồn tại/không, kích thước, loại tệp, dấu tệp dùng
   được để chống xử lý trùng.
4. **Given** cần đưa media cho nền tảng, **When** xin đường dẫn công khai có hạn, **Then** hạn ≤ 24 giờ; đường dẫn xem
   trước cho giao diện có hạn ≤ 1 giờ.
5. **Given** việc nền (có mã việc), **When** ghi tệp tạm, **Then** tệp nằm dưới `tmp/{jobId}/` và thuộc diện tự xóa sau
   1 ngày.
6. **Given** tài khoản bị xóa, **When** liệt kê và xóa theo tiền tố `tenants/{A}/`, **Then** xóa được toàn bộ tệp của A,
   không chạm tài khoản khác.

---

### User Story 6 - Chạy toàn bộ ứng dụng cục bộ bằng bản giả lập, và không bao giờ lỡ bật bản giả lập ở môi trường thật (Priority: P3)

Lập trình viên giao diện và kiểm thử chạy ứng dụng trên máy cục bộ/môi trường thử nghiệm: kết nối kênh giả, đăng bài
giả, tạo bài AI giả, nhận thông báo giả – không cần tài khoản Meta, Zalo, AI, email hay kho tệp thật. Ngược lại, vận
hành cần chắc chắn môi trường chính thức không thể khởi động với bất kỳ bản giả lập nào.

**Why this priority**: Tăng tốc FE-1 và kiểm thử, phục vụ quay video minh họa luồng trước khi có kênh thật; quan trọng
nhưng không chặn backend.

**Independent Test**: Khởi động bằng cấu hình chọn bản giả lập cho cả bốn thành phần → ứng dụng chạy, không có kết nối
mạng ra ngoài; khởi động môi trường chính thức với một thành phần trỏ bản giả lập → tiến trình từ chối khởi động với
thông báo rõ thành phần nào.

**Acceptance Scenarios**:

1. **Given** cấu hình chọn bản giả lập, **When** khởi động API và Worker, **Then** cả hai dùng cùng một lựa chọn cho từng
   thành phần và báo trong nhật ký khởi động thành phần nào đang là giả lập.
2. **Given** môi trường là chính thức, **When** cấu hình chọn bản giả lập cho bất kỳ thành phần nào, **Then** không khởi
   động được.
3. **Given** bản giả lập đang chạy ở môi trường phát triển, **When** kiểm thử cần dàn kịch bản (lỗi, chậm, hết ngân
   sách), **Then** có cách đặt kịch bản cho từng tài khoản/kênh mà không sửa mã, và cách này không tồn tại ở môi trường
   chính thức.

---

### Edge Cases

- Bộ chuyển đổi trả về một kết quả/loại lỗi ngoài danh sách đã khai báo → coi là *không xác định*, ghi nhật ký kỹ thuật,
  không gửi lại ngay (nguyên tắc II).
- Đối soát được gọi khi khoảng thời gian tìm kiếm vượt giới hạn nền tảng cho phép → trả *không đối soát được*, không
  trả *không tìm thấy* (tránh gửi lại nhầm).
- Hai lần Gửi bài cùng dấu nội dung tới bản giả lập (do bên gọi có lỗi) → bản giả lập ghi nhận 2 bài và bộ đếm trùng
  lặp lộ ra trong kiểm thử – bản giả lập **không** che lỗi trùng của bên gọi.
- Mã quyền truy cập, mã lỗi gốc chứa thông tin nhạy cảm → không xuất hiện trong kết quả trả về module Đăng bài, nhật ký,
  chỉ số; mã lỗi gốc chỉ là mã/chuỗi đã lọc.
- Ước tính chi phí tối đa của lời gọi lớn hơn toàn bộ trần còn lại dù lời gọi thật có thể rẻ → vẫn chặn (an toàn trước).
- Lời gọi đẩy tổng qua ngưỡng mềm vẫn dùng mô hình mặc định; lời gọi sau mới chuyển mô hình rẻ (chấp nhận vượt ngưỡng
  mềm tối đa 1 lời gọi – ADD Cổng AI mục 3).
- Chi phí thực sau quyết toán lớn hơn ước tính (do nhà cung cấp tính khác) → ghi đúng chi phí thực, đánh dấu bất thường để
  đối soát; ràng buộc trần vẫn là chốt chặn cuối (không ghi vượt trần).
- Tiến trình chết giữa lúc giữ chỗ và quyết toán → giữ chỗ treo được nhận diện bằng thời điểm giữ chỗ để việc định kỳ trả
  lại sau 15 phút.
- Bảng giá mô hình đổi giữa chu kỳ → lời gọi sau thời điểm hiệu lực dùng giá mới; không tính lại quá khứ.
- Việc hệ thống không thuộc tài khoản nào (tóm tắt xu hướng theo ngành) → chi phí ghi vào phạm vi ngành, không giữ chỗ
  vào ngân sách của một tài khoản; phần chia đều cho tài khoản do tính năng Xu hướng xử lý.
- Thông báo cho người nhận không còn thuộc tài khoản (cộng tác viên đã bị gỡ) → bỏ qua người đó, không lỗi cả sự kiện.
- Đường dẫn tải lên đã dùng một lần nhưng bị dùng lại trong hạn → ghi đè đúng vị trí đó, không ghi được ra chỗ khác; xác
  nhận tải lên dựa trên thông tin tệp đọc lại, không tin dữ liệu trình duyệt gửi.
- Tên tệp người dùng chứa ký tự lạ, `../` → không ảnh hưởng vị trí lưu (vị trí dựng từ mã, không từ tên tệp).

## Requirements *(mandatory)*

### Functional Requirements

**Chung cho bốn hợp đồng**

- **FR-001**: Mỗi thành phần (Cổng nền tảng, Cổng AI, Thông báo, Kho tệp) MUST có một giao diện công khai được khai báo
  tường minh: thao tác, dữ liệu vào/ra, tập đóng các kết quả và loại lỗi. Module khác MUST chỉ dùng thành phần qua giao
  diện này (nguyên tắc IV); kiểm tra ranh giới module trong CI MUST bắt được việc dùng phần nội bộ.
- **FR-002**: Mã tài khoản MUST lấy từ ngữ cảnh tenant của yêu cầu/việc nền; MUST NOT có tham số mã tài khoản trên bất kỳ
  thao tác nào dành cho module nghiệp vụ (nguyên tắc I). Thao tác của việc hệ thống (không thuộc tài khoản) MUST tách
  riêng và chỉ dùng được trong ngữ cảnh hệ thống.
- **FR-003**: Mỗi hợp đồng MUST có ít nhất một bản giả lập chạy hoàn toàn cục bộ, không gọi mạng ra ngoài, kết quả tất
  định khi cùng kịch bản, ghi lại mọi lời gọi để kiểm thử khẳng định.
- **FR-004**: Mỗi hợp đồng MUST có một **bộ kiểm thử hợp đồng** dùng lại được, tham số hóa theo bản cài đặt: bản giả lập
  MUST qua ngay trong tính năng này; bản thật sau này MUST qua cùng bộ trước khi được bật.
- **FR-005**: Việc chọn bản cài đặt (giả lập/thật) MUST theo cấu hình, giống nhau giữa API và Worker; MUST NOT cần sửa mã
  để chuyển. Môi trường chính thức MUST từ chối khởi động nếu bất kỳ thành phần nào trỏ bản giả lập (nêu rõ thành phần).
- **FR-006**: Cơ chế dàn kịch bản cho bản giả lập (lỗi, chậm, hết thời gian, hết ngân sách) MUST chỉ có ở môi trường phát
  triển/thử nghiệm.
- **FR-007**: Mọi lời gọi qua bốn hợp đồng MUST mang mã theo dõi xuyên suốt và tạo nhật ký có cấu trúc gắn mã tài khoản
  (nguyên tắc VIII); MUST NOT ghi mã quyền, mật khẩu, nội dung lời nhắc/kết quả AI, nội dung bài vào nhật ký hay chỉ số.
- **FR-008**: Thư viện bên ngoài dùng phía sau hợp đồng MUST được bọc bên trong thành phần, cố định phiên bản; kiểu dữ liệu
  của thư viện bên ngoài MUST NOT xuất hiện trên giao diện công khai (nguyên tắc IX).

**Cổng nền tảng – bộ chuyển đổi (ADR-05)**

- **FR-010**: Giao diện chung của bộ chuyển đổi MUST gồm đúng 7 thao tác: Kiểm tra điều kiện tài khoản; Quy tắc media của
  kênh; Gửi bài; Kiểm tra trạng thái xử lý; Đối soát; Phân loại lỗi; Làm mới quyền (ADD Đăng bài mục 3).
- **FR-011**: Module Đăng bài MUST gọi Cổng nền tảng bằng mã kết nối kênh; mã quyền truy cập MUST chỉ được giải mã và dùng
  bên trong Cổng nền tảng, MUST NOT có trong dữ liệu vào/ra của giao diện công khai (nguyên tắc VII).
- **FR-012**: Mỗi bộ chuyển đổi MUST khai báo năng lực kênh: hỗ trợ đối soát, xử lý bất đồng bộ, làm mới quyền, báo hạn
  mức, khoảng thời gian đối soát tối đa. Bên gọi MUST rẽ nhánh theo năng lực, không theo tên nền tảng.
- **FR-013**: Gửi bài MUST nhận nội dung theo kênh, danh sách đường dẫn media công khai có hạn và dấu nội dung; MUST trả
  đúng một trong: *đã đăng* (mã bài + đường dẫn bài), *đang xử lý* (mã theo dõi xử lý), *lỗi* (đã phân loại). Hết thời
  gian chờ sau khi đã gửi MUST trả *lỗi không xác định*.
- **FR-014**: Đối soát MUST nhận dấu nội dung và khoảng thời gian; MUST trả đúng một trong: *tìm thấy* (mã bài + đường
  dẫn), *không tìm thấy*, *không đối soát được*.
- **FR-015**: Phân loại lỗi MUST trả loại lỗi (*chắc chắn chưa nhận* / *cần người dùng* / *không xác định*), mã lỗi gốc đã
  lọc, thông điệp tiếng Việt đời thường, ít nhất một cách khắc phục. Nguồn ánh xạ MUST là cấu hình đổi được không cần phát
  hành, với giá trị mặc định do bộ chuyển đổi cung cấp; mã chưa ánh xạ MUST thành *không xác định*.
- **FR-016**: Quy tắc media MUST mô tả được định dạng, dung lượng, thời lượng, tỷ lệ khung, số lượng media tối đa của kênh,
  và MUST có thao tác kiểm tra một danh sách media theo quy tắc, trả danh sách vi phạm có lời giải thích.
- **FR-017**: Kiểm tra điều kiện tài khoản MUST trả đạt/không đạt kèm lý do đã phân loại; khi đạt trả loại tài khoản, quyền
  đã cấp, hạn mức còn lại (nếu có) và ngày hết hạn quyền.
- **FR-018**: Làm mới quyền MUST trả hạn mới hoặc lỗi *cần người dùng* với hành động "Kết nối lại".
- **FR-019**: Bộ chuyển đổi MUST được đăng ký vào một danh mục theo loại kênh; thêm loại kênh MUST chỉ cần thêm bộ chuyển
  đổi + ánh xạ lỗi. Loại kênh chưa đăng ký MUST trả lỗi "kênh chưa được hỗ trợ".
- **FR-020**: Bản giả lập bộ chuyển đổi MUST giả lập được ít nhất các loại kênh Facebook Page, Instagram (xử lý bất đồng
  bộ), Zalo OA (không đối soát – giả định đến khi có POC-2) và một kênh chỉ dùng cho kiểm thử; MUST dàn được mọi kịch bản ở
  User Story 1; MUST giữ "danh sách bài đã lên" theo kênh giả để Đối soát nhất quán với Gửi bài, và MUST đếm được số lần
  một dấu nội dung thực sự lên.

**Cổng AI (ADR-06)**

- **FR-030**: Giao diện công khai của Cổng AI MUST có: gọi sinh văn bản (một lần hoặc trả kết quả dần), chuyển giọng nói
  thành chữ, xem mức sử dụng của tài khoản (chỉ %). Bên gọi khai báo loại việc (tạo bài, đề xuất chủ đề, gán nhãn ảnh/video,
  chuyển giọng nói, tóm tắt xu hướng), các phần lời nhắc theo thứ tự cố định (chỉ dẫn hệ thống → hồ sơ kinh doanh theo
  phiên bản → xu hướng ngành của tuần → phần thay đổi) và giới hạn đầu ra.
- **FR-031**: Mỗi lời gọi MUST theo trình tự: ước tính chi phí tối đa → giữ chỗ có điều kiện → chọn mô hình → gọi nhà cung
  cấp → quyết toán + ghi sổ chi phí; lỗi/hết thời gian/hủy MUST trả lại phần giữ chỗ chưa dùng. Không đủ ngân sách MUST chặn
  trước khi gọi nhà cung cấp.
- **FR-032**: Kết quả lỗi của Cổng AI MUST là tập đóng: *hết giới hạn AI của chu kỳ*, *nhà cung cấp tạm thời không phản hồi*
  (sau 1 lần thử dự phòng), *yêu cầu không hợp lệ*. Lỗi *hết giới hạn* MUST mang thông điệp không có số tiền và MUST NOT được
  bên gọi thử lại tự động.
- **FR-033**: Chọn mô hình MUST theo ngưỡng mềm 2.000.000 micro-USD và theo loại việc (bảng ADD Cổng AI mục 5); bên gọi MUST
  NOT chọn mô hình cụ thể. Kết quả MUST cho biết hạng mô hình đã dùng (mặc định/rẻ) để bên gọi hiển thị nếu cần.
- **FR-034**: Tiền MUST là số nguyên micro-USD trên mọi dữ liệu; trần 4.000.000, ngưỡng mềm 2.000.000. Số tiền MUST NOT xuất
  hiện trong dữ liệu của thao tác dành cho màn hình/email khách hàng; mức sử dụng = `floor((đã dùng + đã giữ) / trần × 100)`.
  Số tiền chỉ có ở thao tác nội bộ dành cho hỗ trợ/quản trị.
- **FR-035**: Phía sau Cổng AI MUST có giao diện nội bộ cho bộ chuyển đổi nhà cung cấp (đếm token đầu vào, gọi, gọi trả dần,
  chuyển giọng nói, báo token vào/ra/bộ đệm thực) và giao diện nội bộ cho kho ngân sách (giữ chỗ, quyết toán, trả lại, đọc
  mức sử dụng) và bảng giá (theo mô hình, hiệu lực từ). Chỉ Cổng AI được dùng SDK nhà cung cấp (đã có quy tắc ở 001).
- **FR-036**: Bản giả lập MUST gồm nhà cung cấp giả (văn bản tất định theo loại việc, số token cấu hình được, độ trễ, chữ đầu
  tiên và trả dần, lỗi/hết thời gian/chi phí thực khác ước tính) và kho ngân sách giả trong bộ nhớ giữ đúng bất biến: giữ chỗ
  nguyên tử, *đã dùng + đã giữ ≤ trần* dưới gọi đồng thời, trả lại khi lỗi.
- **FR-037**: Bộ kiểm thử hợp đồng Cổng AI MUST gồm tối thiểu: giữ chỗ đồng thời không vượt trần; chuyển mô hình ở ngưỡng
  mềm; chặn ở trần; trả lại giữ chỗ khi lỗi/hết thời gian/hủy; thử dự phòng đúng 1 lần; quyết toán khi trả dần bị hủy; ước
  tính chuyển giọng nói theo phút giới hạn 5 phút; mức sử dụng không có số tiền (nguyên tắc III – kiểm thử bắt buộc).
- **FR-038**: Việc hệ thống (tóm tắt xu hướng theo ngành) MUST gọi qua thao tác ngữ cảnh hệ thống, chi phí ghi vào phạm vi
  ngành thay vì giữ chỗ vào ngân sách của một tài khoản.

**Thông báo**

- **FR-040**: Giao diện công khai MUST có thao tác phát sự kiện thông báo với loại thuộc danh mục đóng theo UI/UX mục 8: bài
  chờ duyệt mới; bài bị trả lại; cộng tác viên đổi giờ bài đã duyệt; tạo bài hàng loạt xong; bài cần xử lý / cần kiểm tra;
  quyền kênh sắp hết hạn; mức sử dụng AI 80% / 100%; gói sắp hết hạn; dữ liệu sắp bị xóa.
- **FR-041**: Mỗi loại MUST khai báo sẵn quy tắc người nhận (chủ / cộng tác viên soạn bài / người tạo) và kênh gửi (trong ứng
  dụng, email, nhóm gộp email 10 phút hoặc gửi ngay) theo đúng bảng UI/UX mục 8; bên phát MUST NOT tự chọn kênh gửi.
- **FR-042**: Phát sự kiện MUST nằm trong cùng giao dịch với dữ liệu nghiệp vụ (qua hàng chờ `notify`); giao dịch hủy thì
  không có thông báo (nguyên tắc IV, V).
- **FR-043**: Mỗi sự kiện MUST có khóa chống trùng; cùng khóa MUST chỉ tạo một thông báo.
- **FR-044**: Dữ liệu sự kiện MUST gồm tham chiếu đối tượng (vd mã bài, mã lượt đăng, mã kết nối kênh) và ít nhất một hành
  động khắc phục/đi tới; MUST NOT chứa số tiền AI, mã quyền, mật khẩu, nội dung bài (chỉ tên ngắn của bài). Vi phạm MUST bị
  từ chối khi chạy.
- **FR-045**: Phía sau MUST có giao diện nội bộ bộ gửi email phân biệt kết quả *đã gửi* / *lỗi tạm thời* / *lỗi vĩnh viễn*.
  Bản giả lập MUST ghi lại "hộp thư đi" để kiểm thử đọc lại, kèm dàn được lỗi tạm thời/vĩnh viễn.

**Kho tệp (ADR-07a, ADR-10)**

- **FR-050**: Giao diện công khai MUST có: xin đường dẫn ký sẵn để tải lên (hạn ≤ 15 phút, ràng buộc loại tệp và kích thước
  tối đa); đọc thông tin tệp (tồn tại, kích thước, loại tệp, dấu tệp); đọc và ghi tệp phía máy chủ (dạng luồng, cho Worker);
  sao chép; xóa; liệt kê theo tiền tố của tài khoản; xin đường dẫn xem trước (hạn ≤ 1 giờ); xin đường dẫn công khai có hạn
  cho nền tảng (hạn ≤ 24 giờ).
- **FR-051**: Vị trí tệp MUST được dựng bởi hợp đồng từ mã tài khoản trong ngữ cảnh và mã đối tượng theo các khuôn đã khai báo:
  `tenants/{accountId}/media/{mediaId}/original`, `…/normalized/…`, `…/thumb`, `tenants/{accountId}/context/…`,
  `tmp/{jobId}/…`. Bên gọi MUST NOT truyền đường dẫn thô; thao tác ngoài tiền tố của tài khoản trong ngữ cảnh MUST bị từ chối
  (nguyên tắc I).
- **FR-052**: Tệp lớn MUST đi thẳng từ trình duyệt lên kho bằng đường dẫn ký sẵn; hợp đồng MUST NOT có thao tác nhận nội dung
  tệp tải lên qua API (nguyên tắc V).
- **FR-053**: Bản giả lập kho tệp MUST thực thi đúng hạn đường dẫn, ràng buộc vị trí/loại/kích thước, và cho kiểm thử "dùng"
  đường dẫn ký sẵn để đặt tệp như trình duyệt.

### Key Entities *(include if feature involves data)*

Tính năng này **không** tạo bảng nghiệp vụ trong CSDL; các thực thể dưới đây là dữ liệu trên hợp đồng.

- **Loại kênh & năng lực kênh**: Facebook Page / Instagram / Zalo OA (+ kênh kiểm thử); cờ đối soát, xử lý bất đồng bộ, làm mới
  quyền, báo hạn mức, khoảng đối soát tối đa.
- **Quy tắc media của kênh**: định dạng, dung lượng, thời lượng, tỷ lệ khung, số lượng tối đa; vi phạm quy tắc.
- **Yêu cầu gửi bài / kết quả gửi bài**: nội dung theo kênh, đường dẫn media có hạn, dấu nội dung; *đã đăng* / *đang xử lý* /
  *lỗi*. Mã bài và đường dẫn bài trên nền tảng.
- **Kết quả đối soát**: *tìm thấy* / *không tìm thấy* / *không đối soát được*.
- **Lỗi đã phân loại**: loại lỗi (3 giá trị), mã lỗi gốc đã lọc, thông điệp tiếng Việt, cách khắc phục. Ánh xạ lỗi (loại kênh, mã
  gốc → lỗi đã phân loại) là cấu hình.
- **Lời gọi AI**: loại việc, các phần lời nhắc có thứ tự, giới hạn đầu ra, mã theo dõi; kết quả: văn bản (hoặc luồng), hạng mô
  hình, token vào/ra/bộ đệm.
- **Ngân sách AI của chu kỳ** (khái niệm, lưu thật ở WBS 3.1): tài khoản, chu kỳ, đã dùng, đã giữ, trần, ngưỡng mềm, trạng thái.
- **Giữ chỗ**: số tiền ước tính, thời điểm giữ, mô hình dự kiến; được quyết toán hoặc trả lại.
- **Dòng sổ chi phí AI**: tài khoản (hoặc phạm vi ngành), chu kỳ, loại việc, mô hình, nhà cung cấp, token, chi phí micro-USD,
  mã theo dõi, thời điểm.
- **Mức sử dụng AI (cho khách)**: phần trăm, trạng thái, ngày bắt đầu chu kỳ mới – không số tiền.
- **Sự kiện thông báo**: loại (danh mục đóng), tham chiếu đối tượng, tham số hiển thị, hành động, khóa chống trùng; quy tắc người
  nhận và kênh gửi theo loại.
- **Vị trí tệp**: khuôn vị trí theo tài khoản/đối tượng/việc; đường dẫn ký sẵn (mục đích tải lên/xem trước/công khai, hạn);
  thông tin tệp (kích thước, loại, dấu tệp).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Đội Đăng bài viết được kiểm thử cho 100% kịch bản ở User Story 1 (đủ 3 loại lỗi, 3 kết quả đối soát, xử lý bất
  đồng bộ, làm mới quyền) mà không cần tài khoản hay mạng tới bất kỳ nền tảng nào.
- **SC-002**: Thêm một loại kênh mới (kênh kiểm thử thứ tư) cần **0** thay đổi ở phía gọi (module Đăng bài và luồng gọi mẫu);
  bộ kiểm thử hợp đồng tự áp dụng cho kênh mới.
- **SC-003**: Trong ít nhất 100 lần chạy kiểm thử đồng thời (≥ 20 lời gọi cùng lúc sát trần), tổng *đã dùng + đã giữ* vượt trần
  **0** lần; mọi lời gọi lỗi/hết thời gian/hủy để lại **0** giữ chỗ treo.
- **SC-004**: **0** trường số tiền xuất hiện trong dữ liệu của thao tác dành cho khách hàng (Cổng AI, Thông báo) – kiểm bằng kiểm
  thử tự động trên toàn bộ danh mục thông báo và thao tác mức sử dụng.
- **SC-005**: **0** lần truy cập thành công vào tệp của tài khoản khác qua kho tệp trong bộ kiểm thử truy cập chéo (mọi thao tác
  × mọi khuôn vị trí).
- **SC-006**: Môi trường chính thức từ chối khởi động trong 100% trường hợp có ít nhất một thành phần trỏ bản giả lập.
- **SC-007**: Ứng dụng chạy được toàn luồng thử (kết nối kênh giả → gửi bài giả → tạo bài AI giả → nhận thông báo giả) trên máy
  cục bộ với **0** kết nối mạng ra ngoài.
- **SC-008**: Bộ kiểm thử hợp đồng của cả bốn thành phần với bản giả lập chạy xong trong ≤ 2 phút trên CI, để chạy được ở mọi lần
  hợp nhất.
- **SC-009**: **0** mã quyền, mật khẩu, nội dung lời nhắc/bài xuất hiện trong nhật ký và chỉ số khi chạy bộ kiểm thử (công cụ quét
  bí mật trong nhật ký mẫu của CI).
- **SC-010**: Khi WBS 2.3, 3.1, 4.3, 2.6 đưa bản thật vào, module gọi không phải sửa để thích ứng (đo khi các tính năng đó hợp nhất:
  số thay đổi phía gọi do đổi hợp đồng = 0, trừ khi có sửa đổi hợp đồng được SA duyệt).

## Assumptions

- "Giao diện" trong yêu cầu là **giao diện công khai giữa module** (hợp đồng lập trình), không phải màn hình. Tính năng không làm
  màn hình mới; giao diện người dùng chỉ hưởng lợi qua chế độ chạy bằng bản giả lập (User Story 6).
- Kho ngân sách giả lập nằm trong bộ nhớ của tiến trình; bản lưu CSDL (`ai_budgets`, `ai_cost_ledger`, `model_prices`) và chu kỳ
  theo ngày kích hoạt là WBS 3.1/4.4. Bất biến của bản giả lập giống bản thật để bộ kiểm thử hợp đồng dùng lại được.
- Kho tệp là hạ tầng dùng chung phía máy chủ (không phải module nghiệp vụ có schema); module được dùng: Thư viện media, Ngữ cảnh
  kinh doanh, Tài khoản (xóa dữ liệu). Module Đăng bài lấy đường dẫn công khai qua giao diện của Thư viện media, không gọi thẳng
  kho tệp.
- Giới hạn thời gian: đường dẫn tải lên ≤ 15 phút, xem trước ≤ 1 giờ, công khai cho nền tảng ≤ 24 giờ, tệp tạm tự xóa sau 1 ngày,
  giữ chỗ treo trả lại sau 15 phút (architecture.md mục 3, 6, 7.3).
- Năng lực đối soát của Zalo OA và hạn mức thực tế chưa chốt (POC-2); bản giả lập Zalo OA mặc định "không đối soát được", đổi bằng
  cấu hình khi có kết quả POC.
- Mô hình/nhà cung cấp AI chưa chốt (POC-1, POC-4); bản giả lập chỉ dùng tên hạng "mặc định"/"rẻ"/"thị giác rẻ"/"chuyển giọng nói",
  bảng giá giả là cấu hình.
- Gộp email 10 phút và lưu thông báo trong ứng dụng là việc của bản thật (WBS 4.3); hợp đồng chỉ khai báo nhóm gộp cho từng loại để
  bản thật thực hiện.
- Ngưỡng 80% / 100% được Cổng AI phát thành sự kiện thông báo; bản giả lập phát đúng sự kiện khi vượt ngưỡng lần đầu trong chu kỳ.

## Clarifications

### Phạm vi bản cài đặt kho tệp và email

- [NEEDS CLARIFICATION: Ngoài bản giả lập trong tiến trình, tính năng này có làm luôn bản thật theo chuẩn mở – kho tệp qua giao
  diện S3 và bộ gửi email qua SMTP – kèm dịch vụ giả lập S3/SMTP chạy cục bộ trong docker compose (để trình duyệt tải tệp thật lên
  bằng đường dẫn ký sẵn ở môi trường phát triển), hay chỉ dừng ở bản giả lập trong tiến trình và để bản thật cho WBS 2.6/4.3?]
