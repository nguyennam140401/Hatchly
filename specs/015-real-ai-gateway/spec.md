# Feature Specification: Cổng AI thật (ước tính chi phí, giữ chỗ, ngưỡng 2 / 4 USD, sổ chi phí, nhà cung cấp dự phòng, đơn giá theo phút)

**Feature Branch**: `015-real-ai-gateway` (thư mục spec; nhánh làm việc `impl/015-real-ai-gateway` do hook worktree tạo khi `/speckit-plan 015`)

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Dựa trên tài liệu nghiệp vụ và tài liệu kiến trúc dự án, trong vai trò PM hãy viết tài liệu tính năng 'Cổng AI thật: ước tính chi phí, giữ chỗ, ngưỡng 2 / 4 USD, sổ chi phí, nhà cung cấp dự phòng, đơn giá theo phút' cho chương trình"

**Truy vết**: WBS T6 (WBS 3.1) · FR-11, FR-12 · NFR chi phí AI · ADR-06, ADR-07b · hiến pháp nguyên tắc III (và IV, V, VII, VIII) · phụ thuộc K5/tính năng 005 (hợp đồng + bản giả lập), P1/POC-1.

## Bối cảnh & giá trị

Tính năng 005 đã chốt **giao diện** Cổng AI và một **bản giả lập** (ngân sách trong bộ nhớ / bảng `sandbox`). Các module nghiệp vụ (Nội dung, Thư viện media, Xu hướng) hiện chạy trên bản giả đó. Tính năng này thay phần ruột giả bằng **Cổng AI thật**: ngân sách và sổ chi phí lưu bền trong CSDL, giá lấy từ bảng giá cấu hình, gọi được nhà cung cấp thật có dự phòng, tính tiền chuyển giọng nói theo phút.

Giá trị cho kinh doanh: đây là nơi **bảo vệ biên lợi nhuận** — mỗi tài khoản tốn mục tiêu ≤ 2 USD, trần cứng 4 USD mỗi chu kỳ, tổng chi **không bao giờ** vượt trần dù nhiều người bấm cùng lúc. Với khách hàng: khi AI hết hạn mức, họ vẫn soạn tay, duyệt, lên lịch, đăng được; họ chỉ thấy phần trăm sử dụng, không thấy tiền.

Người dùng của tính năng (vai trò):

- **Chủ tài khoản / cộng tác viên**: gián tiếp — dùng chức năng AI và xem % mức sử dụng.
- **Module nghiệp vụ gọi AI** (Nội dung, Media, Xu hướng): gọi qua giao diện công khai đã có; **không phải sửa** khi chuyển từ bản giả sang bản thật.
- **Hỗ trợ / quản trị nội bộ**: xem chi tiết chi phí, đổi bảng giá, theo dõi cảnh báo.

## Phạm vi

**Trong phạm vi**: ngân sách theo tài khoản + chu kỳ lưu bền; ước tính chi phí tối đa; giữ chỗ → gọi → quyết toán/trả lại; ngưỡng mềm 2 USD (chuyển mô hình rẻ) và cứng 4 USD (chặn); sổ chi phí từng lời gọi; bảng giá cấu hình có hiệu lực theo thời điểm, gồm đơn giá theo phút của chuyển giọng nói; nhà cung cấp chính + dự phòng; ngân sách hệ thống (xu hướng dùng chung); mốc cảnh báo 80% / 100%; cảnh báo vận hành nội bộ; xem chi tiết chi phí cho hỗ trợ; kết nối nhà cung cấp thật theo kết quả POC-1/POC-4.

**Ngoài phạm vi**: soạn lời nhắc nghiệp vụ (thuộc module gọi); lưu nội dung bài; mô hình gói/chu kỳ thanh toán của module Tài khoản (xem Giả định); màn hình quản trị chi tiết (WBS 4.7) ngoài các thao tác tối thiểu nêu trong FR; thu thập xu hướng (module Xu hướng); tự động thay đổi giá bán gói.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mọi lời gọi AI bị chặn trước khi vượt trần 4 USD (Priority: P1)

Là chủ doanh nghiệp, khi tôi và hai cộng tác viên cùng bấm "Tạo bài" sát lúc tài khoản gần hết hạn mức AI, hệ thống chỉ cho chạy những lời gọi mà tổng chi tối đa vẫn nằm trong trần 4 USD; những lời gọi còn lại bị từ chối lịch sự **trước khi** tốn tiền nhà cung cấp, và tôi vẫn soạn tay được.

**Why this priority**: Đây là cam kết "không bao giờ vượt trần" của hiến pháp III và quyết định trực tiếp biên lợi nhuận. Không có nó thì không thể bật AI thật cho khách.

**Independent Test**: Đặt ngân sách một tài khoản sát trần, bắn song song nhiều lời gọi với ước tính ngẫu nhiên; kiểm tra tổng (đã dùng + đã giữ) không bao giờ vượt trần ở mọi thời điểm quan sát và nhà cung cấp không nhận lời gọi nào bị từ chối.

**Acceptance Scenarios**:

1. **Given** tài khoản có đã dùng + đã giữ + ước tính của lời gọi ≤ trần, **When** module gọi AI, **Then** hệ thống giữ chỗ theo chi phí tối đa ước tính, gọi nhà cung cấp, rồi quyết toán chi phí thực và trả phần giữ chỗ dư.
2. **Given** đã dùng + đã giữ + ước tính > trần, **When** có lời gọi, **Then** lời gọi bị từ chối với thông báo "Đã sử dụng hết giới hạn AI của chu kỳ", nhà cung cấp không bị gọi, và không có phần giữ chỗ nào còn treo.
3. **Given** 3 người cùng gọi đồng thời sát trần, **When** các lời gọi chạy song song, **Then** tổng (đã dùng + đã giữ) không bao giờ vượt trần ở bất kỳ thời điểm nào, và khi mọi lời gọi xong thì phần đã giữ về 0.
4. **Given** nhà cung cấp trả lỗi hoặc hết thời gian, **When** hệ thống xử lý, **Then** phần giữ chỗ của lời gọi lỗi được trả lại đầy đủ trước khi thử đường dự phòng.
5. **Given** tài khoản đã bị chặn AI, **When** người dùng soạn tay, sửa, duyệt, lên lịch, đăng, tải media, gắn nhãn tay, **Then** các thao tác đó vẫn dùng được bình thường.

---

### User Story 2 - Ngưỡng mềm 2 USD tự chuyển mô hình rẻ, không gián đoạn (Priority: P1)

Là chủ doanh nghiệp, khi mức dùng AI của tôi chạm 2 USD, chất lượng sinh nội dung chuyển sang mô hình rẻ hơn mà tôi không bị gián đoạn hay phải làm gì; tôi chỉ biết qua % sử dụng.

**Why this priority**: Giữ chi phí trung bình ≤ 2 USD/tài khoản mà không làm khách bực — là cơ chế kinh tế thứ hai của sản phẩm.

**Independent Test**: Đặt ngân sách ở 1,99 / 2,00 / 2,01 USD, gọi cùng một loại việc, kiểm tra bậc mô hình được chọn; kiểm tra gán nhãn và xu hướng luôn dùng bậc rẻ.

**Acceptance Scenarios**:

1. **Given** đã dùng + đã giữ < 2 USD, **When** gọi tạo bài / đề xuất chủ đề, **Then** dùng bậc mô hình mặc định.
2. **Given** đã dùng + đã giữ ≥ 2 USD, **When** gọi tạo bài / đề xuất chủ đề, **Then** dùng bậc mô hình rẻ và người dùng không thấy lỗi hay yêu cầu hành động.
3. **Given** một lời gọi đẩy tổng đi qua 2 USD, **When** nó hoàn tất, **Then** lời gọi đó vẫn chạy bậc mặc định (chấp nhận vượt ngưỡng mềm tối đa 1 lời gọi) và từ lời gọi sau mới chuyển sang bậc rẻ.
4. **Given** loại việc gán nhãn ảnh/video hoặc tóm tắt xu hướng, **When** gọi ở bất kỳ mức dùng nào, **Then** luôn dùng bậc rẻ tương ứng (rẻ có thị giác cho gán nhãn).

---

### User Story 3 - Sổ chi phí và bảng giá cấu hình, đổi giá không cần phát hành (Priority: P1)

Là đội vận hành, tôi cần mỗi lời gọi AI được ghi sổ đầy đủ (tài khoản, chức năng, mô hình, nhà cung cấp, token, chi phí) và bảng giá mô hình là dữ liệu cấu hình có hiệu lực theo thời điểm, để đổi giá khi nhà cung cấp đổi giá mà không phát hành lại, và để đối soát hóa đơn.

**Why this priority**: Không có sổ thì không đo được chi phí/tài khoản, không đối soát được hóa đơn, không chứng minh được trần.

**Independent Test**: Chạy một chuỗi lời gọi hỗn hợp; kiểm tra mỗi lời gọi (kể cả bị từ chối/lỗi theo quy định) để lại đúng dòng sổ; đổi bảng giá giữa chừng và kiểm tra lời gọi sau thời điểm hiệu lực dùng giá mới, quá khứ không bị tính lại.

**Acceptance Scenarios**:

1. **Given** một lời gọi thành công, **When** quyết toán xong, **Then** có đúng một dòng sổ chỉ thêm (không sửa/xóa) với tài khoản, chu kỳ, loại việc, mô hình, nhà cung cấp, token vào/ra/bộ đệm, chi phí thực (micro-USD), mã theo dõi, thời điểm.
2. **Given** quản trị viên thêm một dòng giá có hiệu lực từ thời điểm T, **When** có lời gọi sau T, **Then** ước tính và chi phí dùng giá mới; lời gọi trước T giữ nguyên chi phí đã ghi.
3. **Given** chi phí thực lớn hơn ước tính tối đa (bất thường), **When** quyết toán, **Then** mức đã dùng bị kẹp ở trần, sổ ghi chi phí thật kèm cờ bất thường và số tiền vượt, và có cảnh báo vận hành.
4. **Given** sổ chi phí, **When** hỗ trợ hoặc quản trị cần số liệu, **Then** có thể tổng hợp chi phí theo tài khoản, theo loại việc, theo mô hình, và chi phí trung bình mỗi bài.

