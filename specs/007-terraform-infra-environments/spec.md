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

**Phụ thuộc**: P6 (báo giá và mở tài khoản VNG Cloud – nhà cung cấp đã chọn theo ADR-11, Clarifications
2026-11-13; xác minh 3 điểm của T4) – là điều kiện để *dựng thật*; phần định nghĩa hạ tầng phải viết và kiểm
tra tĩnh được trước khi có tài khoản · `001`–`006` (ảnh
container chạy cả `api` lẫn `worker`, danh sách biến cấu hình, bốn vai trò CSDL `owner`/`app`/`system`/
`support`, bố cục kho tệp `tenants/{accountId}/…`, kho tệp qua giao diện S3).

**Bối cảnh**: Đến nay ứng dụng chỉ chạy trên máy lập trình viên (docker compose). Đợt 1 cần một nơi chạy
giống thật để: nộp App Review của Meta (cần đường dẫn HTTPS công khai), chạy POC đăng bài, kiểm thử tích hợp
và diễn tập sự cố. Trước ngày ra mắt cần môi trường phát hành đạt các chỉ số phi chức năng. Người vận hành
là **một cá nhân** chưa quen vận hành đám mây và cần tối ưu chi phí (Clarifications 2026-11-13), nên hạ tầng
phải ưu tiên dịch vụ được quản lý, **dựng lại được từ mã**, **hai môi trường giống nhau về
hình dạng**, và **không ai phải bấm tay trên bảng điều khiển của nhà cung cấp**.

**Quyết định của SA áp dụng trong đặc tả này** (lý do ở mục Assumptions):

1. **Hai môi trường**: `staging` (thử nghiệm) và `production` (phát hành), **tách hoàn toàn** – mỗi môi
   trường có mạng, cụm Kubernetes, CSDL, kho tệp, CDN, khóa mã hóa và bí mật riêng. Không dùng chung cụm và
   chia namespace. Phát hành chạy thường trực; **thử nghiệm bật khi cần, tắt khi không dùng** để tiết kiệm
   (FR-034).
2. **Cùng một bộ định nghĩa, khác tham số**: thử nghiệm là bản thu nhỏ của phát hành (ít máy hơn, CSDL không
   cần bản dự phòng, giữ sao lưu ngắn hơn) nhưng **cùng thành phần, cùng phiên bản, cùng biến thể CSDL**.
3. **Biến thể CSDL chọn bằng một tham số**: khởi đầu bằng **CloudNativePG trên cụm Kubernetes** (không trả
   thêm tiền dịch vụ); chuyển sang CSDL được quản lý của nhà cung cấp khi đã xác minh khôi phục theo thời điểm
   và chi phí cho phép. Hai biến thể đáp ứng cùng một "hợp đồng CSDL" (FR-011).
4. **Môi trường diễn tập khôi phục** là môi trường tạm, dựng từ cùng bộ định nghĩa trong project của phát
   hành (mạng và cụm riêng), hủy sau khi đo xong.

**Ngoài phạm vi** (thuộc đầu việc khác): quy trình tích hợp và triển khai tự động, dựng và đẩy ảnh container,
định nghĩa triển khai `api`/`worker`/chạy migration (WBS H2) – riêng việc chạy tự động kiểm tra tĩnh và kiểm
tra lệch của mã hạ tầng thì **thuộc** tính năng này (FR-027); cài đặt và cấu hình bộ giám sát Prometheus / Loki
/ Tempo / Grafana / GlitchTip, bảng điều khiển và cảnh báo (WBS H3) – tính năng này chỉ **dành sẵn chỗ và tài
nguyên** cho chúng; tài khoản Amazon SES, ứng dụng Meta/Zalo/Google (P5); tên miền mua mới và hợp đồng nhà
cung cấp (P6); kiểm thử tải (đợt 4); nhiều vùng địa lý, tự mở rộng số máy theo tải, môi trường riêng cho từng
nhánh mã.

## Clarifications

### Session 2026-11-13

