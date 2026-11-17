# Feature Specification: Soạn bài tay theo kênh, duyệt (từng bài / nhiều bài, trả lại kèm ghi chú), lên lịch, màn hình Lịch và Chờ duyệt

**Feature Branch**: `012-manual-compose-approval-calendar`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Dựa vào tài liệu kiến trúc và mô tả phần mềm của chương trình, viết tài liệu mô tả tính năng 'Soạn bài tay theo kênh + duyệt (chọn từng bài / nhiều bài, trả lại kèm ghi chú) + lên lịch + màn hình Lịch, Chờ duyệt'"

**Truy vết**: FR-05 (phần **soạn tay**: người dùng soạn và sửa được nội dung mỗi kênh; phần AI tạo bài **không**
thuộc tính năng này) · FR-06 (duyệt và lên lịch, chỉ chủ tài khoản; kiểm tra hạn mức kênh lúc lên lịch; sửa nội dung
bài đã duyệt → quay về Chờ duyệt; đổi giờ không cần duyệt lại, chỉ khi chưa bắt đầu đăng) · FR-09 (đăng lại là việc
của tính năng đăng bài, chỉ tham chiếu) · FR-12 (bài đã dùng x/100) · Đặc tả yêu cầu mục 3.1 (mã quyền `post.edit`,
`post.approve`, `post.reschedule`, `status.view`) và mục 6 (hạn mức 100 bài/chu kỳ) · UI/UX mục 5 luồng F2 và F3, mục 6
(màn hình **Lịch tuần / tháng**, **Soạn / xem bài**, **Chờ duyệt**), mục 7 (hệ thống trạng thái bài), mục 8 (thông báo:
bài chờ duyệt mới, bài bị trả lại, cộng tác viên đổi giờ), mục 9 (phân quyền trên giao diện) · ADD Đăng bài mục 4
(vòng đời lượt đăng, quy tắc đổi giờ) · Kiến trúc dữ liệu mục 4.3 (cột `phien_ban`), mục 5 (`luot_dang`, chỉ mục duy
nhất có điều kiện), mục "Duyệt bài → tạo lượt đăng → tạo việc: một giao dịch" · ADR-03, ADR-04, ADR-09 · Hiến pháp
nguyên tắc I, II, IV, V, VI.

**Phụ thuộc**: `004-minimal-auth-rbac` (phiên, vai trò chủ / cộng tác viên, lớp chặn quyền, nhật ký kiểm toán) ·
`002-db-layer-tenant-rls`, `003-queue-layer-pgboss` (việc nền, tạo việc cùng giao dịch) · `005-gateway-contracts-fakes`
(giao diện chung nền tảng, thông báo, kho tệp, bản giả lập) · `010-connect-facebook-instagram` (kênh đã kết nối –
nguồn danh sách kênh chọn được khi soạn) · `011-ui-architecture-foundation` (bộ thành phần, khung điều hướng, nền
biểu mẫu, quản lý dữ liệu dùng chung phía giao diện). Phụ thuộc **mềm**: Thư viện media (FR-03) để đính ảnh/video;
module Đăng bài (FR-07) để đăng thật – xem Assumptions.

**Bối cảnh**: Luồng cốt lõi của sản phẩm là *soạn → duyệt → lên lịch → đăng*. Hiện tại mới có hạ tầng (kho mã, CSDL,
hàng chờ, xác thực, bản giả lập cổng) và hồ sơ kinh doanh; **chưa có khái niệm "bài viết"**. Tính năng này tạo bài
viết, phiên bản nội dung theo từng kênh, vòng đời Nháp → Chờ duyệt → Đã lên lịch, và hai màn hình mà chủ kinh doanh
dùng hằng ngày: **Chờ duyệt** (duyệt nhanh, nhất là trên điện thoại) và **Lịch** (nhìn toàn cảnh, kéo thả đổi
giờ). Vì không phụ thuộc AI, nó cũng là đường **soạn tay** mà người dùng vẫn dùng được khi hết giới hạn AI (Hiến
pháp VI, FR-11), và là chỗ AI tạo bài (FR-05) cắm vào sau này. **Không** thuộc phạm vi: AI tạo bài và tạo lại, lập
kế hoạch/đề xuất chủ đề (FR-04), thư viện media và gán nhãn (FR-03), việc **đăng thật** lên nền tảng, 5 bước đăng và
xử lý lỗi (FR-07…FR-09), màn hình Tiến trình đăng, màn hình Tổng quan, kết nối kênh (010).

## Clarifications

### Session 2026-11-15

- Q: Khi bài nhiều kênh có một kênh không lên lịch được (kênh hỏng, hết hạn mức), duyệt xử lý thế nào? → A: **Tất cả
  hoặc không** theo cả bài; người dùng bỏ kênh lỗi khỏi bài (hoặc kết nối lại / chọn giờ khác) rồi duyệt lại. Bài chỉ
  có một trạng thái duyệt, không có trạng thái duyệt riêng từng kênh.
- Q: Khi bài Chờ duyệt có giờ dự kiến đã qua lúc chủ mở duyệt thì làm gì? → A: Bài hiện nhãn "Giờ đã qua"; chủ **phải
  chọn giờ mới** (mặc định gợi ý giờ hợp lệ gần nhất) rồi mới duyệt được; khi duyệt nhiều bài có ô "Dời tất cả bài quá
  giờ về giờ gợi ý". Hệ thống không tự dời giờ âm thầm.
- Q: Bài soạn tay có bị trừ hạn mức 100 bài/chu kỳ không? → A: **Không.** Hạn mức 100 bài chỉ tính các bài có dùng
  tính năng liên quan đến AI (AI viết bài, dùng bài/chủ đề AI gợi ý…). Bài soạn hoàn toàn bằng tay không trừ hạn mức,
  nên tính năng này không trừ, không hoàn trả và không chặn theo hạn mức bài. Việc trừ hạn mức thuộc tính năng AI
  (FR-05/FR-04); bài có "nguồn tạo" là AI sẽ do tính năng đó trừ. Hệ quả: bài soạn tay vẫn lên lịch được khi tài
  khoản đã dùng hết 100 bài AI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Soạn bài tay với nội dung riêng cho từng kênh (Priority: P1)

Chị Lan (chủ tiệm hoa) bấm "Thêm bài", chọn các kênh muốn đăng (Facebook, Instagram…) trong số kênh đã kết nối. Màn
hình **Soạn / xem bài** hiện một tab cho mỗi kênh đã chọn. Chị gõ nội dung chung rồi chỉnh riêng từng kênh (Facebook
viết dài, Instagram thêm hashtag), thấy **bản xem trước gần giống nền tảng**, nhận cảnh báo ngay nếu nội dung vượt
giới hạn của kênh hoặc kênh đòi hỏi thứ còn thiếu (Instagram cần ảnh). Chị bấm "Lưu nháp" – bài được lưu, có thể mở
lại sửa tiếp bất cứ lúc nào, không mất chữ khi chuyển tab hay tải lại trang.

**Why this priority**: Không có bài viết thì không có gì để duyệt hay lên lịch. Soạn tay cũng là đường duy nhất còn
lại khi AI bị khóa (hết giới hạn), nên phải chạy độc lập với AI.