---

### User Story 4 - Nhà cung cấp dự phòng khi nhà cung cấp chính lỗi (Priority: P2)

Là chủ doanh nghiệp, khi nhà cung cấp AI chính tạm gián đoạn, tôi vẫn tạo được bài nhờ đường dự phòng; nếu cả hai đều lỗi tôi nhận thông báo dễ hiểu kèm cách xử lý (soạn tay hoặc thử lại sau).

**Why this priority**: Tăng tỷ lệ thành công của chức năng AI nhưng hệ thống vẫn đúng khi không có nó (khách soạn tay được), nên sau ba câu chuyện bảo vệ chi phí.

**Independent Test**: Cho nhà cung cấp chính lỗi/hết thời gian; kiểm tra lời gọi được thử đúng một lần ở nhà cung cấp dự phòng với giữ chỗ mới; cho cả hai lỗi và kiểm tra thông báo + ngân sách không bị trừ.

**Acceptance Scenarios**:

1. **Given** nhà cung cấp chính lỗi hoặc quá thời gian chờ, **When** hệ thống xử lý, **Then** trả giữ chỗ, giữ chỗ lại theo giá của nhà cung cấp dự phòng, gọi dự phòng đúng một lần, và quyết toán theo nhà cung cấp thực sự trả kết quả (sổ ghi đúng nhà cung cấp).
2. **Given** cả chính lẫn dự phòng đều lỗi, **When** hết lượt, **Then** người dùng nhận thông báo tiếng Việt kèm hành động khắc phục, ngân sách không bị trừ, và việc nền gọi AI không tự thử lại vô hạn.
3. **Given** dự phòng đắt hơn chính và ngân sách không đủ cho ước tính dự phòng, **When** hệ thống giữ chỗ lại, **Then** lời gọi bị từ chối như hết ngân sách, không gọi dự phòng.
4. **Given** tỷ lệ lỗi nhà cung cấp > 5% trong 15 phút, **When** cảnh báo vận hành chạy, **Then** đội vận hành nhận cảnh báo.

---

### User Story 5 - Chuyển giọng nói tính theo phút (Priority: P2)

Là chủ doanh nghiệp tải video có lời nói, tôi muốn hệ thống hiểu được lời nói (tối đa 5 phút đầu) để gán nhãn chính xác hơn, và chi phí phần này được tính đúng theo thời lượng âm thanh chứ không theo token.

**Why this priority**: Phục vụ gán nhãn video (POC-4) và là một đơn vị tính tiền khác (phút), cần thiết nhưng chỉ ảnh hưởng nhóm video có giọng nói.

**Independent Test**: Gọi chuyển giọng nói với tệp 90 giây, 5 phút, 12 phút; kiểm tra ước tính = min(thời lượng, 5 phút) × đơn giá/phút, chi phí thực khớp, và video không có giọng nói không phát sinh lời gọi.

**Acceptance Scenarios**:

1. **Given** âm thanh dài 12 phút, **When** gọi chuyển giọng nói, **Then** ước tính và giữ chỗ theo 5 phút, chỉ xử lý 5 phút đầu.
2. **Given** âm thanh dài 90 giây, **When** quyết toán, **Then** chi phí thực = thời lượng thực × đơn giá theo phút hiệu lực.
3. **Given** ngân sách tài khoản không đủ cho ước tính, **When** gọi chuyển giọng nói, **Then** bị chặn giống mọi lời gọi AI khác và việc gán nhãn quay về chế độ gắn nhãn tay.
4. **Given** cùng một tệp (cùng dấu tệp) đã được xử lý, **When** có yêu cầu gán nhãn lại, **Then** không phát sinh lời gọi AI hay chuyển giọng nói lần nữa.

---

### User Story 6 - Khách thấy % sử dụng và cảnh báo 80% / 100%, không thấy tiền (Priority: P2)

Là chủ doanh nghiệp, tôi thấy mức sử dụng AI dạng phần trăm kèm ngày bắt đầu chu kỳ mới, nhận cảnh báo khi đạt 80% và khi hết 100%, và không bao giờ thấy số tiền USD ở màn hình hay email.

**Why this priority**: Yêu cầu FR-12 và hiến pháp III; giảm khiếu nại "mua 100 bài nhưng không dùng hết".

**Independent Test**: Đưa ngân sách qua 80% rồi 100%, kiểm tra mỗi mốc phát đúng một thông báo (trong ứng dụng + email) mỗi chu kỳ; quét mọi kết quả dành cho khách để xác nhận không có số tiền.

**Acceptance Scenarios**:

1. **Given** (đã dùng + đã giữ) ÷ 4 USD đạt 80%, **When** quyết toán xong, **Then** phát đúng một thông báo cảnh báo trong chu kỳ, trong cùng giao dịch với việc quyết toán.
2. **Given** đạt 100%, **When** quyết toán xong, **Then** phát đúng một thông báo "đã hết giới hạn AI của chu kỳ", chức năng AI hiển thị trạng thái khóa, chức năng thủ công vẫn dùng được.
3. **Given** chu kỳ mới bắt đầu, **When** chủ tài khoản mở lại, **Then** mức sử dụng về 0%, chức năng AI mở lại, các mốc cảnh báo có thể phát lại.
4. **Given** bất kỳ phản hồi/email/thông báo gửi cho khách, **When** kiểm tra nội dung, **Then** không chứa số tiền, đơn giá hay chi phí; chỉ có phần trăm làm tròn xuống.