- Q: Sau khi lập kế hoạch và phân tích (2026-11-14), phạm vi đặc tả có thay đổi gì? → A: Có, ghi lại để truy vết: (1) danh sách
  khởi tạo một lần dài hơn FR-001 ban đầu vì provider VNG Cloud thiếu tài nguyên cho IAM, KMS, CDN, kho ảnh và bucket;
  (2) giao diện phục vụ từ ảnh `web` trong cụm, CDN kéo từ đó (xem lại khi V3 đạt); (3) kiểm tra lệch tự động trên GitHub
  chỉ phủ stack `cloud` (API cụm chỉ mở cho địa chỉ quản trị); (4) review thay đổi do chính người vận hành thực hiện nên
  được thay bằng ba lớp chặn của công cụ và bản ghi áp dụng. Chi tiết: `plan.md` mục Theo dõi độ phức tạp.

- Q: Hạ tầng có gắn với VNG Cloud không? → A: Không. Chủ dự án giữ quyền chọn linh hoạt nhà cung cấp đám
  mây; VNG Cloud chỉ là ứng viên ưu tiên theo T4, không phải ràng buộc của đặc tả này. Ràng buộc "dữ liệu lưu
  trữ đặt trong nước" (ADR-10, nguyên tắc VII) vẫn giữ nguyên – chọn nhà cung cấp ngoài nước cần ADR mới.
- Q: Lớp nhà cung cấp đầu tiên viết cho nhà cung cấp nào? → A: **VNG Cloud**. Chủ dự án đã cân nhắc iNET
  (inet.vn); bản đánh giá `adr-11-nha-cung-cap-ha-tang.md` cho thấy iNET không có Kubernetes được quản lý, dịch
  vụ quản lý khóa, cân bằng tải, CDN riêng và Terraform provider (tài liệu công khai 2026-11-13), nên chủ dự
  án chọn VNG Cloud cho toàn bộ hạ tầng.
- Q: Ai vận hành hạ tầng và ưu tiên gì? → A: Một cá nhân (chủ dự án), chưa quen vận hành đám mây, muốn học
  quy trình triển khai, cần tối ưu chi phí. Ba biện pháp giảm chi phí được chấp nhận: (1) môi trường thử
  nghiệm bật khi cần, tắt khi không dùng; (2) CSDL khởi đầu bằng CloudNativePG trên cụm, chưa dùng CSDL được
  quản lý; (3) phát hành khởi đầu với 2 máy, tăng theo tải thật.
- Q: Làm một mình thì thay đổi lên phát hành được kiểm soát thế nào thay cho "người thứ hai duyệt"? → A: Tự
  duyệt có kiểm soát – (1) thay đổi phải đã áp dụng thành công ở thử nghiệm; (2) bản xem trước của phát hành
  được lưu lại và chỉ đúng bản đó được áp dụng; (3) kiểm tra tự động chặn mọi thao tác xóa/thay thế tài nguyên
  chứa dữ liệu, trừ khi có xác nhận riêng.
- Q: Hai môi trường nằm chung một tài khoản VNG Cloud hay ở hai tài khoản riêng? → A: Chung **một tài khoản**.
  Mỗi môi trường có project (hoặc nhóm tài nguyên) riêng, mạng riêng và tài khoản dịch vụ Terraform riêng chỉ
  có quyền trong môi trường đó; chi phí tách bằng nhãn.
- Q: Môi trường tạm diễn tập khôi phục CSDL phát hành được dựng ở đâu? → A: Trong **project của phát hành**,
  với mạng và cụm tạm riêng, chỉ được đọc kho sao lưu; hủy sau khi đo xong. Không dựng trong cụm phát hành
  và không dựng ở thử nghiệm.
- Q: Ba lớp chặn khi áp dụng lên phát hành và kiểm tra lệch hằng ngày chạy ở đâu? → A: Kết hợp. Xem trước và
  áp dụng chạy trên máy của người vận hành bằng script có ba lớp chặn; kiểm tra tĩnh và kiểm tra lệch hằng
  ngày chạy tự động theo lịch bằng một tài khoản dịch vụ chỉ đọc. Quyền ghi lên phát hành không đặt trên hệ
  thống tự động.
- Q: Bản ghi DNS của từng môi trường do Terraform quản lý hay tạo tay một lần? → A: Tạo tay **một lần** ở nơi
  đăng ký tên miền, thuộc danh sách khởi tạo một lần. Quy trình dựng in ra đúng các bản ghi cần tạo và có
  bước kiểm tra tự động rằng tên miền đã trỏ đúng. Chủ dự án yêu cầu phần này được viết thành tài liệu hướng
  dẫn triển khai từng bước.