**Independent Test**: Với một tài khoản có 2 kênh giả lập đã kết nối, tạo bài chọn cả hai kênh, nhập nội dung riêng
từng kênh, lưu nháp, đóng và mở lại: nội dung từng kênh còn nguyên, trạng thái "Nháp"; tài khoản khác không thấy bài.

**Acceptance Scenarios**:

1. **Given** chủ tài khoản có ít nhất một kênh đang hoạt động, **When** bấm "Thêm bài" và chọn một hoặc nhiều
   kênh, **Then** hiện màn hình soạn có một tab mỗi kênh, mỗi tab có nội dung chữ, hashtag, vùng đính media (nếu có
   thư viện) và bản xem trước theo kênh.
2. **Given** người dùng gõ nội dung ở ô "nội dung chung", **When** sang tab một kênh chưa được chỉnh riêng, **Then**
   tab đó hiện nội dung chung làm điểm bắt đầu; sau khi người dùng sửa riêng tab thì thay đổi nội dung chung về sau
   **không** ghi đè phần đã sửa riêng.
3. **Given** nội dung vượt giới hạn ký tự/hashtag/media của một kênh, hoặc kênh yêu cầu media mà bài chưa có,
   **When** người dùng soạn, **Then** tab kênh đó hiện cảnh báo bằng chữ + biểu tượng nêu rõ vấn đề và cách sửa;
   người dùng vẫn lưu nháp được, nhưng **không** gửi duyệt / duyệt / lên lịch được cho đến khi sửa xong.
4. **Given** người dùng chưa có kênh nào đang hoạt động, **When** bấm "Thêm bài", **Then** thấy hướng dẫn "Kết nối
   kênh để bắt đầu" kèm đường dẫn tới màn hình Kênh kết nối; không tạo được bài.
5. **Given** AI của tài khoản đã bị khóa (hết giới hạn), **When** soạn bài, **Then** soạn tay hoạt động đầy đủ, không
   có thông báo lỗi nào chặn người dùng.
6. **Given** người dùng đang soạn dở và chưa lưu, **When** rời trang hoặc đóng tab trình duyệt, **Then** được hỏi
   xác nhận trước khi mất thay đổi.
7. **Given** một kênh bị ngắt kết nối hoặc hết hạn quyền sau khi bài đã soạn, **When** mở lại bài, **Then** tab kênh
   đó hiện nhãn "Kênh cần kết nối lại" kèm nút tới Kênh kết nối; nội dung đã soạn cho kênh vẫn giữ.

---

### User Story 2 - Chủ tài khoản duyệt bài và lên lịch trong một thao tác (Priority: P1)

Chị Lan soạn xong một bài, chọn ngày giờ đăng (mặc định gợi ý giờ hợp lý gần nhất, chị đổi được), bấm "Duyệt và lên
lịch". Bài chuyển sang **Đã lên lịch** và xuất hiện trên Lịch tại đúng giờ. Hệ thống kiểm tra điều kiện lên lịch
(kênh còn hoạt động, giờ ở tương lai, hạn mức của kênh như số bài Instagram trong 24 giờ hay gói Zalo OA) và nếu có gì
cản, nói rõ bằng lời thường kèm cách xử lý – bài **không** vào lịch.

**Why this priority**: Đây là lúc nội dung trở thành cam kết đăng lên Page của khách hàng; phải đúng quyền, đúng điều
kiện và an toàn (Hiến pháp II, VI). Không có bước này thì không có gì được đăng.

**Independent Test**: Chủ tài khoản duyệt một bài hai kênh với giờ hợp lệ → mỗi kênh có đúng một mục lịch đăng hiệu
lực, trạng thái "Đã lên lịch", bài hiện trên Lịch; duyệt hai lần liên tiếp (bấm đúp, hai tab) không tạo mục thứ hai;
cộng tác viên gọi thao tác duyệt trực tiếp qua API bị từ chối.

**Acceptance Scenarios**:

1. **Given** bài ở trạng thái Nháp (hoặc Chờ duyệt) hợp lệ với giờ đăng ở tương lai, **When** chủ tài khoản bấm
   "Duyệt và lên lịch", **Then** trong **một giao dịch duy nhất** bài chuyển "Đã duyệt → Đã lên lịch", mỗi kênh đã
   chọn có đúng một mục lịch đăng hiệu lực với giờ đã chọn, và việc đăng được đặt vào hàng chờ; hoàn tất hoặc không có
   gì thay đổi.
2. **Given** giờ đăng đã qua hoặc quá sát (dưới 5 phút kể từ bây giờ), **When** duyệt, **Then** bị từ chối với thông
   báo "Chọn giờ đăng ở tương lai" và đề xuất giờ gần nhất hợp lệ.
3. **Given** một kênh của bài đã hết hạn mức đăng ở khung giờ đó (ví dụ Instagram đủ số bài 24 giờ, gói Zalo OA hết
   lượt), **When** duyệt, **Then** **cả bài không được duyệt** (tất cả hoặc không), không có mục lịch đăng nào được
   tạo cho kênh nào; người dùng được báo rõ kênh nào, vì sao, kèm các hành động "Chọn giờ khác" và "Bỏ kênh này khỏi
   bài"; sau khi bỏ kênh (không tính là sửa sau duyệt vì bài chưa được duyệt) có thể duyệt lại các kênh còn lại.
4. **Given** một kênh của bài không còn hoạt động (ngắt kết nối, quyền hết hạn), **When** duyệt, **Then** cả bài
   không được duyệt, kèm nút "Kết nối lại" và "Bỏ kênh này khỏi bài"; không có mục lịch đăng nào được tạo.
5. **Given** người dùng bấm "Duyệt và lên lịch" hai lần liên tiếp hoặc ở hai tab/hai thiết bị cùng lúc, **When** cả
   hai yêu cầu đến máy chủ, **Then** chỉ một yêu cầu thành công; yêu cầu còn lại nhận thông báo "Bài này đã được
   duyệt" và không tạo thêm mục lịch đăng nào (mỗi cặp bài–kênh tối đa một mục hiệu lực).
6. **Given** cộng tác viên (không có quyền duyệt), **When** vào màn hình bài hoặc gọi trực tiếp thao tác duyệt, **Then**
   nút "Duyệt" không hiển thị trên giao diện **và** máy chủ từ chối thao tác này (kiểm tra quyền ở API).
7. **Given** bài đã duyệt và lên lịch, **When** xem màn hình soạn, **Then** thấy trạng thái "Đã lên lịch", giờ đăng,
   người duyệt và thời điểm duyệt.
8. **Given** chủ tài khoản đã bị khóa AI hoặc tài khoản đang hết hạn gói, **When** duyệt: khóa AI **không** cản
   duyệt/lên lịch; gói hết hạn thì thao tác bị chặn với thông báo tiếng Việt đời thường và cách gia hạn.

---

### User Story 3 - Màn hình Chờ duyệt: duyệt nhanh từng bài hoặc nhiều bài, trả lại kèm ghi chú (Priority: P1)