---

### User Story 7 - Ngân sách hệ thống cho xu hướng theo ngành (Priority: P3)

Là đội vận hành, tôi cần việc tóm tắt xu hướng theo ngành (dùng chung, không thuộc tài khoản nào) có ngân sách riêng và chi phí được chia đều cho các tài khoản cùng ngành, để không làm lệch ngân sách từng khách.

**Why this priority**: Cần cho module Xu hướng nhưng chưa nằm trên đường găng của ra mắt; giá trị nhỏ hơn.

**Independent Test**: Chạy việc hệ thống khi hết trần tuần; chạy từ ngữ cảnh tài khoản; kiểm tra phân bổ chi phí.

**Acceptance Scenarios**:

1. **Given** ngữ cảnh hệ thống (không có tài khoản), **When** tóm tắt xu hướng, **Then** dùng ngân sách hệ thống theo tuần, không đổi % sử dụng của bất kỳ khách nào.
2. **Given** ngữ cảnh tài khoản, **When** gọi thao tác hệ thống, **Then** bị từ chối.
3. **Given** hết trần tuần của hệ thống, **When** có lời gọi, **Then** bị chặn, có cảnh báo vận hành, các tài khoản không bị ảnh hưởng.
4. **Given** một lần thu thập hằng tuần xong, **When** phân bổ, **Then** chi phí được chia đều cho các tài khoản cùng ngành và hiện trong số liệu nội bộ theo tài khoản.

---

### User Story 8 - Cảnh báo vận hành và đối soát hóa đơn nhà cung cấp (Priority: P3)

Là đội vận hành, tôi nhận cảnh báo khi > 5% tài khoản chạm ngưỡng 2 USD, khi sổ chi phí lệch hóa đơn nhà cung cấp > 5%, và khi lỗi nhà cung cấp tăng, để chỉnh giá gói/mô hình trước khi thua lỗ.

**Why this priority**: Giám sát và phản ứng; không chặn khách dùng nhưng cần trước ngày ra mắt.

**Independent Test**: Mô phỏng 6% tài khoản chạm 2 USD, một hóa đơn lệch 6%; kiểm tra cảnh báo bắn đúng một lần mỗi điều kiện.

**Acceptance Scenarios**:

1. **Given** > 5% tài khoản đang hoạt động chạm ngưỡng 2 USD trong chu kỳ, **When** kiểm tra định kỳ, **Then** có cảnh báo nội bộ.
2. **Given** tổng sổ chi phí một nhà cung cấp trong ngày chênh hóa đơn thật > 5%, **When** đối soát, **Then** có cảnh báo nội bộ nêu nhà cung cấp và mức lệch.
3. **Given** hỗ trợ cần xem chi phí chi tiết (bằng USD) của một tài khoản, **When** mở bằng vai trò hỗ trợ, **Then** xem được qua khung nhìn hạn chế và mỗi lần xem được ghi nhật ký kiểm toán.

---

### Edge Cases

- **Giữ chỗ treo** (Worker/API chết giữa chừng): quá 15 phút — chưa gọi → trả lại; đã gọi mà chưa quyết toán → quyết toán theo ước tính (kẹp trần), sổ đánh dấu bất thường, có cảnh báo; chạy dọn lần hai không đổi gì.
- **Quyết toán lỗi** (giao dịch ghi sổ thất bại): thử lại một lần; vẫn lỗi thì giữ chỗ để bộ dọn xử lý, không mất tiền và không đếm trùng.
- **Hủy giữa chừng** (người dùng đóng trang khi đang trả dần): quyết toán phần đã sinh, trả phần còn lại.
- **Đổi giá giữa chu kỳ**: chỉ áp cho lời gọi sau thời điểm hiệu lực, không tính lại quá khứ, không đổi `đã dùng` đã ghi.
- **Chu kỳ vào ngày 29–31 / tháng ngắn**: chu kỳ lặp hằng tháng theo ngày kích hoạt; tháng không có ngày đó → ngày cuối tháng; tài khoản chưa có dòng ngân sách của chu kỳ mới thì được tạo nguyên tử, hai yêu cầu đầu chu kỳ đồng thời không tạo hai dòng.
- **Tài khoản không có chu kỳ hiệu lực** (hết hạn/chưa kích hoạt): lời gọi AI bị từ chối như hết hạn mức, không tạo ngân sách mới ngoài quy tắc.
- **Ước tính thấp hơn thực tế** vì mô hình trả nhiều hơn giới hạn đầu ra: giới hạn đầu ra được ép ở nhà cung cấp; nếu vẫn lệch thì áp quy tắc kẹp trần + cờ bất thường.
- **Nhà cung cấp trả không đủ thông tin token** (thiếu số token thực): quyết toán theo ước tính, sổ đánh dấu, cảnh báo.
- **Bảng giá thiếu mô hình/hết hiệu lực**: từ chối lời gọi trước khi gọi (không đoán giá), cảnh báo vận hành, người dùng vẫn làm tay được.
- **Mô hình rẻ cũng không đủ ngân sách còn lại**: từ chối như hết hạn mức; không gọi.
- **Lời gọi trùng** (module nền chạy lại bộ xử lý): không trừ hai lần cho cùng một yêu cầu logic; chạy lại hai lần cho cùng kết quả.
- **Nội dung lời nhắc/kết quả** không được ghi vào nhật ký kỹ thuật; sổ chỉ có số liệu.
- **Chuyển giọng nói với tệp không có giọng nói / không đọc được**: không phát sinh chi phí cho phần không chạy; báo module gọi để quay về gắn nhãn tay.

