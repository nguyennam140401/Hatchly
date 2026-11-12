# Feature Specification: Hạ tầng dưới dạng mã (Terraform) – môi trường thử nghiệm và môi trường phát hành

**Feature Branch**: `007-terraform-infra-environments`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Dựa trên tài liệu kiến trúc dự án, xây dựng Hạ tầng bằng Terraform: Kubernetes,
PostgreSQL (hoặc CloudNativePG), kho tệp S3 + CDN, quản lý khóa; môi trường thử nghiệm phù hợp với dự án. Lưu ý
bạn đang trong vai trò là SA và bạn hiểu hạ tầng thế nào là phù hợp nhất với dự án (cần môi trường test và
release)"

**Truy vết**: WBS H1 (hạ tầng bằng Terraform; cổng chuyển sang đợt 1: "có môi trường thử nghiệm") · ADR-01,
ADR-02, ADR-03, ADR-07a, ADR-08, ADR-10 · Lựa chọn công nghệ T4, T4c, T5, T6, mục 4, mục 5 · ADD tổng thể mục
8.2 (khả dụng, khôi phục), mục bảo mật (khóa mã hóa mã quyền) · Kiến trúc dữ liệu mục 7.3 (sao lưu & khôi
phục), mục 9 (vị trí dữ liệu), mục 10 (CDN) · Đặc tả triển khai `.specify/memory/architecture.md` mục 3 (hình
thái triển khai) · NFR khả dụng 99,5%, mất dữ liệu ≤ 5 phút, khôi phục ≤ 1 giờ, chịu gấp 10 tải · Hiến pháp
nguyên tắc I, V, VII, VIII, IX.

**Phụ thuộc**: P6 (xác minh VNG Cloud 3 điểm + báo giá + ký) – quyết định biến thể CSDL và là điều kiện để
*dựng thật*; phần định nghĩa hạ tầng có thể viết và kiểm tra tĩnh trước khi P6 xong · `001`–`006` (ảnh
container chạy cả `api` lẫn `worker`, danh sách biến cấu hình, bốn vai trò CSDL `owner`/`app`/`system`/
`support`, bố cục kho tệp `tenants/{accountId}/…`, kho tệp qua giao diện S3).

**Bối cảnh**: Đến nay ứng dụng chỉ chạy trên máy lập trình viên (docker compose). Đợt 1 cần một nơi chạy
giống thật để: nộp App Review của Meta (cần đường dẫn HTTPS công khai), chạy POC đăng bài, kiểm thử tích hợp
và diễn tập sự cố. Trước ngày ra mắt cần môi trường phát hành đạt các chỉ số phi chức năng. Với đội 3–4
người chưa có người vận hành riêng, hạ tầng phải **dựng lại được từ mã**, **hai môi trường giống nhau về
hình dạng**, và **không ai phải bấm tay trên bảng điều khiển của nhà cung cấp**.

**Quyết định của SA áp dụng trong đặc tả này** (lý do ở mục Assumptions):

1. **Hai môi trường cố định**: `staging` (thử nghiệm) và `production` (phát hành), **tách hoàn toàn** – mỗi môi
   trường có mạng, cụm Kubernetes, CSDL, kho tệp, CDN, khóa mã hóa và bí mật riêng. Không dùng chung cụm và
   chia namespace.
2. **Cùng một bộ định nghĩa, khác tham số**: thử nghiệm là bản thu nhỏ của phát hành (ít máy hơn, CSDL không
   cần bản dự phòng, giữ sao lưu ngắn hơn) nhưng **cùng thành phần, cùng phiên bản, cùng biến thể CSDL**.
3. **Biến thể CSDL chọn bằng một tham số**: CSDL được quản lý của nhà cung cấp (nếu P6 xác nhận khôi phục theo
   thời điểm) hoặc CloudNativePG trên cụm Kubernetes. Hai biến thể đáp ứng cùng một "hợp đồng CSDL" (FR-011).
4. **Môi trường diễn tập khôi phục** là môi trường tạm, dựng từ cùng bộ định nghĩa, hủy sau khi đo xong.

**Ngoài phạm vi** (thuộc đầu việc khác): quy trình tích hợp và triển khai tự động, dựng và đẩy ảnh container,
định nghĩa triển khai `api`/`worker`/chạy migration (WBS H2); cài đặt và cấu hình bộ giám sát Prometheus / Loki
/ Tempo / Grafana / GlitchTip, bảng điều khiển và cảnh báo (WBS H3) – tính năng này chỉ **dành sẵn chỗ và tài
nguyên** cho chúng; tài khoản Amazon SES, ứng dụng Meta/Zalo/Google (P5); tên miền mua mới và hợp đồng nhà
cung cấp (P6); kiểm thử tải (đợt 4); nhiều vùng địa lý, tự mở rộng số máy theo tải, môi trường riêng cho từng
nhánh mã.

## User Scenarios & Testing *(mandatory)*

