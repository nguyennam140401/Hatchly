# Feature Specification: Đăng bài 5 bước – lượt đăng duy nhất, bộ hẹn giờ, thử lại, đối soát, "Cần kiểm tra", bộ chuyển đổi Facebook/Instagram, màn hình Tiến trình đăng

**Feature Branch**: `013-publish-five-steps`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Dựa vào tài liệu kiến trúc và mô tả phần mềm của chương trình, viết tài liệu mô tả tính năng 'Đăng bài 5 bước: lượt đăng duy nhất, bộ hẹn giờ, thử lại, đối soát, "Cần kiểm tra", bộ chuyển đổi FB/IG, màn hình Tiến trình đăng' đáp ứng cho chương trình"

**Truy vết**: FR-07 (đăng đúng lịch bằng bộ hẹn giờ chung; lưu đường dẫn bài; không đăng trùng; kết quả không xác
định được đối soát trước khi gửi lại) · FR-08 (5 bước, mỗi bước có thời điểm, kết quả, mã lỗi gốc, lời giải thích +
cách khắc phục) · FR-09 (lỗi tạm thời tự thử lại; lỗi cần người xử lý → thông báo trong ứng dụng + email; đăng lại bằng
1 thao tác; "Cần kiểm tra" → "Đã đăng" hoặc "Đăng lại") · FR-10 (phần dữ liệu cho tra cứu hỗ trợ – màn hình tra cứu
nội bộ là tính năng riêng) · FR-13 (gói hết hạn → chặn đăng, kiểm tra ở bước 1) · FR-02 (điều kiện tài khoản, quyền hết
hạn) · NFR Tin cậy đăng bài (≥ 98% thành công, lệch lịch ≤ 5 phút, **0 bài đăng trùng**, không mất bài khi khởi động
lại) và NFR Giám sát (mã theo dõi xuyên suốt, cảnh báo > 5% lỗi/15 phút, việc quá hạn > 5 phút) · Đặc tả yêu cầu mục
3.1 (mã quyền `post.republish`, `status.view`, `support.lookup`) · ADD Đăng bài (mục 3 giao diện chung, mục 4 vòng đời
lượt đăng, mục 5 luồng, mục 6 dữ liệu, mục 7 phân loại lỗi, mục 8–9) · ADD Worker · Kiến trúc triển khai mục 6 (hàng
chờ `publish`) và 7.1 · UI/UX mục 5 luồng F4, mục 6 (**Tiến trình đăng**), mục 7 (hệ thống trạng thái), mục 8 (thông
báo "Bài cần xử lý / cần kiểm tra") · ADR-03, ADR-04, ADR-05, ADR-07a · Hiến pháp nguyên tắc **II** (trọng tâm), I, IV,
V, VII, VIII.

**Phụ thuộc**: `012-manual-compose-approval-calendar` (bài đã duyệt, giờ đăng và việc tạo mục lịch đăng; tính năng này
**thực thi** các mục đó) · `010-connect-facebook-instagram` (kênh đã kết nối, mã quyền mã hóa, điều kiện tài khoản) ·
`005-gateway-contracts-fakes` (giao diện chung bộ chuyển đổi nền tảng, bản giả lập, thông báo, kho tệp) ·
`003-queue-layer-pgboss` (hàng chờ bền vững, khóa chống trùng, giới hạn đồng thời) · `002-db-layer-tenant-rls` ·
`004-minimal-auth-rbac` · `011-ui-architecture-foundation`. Phụ thuộc **mềm**: Thư viện media (FR-03) để lấy bản
chuẩn hóa của ảnh/video – xem Assumptions.

**Bối cảnh**: Đây là nơi tập trung cả ba cam kết khó nhất với khách hàng: **đúng giờ, không bao giờ trùng, tra được lỗi**.
Đến lúc này hệ thống mới dừng ở "bài đã duyệt, đã lên lịch" (012) và các bộ chuyển đổi giả lập; chưa có gì thực sự đưa
bài lên Facebook Page hay Instagram. Tính năng này làm việc đó: đến giờ hẹn, hệ thống đăng bài lên từng kênh theo 5
bước có ghi nhật ký, tự xử lý lỗi tạm thời, **không bao giờ gửi lại mù** khi chưa biết bài đã lên hay chưa, và cho
người dùng thấy đúng bước nào hỏng, vì sao, bấm gì để sửa. API đăng bài của nền tảng không có khóa chống trùng, nên một
lần đăng trùng lên Page của khách hàng gây hại uy tín trực tiếp, nặng hơn việc chậm vài phút. **Không** thuộc phạm vi:
Zalo OA và TikTok (mỗi nền tảng thêm sau chỉ bằng một bộ chuyển đổi mới, không sửa luồng đăng chính), soạn/duyệt/lên lịch
(012), màn hình tra cứu nội bộ của đội hỗ trợ (chỉ cung cấp dữ liệu và mã theo dõi), AI, thống kê tương tác sau đăng,
dùng tính năng hẹn giờ của nền tảng.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bài đã lên lịch được đăng đúng giờ lên Facebook Page và Instagram (Priority: P1)

Chị Lan đã duyệt bài "Khai trương chi nhánh 2" cho Facebook và Instagram lúc 9:00. Đến 9:00 hệ thống tự đăng lên
cả hai kênh. Vài phút sau chị thấy bài chuyển "Đang đăng" rồi "Đã đăng", kèm đường dẫn tới bài thật trên từng kênh. Chị
không phải làm gì thêm.

**Why this priority**: Đây là giá trị cốt lõi của sản phẩm (đăng thay khách hàng) và mục tiêu thành công (≥ 98% bài đã
duyệt đăng được, lệch lịch ≤ 5 phút).

**Independent Test**: Với một tài khoản có kênh Facebook và Instagram (bản giả lập hoặc kênh thử), lên lịch một bài hai
kênh vào 5 phút sau; sau giờ hẹn mỗi kênh có đúng một lượt đăng ở trạng thái thành công, có đường dẫn bài, và đủ 5 bước
được ghi.

**Acceptance Scenarios**:

1. **Given** bài đã duyệt, mỗi kênh có một lượt đăng chờ đến giờ, **When** đến giờ hẹn, **Then** hệ thống thực hiện lượt
   đăng của từng kênh độc lập nhau; bài lên đúng nội dung phiên bản kênh đã duyệt, kèm media đã chọn.
2. **Given** nền tảng xác nhận đăng thành công, **When** lượt đăng hoàn tất, **Then** trạng thái kênh là "Đã đăng",
   lưu đường dẫn bài trên nền tảng; khi mọi kênh thành công, trạng thái tổng của bài là "Đã đăng".