Cộng tác viên Minh soạn 5 bài rồi bấm "Gửi duyệt". Chị Lan nhận thông báo trong ứng dụng và một email "Có 5 bài chờ
duyệt". Chị mở **Chờ duyệt** trên điện thoại, xem từng bài (xem trước theo kênh, ai soạn, giờ đăng dự kiến), duyệt 3
bài ngay bằng cách chọn rồi bấm "Duyệt đã chọn", và **trả lại** 1 bài kèm ghi chú "Giá chưa đúng, sửa lại 250k nhé".
Minh nhận thông báo bài bị trả lại cùng ghi chú, sửa và gửi duyệt lại.

**Why this priority**: Đây là luồng F3 của UI/UX và là lý do chủ tài khoản "duyệt nhanh trên điện thoại". Nếu duyệt
chậm, mục tiêu "10 bài trong ≤ 60 phút" của kế hoạch tuần không đạt.

**Independent Test**: Cộng tác viên gửi duyệt 3 bài; chủ mở Chờ duyệt thấy đúng 3 bài (kèm người soạn, giờ dự kiến);
chọn 2 bài → "Duyệt đã chọn" → cả hai thành "Đã lên lịch"; trả lại bài thứ 3 kèm ghi chú → bài về "Nháp – Bị trả lại" và
cộng tác viên thấy ghi chú; chỉ có một email "bài chờ duyệt" cho lần gửi 3 bài.

**Acceptance Scenarios**:

1. **Given** có bài ở trạng thái Chờ duyệt, **When** chủ vào **Chờ duyệt**, **Then** thấy danh sách: tiêu đề/đoạn đầu
   nội dung, biểu tượng các kênh, người soạn, giờ đăng dự kiến, nhãn "Đã sửa sau khi duyệt" nếu có; sắp theo giờ đăng
   dự kiến gần nhất trước. Mở một bài xem được xem trước theo từng kênh trước khi quyết định.
2. **Given** chủ đang xem một bài chờ duyệt, **When** bấm "Duyệt", **Then** bài được duyệt và lên lịch theo cùng quy
   tắc User Story 2, rồi biến khỏi danh sách; màn hình tự chuyển sang bài kế tiếp để duyệt liên tục (trên điện thoại
   không phải quay lại danh sách).
3. **Given** chủ chọn nhiều bài bằng ô chọn (có nút "Chọn tất cả"), **When** bấm "Duyệt đã chọn", **Then** hệ thống
   xử lý **từng bài độc lập**: bài hợp lệ được duyệt và lên lịch; bài không hợp lệ (giờ đã qua, kênh hỏng, hết hạn mức
   kênh, bài vừa bị người khác sửa) **không** bị duyệt và được liệt kê cùng lý do; kết quả cuối cùng hiện rõ "Đã duyệt
   N bài, M bài chưa duyệt được" với cách xử lý cho từng bài chưa duyệt.
4. **Given** chủ bấm "Trả lại" cho một bài, **When** màn hình ghi chú hiện ra, **Then** ghi chú là **bắt buộc**
   (không rỗng, tối đa 500 ký tự); sau khi xác nhận, bài quay về "Nháp" mang nhãn "Bị trả lại" kèm ghi chú, người
   gửi duyệt nhận thông báo trong ứng dụng (không có email) có đường dẫn mở bài.
5. **Given** chủ chọn nhiều bài và bấm "Trả lại đã chọn", **When** nhập một ghi chú chung, **Then** mọi bài được chọn
   quay về Nháp với cùng ghi chú; từng bài vẫn có thể được trả lại riêng với ghi chú riêng.
6. **Given** cộng tác viên đã gửi duyệt nhiều bài trong một lần, **When** gửi, **Then** chủ nhận **một** thông báo
   trong ứng dụng và **một** email liệt kê các bài (không phải một email cho mỗi bài).
7. **Given** bài chờ duyệt có giờ đăng dự kiến đã qua (hoặc cách bây giờ dưới 5 phút), **When** chủ mở hoặc duyệt, **Then**
   bài hiện nhãn "Giờ đã qua" và nút Duyệt yêu cầu chọn giờ mới (đã điền sẵn giờ hợp lệ gần nhất để xác nhận một chạm);
   trong duyệt nhiều bài có ô "Dời tất cả bài quá giờ về giờ gợi ý" (mỗi bài nhận giờ gợi ý khác nhau, không dồn cùng một
   giờ); hệ thống không tự dời giờ khi chủ chưa xác nhận.
8. **Given** không có bài chờ duyệt, **When** chủ mở Chờ duyệt, **Then** thấy "Không có bài chờ duyệt" kèm đường dẫn
   tới Lịch hoặc "Thêm bài".
9. **Given** một bài vừa được người khác (chủ ở thiết bị khác, hoặc cộng tác viên sửa) thay đổi sau khi chủ mở danh
   sách, **When** chủ bấm duyệt trên phiên bản cũ, **Then** thao tác bị từ chối với "Bài vừa được cập nhật, vui lòng
   xem lại" và hiện nội dung mới; không bao giờ duyệt nhầm nội dung chủ chưa xem.
10. **Given** cộng tác viên, **When** truy cập màn hình Chờ duyệt, **Then** màn hình dành cho chủ không hiển thị mục
   điều hướng cho cộng tác viên, và truy cập trực tiếp bị từ chối; cộng tác viên chỉ thấy trạng thái các bài mình đã
   gửi trong danh sách bài.

---

### User Story 4 - Cộng tác viên gửi duyệt, nhận lại bài bị trả (Priority: P2)

Minh soạn bài, bấm **Gửi duyệt** (có thể chọn giờ đăng đề xuất). Bài sang "Chờ duyệt", Minh không duyệt được. Nếu bài
bị trả lại, Minh thấy nhãn "Bị trả lại" cùng ghi chú của chủ ở đầu màn hình soạn, sửa, rồi gửi duyệt lại; ghi chú cũ
vẫn xem được trong lịch sử của bài.

**Why this priority**: Làm trọn vòng cộng tác (F3) nhưng chủ tài khoản một mình vẫn dùng được sản phẩm nếu chưa có
cộng tác viên, nên đứng sau US1–US3.

**Independent Test**: Cộng tác viên gửi duyệt → bài hiện ở Chờ duyệt của chủ; chủ trả lại kèm ghi chú → cộng tác viên
thấy ghi chú, sửa và gửi lại → bài lại ở Chờ duyệt; lịch sử bài ghi đủ 3 sự kiện (gửi, trả lại, gửi lại) kèm người và
thời điểm.

**Acceptance Scenarios**:

1. **Given** bài Nháp hợp lệ do cộng tác viên soạn, **When** bấm "Gửi duyệt", **Then** bài chuyển Chờ duyệt, chủ
   được thông báo; cộng tác viên không sửa được nội dung khi bài đang chờ duyệt cho đến khi chủ trả lại (tránh đổi
   dưới tay người đang xem) — trừ khi bấm "Rút lại" để đưa bài về Nháp.
2. **Given** bài bị trả lại, **When** cộng tác viên mở bài, **Then** thấy ghi chú trả lại, người trả, thời điểm; có
   thể sửa và "Gửi duyệt" lại.
3. **Given** chủ tài khoản tự soạn bài, **When** hoàn tất, **Then** chủ **không** cần "Gửi duyệt": bấm thẳng "Duyệt và
   lên lịch" từ Nháp (luồng F2); chủ vẫn có thể lưu bài ở Nháp để duyệt sau.
