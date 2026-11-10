# Feature Specification: Lớp hàng chờ nội bộ – 6 hàng chờ, giới hạn theo tenant, việc hỏng, việc định kỳ

**Feature Branch**: `003-queue-layer-pgboss`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "ĐỌc tài liệu kiến trúc dự án và Xây dựng Lớp hàng chờ nội bộ bọc pg-boss: 6 hàng chờ, giới hạn đồng thời theo tenant, tạo việc trong giao dịch, việc hỏng, việc định kỳ"

**Truy vết**: WBS 1.3 · ADR-03 (hàng chờ bền vững trong CSDL + bộ hẹn giờ chung) · T3 (pg-boss) ·
ADR-01 (hàng chờ tách theo loại việc) · ADR-02 (Worker đặt lại ngữ cảnh tenant) · ADD module Worker
v1.1 mục 3–6, 8, 10 · Kiến trúc triển khai mục 3, 6, 9 · Kiến trúc dữ liệu mục 4 (`ha_tang.viec`,
`viec_chet`) · NFR tin cậy (không mất việc khi khởi động lại, lệch lịch ≤ 5 phút), NFR giám sát ·
Hiến pháp nguyên tắc I, II, IV, V, VIII, IX.

**Phụ thuộc**: `001-monorepo-module-skeleton` (WBS 1.1 – khung API/Worker, module `queue`, lõi dùng
chung, nhật ký có cấu trúc) · `002-db-layer-tenant-rls` (WBS 1.2 – giao dịch ngữ cảnh tenant/hệ
thống/hỗ trợ, schema `infra`, `infra.audit_log` phân vùng theo tháng, vai trò CSDL).

**Bối cảnh**: Tính năng nền móng, không có màn hình cho khách hàng. "Người dùng" là lập trình viên các
module nghiệp vụ (tạo việc, viết bộ xử lý), đội vận hành/hỗ trợ (theo dõi hàng chờ, chạy lại việc
hỏng) và – gián tiếp – chủ tài khoản: bài đã duyệt được đăng đúng giờ, không bị mất khi hệ thống khởi
động lại, và không bị chậm vì một tài khoản khác đang tải hàng loạt video. Module `queue` là **lớp
duy nhất** chạm vào thư viện hàng chờ; các module khác chỉ dùng giao diện công khai của nó (nguyên
tắc IV, IX – thư viện bên ngoài quan trọng phải bọc sau giao diện nội bộ).

## Clarifications

### Session 2026-11-08

- Q: Đội hỗ trợ có được dùng nút "chạy lại việc hỏng" chung cho việc hỏng của hàng chờ `publish`
  không? → A: Không. Mỗi loại việc khai báo cờ "cho phép chạy lại chung" (mặc định có); các loại việc
  `publish` tắt cờ này – máy chủ từ chối chạy lại chung, việc đăng lại chỉ đi qua luồng nghiệp vụ của
  module Đăng bài ("Đăng lại"/"Đã đăng").
- Q: Bản Worker cũ nhận việc thuộc loại mới chưa có bộ xử lý (lúc phát hành song song) thì làm gì?
  → A: Giữ như FR-020 – tính lượt thử như lỗi tạm thời theo giãn cách của hàng chờ, hết lượt thì vào
  việc hỏng với lý do "không có bộ xử lý"; không có cơ chế ân hạn riêng.
- Q: Khi xóa một tài khoản, lớp hàng chờ xử lý việc hỏng và việc đã xong còn lưu của tài khoản thế nào?
  → A: Có thao tác công khai "xóa mọi việc của tài khoản" (gọi từ luồng xóa tài khoản): hủy việc chờ,
  xóa việc đã xong/đã hủy và việc hỏng của tài khoản; nhật ký kiểm toán chỉ ghi số lượng đã xóa.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tạo việc nền trong cùng giao dịch với dữ liệu nghiệp vụ (Priority: P1)