3. **Given** một bài hai kênh trong đó Facebook thành công còn Instagram lỗi, **When** xem bài, **Then** trạng thái tổng
   là trạng thái "xấu nhất" và chi tiết hiện riêng từng kênh (vd "Đã đăng: Facebook · Cần bạn xử lý: Instagram");
   lỗi ở Instagram không làm đăng lại Facebook.
4. **Given** Worker nhận việc chậm hoặc bị khởi động lại (phát hành), **When** việc được chạy lại, **Then** bài vẫn được
   đăng trong tối đa 5 phút kể từ giờ hẹn (trừ khi hệ thống quá tải), không mất việc.
5. **Given** nhiều tài khoản có bài hẹn cùng giờ, **When** một tài khoản đăng hàng loạt, **Then** tài khoản khác không bị
   trễ quá giới hạn lệch lịch vì tài khoản đó (giới hạn số lượt đăng đồng thời theo từng tài khoản).
6. **Given** giờ hẹn đến nhưng bài đã bị hủy lịch hoặc sửa nội dung (012) trước khi Worker nhận việc, **When** Worker
   chạy, **Then** không đăng gì và lượt đăng ở trạng thái "Đã hủy".

---

### User Story 2 - Không bao giờ đăng trùng (Priority: P1)

Dù người dùng bấm "Duyệt" hai lần, hai Worker cùng lấy một việc, Worker chết giữa chừng, hay việc bị giao lại sau khi
khóa hết hạn, mỗi cặp (bài, kênh) vẫn chỉ được gửi lên nền tảng **tối đa một lần** trừ khi người dùng chủ động chọn
"Đăng lại".

**Why this priority**: Đăng trùng lên Page khách hàng là lỗi nặng nhất và không thể thu hồi từ phía hệ thống (Hiến pháp II;
NFR: 0 bài đăng trùng).

**Independent Test**: Chạy kịch bản kiểm thử mô phỏng: (a) hai Worker nhận cùng một lượt đăng đồng thời; (b) Worker bị
tắt đột ngột ngay sau khi gửi; (c) việc chạy lại hai lần; (d) nền tảng trả hết thời gian chờ sau khi đã nhận bài → trong
mọi trường hợp số bài thực sự xuất hiện trên nền tảng giả lập ≤ 1 cho mỗi (bài, kênh).

**Acceptance Scenarios**:

1. **Given** mỗi cặp (bài, kênh), **When** hệ thống tạo lượt đăng, **Then** chỉ tồn tại tối đa một lượt đăng đang hiệu
   lực; yêu cầu tạo thứ hai (bấm đúp, hai tab) bị từ chối hoặc trả về lượt hiện có, không tạo mới.
2. **Given** hai Worker cùng nhận một lượt đăng, **When** cả hai cố chuyển sang "Đang xử lý", **Then** chỉ một Worker
   chuyển được (chuyển trạng thái có điều kiện theo trạng thái hiện tại); Worker còn lại dừng, không gửi gì.
3. **Given** hệ thống đã ghi "Đã gửi, chờ phản hồi" cùng dấu nội dung **trước** khi gọi nền tảng, **When** Worker chết sau
   đó và việc được chạy lại, **Then** lần chạy lại thấy dấu này, **không** gửi lại mà đi nhánh "Không xác định" (đối soát).
4. **Given** một lượt đăng đã "Đã đăng" hoặc đã kết thúc, **When** việc cũ bị giao lại, **Then** việc kết thúc ngay,
   không có tác dụng phụ (xử lý chạy lại an toàn).
5. **Given** người dùng chọn "Đăng lại", **When** thực hiện, **Then** lượt đăng hiện có quay về chờ đến giờ với giờ = bây
   giờ (không tạo lượt thứ hai song song) và thao tác được ghi nhật ký người thực hiện.

---

### User Story 3 - Lỗi tạm thời tự thử lại, lỗi cần người dùng được báo kèm cách sửa (Priority: P1)

Lúc 9:00 Facebook báo "quá tải, thử lại sau". Hệ thống không báo gì cho chị Lan mà lặng lẽ thử lại với giãn cách tăng dần;
bài đăng được lúc 9:07. Ở một bài khác, quyền truy cập Page đã hết hạn: hệ thống dừng ngay, chị nhận thông báo trong ứng
dụng và email "Kết nối Facebook đã hết hạn. Vào Kết nối kênh để kết nối lại", bấm nút là tới đúng màn hình.

**Why this priority**: Phân loại đúng lỗi quyết định giữa "tự lành" (đủ để đạt ≥ 98% thành công) và "báo đúng người đúng
việc trong ≤ 5 phút" (Hiến pháp VI: mỗi thông báo lỗi kèm hành động khắc phục).

**Independent Test**: Cho bộ chuyển đổi giả lập trả lần lượt ba loại lỗi; kiểm tra: loại "chắc chắn chưa nhận" → thử lại
đúng lịch giãn cách rồi dừng sau tối đa 5 lần/30 phút; loại "cần người dùng" → dừng ngay, có thông báo + email với cách sửa;
loại "không xác định" → không gửi lại.

**Acceptance Scenarios**:

1. **Given** lỗi được phân loại **chắc chắn chưa được nhận** (nền tảng quá tải, giới hạn tốc độ, lỗi mạng trước khi
   nền tảng nhận), **When** xảy ra, **Then** lượt đăng sang "Chờ thử lại" với giãn cách tăng dần, tối đa **5 lần trong 30
   phút**; người dùng **không** nhận thông báo trong lúc đang thử lại; trên giao diện vẫn hiện "Đang đăng".
2. **Given** đã hết 5 lần/30 phút mà vẫn lỗi, **When** hết lượt, **Then** lượt đăng chuyển "Cần bạn xử lý", người dùng
   nhận thông báo trong ứng dụng + email nêu lý do và nút "Đăng lại".
3. **Given** lỗi được phân loại **cần người dùng xử lý** (quyền hết hạn/bị thu hồi, Instagram không phải tài khoản
   chuyên nghiệp, ảnh sai định dạng không tự chuyển được, vượt hạn mức bài trong ngày của kênh, gói đã hết hạn), **When**
   xảy ra, **Then** lượt đăng dừng ngay ở "Cần bạn xử lý", không thử lại; thông báo trong ứng dụng + email kèm lời giải
   thích bằng tiếng Việt thường và **ít nhất một hành động khắc phục** (vd "Kết nối lại", "Chọn giờ đăng khác").
4. **Given** nhiều lượt đăng cùng cần xử lý trong thời gian ngắn, **When** gửi email, **Then** các email của cùng tài
   khoản được **gộp trong 10 phút** (UI/UX mục 8); thông báo trong ứng dụng vẫn đủ từng bài.