4. **Given** mỗi bài, **When** xem "Lịch sử", **Then** thấy dòng thời gian: tạo, gửi duyệt, trả lại (kèm ghi chú),
   duyệt, đổi giờ, sửa sau khi duyệt – mỗi dòng có người thực hiện và thời điểm (UTC+7).

---

### User Story 5 - Màn hình Lịch tuần/tháng và kéo thả đổi giờ (Priority: P2)

Chị Lan mở **Lịch** để xem tuần này đăng gì. Mỗi bài là một thẻ trong ô ngày: tiêu đề ngắn, giờ, biểu tượng kênh,
trạng thái. Chị kéo bài từ thứ Ba sang thứ Năm để đổi ngày; bài giữ nguyên trạng thái đã duyệt (không phải duyệt lại).
Ở ngày còn trống chị bấm "Thêm bài" để soạn bài mới đã gắn sẵn ngày đó.

**Why this priority**: Giúp nhìn toàn cảnh và chỉnh nhanh, nhưng giá trị cốt lõi (soạn, duyệt, lên lịch) đã đạt ở US1–US3
khi giờ được chọn trong màn hình soạn.

**Independent Test**: Tạo 3 bài đã lên lịch ở các ngày khác nhau → Lịch tuần/tháng hiển thị đúng 3 thẻ đúng ô ngày,
đúng giờ UTC+7; kéo một thẻ sang ngày khác → giờ mới được lưu, thẻ nằm ô mới, bài vẫn "Đã lên lịch"; kéo về quá khứ
bị từ chối.

**Acceptance Scenarios**:

1. **Given** có bài trong khoảng thời gian đang xem, **When** chủ hoặc cộng tác viên mở Lịch, **Then** thấy chế độ tuần
   và tháng (đổi được), mỗi bài một thẻ có tiêu đề ngắn, giờ, biểu tượng kênh, nhãn trạng thái bằng chữ + biểu tượng;
   hôm nay được làm nổi; có nút "Hôm nay" và chuyển tuần/tháng trước–sau.
2. **Given** thẻ bài đã lên lịch, **When** người dùng (chủ hoặc cộng tác viên) kéo sang ngày/giờ khác **ở tương lai**,
   **Then** giờ đăng được đổi; **không** yêu cầu duyệt lại, bài giữ trạng thái "Đã lên lịch"; hệ thống kiểm tra lại
   hạn mức kênh ở giờ mới và nếu vượt hạn mức thì hoàn tác (thẻ trở về chỗ cũ) kèm giải thích.
3. **Given** bài đang đăng, đã đăng, hoặc có kênh đã bắt đầu xử lý, **When** thử kéo, **Then** không kéo được; thẻ
   hiện giải thích ngắn vì sao ("Bài đang được đăng, chưa thể đổi giờ").
4. **Given** người dùng kéo thẻ về giờ đã qua, **When** thả, **Then** bị từ chối, thẻ trở về chỗ cũ, hiện thông báo
   "Chọn giờ ở tương lai".
5. **Given** cộng tác viên đổi giờ một bài đã duyệt, **When** hoàn tất, **Then** chủ nhận thông báo trong ứng dụng "[Tên]
   đã đổi giờ đăng bài X từ … sang …" (không email); lịch sử bài ghi người đổi.
6. **Given** ngày không có bài, **When** người dùng bấm vào ngày đó, **Then** có nút "Thêm bài" mở màn hình soạn đã
   điền sẵn ngày; ngày đã qua không cho thêm bài mới lên lịch.
7. **Given** màn hình dưới 768 px, **When** mở Lịch, **Then** hiển thị dạng danh sách theo ngày (tuần) / chấm đánh dấu
   ngày có bài và danh sách bên dưới (tháng); đổi giờ trên điện thoại thực hiện bằng nút "Đổi giờ" trong chi tiết bài
   (kéo thả không là cách duy nhất).
8. **Given** nhiều bài cùng một ô, **When** ô không đủ chỗ, **Then** hiện "+N bài nữa" mở ra danh sách đầy đủ trong
   ngày; không bài nào bị ẩn mất.
9. **Given** hai người cùng đổi giờ một bài, **When** thao tác đến máy chủ, **Then** người đến sau nhận thông báo xung
   đột và thấy giờ mới nhất; không có giờ nào bị ghi đè âm thầm.

---

### User Story 6 - Sửa bài đã duyệt: tự quay về Chờ duyệt, hủy lịch (Priority: P2)

Bài "Khuyến mãi cuối tuần" đã lên lịch. Minh phát hiện sai giá và sửa nội dung Facebook. Ngay khi lưu, bài quay về
**Chờ duyệt** với nhãn "Đã sửa sau khi duyệt", lịch đăng cũ của bài bị hủy (không có gì được đăng với nội dung chưa
duyệt), chủ nhận thông báo "bài chờ duyệt". Nếu chủ tự sửa bài đã duyệt thì cũng quay về Chờ duyệt (không có ngoại lệ),
rồi duyệt lại trong một bước.

**Why this priority**: Đảm bảo Hiến pháp VI ("nội dung đã duyệt là nội dung được đăng") nhưng chỉ phát sinh sau khi
đã có bài được duyệt.

**Independent Test**: Bài hai kênh đã lên lịch; sửa chữ ở một kênh → bài ở Chờ duyệt có nhãn, mọi mục lịch đăng của
bài bị hủy, bài biến khỏi Lịch (hoặc hiện kiểu chờ duyệt) và không đăng; duyệt lại → có mục lịch đăng mới đúng một mỗi
kênh.

**Acceptance Scenarios**:

1. **Given** bài "Đã lên lịch" và mọi kênh còn chờ đến giờ, **When** ai đó **sửa nội dung** (chữ, hashtag, media của bất
   kỳ kênh nào, thêm/bớt kênh), **Then** trong cùng một thao tác lưu: bài về "Chờ duyệt" mang nhãn "Đã sửa sau khi
   duyệt", các mục lịch đăng chờ giờ bị hủy, việc trong hàng chờ không còn chạy; chủ nhận thông báo bài chờ duyệt.
2. **Given** chỉ **đổi giờ** (không sửa nội dung), **When** lưu, **Then** trạng thái duyệt giữ nguyên (xem US5).
3. **Given** bài đã bắt đầu đăng (có kênh đang đăng, đã đăng, hoặc cần xử lý), **When** người dùng cố sửa nội dung,
   **Then** không sửa được kênh đã đăng/đang đăng, với giải thích; kênh chưa bắt đầu đăng vẫn sửa được theo quy tắc
   mục 1. (Sửa lại bài **đã đăng** trên nền tảng không thuộc phạm vi.)
4. **Given** hai người cùng mở sửa một bài, **When** cả hai lưu, **Then** người lưu sau nhận thông báo xung đột phiên
   bản và thấy nội dung mới nhất, không ghi đè mất chữ người kia.
5. **Given** chủ muốn thôi đăng một bài đã lên lịch, **When** bấm "Hủy lịch" (chỉ chủ) và xác nhận, **Then** các mục
   lịch đăng chờ giờ bị hủy, bài về "Nháp", ghi vào lịch sử; việc này không xóa nội dung đã soạn.

---

### User Story 7 - Danh sách bài viết để tìm và mở lại bài (Priority: P3)