- Q: Kho ảnh container dùng chung hay riêng cho từng môi trường? → A: **Một kho dùng chung**, nằm ngoài hai
  môi trường. Cụm của mỗi môi trường chỉ có quyền kéo ảnh; thẻ ảnh không ghi đè được; phát hành chạy đúng ảnh
  đã kiểm ở thử nghiệm.

## User Scenarios & Testing *(mandatory)*

Người dùng của tính năng này là **người vận hành** – chủ dự án làm một mình, kiêm vai SA, phát triển và kiểm
thử (các kịch bản dưới gọi là "SA"). Giá trị cho chủ kinh doanh đến gián tiếp:
dữ liệu của họ nằm trong nước, không mất quá 5 phút dữ liệu khi sự cố, và bản phát hành nào cũng đã chạy
trước trên một môi trường giống thật.

### User Story 1 - SA dựng môi trường thử nghiệm từ mã để có nơi chạy giống thật (Priority: P1)

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
   đổi riêng, có chủ đích và có bản ghi áp dụng.

---

### User Story 3 - Thay đổi hạ tầng đi qua thử nghiệm trước, có bản xem trước và tự duyệt có kiểm soát (Priority: P3)

Người vận hành cần đổi hạ tầng (tăng kích thước máy, thêm luật vòng đời tệp, nâng phiên bản Kubernetes). Họ
sửa mã, xem bản xem trước thay đổi, áp dụng lên thử nghiệm, kiểm tra, rồi mới áp dụng lên phát hành. Vì chỉ
có một người, lớp chặn không phải là người thứ hai mà là ba điều kiện bắt buộc: đã chạy ở thử nghiệm, chỉ áp
dụng đúng bản xem trước đã lưu, và thao tác xóa/thay thế tài nguyên chứa dữ liệu phải được xác nhận riêng.

**Why this priority**: Ngăn sự cố do sửa tay và do "chỉ đổi ở production". Cần có trước khi phát hành thật,
nhưng US1 vẫn có giá trị khi chưa có quy trình này.

**Independent Test**: Tạo một thay đổi nhỏ (ví dụ thêm nhãn), xem bản xem trước ở cả hai môi trường; áp dụng ở
thử nghiệm; thử áp dụng thẳng lên phát hành một thay đổi chưa chạy ở thử nghiệm → bị chặn; thử áp dụng khi mã đã đổi so
với bản xem trước đã lưu → bị chặn; sửa tay một thuộc tính trên
bảng điều khiển rồi chạy kiểm tra lệch → phát hiện được.

**Acceptance Scenarios**:

1. **Given** một thay đổi mã hạ tầng, **When** người vận hành yêu cầu bản xem trước cho một môi trường, **Then**
   nhận được danh sách tài nguyên sẽ tạo / sửa / thay thế / xóa, trong đó thao tác thay thế hoặc xóa tài nguyên
   chứa dữ liệu được đánh dấu nổi bật.
2. **Given** hai người cùng áp dụng thay đổi lên một môi trường, **When** người thứ hai bắt đầu, **Then** bị từ
   chối vì trạng thái đang bị khóa; không có trạng thái hỏng.
3. **Given** một thay đổi chưa từng áp dụng thành công ở thử nghiệm, **When** người vận hành định áp dụng lên
   phát hành, **Then** kiểm tra tự động không cho phép.
4. **Given** một bản xem trước của phát hành đã lưu, **When** mã hoặc tham số thay đổi sau đó rồi người vận
   hành yêu cầu áp dụng, **Then** bị từ chối và phải tạo bản xem trước mới.
5. **Given** bản xem trước của phát hành có thao tác xóa hoặc thay thế CSDL, kho tệp, kho sao lưu hay khóa mã
   hóa, **When** người vận hành yêu cầu áp dụng theo cách thông thường, **Then** bị chặn kèm danh sách tài
   nguyên bị ảnh hưởng; chỉ đi tiếp được bằng một bước xác nhận riêng, có ghi lại.
6. **Given** ai đó sửa tay một thuộc tính tài nguyên trên bảng điều khiển của nhà cung cấp, **When** chạy kiểm
   tra lệch, **Then** thuộc tính bị lệch được báo ra kèm tên tài nguyên.
7. **Given** kho mã và lịch sử thay đổi, **When** chạy quét bí mật, **Then** không tìm thấy mật khẩu, khóa truy
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
   thật, không gọi được nền tảng mạng xã hội hay nhà cung cấp AI, không có địa chỉ công khai, và không ghi
   hay xóa được gì trong kho sao lưu của phát hành.