Người dùng của tính năng này là **SA và đội phát triển/kiểm thử**. Giá trị cho chủ kinh doanh đến gián tiếp:
dữ liệu của họ nằm trong nước, không mất quá 5 phút dữ liệu khi sự cố, và bản phát hành nào cũng đã chạy
trước trên một môi trường giống thật.

### User Story 1 - SA dựng môi trường thử nghiệm từ mã để đội có nơi chạy giống thật (Priority: P1)

SA nhận kết quả P6, điền tham số của môi trường thử nghiệm, chạy quy trình dựng. Sau một lần chạy, môi trường
có đủ: cụm Kubernetes, CSDL PostgreSQL, kho tệp media, nơi phục vụ giao diện tĩnh qua CDN, khóa mã hóa, kho
bí mật, địa chỉ HTTPS công khai. SA triển khai ảnh container hiện có (bằng tay, theo tài liệu hướng dẫn) và
thấy `api` lẫn `worker` báo khỏe, đăng nhập được, tải tệp thẳng từ trình duyệt lên kho tệp được.

**Why this priority**: Là cổng chuyển sang đợt 1 của WBS và là điều kiện để nộp App Review của Meta (đường
găng tới ngày ra mắt). Không có môi trường này thì mọi kiểm chứng đều dừng ở máy cá nhân.

**Independent Test**: Từ một tài khoản đám mây trống, chạy quy trình dựng với tham số thử nghiệm; triển khai
ảnh container hiện có theo tài liệu; chạy bộ kiểm tra khói (kiểm tra sức khỏe `api`/`worker`, ghi–đọc CSDL
bằng vai trò `app`, tạo đường dẫn ký sẵn và tải tệp, mở giao diện qua HTTPS).

**Acceptance Scenarios**:

1. **Given** tài khoản đám mây chưa có tài nguyên nào của dự án và tham số thử nghiệm đã điền, **When** SA
   chạy quy trình dựng một lần, **Then** mọi thành phần ở FR-008…FR-021 tồn tại, và quy trình in ra danh sách
   đầu ra đủ để cấu hình ứng dụng (FR-024) mà không chứa giá trị bí mật.
2. **Given** môi trường thử nghiệm vừa dựng, **When** SA triển khai ảnh container hiện có với cấu hình lấy từ
   đầu ra và kho bí mật, **Then** `api` (2 bản) và `worker` (2 bản) báo khỏe, và migration chạy được bằng vai
   trò `owner` tách khỏi tiến trình ứng dụng.
3. **Given** môi trường đã dựng xong, **When** SA chạy lại quy trình dựng với cùng tham số, **Then** kết quả
   báo "không có thay đổi".
4. **Given** người dùng thử mở địa chỉ giao diện trên điện thoại, **When** tải trang, **Then** trang đến qua
   HTTPS với chứng chỉ hợp lệ, và yêu cầu HTTP thường được chuyển sang HTTPS.
5. **Given** người dùng đã đăng nhập ở giao diện thử nghiệm, **When** tải một tệp 100 MB bằng đường dẫn ký
   sẵn, **Then** tệp đi thẳng từ trình duyệt lên kho tệp, không qua `api`, và nằm dưới tiền tố
   `tenants/{accountId}/`.

---

### User Story 2 - SA dựng môi trường phát hành cùng hình dạng, đạt chỉ số tin cậy và tách hẳn khỏi thử nghiệm (Priority: P2)

Trước ngày ra mắt, SA dựng môi trường phát hành từ **cùng bộ định nghĩa**, chỉ đổi tham số: nhiều máy hơn,
trải trên nhiều vùng sẵn sàng (nếu nhà cung cấp có), CSDL có bản dự phòng và sao lưu liên tục, chống xóa nhầm.
Không một thông tin đăng nhập, khóa hay đường mạng nào của thử nghiệm dùng được ở phát hành và ngược lại.

**Why this priority**: Là nơi giữ dữ liệu thật của khách hàng; các NFR (99,5%, mất dữ liệu ≤ 5 phút, khôi phục
≤ 1 giờ) và nguyên tắc I, VII chỉ có ý nghĩa ở đây. Xếp sau US1 vì đợt 1–3 chưa cần.

**Independent Test**: Dựng môi trường phát hành; so sánh danh sách thành phần với thử nghiệm (chỉ khác kích
thước và mức bảo vệ); thử dùng thông tin đăng nhập của thử nghiệm để chạm vào CSDL, kho tệp, khóa của phát
hành → bị từ chối; tắt một máy chạy ứng dụng và bản chính của CSDL → dịch vụ tự phục hồi.

**Acceptance Scenarios**:

1. **Given** hai môi trường đã dựng, **When** so sánh định nghĩa, **Then** khác biệt chỉ nằm trong tệp tham số
   của từng môi trường (kích thước, số bản, thời gian giữ sao lưu, tên miền, mức bảo vệ xóa); không có thành
   phần nào chỉ tồn tại ở một bên, trừ các mục được liệt kê rõ ở FR-003.