5. **Given** mã lỗi gốc của nền tảng chưa có trong bảng ánh xạ lỗi, **When** xảy ra, **Then** được phân vào loại "không
   xác định" (an toàn, không gửi lại), kèm thông điệp chung "Có sự cố khi đăng, chúng tôi đang kiểm tra" và mã lỗi gốc lưu
   cho hỗ trợ; không bao giờ đoán là lỗi tạm thời.
6. **Given** bảng ánh xạ lỗi → loại/thông điệp/cách khắc phục là cấu hình, **When** vận hành sửa một thông điệp hay thêm
   mã lỗi, **Then** có hiệu lực ở các lượt đăng sau mà không cần phát hành lại ứng dụng.

---

### User Story 4 - Kết quả không xác định được đối soát trước khi gửi lại; "Cần kiểm tra" khi không đối soát được (Priority: P1)

Facebook nhận bài nhưng kết nối bị treo, hệ thống không biết bài đã lên chưa. Hệ thống **không gửi lại**; sau 2 phút nó
tìm trong các bài gần nhất của Page xem có bài khớp không. Thấy → ghi "Đã đăng". Không thấy sau 10 phút → thử lại đúng 1
lần. Nếu kênh không cho đối soát, bài chuyển **"Cần kiểm tra"** và chị Lan tự xem Page rồi bấm "Đã đăng" hoặc "Đăng lại".

**Why this priority**: Đây là điểm duy nhất dễ gây đăng trùng hoặc mất bài một cách âm thầm; ADR-04 đòi đối soát trước
khi gửi lại.

**Independent Test**: Bộ chuyển đổi giả lập trả "hết thời gian chờ" ở ba chế độ: bài thực sự đã lên, bài chưa lên, kênh
không hỗ trợ đối soát → kết quả lần lượt là "Đã đăng" (không gửi lại), thử lại đúng 1 lần rồi đăng thành công, và "Cần kiểm
tra".

**Acceptance Scenarios**:

1. **Given** lượt đăng ở "Không xác định" (hết thời gian chờ sau khi đã gửi, hoặc Worker chết sau khi ghi "Đã gửi"),
   **When** 2 phút sau, **Then** hệ thống đối soát: đọc các bài gần nhất của kênh trong khoảng thời gian hợp lý và so
   **dấu nội dung** đã lưu trước khi gửi.
2. **Given** đối soát thấy bài khớp, **When** xác nhận, **Then** lượt đăng sang "Đã đăng" với đường dẫn bài thật; **không**
   gửi lại; ghi rõ trong dòng thời gian rằng kết quả được xác nhận nhờ đối soát.
3. **Given** đối soát không thấy bài, **When** chưa đủ 10 phút kể từ lúc gửi, **Then** tiếp tục đối soát theo lịch;
   **sau 10 phút** vẫn không thấy thì thử lại **đúng một lần**; nếu lần thử lại này lại không xác định → "Cần kiểm tra"
   (không thử lại tiếp). (Ngưỡng 10 phút là giả định, cấu hình được – Assumptions.)
4. **Given** kênh **không hỗ trợ đối soát** (hoặc quyền hiện có không đọc được bài đã đăng), **When** rơi vào "Không xác
   định", **Then** lượt đăng chuyển ngay **"Cần kiểm tra"**; người dùng nhận thông báo (trong ứng dụng + email) nêu rõ
   "Chúng tôi không chắc bài đã lên Page chưa" và hai nút: **"Đã đăng"**, **"Đăng lại"**.
5. **Given** lượt đăng ở "Cần kiểm tra", **When** người dùng (chủ hoặc cộng tác viên) bấm **"Đã đăng"**, **Then** lượt
   đăng sang "Đã đăng" (người dùng có thể dán đường dẫn bài, tùy chọn), ghi nhật ký người xác nhận, không gửi gì lên nền
   tảng; **"Đăng lại"** → xem User Story 2, kịch bản 5, kèm cảnh báo "bài có thể bị đăng trùng nếu bài trước đã lên".
6. **Given** tỷ lệ lượt đăng rơi vào "Cần kiểm tra" vượt 1% trong một kênh, **When** vận hành theo dõi, **Then** có cảnh
   báo nội bộ (điều kiện xem lại ADR-04).

---

### User Story 5 - Màn hình Tiến trình đăng: tự tìm lỗi ở bước nào (Priority: P1)

Chị Lan nhận thông báo "Bài 'Khai trương chi nhánh 2' chưa đăng được lên Facebook". Chị mở bài, thấy khu vực **Tiến trình
đăng** theo từng kênh: dòng thời gian 5 bước (Kiểm tra → Chuẩn bị ảnh/video → Gửi lên → Nền tảng xử lý → Xác nhận), bước
lỗi được đánh dấu, kèm câu giải thích dễ hiểu và nút hành động ("Kết nối lại", "Đăng lại", "Đã đăng", "Gửi cho hỗ trợ").

**Why this priority**: Chỉ số thành công là báo lỗi cho người dùng ≤ 5 phút **và** hỗ trợ tra được từng bước (FR-08);
không có màn hình này thì người dùng chỉ thấy "lỗi" mà không biết làm gì.

**Independent Test**: Với một lượt đăng lỗi ở bước 2 (media sai định dạng): màn hình hiện bước 1 hoàn tất, bước 2 đánh dấu
lỗi, bước 3–5 chưa chạy, có lời giải thích + cách khắc phục + nút "Đăng lại"; "Chi tiết cho hỗ trợ" thu gọn mặc định và
chứa mã lỗi gốc, mã lượt đăng.

**Acceptance Scenarios**:

1. **Given** người dùng có quyền xem trạng thái, **When** mở chi tiết một bài, **Then** thấy khu vực **Tiến trình đăng**
   riêng cho từng kênh: trạng thái kênh, dòng thời gian 5 bước, mỗi bước có thời điểm, kết quả (chưa chạy / đang chạy /
   thành công / lỗi / bỏ qua), lời giải thích và cách khắc phục khi lỗi; đường dẫn bài đã đăng khi thành công.
2. **Given** lượt đăng đang chạy, **When** xem màn hình, **Then** bước hiện tại nhấp nháy (kèm chữ "Đang thực hiện", không
   chỉ dựa vào màu/chuyển động) và màn hình tự cập nhật khi trạng thái đổi mà không cần tải lại trang.
3. **Given** lượt đăng ở trạng thái nội bộ "Chờ thử lại" hoặc "Không xác định", **When** người dùng xem, **Then** vẫn thấy
   "Đang đăng" (không gây lo lắng); chỉ khi chuyển sang cần hành động mới hiện thông báo lỗi; **đội hỗ trợ** thấy đủ trạng
   thái hệ thống (UI/UX mục 7).