## Requirements *(mandatory)*

### Functional Requirements

**Ngân sách & giữ chỗ (hiến pháp III, ADR-06, FR-11)**

- **FR-001**: Hệ thống MUST đi mọi lời gọi AI và chuyển giọng nói của mọi module qua Cổng AI; module khác MUST NOT gọi trực tiếp nhà cung cấp.
- **FR-002**: Hệ thống MUST lưu bền ngân sách AI mỗi tài khoản mỗi chu kỳ: ngày bắt đầu/kết thúc chu kỳ, số đã dùng, số đã giữ, trạng thái (bình thường / mô hình rẻ / đã chặn), cờ đã phát mốc 80% và 100%.
- **FR-003**: Hệ thống MUST ước tính **chi phí tối đa** trước mỗi lời gọi (token đầu vào × giá + giới hạn đầu ra × giá, có tính giá đọc bộ đệm khi áp dụng; chuyển giọng nói theo mục FR-021) theo giá của mô hình dự kiến.
- **FR-004**: Hệ thống MUST giữ chỗ bằng **một thao tác có điều kiện nguyên tử** — chỉ thành công khi đã dùng + đã giữ + ước tính ≤ trần 4 USD — sao cho các lời gọi đồng thời không thể cùng vượt trần.
- **FR-005**: Khi không đủ ngân sách, hệ thống MUST từ chối **trước** khi gọi nhà cung cấp, trả lỗi nghiệp vụ có thông điệp tiếng Việt "Đã sử dụng hết giới hạn AI của chu kỳ" kèm hành động khắc phục (soạn tay; chu kỳ mới tự mở lại).
- **FR-006**: Sau lời gọi, hệ thống MUST quyết toán chi phí thực (cộng vào đã dùng, trừ phần đã giữ) trong **một giao dịch** cùng với ghi sổ và phát sự kiện cảnh báo mốc; lỗi/hết thời gian MUST trả lại toàn bộ giữ chỗ.
- **FR-007**: Mức đã dùng MUST bị kẹp ở trần khi quyết toán; mọi trường hợp chi phí thực vượt ước tính MUST ghi cờ bất thường, số vượt và phát cảnh báo vận hành.
- **FR-008**: Hệ thống MUST đánh dấu trạng thái giữ chỗ (đã giữ → đang gọi → đã quyết toán | đã trả) ngay trước mỗi lần gọi nhà cung cấp, và MUST có việc nền dọn các giữ chỗ treo > 15 phút theo quy tắc ở mục Edge Cases, chạy lại an toàn.
- **FR-009**: Kiểm tra + giữ chỗ ngân sách MUST hoàn thành p95 ≤ 50 ms; trạng thái ngân sách MUST NOT được cache.
- **FR-010**: Mã tài khoản MUST lấy từ ngữ cảnh tenant của lời gọi, không nhận từ tham số; dữ liệu ngân sách và sổ của tài khoản này MUST NOT đọc/ghi được từ tài khoản khác.

**Ngưỡng & chọn mô hình**

- **FR-011**: Hệ thống MUST chọn bậc mô hình theo loại việc và mức dùng: dưới 2 USD → mặc định; từ 2 USD → rẻ cho tạo bài và đề xuất chủ đề; gán nhãn ảnh/video luôn bậc rẻ có thị giác; tóm tắt xu hướng luôn bậc rẻ; chuyển giọng nói dùng dịch vụ chuyển giọng nói.
- **FR-012**: Lời gọi đẩy tổng qua 2 USD MUST vẫn chạy bậc mặc định (vượt ngưỡng mềm tối đa 1 lời gọi); từ lời gọi sau MUST chuyển bậc rẻ mà người dùng không bị gián đoạn.
- **FR-013**: Từ 4 USD, hệ thống MUST chặn mọi chức năng AI (tạo bài, tạo lại, lập kế hoạch, gán nhãn tự động, chuyển giọng nói) đến hết chu kỳ, kể cả khi chưa dùng hết 100 bài; MUST NOT chặn soạn/sửa tay, duyệt, lên lịch, đăng, tải media, gắn nhãn tay.
- **FR-014**: Khi sang chu kỳ mới, ngân sách MUST tự mở lại (đã dùng/đã giữ về 0, cờ mốc đặt lại) mà không cần can thiệp; việc tạo dòng ngân sách của chu kỳ mới MUST an toàn khi nhiều yêu cầu đầu chu kỳ đồng thời.