2. **Given** thông tin đăng nhập CSDL, khóa truy cập kho tệp và quyền dùng khóa mã hóa của thử nghiệm, **When**
   dùng chúng với tài nguyên của phát hành, **Then** mọi yêu cầu bị từ chối; từ mạng của thử nghiệm không mở
   được kết nối tới CSDL của phát hành.
3. **Given** môi trường phát hành đang chạy `api` 2 bản và `worker` 2 bản, **When** một máy chạy ứng dụng bị
   tắt đột ngột, **Then** người dùng vẫn dùng được, và số bản trở lại đủ trong ≤ 5 phút mà không cần người can
   thiệp.
4. **Given** CSDL phát hành có bản chính và bản dự phòng, **When** bản chính hỏng, **Then** bản dự phòng lên
   thay, ứng dụng kết nối lại qua cùng một địa chỉ, không cần đổi cấu hình.
5. **Given** ai đó chạy lệnh hủy hoặc một thay đổi dẫn tới thay thế CSDL / kho tệp media / khóa mã hóa của
   phát hành, **When** quy trình thực thi, **Then** bị chặn cho đến khi lớp bảo vệ xóa được gỡ bằng một thay
   đổi riêng, có chủ đích và qua review.

---

### User Story 3 - Thay đổi hạ tầng đi qua thử nghiệm trước, có bản xem trước và có người duyệt (Priority: P3)

Một thành viên cần đổi hạ tầng (tăng kích thước máy, thêm luật vòng đời tệp, nâng phiên bản Kubernetes). Họ
sửa mã, xem bản xem trước thay đổi, áp dụng lên thử nghiệm, kiểm tra, rồi mới đề nghị áp dụng lên phát hành.
Áp dụng lên phát hành cần một người khác duyệt bản xem trước.

**Why this priority**: Ngăn sự cố do sửa tay và do "chỉ đổi ở production". Cần có trước khi phát hành thật,
nhưng US1 vẫn có giá trị khi chưa có quy trình này.

**Independent Test**: Tạo một thay đổi nhỏ (ví dụ thêm nhãn), xem bản xem trước ở cả hai môi trường; áp dụng ở
thử nghiệm; thử áp dụng thẳng lên phát hành khi chưa có người duyệt → bị chặn; sửa tay một thuộc tính trên
bảng điều khiển rồi chạy kiểm tra lệch → phát hiện được.

**Acceptance Scenarios**:

1. **Given** một thay đổi mã hạ tầng, **When** thành viên yêu cầu bản xem trước cho một môi trường, **Then**
   nhận được danh sách tài nguyên sẽ tạo / sửa / thay thế / xóa, trong đó thao tác thay thế hoặc xóa tài nguyên
   chứa dữ liệu được đánh dấu nổi bật.
2. **Given** hai người cùng áp dụng thay đổi lên một môi trường, **When** người thứ hai bắt đầu, **Then** bị từ
   chối vì trạng thái đang bị khóa; không có trạng thái hỏng.
3. **Given** một thay đổi chưa từng áp dụng ở thử nghiệm, **When** thành viên định áp dụng lên phát hành,
   **Then** quy trình (tài liệu + kiểm tra tự động hoặc bước duyệt) không cho phép.
4. **Given** ai đó sửa tay một thuộc tính tài nguyên trên bảng điều khiển của nhà cung cấp, **When** chạy kiểm
   tra lệch, **Then** thuộc tính bị lệch được báo ra kèm tên tài nguyên.
5. **Given** kho mã và lịch sử thay đổi, **When** chạy quét bí mật, **Then** không tìm thấy mật khẩu, khóa truy
   cập hay mã quyền nào trong mã hạ tầng, tệp tham số hay bản xem trước đã lưu.

---

### User Story 4 - Diễn tập khôi phục CSDL ra môi trường riêng và đo thời gian (Priority: P4)

Mỗi quý, SA dựng một môi trường tạm từ cùng bộ định nghĩa, khôi phục CSDL phát hành về một thời điểm chọn
trước, chạy kiểm tra, ghi lại thời gian, rồi hủy môi trường tạm.

**Why this priority**: Hiến pháp bắt buộc diễn tập mỗi quý; mục tiêu "khôi phục ≤ 1 giờ" chưa đo thì chưa có.
Chỉ làm được sau khi US2 xong.

**Independent Test**: Ghi một dòng đánh dấu vào CSDL (thử nghiệm cũng được), chờ 10 phút, xóa dòng đó; khôi
phục về thời điểm trước khi xóa ra môi trường tạm; kiểm tra dòng đánh dấu còn; đo tổng thời gian.

**Acceptance Scenarios**:

1. **Given** CSDL đang chạy và có sao lưu liên tục, **When** SA yêu cầu khôi phục về một thời điểm trong 7 ngày
   gần nhất ra môi trường tạm, **Then** CSDL khôi phục chứa dữ liệu đến đúng thời điểm đó (sai lệch ≤ 5 phút),
   và tổng thời gian từ lúc bắt đầu đến lúc truy vấn được ≤ 1 giờ.