Người dùng cần một chỗ thấy mọi bài (nháp chưa có giờ không hiện trên Lịch): danh sách **Bài viết** lọc theo trạng
thái (Nháp, Chờ duyệt, Đã lên lịch, Đã hủy, Bị trả lại), tìm theo từ trong nội dung, mở bài để soạn/xem, xóa nháp.

**Why this priority**: Cần để tìm lại bản nháp và bài bị trả, nhưng chỉ ở mức tối thiểu; phiên bản đầy đủ (gồm trạng
thái đăng) thuộc tính năng sau.

**Independent Test**: Tạo bài ở 4 trạng thái → bộ lọc trả đúng tập bài; xóa một bài Nháp → biến khỏi danh sách; cộng
tác viên thấy bài của cả nhóm nhưng không có thao tác duyệt.

**Acceptance Scenarios**:

1. **Given** có nhiều bài, **When** mở Bài viết và chọn bộ lọc trạng thái hoặc gõ từ khóa, **Then** danh sách thu hẹp
   đúng; có phân trang/cuộn tải thêm; trạng thái hiện bằng chữ + biểu tượng.
2. **Given** bài ở trạng thái Nháp, **When** chủ hoặc người soạn xóa, **Then** bài bị xóa mềm (khôi phục được trong
   30 ngày theo quy ước dữ liệu) và không hiện nữa; bài đã lên lịch không xóa trực tiếp được mà phải "Hủy lịch" trước.
3. **Given** danh sách rỗng, **When** mở Bài viết, **Then** hiện "Chưa có bài nào" kèm nút "Thêm bài".

---

### Edge Cases

- **Bài chọn nhiều kênh, một kênh hỏng**: duyệt theo cả bài, tất cả hoặc không (User Story 2, kịch bản 3–4, FR-011);
  không bao giờ tạo mục lịch đăng một phần. Trong duyệt hàng loạt, bài như vậy nằm trong danh sách "chưa duyệt được".
- **Giờ đăng tại ranh giới**: giờ đúng 5 phút kể từ bây giờ chấp nhận được; giờ trong 5 phút tới bị từ chối; đổi giờ
  khi Worker vừa nhận việc bị từ chối (không đổi được nếu đã rời trạng thái chờ đến giờ).
- **Chuyển múi giờ**: mọi giờ lưu UTC, hiển thị UTC+7; bài ở sát nửa đêm hiện đúng ngày UTC+7 trên Lịch.
- **Bài không có nội dung** (chỉ khoảng trắng): không lưu nháp rỗng hoàn toàn; không gửi duyệt/duyệt được.
- **Nội dung rất dài / dán từ nguồn khác (ký tự đặc biệt, emoji, xuống dòng)**: lưu và xem trước đúng, báo vượt giới hạn
  kênh bằng chữ rõ ràng, không cắt âm thầm.
- **Kênh bị xóa/ngắt khi bài đã lên lịch**: mục lịch đăng của kênh đó chuyển thành cần người dùng xử lý (do tính năng
  đăng bài sở hữu), Lịch hiện cảnh báo "Cần bạn xử lý"; nội dung vẫn giữ.
- **Hết hạn gói giữa chừng**: bài đã lên lịch vẫn theo quy tắc gói hết hạn của quản trị gói (FR-13); bài mới không
  duyệt/lên lịch được.
- **Cộng tác viên bị gỡ khỏi tài khoản**: bài họ đã soạn vẫn còn, hiển thị người soạn là "Cộng tác viên đã gỡ".
- **Duyệt 50+ bài một lần**: thao tác vẫn hoàn tất trong thời gian chấp nhận được, kết quả từng bài rõ ràng, không
  tạo mục lịch đăng trùng nếu người dùng bấm lại khi mạng chậm.
- **Mất kết nối giữa chừng khi duyệt**: người dùng bấm lại hoặc tải lại thấy trạng thái đúng (đã duyệt hoặc chưa),
  không có trạng thái nửa chừng.
- **Truy cập chéo tài khoản**: đổi mã bài trong đường dẫn sang bài của tài khoản khác → không thấy, không sửa, không
  duyệt (Hiến pháp I).

## Requirements *(mandatory)*

### Functional Requirements

**Soạn bài và nội dung theo kênh (FR-05, phần soạn tay)**

- **FR-001**: Người dùng có quyền soạn bài (chủ, cộng tác viên) MUST tạo được bài với một hoặc nhiều kênh chọn từ các
  kênh **đang hoạt động** của tài khoản; mỗi kênh có phiên bản nội dung riêng (chữ, hashtag, media) mà người dùng sửa
  độc lập; có nội dung chung làm điểm bắt đầu (Kịch bản US1-2).
- **FR-002**: Hệ thống MUST kiểm tra nội dung từng kênh theo giới hạn của kênh (độ dài chữ, số hashtag, loại/số media
  bắt buộc hoặc cho phép, ví dụ Instagram cần media) và cho biết bằng chữ + biểu tượng, kèm cách sửa; vi phạm MUST
  chặn gửi duyệt / duyệt / lên lịch nhưng MUST NOT chặn lưu nháp. Bộ giới hạn theo kênh là **cấu hình**, đổi không cần
  phát hành.
- **FR-003**: Màn hình soạn MUST có bản xem trước theo từng kênh gần giống cách nền tảng hiển thị, và chặn rời trang khi
  còn thay đổi chưa lưu.
- **FR-004**: Hệ thống MUST lưu nháp mà không cần đủ điều kiện duyệt (chỉ cần có ít nhất một kênh hoặc chữ); bài ở
  Nháp mở lại sửa tiếp được bởi chủ hoặc cộng tác viên (theo FR-021).
- **FR-005**: Việc soạn tay MUST hoạt động đầy đủ khi chức năng AI bị khóa (hết giới hạn AI), khi nhà cung cấp AI lỗi,
  và MUST NOT gọi AI trong tính năng này.
- **FR-006**: Bài và phiên bản theo kênh MUST có số phiên bản dòng tăng mỗi lần sửa; mọi lưu/duyệt/trả lại/đổi giờ
  MUST là cập nhật có điều kiện theo phiên bản đang giữ, để hai người cùng sửa hoặc duyệt trên bản đã cũ nhận xung đột
  chứ không ghi đè (Hiến pháp: cột `phien_ban`).
- **FR-007**: Người dùng MUST gắn được media từ thư viện (khi tính năng thư viện sẵn sàng) và thấy cảnh báo khi media
  không hợp với giới hạn của kênh; trong khi chưa có thư viện, bài vẫn soạn được dạng chữ và việc kênh bắt buộc media
  được báo rõ là chưa thể lên lịch.

**Vòng đời trạng thái, gửi duyệt, duyệt, trả lại (FR-06)**

- **FR-008**: Bài MUST có vòng đời: **Nháp → Chờ duyệt → Đã duyệt (Đã lên lịch) → (về Chờ duyệt khi sửa nội dung | Đã
  hủy)**; "Bị trả lại" là nhãn của Nháp. Trạng thái hiển thị MUST theo UI/UX mục 7 (chữ + biểu tượng, không chỉ màu);
  trạng thái tổng hợp nhiều kênh theo quy tắc "xấu nhất" của UI/UX mục 7.