4. **Given** lượt đăng ở "Cần bạn xử lý", **When** xem, **Then** hiện nút khắc phục đúng với lỗi (vd "Kết nối lại" dẫn tới
   màn hình Kênh kết nối; "Chọn giờ khác" dẫn tới đổi giờ) và nút **"Đăng lại"** cho chủ và cộng tác viên; nút **"Gửi cho
   hỗ trợ"** tự đính kèm mã lượt đăng.
5. **Given** lượt đăng ở "Cần kiểm tra", **When** xem, **Then** hiện hai nút "Đã đăng" và "Đăng lại" kèm lời giải thích vì
   sao hệ thống không chắc.
6. **Given** vùng "Chi tiết cho hỗ trợ", **When** người dùng mở, **Then** thấy mã lỗi gốc và mã lượt đăng; mã quyền truy
   cập, mật khẩu, bí mật **không bao giờ** xuất hiện ở bất kỳ nơi nào của màn hình (kể cả trong phản hồi của máy chủ).
7. **Given** màn hình dùng trên điện thoại 360 px, **When** xem, **Then** dòng thời gian chuyển sang dạng dọc, vùng chạm
   ≥ 44 × 44 px, trạng thái bằng chữ + biểu tượng, đạt WCAG 2.1 AA.
8. **Given** người dùng của tài khoản khác hoặc không có quyền xem trạng thái, **When** truy cập trực tiếp địa chỉ, **Then**
   bị từ chối; không lộ sự tồn tại của lượt đăng.

---

### User Story 6 - Bộ chuyển đổi Facebook Page và Instagram sau một giao diện chung (Priority: P1)

Hệ thống đăng lên Facebook Page và Instagram thông qua hai bộ chuyển đổi cắm vào cùng một giao diện chung. Luồng đăng
chính (hẹn giờ, 5 bước, thử lại, đối soát, thông báo) không biết gì về nền tảng cụ thể; sau này thêm Zalo OA hay TikTok chỉ
là thêm một bộ chuyển đổi và bảng ánh xạ lỗi.

**Why this priority**: Là điều kiện để đăng thật lên hai kênh giai đoạn 1 và để mở rộng (NFR Mở rộng, ADR-05); nộp xét duyệt
ứng dụng của Meta cần luồng "kết nối + đăng bài" chạy được.

**Independent Test**: Chạy bộ kiểm thử hợp đồng chung (cùng một bộ ca kiểm thử) trên bộ chuyển đổi Facebook, Instagram và
bản giả lập; tất cả đạt cùng hành vi quy định ở giao diện chung.

**Acceptance Scenarios**:

1. **Given** giao diện chung gồm: kiểm tra điều kiện tài khoản, quy tắc media, gửi bài, kiểm tra trạng thái xử lý, đối
   soát, phân loại lỗi, làm mới quyền, **When** thêm bộ chuyển đổi mới, **Then** không phải sửa bộ thực thi, nhật ký, đối
   soát hay thông báo.
2. **Given** bộ chuyển đổi Facebook, **When** gửi bài chữ, ảnh hoặc video lên một Page đã kết nối, **Then** bài lên đúng
   Page, trả mã bài và đường dẫn; nền tảng xử lý đồng bộ nên bước 4 ghi "không áp dụng/hoàn tất ngay".
3. **Given** bộ chuyển đổi Instagram (tài khoản chuyên nghiệp), **When** gửi bài ảnh/video, **Then** thực hiện đúng quy
   trình hai giai đoạn của nền tảng (tạo bản nháp media → chờ xử lý xong → xuất bản): bước 3 gửi bản nháp, **bước 4 chờ
   nền tảng xử lý xong** (kiểm tra trạng thái định kỳ), bước 5 xác nhận bài đã xuất bản; bài Instagram không có media bị
   chặn từ bước 1 với thông báo rõ.
4. **Given** quy tắc media của kênh (định dạng, dung lượng, thời lượng, Instagram chỉ ảnh JPEG), **When** bước 1–2 chạy,
   **Then** media không hợp được tự chuyển đổi nếu có thể; nếu vẫn không được → lỗi "cần người dùng" kèm "vui lòng chọn
   ảnh khác".
5. **Given** Instagram giới hạn số bài/24 giờ (hạn mức kênh), **When** kênh đã hết lượt, **Then** bước 1 báo lỗi cần người
   dùng "Kênh đã hết lượt đăng hôm nay, chọn giờ đăng khác" thay vì thử gửi rồi bị từ chối.
6. **Given** mã quyền truy cập đã mã hóa, **When** bộ chuyển đổi cần dùng, **Then** chỉ module Cổng nền tảng giải mã tại thời
   điểm gọi; mã quyền không đi vào nhật ký, chỉ số, thông báo lỗi hay phản hồi giao diện.
7. **Given** nền tảng trả mã lỗi gốc, **When** bộ chuyển đổi phân loại, **Then** ánh xạ qua bảng cấu hình thành đúng một
   trong 3 loại + thông điệp tiếng Việt + cách khắc phục; có kiểm thử hợp đồng cho mỗi mã lỗi quan trọng đã biết.

---

### User Story 7 - Hẹn giờ, đổi giờ, hủy: khớp với lượt đăng đang chờ (Priority: P2)

Giờ hẹn là của **bộ hẹn giờ chung** của hệ thống (không dùng hẹn giờ của Facebook/Instagram). Khi chị Lan đổi giờ trên Lịch
hay sửa nội dung bài đã duyệt, các lượt đăng đang chờ phải cập nhật hoặc hủy **cùng lúc** trong cùng giao dịch, và không
bao giờ đổi được nếu Worker vừa nhận việc.

**Why this priority**: Đảm bảo lịch người dùng thấy (012) và lịch hệ thống thực thi luôn khớp; nhưng phần soạn/lịch đã có
sẵn nên mức ưu tiên thấp hơn bốn câu chuyện lõi.

**Independent Test**: Đổi giờ một bài đã lên lịch: giờ trên lượt đăng và thời điểm chạy của việc cùng đổi; thử đổi đúng
lúc Worker nhận việc → bị từ chối và giữ nguyên giờ cũ; sửa nội dung → các lượt đăng đang chờ thành "Đã hủy".

**Acceptance Scenarios**:

1. **Given** mọi lượt đăng của bài còn ở "Chờ đến giờ", **When** chủ hoặc cộng tác viên đổi giờ, **Then** giờ đăng của
   lượt và thời điểm chạy của việc cập nhật trong cùng một giao dịch; hạn mức kênh được kiểm tra lại ở giờ mới; trạng thái
   duyệt không đổi; ghi nhật ký người đổi.
2. **Given** ít nhất một lượt đăng của bài đã rời "Chờ đến giờ" (Worker đã nhận), **When** đổi giờ, **Then** bị từ chối
   với "Bài đang được đăng, không đổi được giờ" (cập nhật có điều kiện nên không có khoảng hở).