2. **Given** môi trường tạm đang chạy, **When** kiểm tra kết nối ra ngoài, **Then** nó không gửi được email
   thật, không gọi được nền tảng mạng xã hội hay nhà cung cấp AI, và không có địa chỉ công khai.
3. **Given** diễn tập xong, **When** SA hủy môi trường tạm, **Then** không còn tài nguyên nào tính phí và bản
   sao dữ liệu khách hàng đã bị xóa; kết quả (thời điểm, thời gian đo, người thực hiện) được ghi lại.

---

### Edge Cases

- **P6 chưa xong hoặc VNG Cloud không đạt 3 điểm xác minh**: định nghĩa hạ tầng vẫn kiểm tra tĩnh được không
  cần tài khoản đám mây; phần phụ thuộc nhà cung cấp gom vào một lớp để đổi sang nhà cung cấp trong nước khác
  không phải viết lại phần chạy trên Kubernetes.
- **Nhà cung cấp không có khôi phục theo thời điểm**: đổi tham số biến thể CSDL sang CloudNativePG; ứng dụng
  không đổi gì ngoài địa chỉ kết nối; sao lưu liên tục ghi vào một kho tệp **riêng**, không chung với media.
- **Quy trình dựng lỗi giữa chừng** (hết hạn mức, lỗi mạng): chạy lại tiếp tục từ chỗ dở, không tạo tài nguyên
  trùng, không để lại tài nguyên mồ côi không được theo dõi.
- **Hai người cùng áp dụng** lên một môi trường: người sau bị chặn bởi khóa trạng thái.
- **Mất tệp trạng thái hạ tầng**: trạng thái có lưu phiên bản; có hướng dẫn khôi phục phiên bản trước.
- **Chứng chỉ HTTPS sắp hết hạn**: tự gia hạn; nếu gia hạn thất bại, có tín hiệu để H3 cảnh báo trước ≥ 14 ngày.
- **Nhà cung cấp chỉ có một vùng sẵn sàng**: các bản `api`/`worker` trải trên các máy khác nhau; ghi nhận rủi
  ro còn lại vào tài liệu.
- **Dữ liệu khách hàng thật bị đưa sang thử nghiệm**: không có đường mạng hay quyền nào giữa hai môi trường;
  tài liệu vận hành cấm sao chép dữ liệu phát hành sang thử nghiệm.
- **Người dùng xóa nhầm tệp / luật vòng đời xóa nhầm**: phiên bản cũ còn giữ 7 ngày.
- **Đổi khóa mã hóa**: dữ liệu mã hóa bằng phiên bản khóa cũ vẫn giải mã được sau khi xoay khóa.
- **Thử nghiệm bị bên ngoài dò quét**: thử nghiệm phải công khai (Meta cần truy cập) nhưng không được lập chỉ
  mục tìm kiếm và không chứa dữ liệu khách hàng thật.
- **Chi phí thử nghiệm phình ra**: thử nghiệm có trần kích thước trong tham số; chi phí hai môi trường xem được
  riêng nhờ nhãn.

## Requirements *(mandatory)*

### Functional Requirements

**Môi trường và cách định nghĩa**

- **FR-001**: Toàn bộ hạ tầng MUST được mô tả bằng mã Terraform lưu trong kho mã của dự án; MUST NOT có tài
  nguyên nào của dự án được tạo bằng tay trên bảng điều khiển, trừ các bước khởi tạo một lần được liệt kê
  trong tài liệu (tài khoản, hạn mức, nơi lưu trạng thái).
- **FR-002**: MUST có đúng hai môi trường thường trực `staging` và `production`, mỗi môi trường có mạng, cụm
  Kubernetes, CSDL, kho tệp, CDN, khóa mã hóa, kho bí mật và trạng thái hạ tầng **riêng**; MUST NOT dùng chung
  thông tin đăng nhập, khóa hay đường mạng nội bộ giữa hai môi trường.
- **FR-003**: Hai môi trường MUST dựng từ cùng một bộ định nghĩa; khác biệt MUST chỉ nằm ở tệp tham số của
  từng môi trường và giới hạn trong: kích thước và số máy, số bản CSDL, thời gian giữ sao lưu, tên miền, mức
  bảo vệ xóa, danh sách người được phép truy cập quản trị.
- **FR-004**: Quy trình dựng MUST chạy lại được an toàn: chạy lần hai với cùng tham số không tạo thay đổi; chạy
  lại sau khi lỗi giữa chừng tiếp tục được mà không tạo tài nguyên trùng.
- **FR-005**: Trạng thái hạ tầng MUST lưu ở nơi dùng chung đặt trong nước, mã hóa khi lưu, có lưu phiên bản và
  có khóa chống hai người áp dụng cùng lúc; MUST NOT lưu trong kho mã.
- **FR-006**: Mọi tài nguyên MUST gắn nhãn tối thiểu: dự án, môi trường, thành phần – để tách chi phí và tra
  cứu.