- **FR-009**: Cộng tác viên MUST gửi duyệt được bài Nháp hợp lệ (trạng thái → Chờ duyệt) và MUST NOT duyệt được; chủ
  tài khoản MUST duyệt được cả bài Nháp lẫn bài Chờ duyệt mà không cần "Gửi duyệt". Quyền MUST được kiểm tra ở API
  theo mã `post.edit` (soạn, gửi duyệt), `post.approve` (duyệt, trả lại, hủy lịch), `post.reschedule` (đổi giờ), không chỉ
  ẩn nút trên giao diện (Hiến pháp VI).
- **FR-010**: "Duyệt" MUST là **một giao dịch duy nhất** gồm: chuyển trạng thái duyệt có điều kiện, tạo **tối đa một**
  mục lịch đăng hiệu lực cho mỗi cặp (bài, kênh) – ràng buộc duy nhất trong CSDL – và tạo việc đăng vào hàng chờ; thất
  bại ở bất kỳ phần nào thì không có phần nào được ghi (ADR-03, Hiến pháp II). Duyệt lặp (bấm đúp, hai tab, mạng
  chậm) MUST không tạo thêm mục lịch đăng hay việc (idempotent).
- **FR-011**: Duyệt MUST kiểm tra tại thời điểm duyệt: kênh còn hoạt động; nội dung đạt giới hạn kênh; giờ đăng ở tương
  lai **tối thiểu 5 phút**; hạn mức đăng của kênh ở giờ đó (như Instagram số bài/24 giờ, Zalo OA theo gói) khi nền tảng
  cho biết; tài khoản đang trong thời hạn gói. Không đạt MUST từ chối **cả bài** (không duyệt từng phần theo kênh; bài
  chỉ có một trạng thái duyệt) với lý do bằng lời thường và ít nhất một cách khắc phục (Hiến pháp VI).
- **FR-012**: Duyệt MUST gắn với phiên bản bài mà người duyệt đã **thấy**; nếu bài đã đổi sau đó MUST từ chối và hiện
  nội dung mới, để không duyệt nhầm nội dung chưa xem (FR-006).
- **FR-013**: "Trả lại" MUST yêu cầu ghi chú không rỗng (tối đa 500 ký tự), đưa bài về Nháp với nhãn "Bị trả lại" kèm
  ghi chú, người trả và thời điểm; MUST thông báo trong ứng dụng cho người đã gửi duyệt (không email, theo UI/UX mục 8).
  Bài đang ở Đã lên lịch trả lại được (chủ) – khi đó các mục lịch đăng chờ giờ bị hủy như FR-018.
- **FR-014**: Duyệt nhiều bài và trả lại nhiều bài MUST xử lý **từng bài độc lập**; một bài lỗi không làm hỏng các bài
  khác; kết quả MUST liệt kê bài thành công và bài thất bại kèm lý do và cách khắc phục. Giới hạn số bài chọn mỗi lần
  là 100 (đủ hạn mức một chu kỳ).
- **FR-015**: Cộng tác viên "Rút lại" được bài mình gửi đang Chờ duyệt (về Nháp) khi chủ chưa xử lý; MUST NOT sửa nội
  dung bài đang Chờ duyệt cho đến khi bài được trả lại hoặc rút lại.
- **FR-016**: Mỗi bài MUST có **lịch sử** bất biến các sự kiện: tạo, gửi duyệt, duyệt, trả lại (kèm ghi chú), rút lại,
  hủy lịch, đổi giờ (giờ cũ → giờ mới), sửa sau khi duyệt – mỗi sự kiện có người thực hiện và thời điểm; giữ 12 tháng
  theo yêu cầu lưu nhật ký duyệt/đăng.

**Lên lịch, đổi giờ, sửa sau duyệt**

- **FR-017**: Người dùng MUST chọn được ngày giờ đăng khi soạn/duyệt; hệ thống gợi ý một giờ hợp lệ gần nhất làm mặc
  định; giờ hiển thị theo UTC+7 và lưu UTC. Một bài có **một** giờ đăng áp dụng cho mọi kênh của bài (xem Assumptions).
- **FR-018**: **Sửa nội dung** bài đã duyệt MUST đưa bài về Chờ duyệt với nhãn "Đã sửa sau khi duyệt", hủy các mục lịch
  đăng đang chờ đến giờ và việc tương ứng **trong cùng giao dịch** với lần lưu, và thông báo cho chủ; thay đổi nội dung
  gồm chữ, hashtag, media và thêm/bớt kênh (đặc tả FR-06; ADD Đăng bài mục 4).
- **FR-019**: **Đổi giờ** bài đã lên lịch (chủ hoặc cộng tác viên, quyền `post.reschedule`) MUST: không đổi trạng thái
  duyệt; chỉ cho phép khi **mọi** mục lịch đăng của bài còn ở trạng thái chờ đến giờ (cập nhật có điều kiện, nên không
  đổi được nếu việc đã được nhận); giờ mới ở tương lai tối thiểu 5 phút; kiểm tra lại hạn mức kênh ở giờ mới; cập nhật
  giờ đăng và thời điểm chạy của việc trong cùng giao dịch; ghi lịch sử; nếu người đổi là cộng tác viên, thông báo trong
  ứng dụng cho chủ.
- **FR-020**: "Hủy lịch" (chỉ chủ, `post.approve`) MUST hủy các mục lịch đăng chờ giờ và đưa bài về Nháp mà không xóa nội
  dung; MUST NOT áp dụng được cho bài đã bắt đầu đăng.
- **FR-021**: Quyền sửa bài: chủ sửa mọi bài; cộng tác viên sửa bài Nháp (kể cả bài mình hay chủ tạo, bài bị trả lại)
  và bài đã lên lịch (khi đó áp dụng FR-018: bài về Chờ duyệt), nhưng không sửa bài đang Chờ duyệt (FR-015). Bài đã bắt đầu đăng/đã đăng ở kênh nào thì kênh đó MUST NOT sửa được từ
  đây.
- **FR-022**: Tính năng này MUST giao việc đăng cho module Đăng bài qua **giao diện công khai** (tạo mục lịch đăng, hủy,
  đổi giờ, đọc trạng thái); MUST NOT đọc/ghi bảng của module khác; tham chiếu bài/phiên bản kênh phía Đăng bài là mã
  tham chiếu, không khóa ngoại (ADR-09, Hiến pháp IV). Trong lúc module Đăng bài chưa đăng thật, bản giả lập đứng sau
  cùng giao diện (xem Assumptions).

**Màn hình**

- **FR-023**: **Chờ duyệt** (chỉ chủ): danh sách bài chờ duyệt với người soạn, kênh, giờ đăng dự kiến, nhãn "Đã sửa sau
  khi duyệt"/"Bị trả lại"/"Giờ đã qua"; bài quá giờ buộc chọn giờ mới khi duyệt, có "Dời tất cả bài quá giờ về giờ
  gợi ý" khi duyệt nhiều bài (không tự dời khi chủ chưa xác nhận); xem trước theo kênh; Duyệt, Duyệt nhiều bài (ô chọn + "Chọn tất cả"), Trả lại kèm ghi chú
  (từng bài và nhiều bài); chuyển bài kế tiếp sau khi xử lý; trạng thái rỗng; số bài chờ duyệt hiển thị trên điều
  hướng. Dùng được trọn vẹn từ 360 px, vùng chạm ≥ 44 × 44 px.