**Sổ chi phí**

- **FR-015**: Mỗi lời gọi (thành công, quyết toán theo ước tính, hoặc bị hủy giữa chừng) MUST để lại đúng một dòng sổ chỉ-thêm với: tài khoản (hoặc phạm vi hệ thống), chu kỳ, loại việc, mô hình, nhà cung cấp, token vào/ra/bộ đệm (hoặc số giây âm thanh), chi phí micro-USD, mã theo dõi, thời điểm, cờ bất thường nếu có.
- **FR-016**: Tiền MUST lưu bằng số nguyên micro-USD; MUST NOT dùng số thực ở bất kỳ bước ước tính, giữ chỗ, quyết toán, cộng dồn nào.
- **FR-017**: Nhật ký kỹ thuật MUST chỉ có mã theo dõi, tài khoản, loại việc, bậc mô hình, số token, kết quả, thời lượng; MUST NOT chứa lời nhắc, văn bản kết quả hay số tiền.
- **FR-018**: Hệ thống MUST cung cấp tổng hợp nội bộ chi phí theo tài khoản, theo loại việc, theo mô hình, và trung bình mỗi bài/mỗi tài khoản.

**Bảng giá & đơn giá theo phút**

- **FR-019**: Hệ thống MUST lưu bảng giá mô hình dưới dạng dữ liệu cấu hình dùng chung gồm: mô hình, đơn vị tính (token hoặc phút âm thanh), giá đầu vào, giá đầu ra, giá đọc bộ đệm, giá theo phút, hiệu lực từ; thay đổi giá MUST không cần phát hành.
- **FR-020**: Giá áp dụng cho một lời gọi MUST là dòng giá có hiệu lực tại thời điểm giữ chỗ; thay đổi giá MUST NOT tính lại các lời gọi cũ.
- **FR-021**: Với chuyển giọng nói, ước tính tối đa MUST = min(thời lượng, 5 phút) × đơn giá theo phút, và hệ thống MUST chỉ xử lý 5 phút đầu; chi phí thực MUST = thời lượng thực đã xử lý × đơn giá theo phút (làm tròn theo quy tắc nhà cung cấp đã ghi trong bảng giá).
- **FR-022**: Nếu không có giá hợp lệ cho mô hình cần dùng, hệ thống MUST từ chối trước khi gọi và phát cảnh báo vận hành, không đoán giá.

**Nhà cung cấp & dự phòng**

- **FR-023**: Cổng AI MUST truy cập nhà cung cấp chỉ qua một giao diện bộ chuyển đổi nội bộ; thêm/đổi nhà cung cấp là thêm/đổi bộ chuyển đổi và cấu hình, không sửa module gọi.
- **FR-024**: Khi nhà cung cấp chính lỗi hoặc quá thời gian chờ (mặc định 40 giây; chữ đầu tiên 5 giây khi trả dần), hệ thống MUST trả giữ chỗ, giữ chỗ lại theo giá nhà cung cấp dự phòng, gọi dự phòng **đúng một lần**; cả hai lỗi → trả lỗi `nhà cung cấp không khả dụng` kèm thông điệp tiếng Việt và hành động khắc phục, ngân sách không bị trừ.
- **FR-025**: Nhà cung cấp AI MUST cam kết không dùng dữ liệu để huấn luyện; dữ liệu gửi ra MUST tối thiểu (không email/số điện thoại chủ tài khoản; chỉ phần hồ sơ kinh doanh cần cho lời gọi; khung hình thu nhỏ); mỗi nhà cung cấp ở nước ngoài MUST được ghi vào danh sách chuyển dữ liệu xuyên biên giới.
- **FR-026**: Mã truy cập nhà cung cấp MUST là bí mật cấu hình, MUST NOT xuất hiện trong nhật ký, sổ, chỉ số, thông báo lỗi.
- **FR-027**: Việc chọn mô hình/nhà cung cấp thật MUST bám kết quả POC-1 (chi phí/chất lượng) và POC-4 (chuyển giọng nói/gán nhãn video); trước khi có kết luận, môi trường thật chạy bằng cấu hình đã chốt tạm của SA, còn bản giả lập vẫn dùng được cho phát triển/kiểm thử.
- **FR-028**: Bản giả lập của 005 MUST tiếp tục tồn tại và MUST bị từ chối ở staging/production (đã có quy tắc); bản thật MUST vượt cùng **bộ kiểm thử hợp đồng** của 005 (cả chế độ bộ nhớ và CSDL).

**Hiển thị cho khách & cảnh báo (FR-12)**

- **FR-029**: Mức sử dụng AI cho khách MUST là phần trăm = làm tròn xuống((đã dùng + đã giữ) ÷ 4 USD × 100), kèm số bài đã dùng / 100 và ngày bắt đầu chu kỳ mới; MUST NOT chứa số tiền, đơn giá hay chi phí, kể cả trong dữ liệu phụ.
- **FR-030**: Hệ thống MUST phát đúng một thông báo (trong ứng dụng + email) khi chạm 80% và đúng một khi chạm 100% mỗi chu kỳ; sự kiện được tạo trong cùng giao dịch quyết toán; nội dung không nhắc số tiền.
- **FR-031**: Trạng thái khóa AI MUST được hiển thị bằng chữ + biểu tượng (không chỉ màu), kèm cách tiếp tục làm việc thủ công.