3. **Given** bài đã duyệt bị sửa nội dung, **When** lưu, **Then** các lượt đăng đang "Chờ đến giờ" chuyển "Đã hủy", bài về
   "Chờ duyệt"; lượt đã bắt đầu đăng không bị ảnh hưởng và kênh đó không sửa được (theo 012).
4. **Given** gói của tài khoản hết hạn sau khi bài được lên lịch, **When** đến giờ, **Then** bước 1 phát hiện và dừng ở
   "Cần bạn xử lý" với thông điệp "Gói dịch vụ đã hết hạn…"; bài được đăng khi người dùng bấm "Đăng lại" sau khi gia hạn.
5. **Given** đến giờ mà Worker/hàng chờ ngưng một thời gian rồi khôi phục, **When** việc quá hạn được nhận, **Then** bài được
   đăng muộn nhưng đúng một lần; có cảnh báo vận hành nếu việc đăng quá hạn > 5 phút.

---

### Edge Cases

- **Bài đã bị xóa/kênh bị ngắt kết nối sau khi lên lịch**: bước 1 phát hiện → "Cần bạn xử lý" với "Kết nối lại"; không gửi.
- **Quyền hết hạn đúng lúc đang đăng (giữa bước 3 và 5)**: lỗi được phân loại theo bước đang chạy; nếu đã gửi rồi thì đi
  nhánh "Không xác định", không gửi lại.
- **Nền tảng trả thành công nhưng ghi kết quả vào CSDL thất bại**: lần chạy lại phải thấy dấu "Đã gửi, chờ phản hồi" và đối
  soát; không gửi lại.
- **Instagram xử lý media rất lâu (video)**: bước 4 chờ có giới hạn; quá giới hạn → "Không xác định" (đối soát), không bỏ
  mặc lượt đăng ở "Đang đăng" vô thời hạn.
- **Hai nền tảng trả kết quả trái ngược trong cùng một bài**: mỗi kênh có lượt đăng và vòng đời riêng; không kênh nào ảnh
  hưởng kênh khác.
- **Người dùng bấm "Đăng lại" khi bài vẫn đang ở "Đang đăng"**: bị từ chối ("Bài đang được đăng"), chỉ nhận thao tác khi
  lượt ở "Cần bạn xử lý" hoặc "Cần kiểm tra".
- **Cộng tác viên "Đăng lại"**: được phép (`post.republish`); hành động ghi tên người thao tác; cộng tác viên không "Kết
  nối lại" kênh (chỉ chủ) nên nút hiển thị dạng hướng dẫn "Nhờ chủ tài khoản kết nối lại".
- **Gói hết hạn trong 90 ngày giữ dữ liệu**: không đăng bài mới; các lượt đăng đang chờ dừng ở bước 1 (xem US7-4).
- **Yêu cầu xóa tài khoản đang xử lý**: kênh đã ngắt ngay (FR-14) → mọi lượt đăng đang chờ của tài khoản bị hủy, không gửi
  thêm bài nào.
- **Việc trong hàng chờ bị hỏng (thử quá số lần chung)**: không tự chạy lại chung chung vì rủi ro đăng trùng; chỉ được xử lý
  qua quy trình có đối soát (hỗ trợ không dùng "chạy lại việc" thô cho việc đăng).
- **Đồng hồ máy lệch / giờ hạ mùa hè**: mọi giờ lưu UTC, hiển thị UTC+7; so sánh giờ đến hạn dùng giờ máy chủ cơ sở dữ
  liệu.
- **Nội dung chứa ký tự đặc biệt/emoji khiến dấu nội dung đối soát lệch**: dấu nội dung tính trên nội dung đã chuẩn hóa,
  dùng cùng một quy tắc ở lúc gửi và lúc đối soát.
- **Lượt đăng thành công nhưng nền tảng sau đó xóa bài**: nằm ngoài phạm vi (không theo dõi sau đăng ở giai đoạn 1).

## Requirements *(mandatory)*

### Functional Requirements

**Lượt đăng duy nhất và vòng đời**

- **FR-001**: Hệ thống MUST tạo cho mỗi cặp (bài, kênh) đã duyệt tối đa **một lượt đăng đang hiệu lực**; ràng buộc này
  MUST được bảo đảm ở cơ sở dữ liệu (không chỉ ở mã ứng dụng) và áp dụng cả khi nhiều yêu cầu đến đồng thời.
- **FR-002**: Lượt đăng MUST có vòng đời: Chờ đến giờ → Đang xử lý → (Chờ thử lại | Cần người dùng | Không xác định | Thành
  công); từ Không xác định → (Thành công | Chờ thử lại | Cần kiểm tra); từ Cần kiểm tra → (Thành công | Chờ đến giờ); từ Cần
  người dùng → Chờ đến giờ; từ Chờ đến giờ → Đã hủy. Mọi chuyển trạng thái MUST là **cập nhật có điều kiện theo trạng thái
  hiện tại**; chuyển trạng thái không hợp lệ MUST bị từ chối.
- **FR-003**: Việc duyệt bài, tạo lượt đăng của từng kênh và đặt việc hẹn giờ vào hàng chờ MUST nằm trong **cùng một giao
  dịch** (hoàn tất hoặc không gì thay đổi); việc đăng MUST mang mã tài khoản và Worker MUST đặt lại ngữ cảnh tenant trước
  khi xử lý.
- **FR-004**: Trạng thái **"Đã gửi, chờ phản hồi"** cùng **dấu nội dung** MUST được ghi bền vững **trước** khi gọi nền tảng.
  Khi lần chạy lại thấy dấu này mà chưa có kết quả, hệ thống MUST đi nhánh "Không xác định" và MUST NOT gửi lại.
- **FR-005**: Bộ xử lý việc đăng MUST **chạy lại an toàn** (idempotent): chạy lại sau khi khóa hết hạn, Worker khởi động lại hay
  việc bị giao hai lần MUST không gây gửi lặp hay trạng thái sai.
- **FR-006**: "Đăng lại" (chủ hoặc cộng tác viên, quyền `post.republish`) MUST đưa lượt đăng từ "Cần người dùng" hoặc "Cần
  kiểm tra" về "Chờ đến giờ" với giờ = bây giờ **trên cùng lượt đăng đó** (không tạo lượt thứ hai), kiểm tra lại điều kiện
  trước khi chạy và ghi nhật ký người thao tác; MUST từ chối khi lượt ở trạng thái khác.

**Bộ hẹn giờ và thực thi**

- **FR-007**: Mọi kênh MUST dùng **bộ hẹn giờ chung của hệ thống** để đến giờ mới đăng; MUST NOT dùng tính năng hẹn giờ của
  Facebook/Instagram ở giai đoạn 1.