- **FR-024**: **Lịch** (chủ, cộng tác viên): chế độ tuần và tháng; mỗi bài một thẻ (tiêu đề ngắn, giờ, biểu tượng kênh,
  trạng thái chữ + biểu tượng); kéo thả đổi giờ theo FR-019, có cách đổi giờ không cần kéo thả; ngày trống có "Thêm
  bài"; "+N bài nữa" khi ô đầy; trên điện thoại hiển thị dạng danh sách theo ngày.
- **FR-025**: **Soạn / xem bài** (chủ, cộng tác viên): tab theo kênh, xem trước, đặt giờ đăng, lịch sử bài, nhãn trạng
  thái, ghi chú trả lại ở đầu màn hình; nút theo quyền: cộng tác viên có "Gửi duyệt", chủ có "Duyệt và lên lịch".
- **FR-026**: **Bài viết** (danh sách tối thiểu): lọc theo trạng thái, tìm theo từ khóa, mở, xóa mềm bài Nháp.
- **FR-027**: Mọi lỗi MUST có thông báo tiếng Việt đời thường kèm ít nhất một hành động khắc phục; MUST NOT hiện mã lỗi
  gốc hay chi tiết kỹ thuật ngoài vùng thu gọn "Chi tiết cho hỗ trợ"; MUST đạt WCAG 2.1 AA và dùng được bằng bàn phím
  (kể cả đổi giờ không cần kéo thả).

**Thông báo**

- **FR-028**: Hệ thống MUST gửi: (a) "Bài chờ duyệt mới" cho chủ – trong ứng dụng + **một** email cho mỗi lần gửi duyệt
  nhiều bài; (b) "Bài bị trả lại" cho người gửi duyệt – trong ứng dụng, không email; (c) "Cộng tác viên đổi giờ bài đã
  duyệt" cho chủ – trong ứng dụng, không email; (d) "Bài đã sửa sau khi duyệt" gộp vào (a). Thông báo MUST được ghi vào
  hàng chờ trong cùng giao dịch với thay đổi trạng thái (Hiến pháp IV), và gửi lại không tạo bản sao.

**Cô lập tenant, bảo mật, vận hành**

- **FR-029**: Mã tài khoản MUST lấy từ phiên đăng nhập; mọi bảng mới của tính năng MUST có mã tài khoản và Row-Level
  Security; truy cập chéo tài khoản (đọc, sửa, duyệt, trả lại, đổi giờ, xem lịch) MUST thất bại và có kiểm thử tự động
  (Hiến pháp I).
- **FR-030**: Bộ xử lý việc nền do tính năng này tạo (thông báo gộp, hủy lịch) MUST chạy lại an toàn, mang mã tài khoản
  và đặt lại ngữ cảnh tenant trước khi xử lý (Hiến pháp V).
- **FR-031**: Mọi thao tác duyệt, trả lại, hủy lịch, đổi giờ, sửa sau duyệt MUST ghi nhật ký có cấu trúc gắn mã tài
  khoản và mã theo dõi; nhật ký duyệt/đăng giữ 12 tháng; nội dung bài MUST NOT xuất hiện đầy đủ trong nhật ký kỹ thuật
  (chỉ mã bài) (Hiến pháp VII, VIII).
- **FR-032**: Bài soạn hoàn toàn bằng tay MUST NOT bị trừ hạn mức 100 bài/chu kỳ và MUST NOT bị chặn khi hạn mức bài
  (do AI) đã hết (Clarifications 2026-11-15). Bài phải ghi nhận "nguồn tạo" (tay / có AI) để tính năng AI sau này trừ
  hạn mức đúng cho bài có dùng AI, bằng cập nhật có điều kiện trong cùng giao dịch với thao tác gây ra việc trừ; khi
  một bài tay được sửa thành có dùng AI thì việc trừ do tính năng AI xử lý. Hạn mức MUST NOT được cache.
- **FR-033**: Bài đã xóa mềm MUST không còn xuất hiện ở bất kỳ màn hình nào và bị xóa hẳn sau 30 ngày; khi tài khoản yêu
  cầu xóa (FR-14), dữ liệu bài MUST nằm trong phạm vi xóa.

### Key Entities *(include if feature involves data)*

- **Bài (Post)**: đơn vị nội dung của một tài khoản; có trạng thái duyệt (Nháp, Chờ duyệt, Đã duyệt/lên lịch, Đã hủy),
  nhãn phụ ("Bị trả lại", "Đã sửa sau khi duyệt"), giờ đăng, người tạo, người gửi duyệt, người duyệt, số phiên bản dòng,
  nguồn tạo (tay; sau này AI) để AI cắm vào sau mà không đổi mô hình.
- **Phiên bản kênh (Channel Version)**: nội dung của bài cho một kênh: chữ, hashtag, danh sách media tham chiếu, kết quả
  kiểm tra giới hạn kênh; thuộc một bài, gắn một kết nối kênh (tham chiếu); có số phiên bản dòng.
- **Sự kiện duyệt (Review Event)**: bản ghi bất biến về gửi duyệt / duyệt / trả lại (kèm ghi chú) / rút lại / hủy lịch /
  đổi giờ / sửa sau duyệt: ai, khi nào, giá trị trước–sau; là nguồn của "Lịch sử" bài và của nhật ký duyệt 12 tháng.
- **Mục lịch đăng (Publish Attempt – thuộc module Đăng bài)**: cam kết đăng một bài lên một kênh tại một giờ; tối đa một
  hiệu lực cho mỗi cặp (bài, kênh); tính năng này tạo/hủy/đổi giờ nó qua giao diện công khai của module Đăng bài, không sở
  hữu bảng.
- **Kênh (Channel Connection – thuộc 010)**: nguồn danh sách kênh chọn được và trạng thái hoạt động; chỉ đọc qua giao
  diện công khai.
- **Giới hạn kênh (Channel Rule)**: cấu hình theo loại kênh: độ dài tối đa, số hashtag, loại và số media; dùng cho kiểm
  tra khi soạn và khi duyệt; thay đổi không cần phát hành.
- **Thông báo (thuộc module Thông báo)**: bài chờ duyệt mới, bài bị trả lại, cộng tác viên đổi giờ.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Chủ tài khoản soạn một bài hai kênh bằng tay, chọn giờ và lên lịch xong trong **≤ 3 phút** (người dùng
  thử nghiệm lần đầu, không cần hướng dẫn trực tiếp ở ≥ 90% lượt thử).
- **SC-002**: Chủ tài khoản duyệt **10 bài** chờ duyệt trên điện thoại (gồm xem trước từng bài) trong **≤ 10 phút**; duyệt
  hàng loạt 10 bài đã xem xong mất **≤ 1 phút**.
- **SC-003**: **100%** thao tác duyệt lặp (bấm đúp, hai tab, thử lại sau mạng chậm) cho cùng một bài tạo **đúng một** mục
  lịch đăng hiệu lực mỗi kênh; **0** bài được lên lịch với nội dung chưa được chủ xem (kiểm thử đồng thời và kiểm thử
  xung đột phiên bản).