- **FR-007**: Mọi tài nguyên lưu dữ liệu (CSDL, kho tệp, sao lưu, nhật ký, trạng thái hạ tầng) MUST đặt tại
  vùng trong nước của nhà cung cấp (ADR-10); định nghĩa MUST từ chối tham số vùng ngoài danh sách cho phép.

**Nơi chạy ứng dụng (Kubernetes)**

- **FR-008**: Mỗi môi trường MUST có một cụm Kubernetes được quản lý, đủ chỗ chạy: `api` 2 bản, `worker` 2 bản
  (từ cùng một ảnh), tác vụ migration chạy một lần, và bộ giám sát của H3. Phát hành MUST chạy trên ≥ 2 máy
  (trải nhiều vùng sẵn sàng nếu nhà cung cấp có) để mất một máy không làm dừng dịch vụ; thử nghiệm được phép
  nhỏ hơn nhưng MUST vẫn chạy được 2 bản mỗi loại.
- **FR-009**: Cụm MUST cung cấp: một lối vào HTTPS công khai duy nhất cho `api` với chứng chỉ tự cấp và tự gia
  hạn; không gian tên tách cho ứng dụng, giám sát và (nếu dùng) CSDL; lưu trữ bền cho thành phần cần; nơi kéo
  ảnh container riêng tư. Điểm quản trị cụm MUST NOT mở cho toàn internet không giới hạn.
- **FR-010**: Kích thước máy của `worker` MUST đủ cho xử lý video tới 500 MB bằng công cụ dòng lệnh trong
  container (bộ nhớ và đĩa tạm), và MUST cho phép tắt có kiểm soát 30 giây khi thay máy.

**CSDL PostgreSQL**

- **FR-011**: Mỗi môi trường MUST có một CSDL PostgreSQL đáp ứng "hợp đồng CSDL" sau, bất kể biến thể: phiên
  bản ≥ 13 và cùng phiên bản chính ở hai môi trường; hỗ trợ Row-Level Security; một địa chỉ kết nối ổn định
  không đổi khi chuyển bản chính; chỉ truy cập được từ mạng nội bộ của chính môi trường đó, bắt buộc mã hóa
  đường truyền; mã hóa khi lưu.
- **FR-012**: Biến thể CSDL (được quản lý / CloudNativePG trên cụm) MUST chọn bằng một tham số, và hai môi
  trường MUST dùng cùng một biến thể. Đổi biến thể MUST NOT đòi hỏi sửa mã ứng dụng.
- **FR-013**: CSDL phát hành MUST có 1 bản chính + 1 bản dự phòng tự lên thay; sao lưu liên tục nhật ký giao
  dịch và bản chụp hằng ngày; khôi phục được về bất kỳ thời điểm nào trong 7 ngày; giữ bản chụp 30 ngày – để
  đạt mất dữ liệu ≤ 5 phút và khôi phục ≤ 1 giờ. Thử nghiệm MUST có cùng cơ chế sao lưu liên tục (để diễn tập
  được), cho phép 1 bản và thời gian giữ ngắn hơn (≥ 3 ngày).
- **FR-014**: Hạ tầng MUST hỗ trợ đúng mô hình vai trò CSDL đã có: thông tin đăng nhập quản trị/`owner` (chỉ
  cho tác vụ migration) tách khỏi `app`, `system`, `support`; mỗi thông tin đăng nhập là một bí mật riêng, mật
  khẩu sinh ngẫu nhiên, khác nhau giữa hai môi trường. `api` MUST NOT nhận được bí mật của `owner` hay
  `system`; `worker` MUST NOT nhận được bí mật của `owner`.
- **FR-015**: Số kết nối tối đa của CSDL MUST đủ cho `api` 2 bản + `worker` 2 bản + hàng chờ + migration +
  giám sát, còn dư ≥ 30%; nếu dùng bộ gom kết nối thì MUST giữ đúng hành vi biến phiên đặt ở phạm vi giao dịch.

**Kho tệp và CDN**

- **FR-016**: Mỗi môi trường MUST có kho tệp media tương thích S3, **riêng tư hoàn toàn** (không đọc/liệt kê
  công khai); bật lưu phiên bản, phiên bản đã xóa giữ 7 ngày rồi xóa hẳn; tệp mang nhãn `lifecycle=tmp` tự xóa
  sau 1 ngày; phần tải lên nhiều phần bị bỏ dở tự dọn sau ≤ 7 ngày; mã hóa khi lưu.
- **FR-017**: Kho tệp media MUST cho phép trình duyệt tải lên và tải xuống thẳng bằng đường dẫn ký sẵn từ đúng
  nguồn gốc giao diện của môi trường đó (không cho phép nguồn gốc bất kỳ), kể cả tải nhiều phần cho tệp tới
  500 MB.