3. **Given** diễn tập xong, **When** SA hủy môi trường tạm, **Then** không còn tài nguyên nào tính phí và bản
   sao dữ liệu khách hàng đã bị xóa; kết quả (thời điểm, thời gian đo, người thực hiện) được ghi lại.

---

### Edge Cases

- **Phạm vi của kiểm tra lệch tự động**: quy trình trên GitHub chỉ kiểm stack `cloud` (mạng, cụm, cân bằng tải, kho
  tệp) vì API cụm chỉ mở cho địa chỉ quản trị. Lệch bên trong cụm (ví dụ `kubectl edit`) chỉ lộ ra ở lần `plan` kế tiếp
  hoặc khi chạy `pnpm infra drift <env>` trên máy người vận hành; khuyến nghị chạy hằng tuần. SC-011 (24 giờ) áp dụng
  cho phần `cloud`.

- **P6 chưa xong, hoặc chủ dự án đổi nhà cung cấp** (trước hay sau khi đã dựng): định nghĩa hạ tầng vẫn kiểm
  tra tĩnh được không cần tài khoản đám mây; phần phụ thuộc nhà cung cấp gom vào một lớp có hợp đồng đầu
  vào/đầu ra cố định (FR-031), nên đổi nhà cung cấp là viết lại đúng lớp đó, không đụng phần chạy trên
  Kubernetes, tệp tham số môi trường hay mã ứng dụng.
- **Nhà cung cấp được chọn thiếu một năng lực** (không có CSDL được quản lý đạt hợp đồng, CDN không ký được
  đường dẫn, không có kho bí mật, không có danh tính theo tải công việc): mỗi năng lực có phương án dự phòng
  chạy trên Kubernetes hoặc chuẩn mở đã nêu ở FR-012, FR-020 và Assumptions; thiếu năng lực **bắt buộc**
  (FR-033) thì nhà cung cấp đó bị loại.
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
  trong tài liệu (tài khoản và hạn mức, project, tài khoản dịch vụ cùng chính sách, khóa truy cập kho tệp, khóa mã
  hóa KMS, điểm phân phối CDN, kho ảnh cùng tài khoản robot, nơi lưu trạng thái, bản ghi DNS của từng môi trường
  ở nơi đăng ký tên miền); mỗi mục của danh sách đó MUST có phép kiểm tự động (`pnpm infra bootstrap-check`). Terraform MUST NOT quản lý vùng DNS; quy trình dựng MUST in ra đầy đủ các bản ghi DNS cần tạo (tên,
  loại, giá trị) và MUST có một bước kiểm tra tự động xác nhận từng tên miền đã trỏ đúng, báo rõ bản ghi nào
  còn thiếu hoặc sai.
- **FR-002**: MUST có đúng hai môi trường `staging` và `production` (phát hành thường trực; thử nghiệm bật
  theo nhu cầu – FR-034), mỗi môi trường có mạng, cụm
  Kubernetes, CSDL, kho tệp, CDN, khóa mã hóa, kho bí mật và trạng thái hạ tầng **riêng**; MUST NOT dùng chung
  thông tin đăng nhập, khóa hay đường mạng nội bộ giữa hai môi trường. Hai môi trường nằm trong **cùng một
  tài khoản đám mây**, mỗi môi trường một project (hoặc nhóm tài nguyên) riêng. Ngoại lệ duy nhất được dùng
  chung là kho ảnh container (FR-009) và nơi lưu trạng thái hạ tầng của chính nó.
- **FR-003**: Hai môi trường MUST dựng từ cùng một bộ định nghĩa; khác biệt MUST chỉ nằm ở tệp tham số của
  từng môi trường và giới hạn trong: kích thước và số máy, số bản CSDL, thời gian giữ sao lưu, tên miền, mức
  bảo vệ xóa, danh sách người được phép truy cập quản trị, định danh (project, mạng, khóa mã hóa) và các công tắc
  riêng của thử nghiệm (FR-029: bắt thư và chặn lập chỉ mục; FR-034: tắt/bật máy).
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
  ảnh container riêng tư. Điểm quản trị cụm MUST NOT mở cho toàn internet không giới hạn. Kho ảnh container
  là **một kho dùng chung** cho mọi môi trường, đặt trong nước, định nghĩa và trạng thái tách khỏi hai môi
  trường: cụm của mỗi môi trường MUST chỉ có quyền kéo ảnh; thẻ ảnh MUST NOT ghi đè được; quyền đẩy ảnh là
  một thông tin đăng nhập riêng, không cấp cho cụm nào; kho ảnh MUST NOT chứa bí mật hay dữ liệu khách hàng.
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
  hơn thử nghiệm; thao tác quản trị trên tài khoản đám mây MUST có nhật ký. Quy trình dựng của mỗi môi trường
  MUST chạy bằng một tài khoản dịch vụ riêng chỉ có quyền trong project của môi trường đó; tài khoản dịch vụ
  của thử nghiệm MUST NOT đọc, sửa hay xóa được tài nguyên nào của phát hành và ngược lại. Thông tin đăng nhập
  gốc của tài khoản đám mây MUST NOT dùng cho quy trình dựng hằng ngày.