- **FR-008**: Việc đăng MUST được thực hiện bởi tiến trình nền (Worker) qua **hàng chờ bền vững riêng cho việc đăng, ưu tiên
  cao**, không mất khi khởi động lại; mỗi lượt đăng có khóa chống trùng việc; số lượt đăng đồng thời của mỗi tài khoản MUST có
  giới hạn riêng (mặc định ≤ 3) để một tài khoản không làm trễ tài khoản khác.
- **FR-009**: Bài đã duyệt MUST được đăng với **độ lệch so với giờ hẹn ≤ 5 phút** trong điều kiện vận hành bình thường; việc
  quá hạn > 5 phút MUST kích hoạt cảnh báo vận hành.
- **FR-010**: Đổi giờ (chủ hoặc cộng tác viên) MUST chỉ thành công khi **mọi** lượt đăng của bài còn ở "Chờ đến giờ"; giờ của
  lượt đăng và thời điểm chạy của việc MUST đổi trong cùng một giao dịch; kiểm tra lại hạn mức kênh ở giờ mới; không đổi
  trạng thái duyệt; ghi nhật ký người đổi. Sửa nội dung bài đã duyệt hoặc hủy lịch MUST hủy các lượt đăng đang "Chờ đến giờ".
- **FR-011**: Worker MUST tắt có kiểm soát (ngừng nhận việc mới, chờ việc đang chạy tối đa 30 giây); việc dở dang sau đó MUST
  được xử lý an toàn theo FR-004/FR-005.

**Năm bước đăng và nhật ký**

- **FR-012**: Mỗi lượt đăng MUST ghi đủ **5 bước**: (1) kiểm tra trước, (2) chuẩn bị media, (3) gửi lên nền tảng, (4) chờ
  nền tảng xử lý, (5) xác nhận. Mỗi bước có: thời điểm bắt đầu/kết thúc, kết quả, mã lỗi gốc (nếu lỗi), loại lỗi, lời giải thích
  tiếng Việt dễ hiểu và cách khắc phục. Nhật ký bước **chỉ thêm, không sửa**, lưu **12 tháng**, tách khỏi nhật ký kỹ thuật.
- **FR-013**: Bước 1 MUST kiểm tra: gói của tài khoản còn hiệu lực (FR-13), kênh còn kết nối và quyền còn hạn, điều kiện tài
  khoản (vd Instagram chuyên nghiệp), hạn mức đăng của kênh còn lại (nếu nền tảng cho biết), quy tắc media của kênh; bài và
  phiên bản kênh vẫn ở trạng thái được đăng. Không đạt → dừng, không gọi bước gửi.
- **FR-014**: Bước 2 MUST lấy bản media đã chuẩn hóa và **đường dẫn công khai có hạn (≤ 24 giờ)** từ module Thư viện media
  qua giao diện công khai; MUST xử lý tự động khi có thể (chuyển định dạng) và chỉ báo lỗi khi không xử lý được. Bài không có
  media bỏ qua bước này (ghi "không áp dụng").
- **FR-015**: Bước 3 MUST gửi nội dung phiên bản kênh đã duyệt qua bộ chuyển đổi của kênh, sau khi đã ghi dấu ở FR-004; bước 4
  MUST chờ/kiểm tra trạng thái xử lý với nền tảng bất đồng bộ (Instagram) và ghi "không áp dụng" với nền tảng đồng bộ
  (Facebook); bước 5 MUST xác nhận bài đã xuất bản và **lưu mã bài + đường dẫn bài trên nền tảng**.
- **FR-016**: Mỗi lượt đăng MUST có **mã theo dõi** xuyên suốt từ API → hàng chờ → Worker → lời gọi nền tảng và hiện trong nhật
  ký kỹ thuật, để đội hỗ trợ tra từ mã bài hoặc mã lượt đăng sang toàn bộ nhật ký liên quan.

**Phân loại lỗi, thử lại, đối soát**

- **FR-017**: Mọi lỗi MUST được phân vào đúng **một trong ba loại**: *chắc chắn chưa được nhận*, *cần người dùng xử lý*,
  *không xác định*; mã lỗi chưa biết MUST rơi vào "không xác định". Bảng ánh xạ (kênh, mã lỗi gốc → loại, thông điệp tiếng
  Việt, cách khắc phục) MUST là cấu hình, sửa được không cần phát hành.
- **FR-018**: Lỗi *chắc chắn chưa nhận* MUST được tự thử lại với giãn cách tăng dần, **tối đa 5 lần trong 30 phút**, không
  thông báo người dùng trong lúc thử; hết lượt → "Cần người dùng".
- **FR-019**: Lỗi *cần người dùng* MUST dừng ngay, chuyển "Cần bạn xử lý", gửi **thông báo trong ứng dụng + email** (email gộp
  trong 10 phút) có lời giải thích và **ít nhất một hành động khắc phục**, trong ≤ 5 phút kể từ lúc lỗi.
- **FR-020**: Lỗi *không xác định* MUST NOT gửi lại ngay. Hệ thống MUST **đối soát** sau 2 phút (cấu hình): đọc các bài gần
  nhất của kênh trong khoảng thời gian hợp lý và so dấu nội dung. Thấy → "Thành công" (không gửi lại). Không thấy sau
  **10 phút** (cấu hình) → thử lại **đúng 1 lần**. Kênh/quyền không hỗ trợ đối soát, hoặc vẫn không xác định sau lần thử
  lại → **"Cần kiểm tra"**.
- **FR-021**: Ở "Cần kiểm tra", người dùng (chủ hoặc cộng tác viên) MUST chọn được **"Đã đăng"** (đóng lượt đăng thành công, có
  thể dán đường dẫn) hoặc **"Đăng lại"** (kèm cảnh báo có thể trùng); cả hai MUST ghi nhật ký người thao tác; hệ thống MUST NOT
  tự quyết thay người dùng.

**Bộ chuyển đổi nền tảng**

- **FR-022**: Mỗi nền tảng MUST là một **bộ chuyển đổi** sau giao diện chung gồm: kiểm tra điều kiện tài khoản, quy tắc media,
  gửi bài, kiểm tra trạng thái xử lý, đối soát, phân loại lỗi, làm mới quyền. Tính năng này MUST cung cấp bộ chuyển đổi
  **Facebook Page** và **Instagram (tài khoản chuyên nghiệp)** thay cho bản giả lập; thêm nền tảng sau MUST NOT yêu cầu sửa bộ
  thực thi, nhật ký, đối soát hay thông báo.
- **FR-023**: Chỉ module Đăng bài MUST gọi module Cổng nền tảng; MUST NOT module nào khác gọi nền tảng trực tiếp. Mã quyền
  truy cập MUST chỉ được giải mã trong bộ chuyển đổi tại lúc gọi, và MUST NOT xuất hiện trong nhật ký, chỉ số, thông báo lỗi,
  màn hình hỗ trợ hay phản hồi giao diện.