- **FR-018**: Thông tin truy cập kho tệp cấp cho ứng dụng MUST chỉ có quyền trên kho tệp media của chính môi
  trường đó (đọc, ghi, xóa, gắn nhãn đối tượng); MUST NOT có quyền đổi cấu hình kho tệp, và MUST NOT chạm được
  kho tệp sao lưu CSDL hay nơi lưu trạng thái hạ tầng.
- **FR-019**: Giao diện web tĩnh MUST được phục vụ qua CDN trong nước bằng HTTPS trên tên miền của môi trường:
  tệp có mã băm trong tên cache 1 năm; tệp vào (`index.html`) không cache dài để bản phát hành mới có hiệu lực
  ngay; đường dẫn không tồn tại trả về tệp vào (ứng dụng một trang).
- **FR-020**: Media xem trước MUST phân phối được qua CDN bằng đường dẫn ký sẵn có thời hạn ≤ 1 giờ; CDN MUST
  NOT phục vụ nội dung quá thời hạn đường dẫn, và MUST NOT cho truy cập tệp media khi không có chữ ký hợp lệ.
  Nếu CDN của nhà cung cấp không đáp ứng được hai điều này thì media xem trước đi thẳng từ kho tệp, CDN chỉ
  phục vụ giao diện.

**Khóa mã hóa và bí mật**

- **FR-021**: Mỗi môi trường MUST có một khóa mã hóa riêng trong dịch vụ quản lý khóa của nhà cung cấp, dùng
  để mã hóa mã quyền truy cập nền tảng mạng xã hội; khóa không xuất ra ngoài dịch vụ; xoay khóa định kỳ
  (≤ 12 tháng) mà dữ liệu cũ vẫn giải mã được; chỉ danh tính của ứng dụng (`api`, `worker`) của chính môi
  trường đó được mã hóa/giải mã, mọi lần dùng khóa có nhật ký.
- **FR-022**: Mọi bí mật (mật khẩu CSDL, khóa truy cập kho tệp, bí mật ứng dụng như khóa chống dò đăng nhập,
  thông tin SMTP, khóa nhà cung cấp AI và nền tảng về sau) MUST nằm trong kho bí mật của môi trường, đến ứng
  dụng lúc chạy; MUST NOT xuất hiện dạng rõ trong kho mã, tệp tham số, bản xem trước, đầu ra của quy trình
  dựng hay nhật ký. Bí mật do bên ngoài cấp (SMTP, AI, Meta, Zalo) được nhập bằng một thao tác có tài liệu,
  không đi qua kho mã.
- **FR-023**: Quyền quản trị hạ tầng MUST theo cá nhân và theo môi trường: quyền áp dụng lên phát hành hẹp
  hơn thử nghiệm; thao tác quản trị trên tài khoản đám mây MUST có nhật ký.

**Bàn giao, an toàn thay đổi, vận hành**

- **FR-024**: Mỗi môi trường MUST xuất ra danh sách đầu ra không bí mật đủ cho H2/H3 cấu hình ứng dụng: địa
  chỉ cụm, địa chỉ `api` và giao diện, địa chỉ CSDL, tên kho tệp và điểm cuối S3, địa chỉ CDN, định danh khóa
  mã hóa, tên/đường dẫn của từng bí mật, không gian tên. Danh sách này MUST khớp với các biến cấu hình mà ứng
  dụng hiện đọc.
- **FR-025**: Tài nguyên chứa dữ liệu của phát hành (CSDL, kho tệp media, kho sao lưu, khóa mã hóa, nơi lưu
  trạng thái) MUST có bảo vệ chống xóa/thay thế; gỡ bảo vệ MUST là một thay đổi riêng.
- **FR-026**: MUST có bản xem trước thay đổi cho từng môi trường trước khi áp dụng; áp dụng lên phát hành MUST
  cần người thứ hai duyệt và MUST đã áp dụng cùng thay đổi lên thử nghiệm trước.
- **FR-027**: MUST có kiểm tra tự động chạy được không cần tài khoản đám mây (định dạng, hợp lệ, luật an toàn
  cơ bản: không kho tệp công khai, không CSDL mở ra internet, không bí mật trong mã) và MUST có cách phát hiện
  lệch giữa mã và hạ tầng thật.
- **FR-028**: MUST dựng và hủy được một môi trường tạm cho diễn tập khôi phục từ cùng bộ định nghĩa, bị cô
  lập mạng ra ngoài (không gửi email thật, không gọi nền tảng/AI), không có địa chỉ công khai.
- **FR-029**: Thử nghiệm MUST chạy với các bản giả lập của Cổng nền tảng / Cổng AI / Thông báo theo mặc định
  và email đi vào hộp thư bắt giữ, cho đến khi tính năng tương ứng bật bản thật bằng cấu hình; MUST gắn chỉ
  dẫn không lập chỉ mục tìm kiếm.
- **FR-030**: MUST có tài liệu vận hành bằng tiếng Việt: khởi tạo lần đầu, dựng một môi trường, triển khai
  ảnh và kiểm tra khói, quy trình thay đổi, nhập và xoay bí mật, xoay khóa, khôi phục theo thời điểm, xử lý
  khi quy trình dựng lỗi/trạng thái bị khóa, chuyển biến thể CSDL, danh sách phần phụ thuộc nhà cung cấp.