**Bàn giao, an toàn thay đổi, vận hành**

- **FR-024**: Mỗi môi trường MUST xuất ra danh sách đầu ra không bí mật đủ cho H2/H3 cấu hình ứng dụng: địa
  chỉ cụm, địa chỉ `api` và giao diện, địa chỉ CSDL, tên kho tệp và điểm cuối S3, địa chỉ CDN, định danh khóa
  mã hóa, tên/đường dẫn của từng bí mật, không gian tên. Danh sách này MUST khớp với các biến cấu hình mà ứng
  dụng hiện đọc.
- **FR-025**: Tài nguyên chứa dữ liệu của phát hành (CSDL, kho tệp media, kho sao lưu, khóa mã hóa, nơi lưu
  trạng thái) MUST có bảo vệ chống xóa/thay thế; gỡ bảo vệ MUST là một thay đổi riêng.
- **FR-026**: MUST có bản xem trước thay đổi cho từng môi trường trước khi áp dụng; áp dụng lên phát hành MUST
  thỏa cả ba điều kiện, được kiểm bằng công cụ chứ không chỉ bằng tài liệu: (a) cùng thay đổi đã áp dụng thành
  công lên thử nghiệm; (b) bản xem trước của phát hành được lưu lại và chỉ đúng bản đó được áp dụng – mã hay
  tham số đổi thì phải xem trước lại; (c) bản xem trước có thao tác xóa/thay thế tài nguyên chứa dữ liệu thì
  bị chặn cho đến khi có một bước xác nhận riêng. Mỗi lần áp dụng lên phát hành MUST để lại bản ghi: thời
  điểm, phiên bản mã, tóm tắt thay đổi. Quy trình MUST NOT đòi hỏi người thứ hai. Xem trước và áp dụng chạy
  trên máy của người vận hành bằng script trong kho mã thực thi ba điều kiện trên; thông tin đăng nhập có
  quyền ghi lên phát hành MUST NOT đặt trên hệ thống chạy tự động.
- **FR-027**: MUST có kiểm tra tự động chạy được không cần tài khoản đám mây (định dạng, hợp lệ, luật an toàn
  cơ bản: không kho tệp công khai, không CSDL mở ra internet, không bí mật trong mã) và MUST có cách phát hiện
  lệch giữa mã và hạ tầng thật. Kiểm tra tĩnh MUST chạy tự động trên mỗi thay đổi mã hạ tầng; kiểm tra lệch
  MUST chạy tự động theo lịch ít nhất mỗi ngày cho mọi môi trường đang bật, bằng một tài khoản dịch vụ **chỉ
  đọc** của từng môi trường, và MUST báo cho người vận hành khi phát hiện lệch hoặc khi lần chạy thất bại.
- **FR-028**: MUST dựng và hủy được một môi trường tạm cho diễn tập khôi phục từ cùng bộ định nghĩa, bị cô
  lập mạng ra ngoài (không gửi email thật, không gọi nền tảng/AI), không có địa chỉ công khai. Khi diễn tập
  với dữ liệu phát hành, môi trường tạm MUST nằm trong project của phát hành, có mạng và cụm riêng (MUST NOT
  chạy trong cụm phát hành, MUST NOT đặt ở thử nghiệm); quyền của nó trên kho sao lưu phát hành MUST chỉ là
  đọc, và nó MUST NOT kết nối được tới CSDL, kho tệp media hay khóa mã hóa đang dùng của phát hành.