- **FR-024**: Mỗi bộ chuyển đổi MUST có **kiểm thử hợp đồng** theo giao diện chung (cùng một bộ ca kiểm thử chạy cho mọi bộ
  chuyển đổi, gồm bản giả lập), bao phủ ba loại lỗi và đối soát.
- **FR-025**: Việc làm mới quyền truy cập trước khi hết hạn MUST chạy định kỳ; quyền còn < 7 ngày MUST được nhắc người dùng
  (đã có ở 010, tính năng này chỉ dùng kết quả).

**Màn hình và thông báo**

- **FR-026**: Chi tiết bài MUST có khu vực **Tiến trình đăng** theo từng kênh gồm: trạng thái kênh bằng chữ + biểu tượng, dòng
  thời gian 5 bước với thời điểm/kết quả/lời giải thích/cách khắc phục, đường dẫn bài đã đăng, vùng **"Chi tiết cho hỗ trợ"**
  thu gọn (mã lỗi gốc, mã lượt đăng), và nút hành động phù hợp: **Đăng lại, Kết nối lại, Đã đăng, Gửi cho hỗ trợ**.
- **FR-027**: Hệ thống trạng thái hiển thị MUST theo UI/UX mục 7: Đã lên lịch (Chờ đến giờ) · Đang đăng (Đang xử lý, Chờ thử
  lại, Không xác định) · Đã đăng · Cần bạn xử lý (Cần người dùng, Cần kiểm tra) · Đã hủy; trạng thái tổng của bài nhiều kênh =
  trạng thái "xấu nhất", chi tiết luôn có trạng thái riêng từng kênh. "Chờ thử lại" và "Không xác định" MUST NOT hiện riêng
  cho người dùng; đội hỗ trợ thấy đủ.
- **FR-028**: Màn hình MUST tự cập nhật khi trạng thái đổi (không tải lại trang), hoạt động từ 360 px, vùng chạm ≥ 44 × 44 px,
  đạt WCAG 2.1 AA; mọi thông báo lỗi MUST có ít nhất một hành động khắc phục; mã lỗi gốc chỉ hiện ở "Chi tiết cho hỗ trợ".
- **FR-029**: Thông báo MUST gồm: bài cần xử lý/cần kiểm tra → trong ứng dụng + email (gộp trong 10 phút) cho chủ và cộng tác
  viên soạn bài; thông điệp nêu tên bài và kênh, **không** nêu số tiền chi phí AI.
- **FR-030**: Lịch và danh sách bài (012) MUST hiển thị trạng thái đăng thật lấy từ module Đăng bài qua giao diện công khai
  (Đang đăng, Đã đăng, Cần bạn xử lý, Đã hủy); thay cho bản giả lập tạm thời.

**Phân quyền, cô lập và giám sát**

- **FR-031**: Quyền MUST được kiểm tra ở API: xem Tiến trình đăng (`status.view`: chủ, cộng tác viên); "Đăng lại", "Đã đăng"
  (`post.republish`: chủ, cộng tác viên); hỗ trợ tra cứu qua đường hỗ trợ có kiểm toán (`support.lookup`). Người dùng tài
  khoản này MUST NOT đọc/sửa lượt đăng hay bước đăng của tài khoản khác (mọi bảng có mã tài khoản + bảo mật mức dòng; kiểm
  thử truy cập chéo bắt buộc).
- **FR-032**: Hệ thống MUST phát chỉ số và cảnh báo vận hành: tỷ lệ lỗi đăng của một kênh > 5% trong 15 phút; việc đăng quá hạn
  > 5 phút; số lượt "Không xác định" và "Cần kiểm tra" (cảnh báo khi "Cần kiểm tra" > 1%); độ trễ so với giờ hẹn; việc đăng
  nằm trong danh sách việc chết > 0 → cảnh báo ngay. Mọi chỉ số/nhật ký gắn mã tài khoản.
- **FR-033**: Các lượt đăng chưa kết thúc của tài khoản MUST bị hủy và dừng gửi khi tài khoản yêu cầu xóa hoặc kênh bị ngắt kết
  nối; dữ liệu bước đăng giữ 12 tháng rồi xóa theo phân vùng, và bị xóa theo vòng đời dữ liệu của tài khoản (FR-14).

### Key Entities *(include if feature involves data)*

- **Lượt đăng (publish attempt)**: một lần đăng bài lên một kênh; thuộc tài khoản, tham chiếu bài, phiên bản kênh và kết nối
  kênh; có giờ đăng, trạng thái, số lần thử, dấu nội dung, mã bài + đường dẫn trên nền tảng, mã theo dõi, thời điểm gửi. Duy
  nhất một lượt hiệu lực mỗi cặp (bài, kênh).
- **Bước đăng (publish step)**: bản ghi chỉ thêm cho từng bước 1–5 của một lượt đăng: số bước, thời điểm, kết quả, mã lỗi
  gốc, loại lỗi, thông điệp tiếng Việt, cách khắc phục. Giữ 12 tháng.
- **Ánh xạ lỗi (error mapping)**: cấu hình dùng chung theo kênh: mã lỗi gốc → loại lỗi, thông điệp, cách khắc phục. Không
  thuộc tài khoản nào.
- **Bộ chuyển đổi kênh (platform adapter)**: thành phần cắm vào giao diện chung cho từng nền tảng (Facebook Page, Instagram;
  giả lập cho kiểm thử). Không lưu dữ liệu riêng của tài khoản ngoài kết nối kênh đã có (010).
- **Kết nối kênh (channel connection)** (có từ 010): nguồn mã quyền mã hóa, trạng thái, điều kiện tài khoản, tham chiếu bởi
  lượt đăng.
- **Việc đăng (publish job)**: việc trong hàng chờ bền vững gắn với một lượt đăng, mang mã tài khoản, có khóa chống trùng.
- **Hành động người dùng trên lượt đăng**: "Đăng lại", "Đã đăng", đổi giờ, hủy – ghi người thao tác, thời điểm, lý do.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **0 bài đăng trùng** trong mọi kịch bản kiểm thử rủi ro (hai Worker cùng lấy một lượt đăng, Worker chết giữa
  chừng, việc chạy lại hai lần, hết thời gian chờ sau khi đã gửi, bấm duyệt/đăng lại hai lần liên tiếp): số bài xuất hiện
  trên nền tảng thử ≤ 1 mỗi (bài, kênh) khi người dùng chưa chủ động chọn "Đăng lại".