- **FR-031**: Phần định nghĩa phụ thuộc nhà cung cấp MUST tách khỏi phần chạy trên Kubernetes, và phiên bản
  công cụ cùng các thành phần bên ngoài MUST được cố định, để đổi nhà cung cấp trong nước chủ yếu là thay lớp
  nhà cung cấp và tham số (nguyên tắc IX).
- **FR-032**: Tính năng này MUST NOT thêm máy chủ cache phân tán, hệ thống tin nhắn hay dịch vụ nào ngoài bảng
  ngăn xếp công nghệ của hiến pháp (ADR-08, nguyên tắc IX).

### Key Entities

- **Môi trường**: một bộ tài nguyên độc lập (`staging`, `production`, hoặc tạm cho diễn tập); thuộc tính: tên,
  vùng, tên miền, bộ tham số kích thước, mức bảo vệ xóa, biến thể CSDL.
- **Bộ tham số môi trường**: các giá trị được phép khác nhau giữa môi trường (FR-003); không chứa bí mật.
- **Trạng thái hạ tầng**: bản ghi tài nguyên đã tạo của một môi trường; có phiên bản, có khóa, lưu trong nước.
- **Cụm chạy ứng dụng**: nơi chạy `api`, `worker`, migration, giám sát; có nhóm máy, không gian tên, lối vào.
- **CSDL**: một cơ sở dữ liệu PostgreSQL cho mỗi môi trường, theo hợp đồng CSDL; kèm chính sách sao lưu.
- **Kho tệp**: kho media (riêng tư, theo tiền tố tenant), kho giao diện tĩnh, kho sao lưu CSDL (nếu tự vận
  hành), nơi lưu trạng thái – mỗi loại tách riêng, có luật vòng đời riêng.
- **Điểm phân phối CDN**: tên miền, nguồn, luật cache cho giao diện và (nếu đạt FR-020) media xem trước.
- **Khóa mã hóa**: khóa của môi trường cho mã quyền nền tảng; có phiên bản, lịch xoay, danh sách danh tính
  được dùng.
- **Bí mật**: tên, mục đích, thành phần được đọc (`api` / `worker` / migration), nguồn (tự sinh / nhập từ bên
  ngoài), lần xoay gần nhất.
- **Đầu ra bàn giao**: danh sách giá trị không bí mật của một môi trường cho H2/H3.
- **Bản ghi diễn tập khôi phục**: ngày, thời điểm khôi phục về, thời gian đo, kết quả, người thực hiện.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Một thành viên chưa từng dựng hạ tầng, chỉ theo tài liệu, dựng xong môi trường thử nghiệm từ tài
  khoản trống trong ≤ 2 giờ, với 0 thao tác bấm tay ngoài danh sách khởi tạo một lần.
- **SC-002**: Chạy lại quy trình dựng trên môi trường không đổi cho kết quả 0 thay đổi, ở cả hai môi trường.
- **SC-003**: Ảnh container hiện có chạy trên thử nghiệm với 100% mục của bộ kiểm tra khói đạt: `api` và
  `worker` báo khỏe, đăng nhập được, tải tệp 100 MB thẳng lên kho tệp được, giao diện mở qua HTTPS.
- **SC-004**: Danh sách thành phần của hai môi trường trùng nhau 100%; mọi khác biệt truy được về một dòng
  trong tệp tham số.
- **SC-005**: 100% phép thử dùng thông tin đăng nhập / đường mạng của môi trường này để chạm tài nguyên của
  môi trường kia đều bị từ chối (CSDL, kho tệp, khóa mã hóa, bí mật).
- **SC-006**: Khôi phục CSDL về một thời điểm chọn trước ra môi trường tạm hoàn tất trong ≤ 1 giờ, dữ liệu mất
  ≤ 5 phút so với thời điểm chọn; kết quả lần đo đầu tiên được ghi lại trước ngày ra mắt.
- **SC-007**: Tắt đột ngột một máy chạy ứng dụng ở phát hành: người dùng không thấy gián đoạn quá 1 phút, hệ
  thống tự về đủ số bản trong ≤ 5 phút; hỏng bản chính CSDL: dịch vụ trở lại trong ≤ 5 phút, không ai phải đổi
  cấu hình.
- **SC-008**: Quét bí mật trên kho mã, tệp tham số, bản xem trước và đầu ra của quy trình dựng tìm thấy 0 bí
  mật dạng rõ.
- **SC-009**: 0 kho tệp đọc được công khai; 0 CSDL kết nối được từ internet; 100% tài nguyên lưu dữ liệu nằm ở
  vùng trong nước – kiểm bằng phép thử từ bên ngoài và bằng kiểm tra tự động.