- **FR-029**: Thử nghiệm MUST chạy với các bản giả lập của Cổng nền tảng / Cổng AI / Thông báo theo mặc định
  và email đi vào hộp thư bắt giữ, cho đến khi tính năng tương ứng bật bản thật bằng cấu hình; MUST gắn chỉ
  dẫn không lập chỉ mục tìm kiếm.
- **FR-030**: MUST có tài liệu vận hành bằng tiếng Việt, trong đó có một **hướng dẫn triển khai từng bước**
  đi từ tài khoản trống tới môi trường chạy được, gồm cả phần tạo bản ghi DNS bằng tay (tạo bản ghi nào, ở
  đâu, kiểm tra thế nào, làm gì khi chứng chỉ chưa cấp được). Tài liệu bao gồm: khởi tạo lần đầu, dựng một môi trường, triển khai
  ảnh và kiểm tra khói, quy trình thay đổi, nhập và xoay bí mật, xoay khóa, khôi phục theo thời điểm, xử lý
  khi quy trình dựng lỗi/trạng thái bị khóa, chuyển biến thể CSDL, danh sách phần phụ thuộc nhà cung cấp.
- **FR-031**: Định nghĩa hạ tầng MUST NOT gắn với một nhà cung cấp cụ thể. Phần phụ thuộc nhà cung cấp MUST
  gom vào **một lớp nhà cung cấp** có hợp đồng đầu vào/đầu ra cố định (cụm Kubernetes, mạng, kho tệp S3, CDN,
  khóa mã hóa, và – nếu dùng – CSDL được quản lý, kho bí mật); phần chạy trên Kubernetes và tệp tham số môi
  trường MUST chỉ dựa vào hợp đồng đó và vào chuẩn mở (Kubernetes, giao diện S3, PostgreSQL), MUST NOT dùng
  tính năng riêng của một nhà cung cấp. Đổi nhà cung cấp MUST chỉ đòi hỏi viết lại lớp nhà cung cấp. Phiên
  bản công cụ và thành phần bên ngoài MUST được cố định (nguyên tắc IX).
- **FR-033**: MUST có một bảng "năng lực tối thiểu của nhà cung cấp" dùng để chấp nhận hay loại một nhà
  cung cấp trước khi viết lớp của họ. Bắt buộc: vùng dữ liệu trong nước; Kubernetes được quản lý; kho tệp
  tương thích S3 có lưu phiên bản, luật vòng đời và đường dẫn ký sẵn; CDN phục vụ HTTPS trên tên miền riêng;
  dịch vụ quản lý khóa; có cách tự động hóa bằng Terraform. Không bắt buộc (đã có phương án dự phòng): CSDL
  được quản lý đạt hợp đồng CSDL, CDN ký đường dẫn cho media, kho bí mật, danh tính theo tải công việc,
  nhiều vùng sẵn sàng.
- **FR-034**: Môi trường thử nghiệm MUST tắt và bật lại được bằng một thao tác có tài liệu, để không trả tiền
  máy khi không dùng. Khi tắt: không còn máy chạy ứng dụng tính phí; tên miền, địa chỉ công khai, chứng chỉ,
  khóa mã hóa, bí mật và kho tệp được giữ. Khi bật lại: môi trường dùng được trong ≤ 1 giờ, cùng địa chỉ như
  trước, không phải cấu hình lại bên ngoài (Meta, DNS). Dữ liệu CSDL thử nghiệm MUST NOT bị coi là cần giữ –
  được phép dựng lại từ migration và dữ liệu mẫu. Thử nghiệm MUST được giữ bật liên tục trong thời gian Meta
  xét duyệt ứng dụng.
- **FR-032**: Tính năng này MUST NOT thêm máy chủ cache phân tán, hệ thống tin nhắn hay dịch vụ nào ngoài bảng
  ngăn xếp công nghệ của hiến pháp (ADR-08, nguyên tắc IX).

### Key Entities

- **Môi trường**: một bộ tài nguyên độc lập (`staging`, `production`, hoặc tạm cho diễn tập); thuộc tính: tên,
  vùng, tên miền, bộ tham số kích thước, mức bảo vệ xóa, biến thể CSDL.