- **SC-002**: ≥ **98%** bài đã duyệt đăng thành công (không tính lỗi do tài khoản khách hàng) khi đo theo tháng.
- **SC-003**: ≥ **95%** bài được đăng trong vòng **5 phút** kể từ giờ hẹn; không bài nào bị bỏ sót sau khi hệ thống được khởi
  động lại (0 việc mất).
- **SC-004**: Với lỗi cần người dùng xử lý, **≥ 95%** người dùng nhận thông báo (trong ứng dụng) trong ≤ **5 phút** kể từ lúc
  xảy ra lỗi và 100% thông báo lỗi kèm ít nhất một hành động khắc phục.
- **SC-005**: **100%** lượt đăng có đủ 5 bước được ghi (hoặc ghi rõ "không áp dụng"/"chưa chạy" vì bước trước lỗi) với thời
  điểm, kết quả, lời giải thích; hỗ trợ tra ra bước hỏng từ mã bài hoặc mã lượt đăng trong ≤ **2 phút**.
- **SC-006**: Người dùng không biết kỹ thuật tìm được **bước nào hỏng và bấm gì để sửa** trong ≤ **30 giây** từ lúc mở bài
  lỗi (kiểm thử với người dùng đại diện; ≥ 8/10 hoàn thành).
- **SC-007**: Tỷ lệ lượt đăng kết thúc ở "Cần kiểm tra" ≤ **1%** tổng lượt đăng của mỗi kênh trong tháng; vượt ngưỡng → cảnh
  báo xem lại thiết kế đối soát.
- **SC-008**: **100%** cặp (người dùng tài khoản A, lượt đăng/bước đăng của tài khoản B) bị từ chối trong kiểm thử truy cập
  chéo; **0** lần mã quyền truy cập nền tảng xuất hiện trong nhật ký mẫu, thông báo lỗi hay phản hồi giao diện (quét tự động).
- **SC-009**: Thêm bộ chuyển đổi nền tảng mới (bản giả lập thứ hai dùng để chứng minh) chỉ cần thêm bộ chuyển đổi + bảng ánh xạ
  lỗi, **không sửa** bộ thực thi, nhật ký, đối soát hay thông báo; mọi bộ chuyển đổi đạt cùng một bộ kiểm thử hợp đồng.
- **SC-010**: Một tài khoản đăng hàng loạt (vd 50 lượt đăng cùng giờ) **không** làm lệch lịch của tài khoản khác quá 5 phút.
- **SC-011**: Màn hình Tiến trình đăng tải ≤ **1 giây** khi chuyển màn hình; trạng thái đổi hiển thị trong ≤ **15 giây** mà
  không tải lại trang; dùng trọn vẹn từ **360 px**, đạt WCAG 2.1 AA.
- **SC-012**: Khi chức năng AI bị khóa (hết giới hạn), **100%** luồng đăng, thử lại, đối soát, đăng lại vẫn chạy bình thường.

## Assumptions

- **Ranh giới với 012**: 012 lo soạn, duyệt, lên lịch và Lịch; tính năng này lo **thực thi đăng**. Nếu 012 đã dựng tạm mục lịch
  đăng và bản giả lập ở module Đăng bài thì kế hoạch (`/speckit-plan`) quyết định cách thay bằng lượt đăng thật mà **không đổi
  hợp đồng giao diện công khai** (tạo, hủy, đổi giờ, đọc trạng thái); mọi thay đổi ranh giới đi ngược ADD cần ghi vào ADR.
- **Phạm vi nền tảng**: giai đoạn này chỉ có **Facebook Page** và **Instagram (tài khoản chuyên nghiệp)** theo yêu cầu; **Zalo
  OA** và **TikTok** (bộ chuyển đổi đã có kênh kết nối ở 010, mặc định tắt) thêm sau bằng bộ chuyển đổi riêng. Bài chọn kênh
  chưa có bộ chuyển đổi thật vẫn dùng bản giả lập, không chặn luồng.
- **Instagram hẹn giờ qua API (C4)**: chưa kiểm chứng; không ảnh hưởng vì dùng bộ hẹn giờ chung. Ngưỡng 2 phút đối soát và 10
  phút chờ thử lại là **giả định**, cấu hình được và điều chỉnh theo kết quả POC-2 (độ trễ hiển thị bài, khả năng đọc bài đã
  đăng của Facebook/Instagram, thời gian xử lý video).
- **Khả năng đối soát từng nền tảng** chỉ được xác nhận sau POC-2; cho đến lúc đó bộ chuyển đổi khai báo khả năng đối soát qua
  cấu hình, kênh nào chưa chắc → đi thẳng "Cần kiểm tra" theo hướng an toàn (ưu tiên không trùng hơn tự động hóa).
- **Ánh xạ lỗi ban đầu** dựa trên bảng ví dụ của ADD Đăng bài mục 7 và sẽ được hoàn thiện bằng POC-2; mã lỗi chưa biết luôn
  đi nhánh "không xác định".
- **Thư viện media (FR-03) có thể chưa sẵn sàng**: khi chưa có, bước 2 dùng media giả lập của 005; bài chỉ chữ không phụ
  thuộc. Đường dẫn công khai ≤ 24 giờ do module media cấp.
- **Hạn mức đăng của kênh** (Instagram số bài/24 giờ, Zalo theo gói) chỉ kiểm tra được khi nền tảng cho biết; khi không biết,
  vẫn thử đăng và xử lý lỗi hạn mức theo ánh xạ lỗi.
- **Không theo dõi sau đăng**: thống kê tương tác, phát hiện bài bị xóa trên nền tảng nằm ngoài phạm vi giai đoạn 1.
- **Màn hình tra cứu hỗ trợ** (FR-10) là tính năng riêng; tính năng này chỉ bảo đảm dữ liệu (5 bước, mã lỗi gốc, mã theo dõi,
  trạng thái hệ thống đầy đủ) và cho phép tra theo mã lượt đăng.
- **Hạ tầng sẵn có**: dùng hàng chờ, khung quyền, thông báo, khung giao diện từ 002–005, 011; không thêm dịch vụ, bộ nhớ đệm
  phân tán hay hệ thống tin nhắn mới (Hiến pháp IX). **Không cache**: trạng thái lượt đăng, quyền truy cập nền tảng.
- **Thời gian**: mọi thời điểm lưu UTC, hiển thị UTC+7; khóa chính UUID v7.
- **Ngôn ngữ**: giao diện tiếng Việt; định danh trong mã/CSDL/hàng chờ bằng tiếng Anh theo ánh xạ của dự án (`lượt đăng` →
  `publish_attempt`, `bước đăng` → `publish_step`, `ánh xạ lỗi` → `error_mapping`, hàng chờ `dang_bai` → `publish`); ánh xạ
  mới ghi vào kế hoạch/mô hình dữ liệu.