- **SC-010**: Tệp media đã xóa khôi phục được trong 7 ngày; tệp tạm biến mất sau ≤ 2 ngày kể từ khi tải lên.
- **SC-011**: 100% thay đổi hạ tầng của phát hành có bản xem trước được một người khác duyệt và đã chạy ở thử
  nghiệm trước; một thay đổi sửa tay trên bảng điều khiển được phát hiện trong ≤ 24 giờ.
- **SC-012**: Chi phí hạ tầng hằng tháng của thử nghiệm ≤ 40% của phát hành, và xem được tách riêng theo môi
  trường.
- **SC-013**: Đổi biến thể CSDL hoặc đổi nhà cung cấp kho tệp không đòi hỏi sửa một dòng mã ứng dụng nào – chỉ
  đổi cấu hình.
- **SC-014**: Dung lượng dựng sẵn của phát hành chịu được tải giai đoạn 1 (100 tài khoản, ~3.000 lượt đăng và
  ~50 GB media mỗi tháng); lên gấp 10 chỉ cần đổi tham số kích thước, không đổi thành phần.

## Assumptions

- **Nhà cung cấp**: viết cho VNG Cloud (ưu tiên theo T4/ADR-10). P6 chưa có kết luận tại ngày viết; nếu VNG
  Cloud không đạt, lớp nhà cung cấp được viết lại cho FPT Cloud, các yêu cầu trong đặc tả này giữ nguyên.
  Dựng thật chỉ bắt đầu khi P6 xong; viết định nghĩa và kiểm tra tĩnh làm trước được.
- **Vì sao tách hẳn hai môi trường thay vì chung cụm chia namespace**: (a) nguyên tắc I và VII – dữ liệu và
  khóa của khách hàng thật không được nằm cùng ranh giới quyền với nơi thử nghiệm; (b) thử nâng cấp cụm, đổi
  CSDL, diễn tập sự cố ở thử nghiệm không thể làm hỏng phát hành; (c) Worker xử lý video ở thử nghiệm không
  tranh tài nguyên với phát hành. Đánh đổi là chi phí thêm một cụm nhỏ – chấp nhận, giới hạn bằng SC-012.
- **Vì sao chỉ hai môi trường**: đội 3–4 người; máy cá nhân (docker compose) đã là môi trường phát triển; thêm
  môi trường thứ ba là công vận hành không có lợi ích tương xứng (nguyên tắc IX).
- **Vì sao thử nghiệm dùng cùng biến thể CSDL với phát hành**: sự khác nhau giữa CSDL được quản lý và
  CloudNativePG (kết nối, sao lưu, chuyển bản chính) là đúng loại lỗi mà thử nghiệm phải bắt được.
- **Vai trò CSDL**: bốn vai trò `owner`/`app`/`system`/`support` vẫn do bước khởi tạo CSDL sẵn có của ứng dụng
  tạo (tính năng 002); hạ tầng cung cấp CSDL, thông tin quản trị ban đầu và việc sinh/giao bí mật cho từng vai
  trò, không định nghĩa lại quyền.
- **Triển khai ứng dụng**: trong tính năng này ảnh container được triển khai bằng tay theo tài liệu để kiểm tra
  khói; tự động hóa thuộc H2. Bộ giám sát thuộc H3; ở đây chỉ dành không gian tên, tài nguyên và lưu trữ.
- **Tên miền**: PM cung cấp một tên miền gốc; mỗi môi trường dùng tên miền con riêng cho giao diện, `api` và
  CDN. Thử nghiệm phải truy cập công khai được vì người xét duyệt của Meta cần vào.
- **Kích thước ban đầu**: lấy theo tải giai đoạn 1 (100 tài khoản, CSDL vài GB, ~50 GB media, ~600 GB băng
  thông ra mỗi tháng); con số cụ thể chốt ở kế hoạch sau khi có báo giá.
- **Sao lưu kho tệp**: giai đoạn 1 dựa vào lưu phiên bản 7 ngày và độ bền của dịch vụ; không sao chép sang
  vùng thứ hai.
- **Email**: Amazon SES là dịch vụ ngoài, không dựng bằng tính năng này; thông tin SMTP là bí mật nhập vào
  (FR-022). Thử nghiệm dùng hộp thư bắt giữ để không gửi nhầm cho người thật.
- **Cấp quyền cho ứng dụng dùng khóa và kho tệp**: dùng cơ chế danh tính theo tải công việc nếu nhà cung cấp
  có; nếu không thì dùng khóa truy cập tĩnh lưu trong kho bí mật và xoay định kỳ.
- **Kho bí mật**: dùng dịch vụ của nhà cung cấp nếu có; nếu không thì dùng bí mật của Kubernetes được mã hóa
  khi lưu bằng khóa của dịch vụ quản lý khóa. Cả hai đều thỏa FR-022; lựa chọn chốt ở kế hoạch.
- **Tuân thủ**: tính năng này không thêm bên nhận dữ liệu mới ở nước ngoài; danh sách chuyển dữ liệu xuyên
  biên giới không đổi.