- **Bộ tham số môi trường**: các giá trị được phép khác nhau giữa môi trường (FR-003); không chứa bí mật.
- **Trạng thái hạ tầng**: bản ghi tài nguyên đã tạo của một môi trường; có phiên bản, có khóa, lưu trong nước.
- **Cụm chạy ứng dụng**: nơi chạy `api`, `worker`, migration, giám sát; có nhóm máy, không gian tên, lối vào.
- **CSDL**: một cơ sở dữ liệu PostgreSQL cho mỗi môi trường, theo hợp đồng CSDL; kèm chính sách sao lưu.
- **Kho tệp**: kho media (riêng tư, theo tiền tố tenant), kho sao lưu CSDL (nếu tự vận hành), nơi lưu trạng thái –
  mỗi loại tách riêng, có luật vòng đời riêng. Giao diện không nằm ở kho tệp: ảnh `web` chạy trong cụm làm nguồn
  cho CDN (xem lại khi xác minh V3 cho thấy CDN đọc được bucket riêng tư).
- **Kho ảnh container**: một kho dùng chung cho mọi môi trường; thuộc tính: địa chỉ, quyền kéo theo cụm,
  quyền đẩy riêng, thẻ ảnh không ghi đè được.
- **Điểm phân phối CDN**: tên miền, nguồn, luật cache cho giao diện và (nếu đạt FR-020) media xem trước.
- **Khóa mã hóa**: khóa của môi trường cho mã quyền nền tảng; có phiên bản, lịch xoay, danh sách danh tính
  được dùng.
- **Bí mật**: tên, mục đích, thành phần được đọc (`api` / `worker` / migration), nguồn (tự sinh / nhập từ bên
  ngoài), lần xoay gần nhất.
- **Đầu ra bàn giao**: danh sách giá trị không bí mật của một môi trường cho H2/H3.
- **Bản ghi diễn tập khôi phục**: ngày, thời điểm khôi phục về, thời gian đo, kết quả, người thực hiện.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Người vận hành chưa từng dựng hạ tầng, chỉ theo tài liệu, dựng xong môi trường thử nghiệm từ tài
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
- **SC-011**: 100% thay đổi hạ tầng của phát hành có bản xem trước đã lưu, đã chạy ở thử nghiệm trước và có bản ghi
  áp dụng; 0 thao tác xóa/thay thế tài nguyên chứa dữ liệu đi qua mà không có xác nhận riêng; một thay đổi sửa tay trên bảng điều khiển được phát hiện trong ≤ 24 giờ.
- **SC-012**: Chi phí hạ tầng hằng tháng của thử nghiệm ≤ 40% của phát hành khi bật suốt tháng, và ≤ 15% khi
  chỉ bật lúc cần (khoảng một phần tư thời gian); chi phí xem được tách riêng theo môi trường. Tắt thử nghiệm
  rồi bật lại mất ≤ 1 giờ và không đổi địa chỉ.
- **SC-013**: Đổi biến thể CSDL, đổi nhà cung cấp kho tệp hoặc đổi nhà cung cấp đám mây không đòi hỏi sửa
  một dòng mã ứng dụng nào – chỉ đổi cấu hình; khi đổi nhà cung cấp đám mây, 100% thay đổi của mã hạ tầng nằm
  trong lớp nhà cung cấp, phần chạy trên Kubernetes giữ nguyên.
- **SC-014**: Dung lượng dựng sẵn của phát hành chịu được tải giai đoạn 1 (100 tài khoản, ~3.000 lượt đăng và
  ~50 GB media mỗi tháng); lên gấp 10 chỉ cần đổi tham số kích thước, không đổi thành phần.

## Assumptions

- **Nhà cung cấp**: **VNG Cloud** cho toàn bộ hạ tầng (ADR-11, Clarifications 2026-11-13). Đặc tả vẫn không
  gắn cứng vào nhà cung cấp (FR-031, FR-033) để đổi được về sau; iNET có thể dùng cho tên miền/DNS. Trước khi
  dựng thật vẫn cần báo giá và xác minh 3 điểm của T4; dựng thật bắt đầu khi có tài khoản; viết định nghĩa và
  kiểm tra tĩnh làm trước được.
- **Người vận hành**: một cá nhân chưa quen vận hành đám mây. Vì vậy tài liệu vận hành (FR-030) giải thích
  từng bước và lý do, không coi kiến thức vận hành là có sẵn; ưu tiên dịch vụ được quản lý khi chi phí cho
  phép.
- **CSDL khởi đầu**: CloudNativePG trên cụm, sao lưu liên tục ra một kho tệp riêng. Đánh đổi đã chấp nhận:
  tiết kiệm tiền dịch vụ, đổi lại người vận hành tự chịu trách nhiệm sao lưu và khôi phục – nên diễn tập
  khôi phục (US4) phải làm được trước ngày ra mắt.