- **SC-004**: **100%** bài đã duyệt mà bị sửa nội dung quay về Chờ duyệt, và **0** bài được đăng với nội dung khác bản đã
  duyệt (kiểm thử cho mọi kiểu sửa: chữ, hashtag, media, thêm/bớt kênh).
- **SC-005**: Đổi giờ bằng kéo thả hoặc nút "Đổi giờ" hoàn tất và thẻ hiện ở vị trí mới trong **≤ 2 giây** sau khi thả
  (kết nối thường); **100%** lần đổi giờ cho bài đã bắt đầu đăng hoặc về quá khứ bị từ chối với giải thích.
- **SC-006**: Duyệt hàng loạt 50 bài hoàn tất và hiện kết quả từng bài trong **≤ 10 giây**; một bài lỗi không làm bài
  khác thất bại (**0** ảnh hưởng chéo).
- **SC-007**: Chủ nhận thông báo "bài chờ duyệt" trong ứng dụng trong **≤ 1 phút** sau khi cộng tác viên gửi; mỗi lần gửi
  nhiều bài tạo **đúng một** email.
- **SC-008**: Màn hình Lịch (tháng, 200 bài) và Chờ duyệt (100 bài) hiển thị nội dung đầu trong **≤ 2 giây**, chuyển
  màn hình **≤ 1 giây** trên 4G; dùng được trọn vẹn từ **360 px**, mọi vùng chạm ≥ 44 × 44 px.
- **SC-009**: Kiểm thử truy cập chéo tài khoản trên mọi bảng và thao tác mới (đọc, sửa, duyệt, trả lại, đổi giờ, xem lịch)
  cho kết quả **0** rò rỉ; kiểm thử quyền xác nhận cộng tác viên **không** duyệt/trả lại/hủy lịch được qua API.
- **SC-010**: **100%** thông báo lỗi trong tính năng có tiếng Việt đời thường và ≥ 1 hành động khắc phục; **0** màn hình
  chỉ dựa vào màu để báo trạng thái; kiểm tra tự động trình đọc màn hình/bàn phím đạt WCAG 2.1 AA cho luồng soạn, duyệt,
  lịch.
- **SC-011**: Khi chức năng AI bị khóa, **100%** luồng trong tính năng này (soạn, gửi duyệt, duyệt, lịch, đổi giờ) vẫn
  chạy bình thường.

## Assumptions

- **Hạn mức bài**: chỉ bài có dùng AI mới tính vào 100 bài/chu kỳ (đã chốt, Clarifications); tính năng này không đụng
  tới bộ đếm hạn mức bài. Cần ghi chú quyết định này vào đặc tả yêu cầu mục 6 khi hoàn thành (hiện mục 6 chỉ nói "1 bài
  = 1 chủ đề được AI tạo nội dung"); số "bài đã dùng x/100" hiển thị cho khách (FR-12) cũng chỉ đếm bài có AI.
- **Phạm vi AI**: bài tạo bằng AI (FR-05), "Tạo lại" và số lần tạo lại nằm ở tính năng sau; mô hình dữ liệu có trường
  "nguồn tạo" để AI cắm vào mà không đổi cấu trúc. Tính năng này không gọi Cổng AI.
- **Phạm vi đăng thật**: tính năng này tạo **mục lịch đăng** và việc trong hàng chờ nhưng việc **thực thi đăng**
  (5 bước, đối soát, thử lại, Đăng lại, màn hình Tiến trình đăng) thuộc tính năng Đăng bài. Cho đến khi có, mục lịch
  đăng chạy bằng bản giả lập của 005 sau cùng giao diện công khai của module Đăng bài; trạng thái "Đang đăng / Đã đăng /
  Cần bạn xử lý" chỉ hiển thị lại những gì module Đăng bài báo. Khi module Đăng bài chưa có bảng riêng thì mục lịch đăng
  do chính tính năng này dựng theo ADD Đăng bài mục 4 và Kiến trúc dữ liệu mục 5 (kế hoạch `/speckit-plan` quyết định
  ranh giới cụ thể, ghi vào ADR nếu đi ngược ADD).
- **Một giờ đăng cho mỗi bài**: một bài đăng cùng giờ lên mọi kênh đã chọn; giờ riêng từng kênh là cải tiến sau. Giờ
  gợi ý mặc định là khung "giờ vàng" mặc định cấu hình được (chưa dùng dữ liệu phân tích).
- **Tối thiểu 5 phút**: giờ đăng phải cách bây giờ ít nhất 5 phút, cho Worker và hạn mức kịp xử lý; giá trị là cấu hình.
- **Tiêu đề bài**: bài không có tiêu đề riêng; hệ thống lấy đoạn đầu nội dung (≤ 60 ký tự) làm tiêu đề thẻ; người dùng
  có thể đặt tên gợi nhớ nội bộ (tùy chọn, không đăng lên nền tảng).
- **Chủ tự soạn không cần "Gửi duyệt"**: chủ duyệt thẳng từ Nháp (F2). Cộng tác viên luôn đi qua Chờ duyệt.
- **Trả lại về Nháp**: bài bị trả lại không có trạng thái riêng mà là Nháp mang nhãn "Bị trả lại"; nhãn mất khi bài được
  gửi duyệt lại. Có thể hiển thị nhãn bằng chữ + biểu tượng trong UI/UX mục 7 nếu PO muốn trạng thái riêng.
- **Giới hạn số bài mỗi thao tác hàng loạt = 100**, giới hạn kênh mỗi bài = số kênh đang hoạt động của tài khoản (tối đa 4
  gồm TikTok nếu khách bật theo 010); TikTok mặc định tắt nên bài chỉ chọn được TikTok khi kênh đó đã bật và kết nối.
- **Cộng tác viên thấy cả nhóm**: cộng tác viên xem được mọi bài của tài khoản (như Lịch) vì tối đa 2 cộng tác viên cùng
  một chủ; không có quyền riêng tư giữa các thành viên trong cùng tài khoản.
- **Cập nhật gần thời gian thực** bằng làm mới định kỳ/khi quay lại tab (theo 011); số bài chờ duyệt trên điều hướng có
  thể trễ vài giây.
- **Không có hẹn giờ của nền tảng** ở giai đoạn 1: mọi kênh dùng bộ hẹn giờ chung của hệ thống (FR-07; đặc tả mục 9, C4).
- **Thư viện media (FR-03) chưa có** khi bắt đầu tính năng này: vùng đính media hiển thị sẵn nhưng hoạt động đầy đủ khi
  tính năng thư viện có mặt (FR-007); kiểm thử dùng media giả lập từ 005.
- **Hạ tầng sẵn có**: dùng khung giao diện, quyền, nhật ký kiểm toán, hàng chờ và bản giả lập cổng đã có từ 001–005, 011;
  không thêm dịch vụ, bộ nhớ đệm phân tán hay hệ thống tin nhắn mới (Hiến pháp IX).
- **Ngôn ngữ**: giao diện tiếng Việt; định danh trong mã, CSDL, hàng chờ bằng tiếng Anh theo bảng ánh xạ thuật ngữ của
  dự án (vd `bài` → `post`, `phiên bản kênh` → `channel_variant`, `lượt đăng` → `publish_attempt`); ghi ánh xạ mới vào
  kế hoạch/mô hình dữ liệu.