**Ngân sách hệ thống**

- **FR-032**: Hệ thống MUST có ngân sách hệ thống riêng, theo tuần, cho việc tóm tắt xu hướng theo ngành; thao tác hệ thống MUST chỉ gọi được từ ngữ cảnh không có tài khoản và MUST NOT thay đổi ngân sách hay % sử dụng của bất kỳ tài khoản nào.
- **FR-033**: Sau mỗi lần thu thập xu hướng hằng tuần, chi phí dùng chung MUST được chia đều cho các tài khoản cùng ngành và hiện trong số liệu nội bộ theo tài khoản.

**Vận hành, giám sát, hỗ trợ**

- **FR-034**: Hệ thống MUST phát cảnh báo nội bộ khi: > 5% tài khoản chạm ngưỡng 2 USD trong chu kỳ; sổ chi phí lệch hóa đơn nhà cung cấp > 5%; tỷ lệ lỗi nhà cung cấp > 5% trong 15 phút; giữ chỗ treo bất thường; chi phí thực vượt ước tính; thiếu giá hợp lệ; ngân sách hệ thống hết.
- **FR-035**: Hệ thống MUST cung cấp cho hỗ trợ/quản trị xem chi tiết chi phí một tài khoản (USD) qua khung nhìn hạn chế; mỗi lần xem MUST ghi nhật ký kiểm toán; vai trò khách MUST NOT truy cập.
- **FR-036**: Mỗi lời gọi MUST mang mã theo dõi xuyên suốt module gọi → Cổng AI → nhà cung cấp, và số liệu đo theo chuẩn OpenTelemetry có gắn mã tài khoản.
- **FR-037**: Bộ xử lý việc nền gọi AI MUST khi gặp "hết hạn mức" thì dừng không thử lại (không đốt hàng chờ), và MUST chạy lại an toàn không trừ hai lần.
- **FR-038**: Việc dọn giữ chỗ treo, kiểm tra ngưỡng, đối soát hóa đơn MUST chạy qua hàng chờ bền vững của hệ thống, có giới hạn đồng thời riêng.

### Key Entities *(include if feature involves data)*

- **Ngân sách AI (`ai_budget`)**: một dòng mỗi tài khoản mỗi chu kỳ — khoảng chu kỳ, đã dùng, đã giữ, trạng thái, cờ mốc 80/100; ngân sách hệ thống tương tự theo tuần cho xu hướng.
- **Giữ chỗ (`ai_reservation`)**: một lần giữ cho một lời gọi — tài khoản/hệ thống, ước tính, trạng thái (đã giữ / đang gọi / đã quyết toán / đã trả), thời điểm gọi, mã theo dõi.
- **Sổ chi phí AI (`ai_cost_ledger`)**: dòng chỉ-thêm cho mỗi lời gọi — loại việc, mô hình, nhà cung cấp, token/giây âm thanh, chi phí micro-USD, cờ bất thường, mã theo dõi.
- **Bảng giá mô hình (`model_price`)**: dữ liệu cấu hình dùng chung — mô hình, đơn vị tính, giá đầu vào/đầu ra/bộ đệm/phút, hiệu lực từ.
- **Phân bổ chi phí xu hướng**: phần chi phí dùng chung chia đều cho tài khoản cùng ngành, gắn với lần thu thập.
- **Mức sử dụng AI cho khách (`AiUsage`)**: chỉ phần trăm + ngày bắt đầu chu kỳ mới + số bài; không có tiền.