Lập trình viên module nghiệp vụ (vd Duyệt & lịch) đang ở trong một giao dịch ngữ cảnh tenant: ghi
dữ liệu nghiệp vụ (vd tạo lượt đăng) và **tạo việc** cho một loại việc đã đăng ký (vd "thực hiện lượt
đăng") trong **cùng giao dịch đó**, kèm giờ chạy sớm nhất và khóa chống trùng. Giao dịch xác nhận thì
cả dữ liệu lẫn việc cùng tồn tại; giao dịch hoàn tác thì không có việc nào. Mã tài khoản và mã theo dõi
của việc được lấy tự động từ ngữ cảnh giao dịch, không do người gọi tự điền.

**Why this priority**: Hiến pháp nguyên tắc II ("duyệt bài, tạo lượt đăng và tạo việc MUST nằm trong
cùng một giao dịch") và IV ("sự kiện giữa module MUST ghi vào hàng chờ trong cùng giao dịch"). Mọi
module sau đều cần thao tác này; không có nó sẽ phát sinh "dữ liệu có mà việc không có" hoặc ngược lại.

**Independent Test**: Trong giao dịch ngữ cảnh A, chèn một dòng bảng mẫu + tạo một việc thử; hoàn tác
→ không có dòng, không có việc. Lặp lại và xác nhận → có cả hai; việc mang mã tài khoản A và mã theo
dõi của giao dịch.

**Acceptance Scenarios**:

1. **Given** giao dịch ngữ cảnh tài khoản A, **When** tạo việc loại đã đăng ký rồi giao dịch xác nhận,
   **Then** việc tồn tại ở đúng hàng chờ của loại việc, mang mã tài khoản A và mã theo dõi hiện hành.
2. **Given** giao dịch ngữ cảnh A đã tạo việc, **When** giao dịch bị hoàn tác (lỗi hoặc chủ động),
   **Then** không có việc nào được tạo và không Worker nào nhận được việc đó.
3. **Given** đã có một việc còn hiệu lực (chờ, đang chạy hoặc chờ thử lại) với khóa chống trùng
   `publish:{attemptId}`, **When** tạo thêm việc cùng khóa, **Then** không có việc thứ hai; người gọi
   biết việc đã tồn tại (không phải lỗi im lặng).
4. **Given** tạo việc với giờ chạy sớm nhất trong tương lai, **When** chưa đến giờ, **Then** không
   Worker nào lấy việc; khi đến giờ, việc được lấy trong khoảng trễ cho phép của hàng chờ (SC-003).
5. **Given** việc đã tạo nhưng chưa chạy, **When** module sở hữu đổi giờ chạy hoặc hủy việc trong một
   giao dịch nghiệp vụ (vd đổi giờ đăng, hủy lượt đăng), **Then** thay đổi có hiệu lực cùng giao dịch
   đó; việc đã bị hủy không bao giờ chạy.
6. **Given** người gọi tạo việc với loại việc chưa đăng ký, dữ liệu việc sai khuôn, hoặc dữ liệu chứa
   trường bị cấm (nội dung bài, mã quyền truy cập, mã tài khoản tự điền), **When** tạo việc, **Then**
   bị từ chối với lỗi rõ ràng và giao dịch không bị âm thầm xác nhận một nửa.

---

### User Story 2 - Worker xử lý việc an toàn, không mất việc, không chạy trùng (Priority: P1)

Mỗi bản Worker lấy việc từ 6 hàng chờ, mỗi hàng chờ một nhóm luồng có giới hạn đồng thời riêng. Trước
khi gọi bộ xử lý của module sở hữu, Worker **đặt lại ngữ cảnh tenant** từ mã tài khoản của việc (hoặc
ngữ cảnh hệ thống nếu việc không có mã tài khoản) và khôi phục mã theo dõi. Việc thành công được đánh
dấu xong; lỗi tạm thời được thử lại theo chính sách của hàng chờ; Worker chết giữa chừng thì việc được
trả lại sau khi hết thời gian khóa để bản khác chạy. Một việc không bao giờ do hai bản Worker cùng chạy
trong thời gian khóa còn hiệu lực.

**Why this priority**: Đây là cam kết "không mất việc, đúng giờ" của NFR tin cậy và nguyên tắc V; đăng
bài (nguyên tắc II) đứng trên cơ chế này.

**Independent Test**: Chạy 2 bản Worker, tạo 500 việc thử ở nhiều hàng chờ; trong lúc chạy, cưỡng bức
dừng một bản → sau thời gian khóa, mọi việc đều xong đúng một lần ghi nhận thành công, không việc nào
bị hai bản chạy đồng thời.

**Acceptance Scenarios**:

1. **Given** một việc mang mã tài khoản A, **When** Worker gọi bộ xử lý, **Then** bộ xử lý chạy trong
   giao dịch/ngữ cảnh tenant A (chỉ thấy dữ liệu của A) và nhật ký mang `account_id` = A, `trace_id`
   của việc.
2. **Given** một việc không có mã tài khoản (việc hệ thống), **When** Worker gọi bộ xử lý, **Then** bộ
   xử lý chạy trong ngữ cảnh hệ thống, không đọc được bảng khách hàng.
3. **Given** bộ xử lý ném lỗi tạm thời và việc còn lượt thử, **When** Worker xử lý lỗi, **Then** việc
   chuyển "chờ thử lại" với giờ chạy kế tiếp theo giãn cách của hàng chờ (có thêm ngẫu nhiên nhỏ).
4. **Given** bộ xử lý báo lỗi vĩnh viễn hoặc việc đã hết lượt thử, **When** Worker xử lý lỗi, **Then**
   việc chuyển sang việc hỏng kèm lỗi cuối và module sở hữu được báo để cập nhật trạng thái nghiệp vụ.
5. **Given** bộ xử lý của hàng chờ có chính sách thử lại do module tự quyết (`publish` theo ADR-04),
   **When** bộ xử lý yêu cầu "thử lại sau X" hoặc "không thử lại", **Then** lớp hàng chờ làm đúng yêu
   cầu đó, không tự áp giãn cách mặc định.
6. **Given** Worker đang chạy một việc thì bị dừng đột ngột, **When** hết thời gian khóa của hàng chờ,
   **Then** việc được trả lại và một bản Worker khác chạy lại; lượt chạy lại được tính vào số lần thử.
7. **Given** Worker nhận tín hiệu tắt (phát hành), **When** đang có việc chạy, **Then** Worker ngừng lấy
   việc mới, chờ việc đang chạy tối đa 30 giây rồi thoát; việc chưa xong được trả lại khi hết khóa.
8. **Given** hàng chờ `media` đang đầy việc nặng, **When** có việc `publish` đến giờ, **Then** việc
   `publish` được lấy ngay bởi nhóm luồng riêng, không phải chờ việc `media`.

---

### User Story 3 - Giới hạn đồng thời theo tenant chống "hàng xóm ồn ào" (Priority: P1)

Một tài khoản tải lên 50 video cùng lúc hoặc tạo 10 bài hàng loạt. Lớp hàng chờ bảo đảm số việc của
**một tài khoản** đang chạy đồng thời trên một hàng chờ không vượt giới hạn "tối đa/tenant" của hàng chờ
đó, **tính trên mọi bản Worker cộng lại**, nên việc của các tài khoản khác vẫn được lấy chạy song song.

**Why this priority**: Nguyên tắc V ("MUST có giới hạn đồng thời theo tenant"); không có thì một khách
hàng làm trễ lịch đăng/gán nhãn của mọi khách hàng khác.

**Independent Test**: 2 bản Worker, hàng chờ `media` (tối đa 1/tenant): tài khoản A tạo 20 việc, B tạo 2
việc → tại mọi thời điểm A có ≤ 1 việc chạy; việc của B bắt đầu mà không phải chờ hết việc của A.

**Acceptance Scenarios**:

1. **Given** hàng chờ có giới hạn N/tenant và tài khoản A có nhiều hơn N việc đến giờ, **When** 2 bản
   Worker cùng lấy việc, **Then** tại mọi thời điểm số việc của A đang chạy trên hàng chờ đó ≤ N.
2. **Given** A đã đạt giới hạn, **When** tài khoản B có việc đến giờ và hàng chờ còn chỗ, **Then** việc
   của B được lấy chạy ngay.
3. **Given** hàng chờ không có giới hạn theo tenant (`notify`, `scheduled`), **When** lấy việc, **Then**
   chỉ áp giới hạn đồng thời của bản Worker.
4. **Given** việc hệ thống không có mã tài khoản, **When** lấy việc, **Then** không bị tính vào giới hạn
   của tenant nào.

---

### User Story 4 - Việc hỏng được giữ lại để tra cứu và chạy lại bằng một thao tác (Priority: P2)

Việc đã hết lượt thử hoặc lỗi vĩnh viễn được chuyển vào **việc hỏng** kèm lỗi cuối, số lần thử, loại
việc, mã tài khoản, mã theo dõi. Đội hỗ trợ/vận hành tra cứu việc hỏng (lọc theo hàng chờ, tài khoản,
khoảng thời gian) và **chạy lại** một việc bằng một thao tác; mỗi lần xem việc hỏng của một tài khoản
hoặc chạy lại đều ghi nhật ký kiểm toán.

**Why this priority**: ADD Worker mục 3 và kiến trúc mục 6 yêu cầu; màn hình hỗ trợ (WBS 4.7) và cảnh
báo `publish` > 0 việc hỏng dựa vào đây. Xếp P2 vì các luồng P1 chạy được trước khi có thao tác chạy lại.

**Independent Test**: Tạo một việc có bộ xử lý luôn lỗi → sau khi hết lượt thử có đúng một bản ghi việc
hỏng; gọi thao tác chạy lại → có một việc mới cùng loại/dữ liệu chạy được, bản ghi việc hỏng ghi nhận đã
chạy lại, có dòng nhật ký kiểm toán.

**Acceptance Scenarios**:

1. **Given** việc hết lượt thử, **When** chuyển sang việc hỏng, **Then** bản ghi có loại việc, hàng chờ,
   mã tài khoản (nếu có), dữ liệu việc (chỉ mã tham chiếu), lỗi cuối (đã lược bí mật), số lần thử,
   thời điểm tạo/hỏng, mã theo dõi.
2. **Given** một việc hỏng, **When** người có vai trò hỗ trợ/quản trị nội bộ chọn "chạy lại", **Then**
   một việc mới được tạo với cùng loại và dữ liệu, số lần thử đặt lại, mã theo dõi nối với việc cũ;
   bản ghi việc hỏng đánh dấu "đã chạy lại" kèm người thực hiện; có một dòng nhật ký kiểm toán.
3. **Given** việc hỏng đã được chạy lại và việc mới còn hiệu lực, **When** bấm chạy lại lần nữa,
   **Then** không tạo thêm việc trùng (khóa chống trùng giữ nguyên tác dụng).
4. **Given** ngữ cảnh tenant A, **When** truy vấn việc hỏng, **Then** không thấy việc hỏng của tài khoản
   khác.
5. **Given** việc hỏng cũ hơn 90 ngày, **When** việc định kỳ dọn dẹp chạy, **Then** bản ghi bị xóa.
6. **Given** việc hỏng thuộc loại việc tắt cờ "cho phép chạy lại chung" (mọi loại việc của `publish`),
   **When** người hỗ trợ chọn "chạy lại", **Then** máy chủ từ chối, không tạo việc mới, thông báo chỉ
   cách xử lý qua luồng nghiệp vụ của module sở hữu; lần thử bị từ chối vẫn được ghi nhật ký kiểm toán.

---

### User Story 5 - Việc định kỳ chạy đúng một lần mỗi khung thời gian trên nhiều bản Worker (Priority: P2)

Module nghiệp vụ **đăng ký việc định kỳ** với tên, lịch (mỗi phút / mỗi 10 phút / mỗi giờ / hằng ngày /
hằng tuần thứ Hai 05:00 / hằng tháng – theo giờ UTC+7 khi lịch gắn với ngày giờ địa phương) và bộ xử lý.
Bộ hẹn giờ chạy trên **mọi** bản Worker nhưng mỗi khung thời gian chỉ tạo đúng **một** việc (khóa chống
trùng `scheduled:{name}:{slot}`), không cần chọn bản chính. Lớp hàng chờ tự đăng ký các việc định kỳ
của chính nó: dọn việc cũ, tạo trước phân vùng tháng của `infra.audit_log`.

**Why this priority**: Kiến trúc mục 6 liệt kê 12 việc định kỳ của các module (mở chu kỳ, trả giữ chỗ
ngân sách, phát hiện lượt đăng quá giờ…); cơ chế phải có trước khi các module đó được làm. Việc của
từng module do module đó viết sau.

**Independent Test**: 2 bản Worker, đăng ký một việc định kỳ thử "mỗi phút" → trong 30 phút có đúng 30
lần chạy (± 1 ở đầu/cuối cửa sổ đo), không khung nào chạy 2 lần; tắt 1 bản giữa chừng → không khung nào
bị bỏ.

**Acceptance Scenarios**:

1. **Given** 2 bản Worker cùng chạy bộ hẹn giờ, **When** đến một khung thời gian, **Then** đúng một việc
   định kỳ được tạo và chạy cho khung đó.
2. **Given** việc định kỳ lịch "thứ Hai 05:00 UTC+7", **When** tính khung, **Then** việc chạy lúc 22:00
   UTC Chủ nhật; khóa khung dùng ngày giờ địa phương.
3. **Given** cả 2 bản Worker dừng trong một khung, **When** Worker khởi động lại sau khung đó, **Then**
   khung bị lỡ không được bù lại hàng loạt; lần chạy kế tiếp tự bù (việc định kỳ phải viết theo kiểu
   "xử lý mọi thứ đến hạn", không phụ thuộc mỗi khung đều chạy).
4. **Given** việc định kỳ đang chạy lâu hơn chu kỳ của nó, **When** đến khung kế tiếp, **Then** không có
   hai lần chạy cùng tên chồng lên nhau.
5. **Given** việc định kỳ dọn dẹp của lớp hàng chờ, **When** chạy hằng ngày, **Then** xóa việc đã xong
   > 30 ngày và việc hỏng > 90 ngày.
6. **Given** việc định kỳ tạo phân vùng hằng tháng, **When** chạy, **Then** phân vùng của tháng kế tiếp
   (và tháng sau đó) của các bảng nhật ký phân vùng theo tháng đã đăng ký tồn tại trước khi tháng bắt
   đầu; chạy lại không lỗi.

---

### User Story 6 - Quan sát hàng chờ và cấu hình không cần phát hành (Priority: P2)

Đội vận hành xem được, cho từng hàng chờ: số việc đang chờ, tuổi việc chờ lâu nhất, thời gian xử lý
p95, tỷ lệ lỗi, số việc hỏng, số bản Worker đang sống. Thông số hàng chờ (đồng thời/bản, tối đa/tenant,
thời gian khóa, số lần thử, giãn cách) là **cấu hình lưu trong CSDL**, đổi được mà không phát hành lại.

**Why this priority**: Nguyên tắc VIII (cảnh báo `publish` quá hạn > 5 phút là bắt buộc) và kiến trúc
mục 3 (thông số hàng chờ đổi không cần phát hành). P2 vì phần chỉ số có thể hoàn thiện sau luồng chính.

**Independent Test**: Tạo việc làm tăng tuổi chờ của `publish` > 5 phút trong môi trường thử → chỉ số
tương ứng vượt ngưỡng và quy tắc cảnh báo đã khai báo đánh giá thành "đang cảnh báo". Đổi giới hạn
đồng thời trong CSDL → Worker áp dụng giá trị mới trong ≤ 5 phút mà không khởi động lại.

**Acceptance Scenarios**:

1. **Given** Worker đang chạy, **When** đọc điểm xuất chỉ số, **Then** có đủ 6 chỉ số trên cho mỗi
   hàng chờ, gắn nhãn hàng chờ (không gắn mã tài khoản làm nhãn chỉ số để tránh bùng nổ nhãn – mã tài
   khoản nằm trong nhật ký).
2. **Given** quy tắc cảnh báo khai báo trong kho mã, **When** đối chiếu với kiến trúc mục 9, **Then** có
   đủ: tuổi chờ `publish` > 5 phút, `media` > 10 phút, `notify` > 5 phút; việc hỏng `publish` > 0, loại
   khác > 10/ngày; tỷ lệ lỗi > 5%/15 phút; số việc chờ tăng liên tục 30 phút; p95 video > 8 phút; số
   bản Worker < 2.
3. **Given** quản trị đổi thông số một hàng chờ trong CSDL, **When** qua tối đa 5 phút, **Then** mọi bản
   Worker áp dụng thông số mới; giá trị không hợp lệ (âm, bằng 0 với đồng thời) bị từ chối và giữ giá
   trị cũ, ghi cảnh báo.
4. **Given** mỗi việc được xử lý, **When** ghi nhật ký, **Then** nhật ký có cấu trúc gồm `trace_id`,
   `account_id`, hàng chờ, loại việc, lần thử, thời gian, kết quả; MUST NOT chứa dữ liệu việc ngoài mã
   tham chiếu, nội dung bài, prompt hay mã quyền truy cập.

---

### Edge Cases

- Tạo việc ngoài giao dịch có ngữ cảnh (vd từ mã khởi động): chỉ được phép cho việc hệ thống qua ngữ
  cảnh hệ thống; việc có mã tài khoản MUST được tạo trong giao dịch ngữ cảnh tenant đó.
- Tạo việc cho tài khoản B trong giao dịch ngữ cảnh A: MUST bị từ chối (mã tài khoản lấy từ ngữ cảnh,
  không nhận từ tham số).
- Tài khoản bị tạm dừng/xóa trong khi còn việc chờ: Worker vẫn đặt ngữ cảnh và gọi bộ xử lý; bộ xử lý
  của module sở hữu quyết định bỏ qua. Việc dọn dữ liệu tài khoản (WBS sau) gọi thao tác "xóa mọi việc
  của tài khoản" của lớp hàng chờ (FR-037) – không chờ lịch dọn dẹp 30/90 ngày.
- Bộ xử lý chạy quá thời gian khóa nhưng vẫn đang sống: không được để bản Worker khác chạy song song
  cùng việc; plan chọn cơ chế (gia hạn khóa theo nhịp như ADD Worker mục 2, hoặc thời gian khóa đủ lớn
  và bộ xử lý tự ngắt trước hạn) và ghi lý do.
- Bộ xử lý chạy lại sau khi đã làm xong một nửa (Worker chết sau khi ghi kết quả, trước khi đánh dấu
  xong): bộ xử lý MUST chạy lại được an toàn – lớp hàng chờ cung cấp khuôn kiểm thử "chạy hai lần
  cho cùng kết quả" để mỗi module dùng.
- CSDL mất kết nối tạm thời: Worker không thoát, thử kết nối lại có giãn cách; không việc nào bị đánh
  dấu xong sai.
- Đồng hồ các bản Worker lệch nhau: khung việc định kỳ và giờ chạy sớm nhất MUST dựa vào giờ của CSDL,
  không dựa vào giờ máy Worker.
- Lỗi chứa bí mật (chuỗi kết nối, mã quyền truy cập trong thông điệp lỗi của thư viện bên ngoài): MUST
  được lược trước khi lưu vào việc hỏng hoặc nhật ký.
- Việc định kỳ "hằng tháng" vào ngày 31: theo khung tháng, không phụ thuộc ngày tồn tại trong tháng.
- Phát hành song song bản cũ/mới: định nghĩa loại việc và dữ liệu việc MUST tương thích ngược (bản mới
  vẫn xử lý được việc do bản cũ tạo); thêm trường mới là tùy chọn.
- Đổi tên/bỏ một loại việc: việc còn tồn đọng của loại cũ MUST không bị mất âm thầm – Worker chuyển
  chúng sang việc hỏng với lý do "không có bộ xử lý".

## Requirements *(mandatory)*

### Functional Requirements

**Giao diện công khai & ranh giới**

- **FR-001**: Module `queue` MUST là nơi duy nhất dùng trực tiếp thư viện hàng chờ; module khác MUST chỉ
  dùng giao diện công khai của `queue`. Kiểm tra ranh giới (tính năng 001) MUST phát hiện module khác
  nhập thư viện hàng chờ trực tiếp.
- **FR-002**: Phiên bản thư viện hàng chờ MUST được cố định chính xác (không dùng khoảng phiên bản);
  kiểu dữ liệu của thư viện MUST NOT lộ ra giao diện công khai của `queue`.
- **FR-003**: MUST có cơ chế **đăng ký loại việc**: mỗi loại việc có tên duy nhất, thuộc đúng một hàng
  chờ, có khuôn dữ liệu việc được kiểm tra khi tạo và khi xử lý, có bộ xử lý của module sở hữu, và có
  cờ "việc tenant" hay "việc hệ thống". Bộ xử lý chỉ được đăng ký ở phía Worker; phía API chỉ tạo việc.

**6 hàng chờ**

- **FR-004**: MUST có đúng 6 hàng chờ `publish`, `media`, `ai_batch`, `trends`, `notify`, `scheduled`
  với thông số khởi tạo theo bảng ở Key Entities; mỗi hàng chờ MUST có nhóm luồng riêng trên mỗi bản
  Worker để việc chạy lâu ở hàng chờ này không chiếm chỗ của hàng chờ khác.
- **FR-005**: `publish` MUST có ưu tiên cao nhất: khi tài nguyên bản Worker bị tranh chấp, việc `publish`
  đến giờ được lấy trước.
- **FR-006**: Thông số hàng chờ (đồng thời/bản, tối đa/tenant, thời gian khóa, số lần thử, giãn cách)
  MUST là cấu hình lưu trong CSDL, mọi bản Worker áp dụng thay đổi trong ≤ 5 phút không cần phát hành;
  giá trị không hợp lệ bị từ chối, giữ giá trị cũ, ghi cảnh báo.

**Tạo việc trong giao dịch**

- **FR-007**: MUST có thao tác tạo việc chạy **bên trong giao dịch đang mở** của lớp CSDL (tính năng 002);
  việc chỉ hiện hữu khi giao dịch xác nhận.
- **FR-008**: Mã tài khoản của việc tenant MUST lấy từ ngữ cảnh tenant của giao dịch; người gọi MUST NOT
  truyền được mã tài khoản. Việc hệ thống MUST tạo từ ngữ cảnh hệ thống và không có mã tài khoản.
- **FR-009**: Mã theo dõi hiện hành (OpenTelemetry) MUST được lưu vào việc và khôi phục khi Worker xử lý,
  để truy vết API → hàng chờ → Worker xuyên suốt (nguyên tắc VIII).
- **FR-010**: Thao tác tạo việc MUST hỗ trợ: giờ chạy sớm nhất, khóa chống trùng (duy nhất trong số việc
  còn hiệu lực: chờ, đang chạy, chờ thử lại), và ghi đè chính sách thử lại trong phạm vi cấu hình của
  loại việc. Khóa chống trùng trùng → trả kết quả "đã tồn tại" cho người gọi.
- **FR-011**: MUST có thao tác, trong giao dịch, **hủy** việc chưa chạy và **đổi giờ chạy** của việc chưa
  chạy theo mã việc hoặc khóa chống trùng; thao tác chỉ thành công khi việc còn ở trạng thái chờ/chờ thử
  lại và báo cho người gọi khi việc đã chạy (phục vụ đổi giờ đăng – kiến trúc mục 7.1).
- **FR-012**: Dữ liệu việc MUST chỉ chứa mã tham chiếu và tham số nhỏ: tạo việc MUST từ chối dữ liệu sai
  khuôn hoặc vượt kích thước tối đa (mặc định 8 KB), và khuôn dữ liệu MUST NOT có trường nội dung bài,
  prompt, mã quyền truy cập.
- **FR-013**: MUST có thao tác tạo nhiều việc trong một lần gọi (vd 10 việc con tạo bài hàng loạt) trong
  cùng giao dịch – tất cả hoặc không việc nào.

**Xử lý việc ở Worker**

- **FR-014**: Trước khi gọi bộ xử lý, Worker MUST mở ngữ cảnh tenant theo mã tài khoản của việc (việc
  tenant) hoặc ngữ cảnh hệ thống (việc hệ thống) bằng lớp CSDL của tính năng 002, và gắn `account_id`,
  `trace_id`, hàng chờ, loại việc, lần thử vào ngữ cảnh nhật ký.
- **FR-015**: Kết quả bộ xử lý MUST được ánh xạ như sau: thành công → xong; lỗi tạm thời còn lượt → chờ
  thử lại với giãn cách cấu hình (kèm ngẫu nhiên ≤ 20%); lỗi vĩnh viễn hoặc hết lượt → việc hỏng; bộ xử
  lý yêu cầu "thử lại sau X" → chờ thử lại đúng X (không vượt số lần tối đa); "không thử lại" → kết
  thúc, không vào việc hỏng nếu bộ xử lý báo đó là kết quả nghiệp vụ (vd hết ngân sách AI).
- **FR-016**: Khi việc vào việc hỏng, MUST gọi phản hồi "thất bại cuối" của loại việc (nếu module sở hữu
  đăng ký) để module cập nhật trạng thái nghiệp vụ (vd lượt đăng → "Cần người dùng xử lý").
- **FR-017**: Việc bị bỏ dở (Worker chết, mất kết nối) MUST được trả lại để chạy lại sau khi hết thời gian
  khóa của hàng chờ; trong thời gian khóa còn hiệu lực, MUST NOT có bản Worker thứ hai chạy cùng việc.
- **FR-018**: Worker MUST tắt có kiểm soát khi nhận tín hiệu dừng: ngừng lấy việc mới, chờ việc đang chạy
  tối đa 30 giây, rồi thoát; việc chưa xong được trả lại theo FR-017.
- **FR-019**: Worker MUST tự kết nối lại khi CSDL tạm mất kết nối, không thoát tiến trình, và báo trạng
  thái "chưa sẵn sàng" qua điểm kiểm tra sống của tính năng 001 trong lúc mất kết nối.
- **FR-020**: Việc có loại không có bộ xử lý đăng ký ở bản Worker đang chạy MUST được xử lý như lỗi
  tạm thời (tính lượt thử, giãn cách theo hàng chờ – để bản Worker khác có thể nhận ở lần thử sau) và
  chuyển sang việc hỏng với lý do "không có bộ xử lý" khi hết lượt thử, không bị xóa âm thầm. Không có
  cơ chế ân hạn/không tính lượt riêng cho trường hợp này.

**Giới hạn đồng thời theo tenant**

- **FR-021**: Với hàng chờ có giới hạn "tối đa/tenant" N, số việc của một tài khoản đang chạy trên hàng
  chờ đó MUST ≤ N **tính trên mọi bản Worker**, phối hợp qua CSDL (không qua bộ nhớ riêng của bản Worker,
  không thêm hạ tầng mới).
- **FR-022**: Một tài khoản đạt giới hạn MUST NOT làm chặn việc của tài khoản khác trên cùng hàng chờ.
  Việc hệ thống không tính vào giới hạn tenant.

**Việc hỏng**

- **FR-023**: MUST có bảng việc hỏng `infra.dead_jobs` lưu: mã việc gốc, hàng chờ, loại việc, mã tài khoản
  (rỗng với việc hệ thống), dữ liệu việc, lỗi cuối đã lược bí mật, số lần thử, thời điểm tạo/hỏng, mã
  theo dõi, trạng thái chạy lại (người thực hiện, thời điểm, mã việc mới).
- **FR-024**: Việc hỏng có mã tài khoản MUST NOT đọc được từ ngữ cảnh tenant khác (nguyên tắc I); đội hỗ
  trợ đọc qua ngữ cảnh hỗ trợ của tính năng 002 (có nhật ký kiểm toán).
- **FR-025**: MUST có thao tác công khai **tra cứu việc hỏng** (lọc theo hàng chờ, loại việc, tài khoản,
  khoảng thời gian, trạng thái chạy lại) và **chạy lại một việc hỏng** (dùng cho màn hình hỗ trợ WBS 4.7),
  chỉ cho vai trò hỗ trợ/quản trị nội bộ; chạy lại tạo việc mới cùng loại/dữ liệu/khóa chống trùng, nối
  mã theo dõi, ghi nhật ký kiểm toán; chạy lại hai lần khi việc mới còn hiệu lực MUST NOT tạo việc trùng.
  Quyền MUST kiểm tra ở tầng máy chủ. Chạy lại chung MUST bị từ chối với loại việc tắt cờ "cho phép chạy
  lại chung"; mọi loại việc của hàng chờ `publish` MUST tắt cờ này (nguyên tắc II – đăng lại chỉ qua
  luồng nghiệp vụ có đối soát của module Đăng bài).
- **FR-037**: MUST có thao tác công khai **xóa mọi việc của một tài khoản** (cho luồng xóa tài khoản,
  nguyên tắc VII – xóa CSDL ≤ 30 ngày): trong một giao dịch, hủy mọi việc chờ/chờ thử lại, xóa việc đã
  xong/đã hủy còn lưu và mọi bản ghi `infra.dead_jobs` của tài khoản; việc đang chạy được đánh dấu để
  không thử lại và bị xóa khi kết thúc. Chạy lại được an toàn; nhật ký kiểm toán chỉ ghi số lượng đã
  xóa theo loại, không chứa dữ liệu việc.

**Việc định kỳ**

- **FR-026**: MUST có cơ chế **đăng ký việc định kỳ**: tên duy nhất, lịch, múi giờ tính khung (mặc định
  UTC+7 cho lịch theo ngày/tuần/tháng), loại việc thực thi trên hàng chờ `scheduled` (hoặc hàng chờ khác
  do module chỉ định).
- **FR-027**: Bộ hẹn giờ MUST chạy trên mọi bản Worker; mỗi khung thời gian MUST tạo đúng một việc nhờ
  khóa chống trùng `scheduled:{name}:{slot}`; giờ tính khung lấy từ CSDL.
- **FR-028**: Hai lần chạy của cùng một việc định kỳ MUST NOT chồng nhau; khung bị lỡ khi mọi Worker
  dừng MUST NOT được bù hàng loạt khi khởi động lại.
- **FR-029**: Lớp hàng chờ MUST tự đăng ký các việc định kỳ của mình: (a) dọn việc đã xong > 30 ngày và
  việc hỏng > 90 ngày (hằng ngày); (b) tạo trước phân vùng tháng kế tiếp cho các bảng nhật ký phân vùng
  theo tháng đã đăng ký (hằng tháng) – áp ngay cho `infra.audit_log` (tính năng 002 FR-024); các bảng
  phân vùng khác (`publish_steps`, `ai_cost_ledger`) đăng ký khi module sở hữu tạo bảng. Bỏ phân vùng
  > 12 tháng chỉ làm khi bảng đăng ký có chính sách giữ 12 tháng.
- **FR-030**: Các việc định kỳ nghiệp vụ còn lại ở kiến trúc mục 6 (mở chu kỳ, kiểm tra gói, làm mới
  token, xu hướng, trả giữ chỗ ngân sách, đối soát chi phí AI, xóa tài khoản, phát hiện lượt đăng quá
  giờ, báo cáo tham chiếu hỏng) MUST NOT làm trong tính năng này; tài liệu MUST có danh sách để module
  sở hữu đăng ký sau.

**Quan sát**

- **FR-031**: MUST xuất chỉ số theo từng hàng chờ: số việc đang chờ, tuổi việc chờ lâu nhất, thời gian xử
  lý (để tính p95), số việc thành công/lỗi (để tính tỷ lệ), số việc hỏng, và số bản Worker đang sống;
  theo chuẩn OpenTelemetry; nhãn chỉ số MUST NOT gồm mã tài khoản.
- **FR-032**: MUST có quy tắc cảnh báo khai báo trong kho mã cho các ngưỡng ở kiến trúc mục 9 thuộc hàng
  chờ (liệt kê ở User Story 6, kịch bản 2). Triển khai lên hệ thống giám sát thuộc WBS hạ tầng giám sát.
- **FR-033**: Mỗi lần xử lý việc MUST ghi một dòng nhật ký có cấu trúc (bắt đầu/kết thúc gộp hoặc tách do
  plan chọn) theo FR-014; MUST NOT ghi dữ liệu việc ngoài mã tham chiếu, nội dung bài, prompt, mã quyền
  truy cập, chuỗi kết nối.

**Kiểm thử & tài liệu**

- **FR-034**: MUST có bộ kiểm thử tích hợp trên PostgreSQL thật chứng minh: tạo việc trong giao dịch bị
  hoàn tác thì không có việc; khóa chống trùng; 2 bản Worker không chạy trùng một việc; Worker chết giữa
  chừng → việc được chạy lại; giới hạn theo tenant trên 2 bản Worker; ngữ cảnh tenant/hệ thống đúng
  trong bộ xử lý; thử lại/giãn cách/việc hỏng; chạy lại việc hỏng; việc định kỳ đúng một lần mỗi khung
  với 2 bản Worker; tắt có kiểm soát; từ chối chạy lại chung việc `publish`; xóa mọi việc của tài
  khoản (FR-037) không chạm việc của tài khoản khác.
- **FR-035**: MUST có khuôn kiểm thử dùng lại cho module khác: (a) chạy một bộ xử lý **hai lần** với cùng
  việc và so sánh kết quả (cổng kiểm thử "chạy lại hai lần cho cùng kết quả" của hiến pháp); (b) chạy
  đồng bộ việc trong kiểm thử mà không cần khởi động Worker thật.
- **FR-036**: MUST có tài liệu tiếng Việt: cách đăng ký loại việc, cách tạo việc trong giao dịch, cách viết
  bộ xử lý chạy lại an toàn, cách báo lỗi tạm thời/vĩnh viễn/"thử lại sau X", cách đăng ký việc định kỳ,
  cách tra cứu/chạy lại việc hỏng, danh sách việc định kỳ chờ module đăng ký (FR-030), và thuật ngữ mới bổ
  sung vào bảng thuật ngữ.

### Key Entities *(include if feature involves data)*

- **Hàng chờ** – thông số khởi tạo (kiến trúc mục 6; cấu hình được, FR-006):

  | Hàng chờ | Việc (chủ sở hữu) | Đồng thời/bản | Tối đa/tenant | Thời gian khóa | Thử lại mặc định |
  |---|---|---|---|---|---|
  | `publish` | Thực hiện lượt đăng, đối soát (`publishing`) | 10 | 3 | 2 phút | Do bộ xử lý quyết theo ADR-04 (≤ 5 lần / 30 phút) |
  | `media` | Chuẩn hóa, xử lý video, gán nhãn (`media`) | 2 | 1 | 15 phút | 3 lần: 1 → 5 → 15 phút |
  | `ai_batch` | Đề xuất chủ đề, tạo bài hàng loạt (`content`) | 5 | 3 | 3 phút | 2 lần; hết ngân sách → không thử lại |
  | `trends` | Thu thập/tóm tắt theo ngành, từ khóa riêng (`trends`) | 2 | 1 | 10 phút | 3 lần: 1 giờ → 4 giờ |
  | `notify` | Email, thông báo trong ứng dụng (`notifications`) | 5 | — | 1 phút | 5 lần, giãn cách tăng dần |
  | `scheduled` | Việc định kỳ (nhiều module) | 2 | — | 10 phút | Không thử lại; lần chạy kế tiếp tự bù |

- **Loại việc**: tên, hàng chờ, khuôn dữ liệu, tenant/hệ thống, bộ xử lý, phản hồi thất bại cuối, chính
  sách thử lại (mặc định theo hàng chờ), cờ "cho phép chạy lại chung" (mặc định có; loại việc `publish`
  tắt).
- **Việc**: mã, loại, hàng chờ, mã tài khoản (rỗng với việc hệ thống), dữ liệu (chỉ mã tham chiếu), trạng
  thái (chờ · đang chạy · chờ thử lại · xong · hủy · hỏng), giờ chạy sớm nhất, số lần thử/tối đa, khóa
  đến, khóa chống trùng, mã theo dõi. Lưu trong vùng dữ liệu của thư viện hàng chờ (schema riêng do plan
  đặt tên), do module `queue` sở hữu.
- **Việc hỏng (`infra.dead_jobs`)**: theo FR-023.
- **Cấu hình hàng chờ**: thông số theo bảng trên, lưu trong schema `infra` (tên bảng do plan đặt).
- **Việc định kỳ**: tên, lịch, múi giờ, loại việc; khung thời gian (`slot`) là khóa chống trùng.
- **Thuật ngữ mới cần thêm vào bảng ánh xạ** (kiến trúc mục 11): loại việc → `job type`; khóa chống trùng
  → `singleton key`; khung thời gian → `slot`; giờ chạy sớm nhất → `run_after`/`start_after` (plan chốt
  một tên); khóa đến → `locked_until`; chạy lại việc hỏng → `retry dead job`; cấu hình hàng chờ →
  `queue_settings`; việc tenant / việc hệ thống → `tenant job` / `system job`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 việc bị mất: trong thử nghiệm 2 bản Worker xử lý 1.000 việc, cưỡng bức dừng ngẫu nhiên
  một bản 5 lần, 100% việc kết thúc ở "xong" hoặc "hỏng" có lý do; không việc nào bị kẹt quá thời gian
  khóa + 1 phút.
- **SC-002**: 0 lần một việc bị hai bản Worker chạy đồng thời trong cùng thử nghiệm SC-001 (đo bằng bộ xử
  lý thử ghi nhận chồng lấn).
- **SC-003**: Việc `publish` đến giờ được bắt đầu xử lý trong ≤ 30 giây ở p99, kể cả khi hàng chờ `media`
  đang đầy việc chạy lâu – đủ dư địa cho mục tiêu lệch lịch đăng ≤ 5 phút.
- **SC-004**: Giới hạn theo tenant không bao giờ bị vượt: với 2 bản Worker, 1 tài khoản có 50 việc
  `media` và 5 tài khoản khác mỗi tài khoản 2 việc, số việc đồng thời của mỗi tài khoản ≤ giới hạn tại mọi
  lần lấy mẫu, và việc của 5 tài khoản kia đều bắt đầu trước khi tài khoản ồn ào xong 25% việc của mình.
- **SC-005**: 100% việc tạo trong giao dịch bị hoàn tác không bao giờ được chạy (≥ 200 lần thử).
- **SC-006**: Việc định kỳ "mỗi phút" chạy đúng một lần mỗi khung trong 60 phút với 2 bản Worker (0 khung
  chạy trùng, 0 khung bị bỏ khi còn ít nhất một bản Worker sống).
- **SC-007**: Tạo một việc làm tăng thời gian giao dịch nghiệp vụ không quá 10 ms ở p95 trên môi trường
  phát triển.
- **SC-008**: Tắt Worker có kiểm soát hoàn tất trong ≤ 35 giây ở 100% lần thử; không việc nào bị đánh
  dấu xong khi chưa chạy xong.
- **SC-009**: Đội hỗ trợ chạy lại một việc hỏng trong ≤ 1 thao tác; 100% lần chạy lại có nhật ký kiểm toán.
- **SC-010**: Thay đổi thông số hàng chờ có hiệu lực trên mọi bản Worker trong ≤ 5 phút, không khởi động lại.
- **SC-011**: 0 trường dữ liệu bị cấm (nội dung bài, prompt, mã quyền truy cập, chuỗi kết nối) xuất hiện
  trong nhật ký và việc hỏng khi chạy toàn bộ bộ kiểm thử (kiểm bằng quét nhật ký mẫu).
- **SC-012**: Lập trình viên module mới đăng ký một loại việc + bộ xử lý + kiểm thử "chạy hai lần" theo
  tài liệu trong ≤ 30 phút.

## Assumptions

- Phạm vi là WBS 1.3. **Ngoài phạm vi**: bộ xử lý nghiệp vụ của từng hàng chờ (đăng bài, media, AI hàng
  loạt, xu hướng, thông báo) và các việc định kỳ nghiệp vụ (FR-030) – làm trong đặc tả của từng module;
  màn hình hỗ trợ tra cứu/chạy lại việc hỏng (WBS 4.7 – ở đây chỉ có thao tác máy chủ); triển khai bảng
  điều khiển và cảnh báo lên Grafana/Prometheus, gắn kiểm thử vào CI (WBS 1.4/1.5); tách Worker media
  thành đơn vị riêng (điều kiện xem xét lại của ADR-01).
- Thư viện đã chốt là pg-boss (T3); đặc tả không chọn lại. T3 ghi pg-boss có tạo việc trong giao dịch
  đang mở (qua bộ nối với Drizzle), giới hạn đồng thời theo nhóm phối hợp qua CSDL, hẹn giờ định kỳ, thử
  lại giãn cách, hàng chờ việc hỏng. `/speckit-plan` MUST xác minh từng khả năng trên phiên bản cố định;
  khả năng nào thiếu thì bổ sung **bên trong** module `queue` bằng PostgreSQL (không thêm hạ tầng) và ghi
  lý do. Nếu phải đi ngược ADR-03/T3 thì cần ADR mới.
- Việc hỏng lưu ở `infra.dead_jobs` (tên theo kiến trúc mục 4) thay vì chỉ dựa vào hàng chờ việc hỏng
  của thư viện, để tra cứu/kiểm toán/giữ 90 ngày không phụ thuộc cấu trúc nội bộ của thư viện. Plan có thể
  dùng cơ chế việc hỏng của thư viện làm bước trung gian.
- Bảng việc của thư viện là dữ liệu hạ tầng, không phải bảng nghiệp vụ của khách hàng: không bật chính
  sách tenant trên đó, được khai báo ngoại lệ trong kiểm tra quy ước CSDL (tính năng 002 FR-020) kèm lý
  do; cô lập được bảo đảm vì dữ liệu việc chỉ chứa mã tham chiếu và bộ xử lý luôn chạy trong ngữ cảnh
  tenant. `infra.dead_jobs` có `account_id` nên áp chính sách tenant (FR-024); plan quyết cách hợp lệ hóa
  dòng `account_id` rỗng của việc hệ thống.
- Bản Worker giai đoạn 1 = 2 bản; con số đồng thời ở bảng là trên mỗi bản, tổng năng lực gấp đôi.
- ADD Worker mục 2/5 mô tả "gia hạn khóa mỗi 30 giây"; đặc tả chỉ ràng buộc kết quả (FR-017, edge case
  bộ xử lý chạy lâu), plan chọn cơ chế phù hợp với phiên bản thư viện.
- Thời gian khóa 2 phút của `publish` là giả định; POC-2 xác định lại (phải lớn hơn thời gian chờ phản
  hồi tối đa của nền tảng, nhất là video) – chỉnh bằng cấu hình (FR-006).
- Thử lại `trends` "1 → 4 giờ" hiểu là giãn cách 1 giờ rồi 4 giờ (kiến trúc mục 6 ghi "1 → 4 giờ").
- Lịch định kỳ theo ngày/tuần/tháng tính theo UTC+7 vì nghiệp vụ gắn với giờ Việt Nam (vd "thứ Hai 05:00");
  lịch theo phút/giờ không phụ thuộc múi giờ.
- Giao diện hỏi tiến độ tạo bài hàng loạt đọc từ dữ liệu nghiệp vụ của module `content`, không đọc trạng
  thái việc trực tiếp – lớp hàng chờ không cần API tra cứu việc cho người dùng cuối.