- **Vì sao tách hẳn hai môi trường thay vì chung cụm chia namespace**: (a) nguyên tắc I và VII – dữ liệu và
  khóa của khách hàng thật không được nằm cùng ranh giới quyền với nơi thử nghiệm; (b) thử nâng cấp cụm, đổi
  CSDL, diễn tập sự cố ở thử nghiệm không thể làm hỏng phát hành; (c) Worker xử lý video ở thử nghiệm không
  tranh tài nguyên với phát hành. Đánh đổi là chi phí thêm một cụm nhỏ – chấp nhận vì phần điều khiển Kubernetes của VNG Cloud miễn phí và
  thử nghiệm tắt được khi không dùng (FR-034), giới hạn bằng SC-012.
- **Vì sao chỉ hai môi trường**: một người vận hành; máy cá nhân (docker compose) đã là môi trường phát triển; thêm
  môi trường thứ ba là công vận hành không có lợi ích tương xứng (nguyên tắc IX).
- **Vì sao thử nghiệm dùng cùng biến thể CSDL với phát hành**: sự khác nhau giữa CSDL được quản lý và
  CloudNativePG (kết nối, sao lưu, chuyển bản chính) là đúng loại lỗi mà thử nghiệm phải bắt được.
- **Vai trò CSDL**: bốn vai trò `owner`/`app`/`system`/`support` vẫn do bước khởi tạo CSDL sẵn có của ứng dụng
  tạo (tính năng 002); hạ tầng cung cấp CSDL, thông tin quản trị ban đầu và việc sinh/giao bí mật cho từng vai
  trò, không định nghĩa lại quyền.
- **Triển khai ứng dụng**: trong tính năng này ảnh container được triển khai bằng tay theo tài liệu để kiểm tra
  khói; tự động hóa thuộc H2. Bộ giám sát thuộc H3; ở đây chỉ dành không gian tên, tài nguyên và lưu trữ.
- **Tên miền**: PM cung cấp một tên miền gốc; mỗi môi trường dùng tên miền con riêng cho giao diện, `api` và
  CDN. Thử nghiệm phải truy cập công khai được vì người xét duyệt của Meta cần vào. Bản ghi DNS tạo tay một
  lần ở nơi đăng ký tên miền (FR-001); địa chỉ công khai của môi trường được giữ cố định nên không phải sửa
  lại bản ghi khi tắt/bật thử nghiệm (FR-034).
- **Kích thước ban đầu**: lấy theo tải giai đoạn 1 (100 tài khoản, CSDL vài GB, ~50 GB media, ~600 GB băng
  thông ra mỗi tháng); con số cụ thể chốt ở kế hoạch sau khi có báo giá.
- **Sao lưu kho tệp**: giai đoạn 1 dựa vào lưu phiên bản 7 ngày và độ bền của dịch vụ; không sao chép sang
  vùng thứ hai.
- **Email**: Amazon SES là dịch vụ ngoài, không dựng bằng tính năng này; thông tin SMTP là bí mật nhập vào
  (FR-022). Thử nghiệm dùng hộp thư bắt giữ để không gửi nhầm cho người thật.
- **Cấp quyền cho ứng dụng dùng khóa và kho tệp**: dùng cơ chế danh tính theo tải công việc nếu nhà cung cấp
  có; nếu không thì dùng khóa truy cập tĩnh lưu trong kho bí mật và xoay định kỳ.
- **Kho bí mật**: dùng dịch vụ của nhà cung cấp nếu có; nếu không thì dùng bí mật của Kubernetes được mã hóa
  khi lưu bằng khóa của dịch vụ quản lý khóa. Cả hai đều thỏa FR-022; lựa chọn chốt ở kế hoạch. Nếu nhà cung cấp
  không mã hóa `Secret` bằng khóa KMS của khách hàng thì dùng `Secret` thường với RBAC hẹp; rủi ro còn lại ghi ở
  ADR-11 (mã quyền nền tảng vẫn được mã hóa ở tầng ứng dụng – nguyên tắc VII, nên trong `Secret` chỉ có mật khẩu
  CSDL và khóa kho tệp).
- **Tuân thủ**: tính năng này không thêm bên nhận dữ liệu mới ở nước ngoài; danh sách chuyển dữ liệu xuyên
  biên giới không đổi.