(Ánh xạ tên tiếng Việt → tiếng Anh theo `CLAUDE.md`: `ngan_sach_ai` → `ai_budget`, `so_chi_phi_ai` → `ai_cost_ledger`, `bang_gia_mo_hinh` → `model_price`; ghi bổ sung vào `data-model.md` của kế hoạch.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Trong kiểm thử đồng thời (ít nhất 100 vòng × 25 lời gọi song song sát trần), tổng (đã dùng + đã giữ) vượt trần 4 USD **0 lần** ở mọi thời điểm quan sát; phần đã giữ về 0 khi mọi lời gọi xong.
- **SC-002**: 100% lời gọi bị từ chối vì hết ngân sách xảy ra **trước** khi tốn bất kỳ chi phí nhà cung cấp nào (0 lời gọi nhà cung cấp cho lời gọi bị từ chối).
- **SC-003**: Kiểm tra + giữ chỗ ngân sách hoàn thành p95 ≤ 50 ms trên môi trường kiểm thử CSDL cục bộ.
- **SC-004**: 100% bề mặt hướng khách (kết quả mức sử dụng, thông báo trong ứng dụng, email) không chứa số tiền, đơn giá hay chi phí — kiểm bằng quét tự động.
- **SC-005**: Ở các mức 1,99 / 2,00 / 2,01 USD, bậc mô hình được chọn đúng 100% theo bảng loại việc; gán nhãn và xu hướng luôn bậc rẻ.
- **SC-006**: Mọi lời gọi thật để lại đúng một dòng sổ; tổng sổ của một tài khoản trong chu kỳ khớp mức "đã dùng" của chu kỳ đó (sai lệch 0 micro-USD, trừ phần kẹp trần có ghi cờ).
- **SC-007**: Đổi một dòng giá có hiệu lực từ thời điểm T không cần phát hành; 100% lời gọi sau T dùng giá mới, 0 lời gọi trước T bị tính lại.
- **SC-008**: Khi nhà cung cấp chính lỗi giả lập, ≥ 99% lời gọi hợp lệ vẫn thành công qua dự phòng đúng một lần; khi cả hai lỗi, ngân sách không bị trừ 100% trường hợp.
- **SC-009**: Chuyển giọng nói: với âm thanh bất kỳ thời lượng, chi phí ước tính = min(thời lượng, 5 phút) × đơn giá/phút và chi phí thực không vượt ước tính; không có lời gọi trùng cho tệp trùng nội dung.
- **SC-010**: Sau khi Worker/API bị tắt đột ngột giữa lời gọi, 100% giữ chỗ treo được xử lý (trả lại hoặc quyết toán theo ước tính) trong vòng 15 phút + 1 chu kỳ dọn, và chạy dọn hai lần cho kết quả như một lần.
- **SC-011**: Đạt 80% và 100% mỗi chu kỳ phát đúng 1 thông báo cho mỗi mốc (0 trùng, 0 thiếu), kể cả khi quyết toán bị thử lại.
- **SC-012**: Chi phí AI trung bình mỗi tài khoản hoạt động trong thử nghiệm kín ≤ 2 USD/chu kỳ và 0 tài khoản có chi phí được ghi nhận vượt 4 USD.
- **SC-013**: Cảnh báo vận hành (> 5% tài khoản chạm 2 USD, lệch hóa đơn > 5%, lỗi nhà cung cấp > 5%/15 phút) kích hoạt đúng trong kiểm thử mô phỏng và đội vận hành nhận được trong ≤ 15 phút.
- **SC-014**: Khi AI bị chặn, 100% thao tác thủ công (soạn, duyệt, lên lịch, đăng, tải media, gắn nhãn tay) vẫn hoàn thành bình thường.

## Assumptions

- Giao diện công khai `AiGatewayPublicApi` và kiểu `AI_TASKS`/`MODEL_TIERS`/`AiError`/`AiUsage` của 005 được **giữ nguyên**; chỉ thay phần cài đặt bên trong (kho ngân sách, bảng giá, nhà cung cấp). Module gọi không phải sửa.
- **Chu kỳ ngân sách**: module Tài khoản chưa có mô hình gói/chu kỳ (`subscriptions`, `usage_cycles` chưa có mã). Tính năng này tự quản chu kỳ AI theo ngày kích hoạt gói qua giao diện công khai của `account` khi có; trước khi có, dùng ngày kích hoạt tài khoản làm mốc với quy tắc "tháng không có ngày đó → ngày cuối tháng", và ghi nhận phụ thuộc này ở kế hoạch (liên quan việc mở 012/013/014-gói).
- Mô hình AI và dịch vụ chuyển giọng nói chưa chốt (POC-1/POC-4): tính năng giao **cơ chế** (ước tính, giữ chỗ, ngưỡng, sổ, bảng giá, dự phòng) độc lập nhà cung cấp, cùng bộ chuyển đổi cho nhà cung cấp được SA chốt tạm; bảng giá ban đầu là giá giả định, được thay bằng giá thật sau POC-1, không cần phát hành lại.
- Hai nhà cung cấp (chính + dự phòng) là hai bộ chuyển đổi khác nhau cấu hình độc lập; dự phòng được thử đúng một lần mỗi lời gọi (đã chốt trong ADD).
- Ngưỡng 2 USD (mềm) và 4 USD (cứng) là giá trị cấu hình mặc định theo đặc tả mục 6; trần là cấu hình có kiểm soát thay đổi, không do khách chỉnh.
- Kích thước nhóm: 1 chủ + tối đa 2 cộng tác viên cùng dùng một ngân sách tài khoản.
- Thông báo trong ứng dụng/email dùng module Thông báo đã có (danh mục sự kiện `ai_usage_80/100` đã khai báo ở 005); màn hình hiển thị % thuộc giao diện đã có/được làm kèm tối thiểu nếu thiếu.
- Đối soát hóa đơn nhà cung cấp là so sánh tổng theo ngày giữa sổ chi phí và số liệu hóa đơn do vận hành nhập/tải vào; không tự gọi API thanh toán của nhà cung cấp trong phạm vi này.
- Màn hình quản trị đầy đủ (WBS 4.7) nằm ngoài phạm vi; tính năng này chỉ cung cấp thao tác tối thiểu cho đổi giá và xem chi tiết chi phí có kiểm toán.
- Hạ tầng nền tảng đã có và được tái sử dụng: CSDL có cô lập theo tài khoản, hàng chờ bền vững, nhật ký kiểm toán, đo đạc; không thêm thành phần hạ tầng mới (không bộ nhớ đệm phân tán, không hệ thống tin nhắn).
