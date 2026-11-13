# Feature Specification: Quy trình tích hợp và triển khai tự động (Jenkins) cho hai môi trường test và release

**Feature Branch**: `008-cicd-jenkins-pipeline`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Dựa vào tài liệu kiến trúc dự án xây dựng Quy trình tích hợp và triển khai tự
động: dựng 1 ảnh chạy cả API và Worker; kiểm tra phụ thuộc giữa module; bộ kiểm thử truy cập chéo tenant; kiểm
tra thay đổi CSDL tương thích ngược (Tôi có 2 môi trường test và release, môi trường test ứng với nhánh dev sẽ
triển khai khi có code merge vào nhánh, môi trường release tương ứng nhánh master sẽ được triển khai khi có
code merge vào. và tôi muốn Jenkins có mặt trong quy trình triển khai tự động này)"

**Truy vết**: WBS H2 (quy trình tích hợp và triển khai tự động; cổng chuyển sang đợt 1: "xong K1–K6, H2, có môi
trường thử nghiệm") · ADR-01 (một ảnh, hai đơn vị triển khai), ADR-02 (cô lập tenant), ADR-09 (ranh giới
module), ADR-10 (dữ liệu trong nước) · Đặc tả triển khai `.specify/memory/architecture.md` mục 3 (phát hành),
mục 4 (kiểm tra phụ thuộc module), mục 5 (kiểm tra bắt buộc trong CI) · Hiến pháp mục "Quy trình phát triển &
cổng chất lượng" (5 kiểm tra tự động chặn hợp nhất; migration tương thích ngược; API và Worker phát hành cùng
nhau) và nguyên tắc I, IV, V, VII, VIII, IX · NFR khả dụng 99,5%, không mất việc trong hàng chờ khi phát hành.

**Phụ thuộc**: `001` (kho mã chia module, tệp kê khai module, kiểm tra ranh giới, quét bí mật, một ảnh
container) · `002` (lớp CSDL, bốn vai trò `owner`/`app`/`system`/`support`, kiểm tra quy ước CSDL, kiểm tra
tĩnh migration, kiểm thử trên CSDL thật) · `003`–`006` (các bộ kiểm thử hiện có) · `007` (hai môi trường, kho
ảnh riêng tư, kho bí mật, danh sách đầu ra bàn giao FR-024, tài liệu triển khai bằng tay và bộ kiểm tra khói).
Triển khai thật lên một môi trường chỉ làm được khi môi trường đó đã dựng xong ở `007`; phần kiểm tra trước khi
hợp nhất và dựng ảnh không phụ thuộc `007`.

**Bối cảnh**: Các kiểm tra chất lượng (`pnpm verify`) hiện chỉ chạy khi lập trình viên nhớ chạy trên máy mình;
ảnh container được dựng và triển khai bằng tay. Hiến pháp yêu cầu năm kiểm tra tự động **chặn hợp nhất**, và
cổng chuyển sang đợt 1 yêu cầu có H2. Với đội 3–4 người không có người vận hành riêng, mỗi lần hợp nhất mã phải
tự đi tới môi trường tương ứng mà không ai phải làm tay, và lỗi phải bị chặn trước khi chạm dữ liệu khách hàng.

**Quy ước tên môi trường và nhánh** (dùng thống nhất trong đặc tả này):

| Người dùng gọi | Nhánh | Tên ở tính năng 007 | Mục đích |
|---|---|---|---|
| Môi trường **test** | `dev` | `staging` | Thử nghiệm, App Review của Meta, POC, kiểm thử tích hợp |
| Môi trường **release** | `master` | `production` | Phục vụ khách hàng thật |

**Quyết định của SA áp dụng trong đặc tả này** (lý do ở mục Assumptions):

1. **Jenkins điều phối toàn bộ quy trình**; định nghĩa quy trình nằm trong kho mã, không cấu hình bằng tay trên
   giao diện Jenkins.
2. **Hai chặng**: *kiểm tra trước khi hợp nhất* (chặn hợp nhất vào `dev` và `master`) và *triển khai sau khi hợp
   nhất* (`dev` → test, `master` → release). Chặng sau chạy lại toàn bộ cổng chất lượng trước khi triển khai.
3. **Một ảnh cho mỗi phiên bản mã**, dùng cho cả `api`, `worker` và tác vụ migration; ảnh không bị ghi đè.
4. **Hai đường vào `master`**: đường phát hành thường từ `dev` (chỉ mã đã chạy tốt trên test) và đường sửa
   nóng từ nhánh `hotfix/*` tách ra từ `master` (không cần qua test, vì `dev` có thể đang lẫn mã chưa hoàn
   thiện). Không có đường thứ ba.
5. **Tương thích ngược của CSDL được kiểm bằng hai lớp**: kiểm tra tĩnh từng migration và chạy thử *phiên bản
   ứng dụng đang chạy ở môi trường đích* trên cấu trúc CSDL mới.
6. **Triển khai hỏng thì tự quay về bản ứng dụng trước**; cấu trúc CSDL không quay lui (vì đã tương thích ngược).

**Ngoài phạm vi**: dựng hạ tầng và mọi tài nguyên đám mây (`007`); bộ giám sát, bảng điều khiển và cảnh báo vận
hành (WBS H3); kiểm thử tải; môi trường xem trước cho từng nhánh; phát hành từng phần theo tỷ lệ người dùng
(canary) và bật/tắt tính năng bằng cờ; áp dụng thay đổi hạ tầng Terraform (quy trình riêng ở `007` US3); viết
thêm kiểm thử nghiệp vụ cho các module (thuộc từng tính năng).

## Clarifications

### Session 2026-11-13

- Q: Kho mã của dự án sẽ được đặt trên dịch vụ lưu mã nào để Jenkins nhận sự kiện hợp nhất và khóa nút hợp
  nhất khi cổng chất lượng chưa đạt? → A: GitHub (đám mây, kho riêng tư); Jenkins nhận webhook và báo trạng
  thái lên pull request.
- Q: Máy Jenkins sẽ chạy ở đâu so với hai môi trường test và release? → A: Một máy ảo riêng trên đám mây trong
  nước, nằm ngoài cả hai cụm Kubernetes, có mạng và quyền riêng.
- Q: Sau khi pull request vào `master` được hợp nhất, Jenkins có triển khai thẳng lên release hay phải chờ một
  người bấm xác nhận trong Jenkins? → A: Triển khai thẳng ngay sau hợp nhất; bước duyệt của con người là duyệt
  pull request vào `master`.
- Q: Khi release có lỗi nghiêm trọng cần sửa gấp, bản sửa nóng có được đi thẳng vào `master` không? → A: Có –
  nhánh `hotfix/*` (tách từ `master`) mở pull request thẳng vào `master`, vẫn chạy đủ cổng chất lượng và cần
  người thứ hai duyệt nhưng không cần đã chạy trên test; Jenkins tự mở pull request đưa bản sửa ngược về `dev`.
  Lý do: `dev` là nhánh thi công tính năng theo vòng lặp nên có thể lẫn mã mới chưa hoàn thiện.
- Q: Kết quả triển khai sẽ được gửi cho đội qua kênh nào? → A: Một nhóm Telegram của đội, cùng trạng thái
  trên pull request của GitHub; không gửi email.

### Session 2026-11-13 (sau `/speckit-analyze`)

- Q: FR-004 đòi người thứ hai duyệt, nhưng hiện kho mã chỉ có một người làm – xử lý thế nào? → A: Không đẩy
  thẳng lên `master`; thay đổi đi qua `dev` bằng pull request đã đạt cổng chất lượng. Hiện chỉ chủ dự án (quyền
  cao nhất) được thao tác và hợp nhất vào `master`. Yêu cầu "người khác tác giả duyệt" áp dụng khi kho có từ hai
  thành viên trở lên; trong lúc chỉ có một thành viên, việc chủ dự án bấm hợp nhất là bước duyệt của con người.
  Câu trả lời này thay cho các chỗ ghi "người thứ hai duyệt" ở phiên trước. Đường sửa nóng `hotfix/*` (phiên
  trước) được giữ nguyên.

## User Scenarios & Testing *(mandatory)*

Người dùng của tính năng này là **lập trình viên, người review và SA**. Giá trị cho chủ kinh doanh đến gián
tiếp: không bản phát hành nào làm lộ dữ liệu chéo tài khoản hay làm gián đoạn việc đăng bài đã lên lịch.

### User Story 1 - Mọi thay đổi bị chặn hợp nhất nếu vi phạm cổng chất lượng (Priority: P1)

Lập trình viên mở yêu cầu hợp nhất vào `dev` (hoặc từ `dev` vào `master`). Jenkins tự chạy toàn bộ cổng chất
lượng và báo kết quả ngay trên yêu cầu hợp nhất. Nếu một cổng không đạt, nút hợp nhất bị khóa; lập trình viên
thấy cổng nào hỏng, ở tệp nào, và cách chạy lại đúng cổng đó trên máy mình.

**Why this priority**: Đây là lớp bảo vệ mà hiến pháp bắt buộc (nguyên tắc I, IV và mục cổng chất lượng) và là
phần có giá trị ngay cả khi chưa có môi trường nào để triển khai. Không có nó, ba kiểm tra trọng yếu (ranh giới
module, truy cập chéo tenant, migration tương thích ngược) phụ thuộc vào trí nhớ của từng người.

**Independent Test**: Tạo năm yêu cầu hợp nhất, mỗi yêu cầu cài một vi phạm: (a) module này import nội bộ module
khác; (b) bảng mới có `account_id` nhưng chưa bật bảo mật mức dòng; (c) bảng khách hàng mới chưa có trong bộ
kiểm thử truy cập chéo; (d) migration xóa một cột mà phiên bản đang chạy còn đọc; (e) một bí mật giả trong mã.
Cả năm phải bị chặn, mỗi cái nêu đúng nguyên nhân. Một yêu cầu sạch phải được phép hợp nhất.

**Acceptance Scenarios**:

1. **Given** một yêu cầu hợp nhất vào `dev` hoặc `master`, **When** nó được mở hoặc có thêm commit, **Then**
   Jenkins tự chạy cổng chất lượng trên kết quả hợp nhất dự kiến và ghi trạng thái đạt/không đạt lên yêu cầu đó.
2. **Given** một module import tệp nội bộ hoặc truy cập schema của module khác ngoài danh sách phụ thuộc được
   phép trong tệp kê khai module, **When** cổng chạy, **Then** không đạt, nêu module vi phạm, tệp và quy tắc.
3. **Given** một bảng của khách hàng mà tài khoản A đọc, sửa hoặc xóa được dòng của tài khoản B, **When** bộ
   kiểm thử truy cập chéo chạy trên CSDL thật bằng vai trò ứng dụng, **Then** không đạt, nêu bảng và thao tác.
4. **Given** một bảng có `account_id` nhưng chưa bật bảo mật mức dòng, hoặc một bảng khách hàng chưa được bộ
   kiểm thử truy cập chéo bao phủ, **When** cổng chạy, **Then** không đạt, nêu tên bảng.
5. **Given** một migration không tương thích ngược (ví dụ xóa/đổi tên cột hay bảng đang dùng, thêm cột bắt buộc
   không có giá trị mặc định, siết ràng buộc mà dữ liệu cũ vi phạm), **When** cổng chạy, **Then** không đạt, nêu
   tệp migration, câu lệnh và lý do.
6. **Given** một cổng không đạt, **When** lập trình viên xem kết quả, **Then** thấy tên cổng, dòng lỗi đầu tiên,
   đường dẫn tới nhật ký đầy đủ và lệnh để chạy lại đúng cổng đó trên máy cá nhân.
7. **Given** có cổng không đạt hoặc chưa chạy xong, **When** ai đó thử hợp nhất, **Then** bị từ chối; không có
   cách bỏ qua ngoài quy trình ngoại lệ có ghi nhận ở FR-009.

---

### User Story 2 - Hợp nhất vào `dev` thì môi trường test tự cập nhật (Priority: P2)

Sau khi một yêu cầu hợp nhất vào `dev` được chấp nhận, Jenkins tự: chạy lại cổng chất lượng, dựng một ảnh
container, đẩy vào kho ảnh riêng tư, chạy migration, cập nhật `api` và `worker` cùng lúc từ ảnh đó, đưa giao
diện web mới lên, chạy kiểm tra khói, rồi báo kết quả cho đội. Không ai phải gõ lệnh triển khai.

**Why this priority**: Môi trường test luôn mới là điều kiện cho App Review của Meta, POC đăng bài và kiểm thử
tích hợp ở đợt 1. Xếp sau US1 vì triển khai mã chưa qua cổng là vô nghĩa.

**Independent Test**: Hợp nhất một thay đổi nhìn thấy được (ví dụ đổi một dòng chữ và thêm một cột) vào `dev`;
không làm gì thêm; trong thời hạn SC-003, môi trường test hiển thị thay đổi, `api` và `worker` báo đúng mã phiên
bản của commit đó, và đội nhận được thông báo thành công.

**Acceptance Scenarios**:

1. **Given** một commit mới trên `dev`, **When** hợp nhất xong, **Then** quy trình triển khai test tự bắt đầu
   trong ≤ 2 phút, không cần ai kích hoạt.
2. **Given** quy trình đang chạy, **When** dựng ảnh, **Then** đúng một ảnh được dựng cho commit đó, gắn mã
   phiên bản truy được về commit, và cùng ảnh đó chạy được ở ba vai: `api`, `worker`, tác vụ migration.
3. **Given** ảnh đã dựng, **When** triển khai, **Then** migration chạy trước bằng vai trò `owner` trong một tác
   vụ tách khỏi tiến trình ứng dụng; chỉ khi migration thành công thì `api` và `worker` mới được cập nhật, và
   cả hai được cập nhật sang cùng một ảnh trong cùng một lần phát hành.
4. **Given** `api` và `worker` đang chuyển sang bản mới, **When** người dùng thử đang thao tác và có việc nền
   đang chạy, **Then** yêu cầu của người dùng không bị lỗi do triển khai, Worker cũ ngừng lấy việc mới và có
   tối đa 30 giây hoàn tất việc đang chạy, và không việc nào trong hàng chờ bị mất.
5. **Given** triển khai xong, **When** kiểm tra khói chạy, **Then** nó xác nhận `api` và `worker` báo khỏe với
   đúng mã phiên bản mới, đăng nhập được, giao diện web mở được qua HTTPS; kết quả được báo cho đội.
6. **Given** cổng chất lượng không đạt ở chặng sau hợp nhất, **When** quy trình dừng, **Then** không có ảnh nào
   được triển khai, môi trường test giữ nguyên bản cũ, và đội được báo kèm nguyên nhân.
7. **Given** hai lần hợp nhất vào `dev` sát nhau, **When** cả hai kích hoạt quy trình, **Then** các lần triển
   khai lên test chạy lần lượt, không chồng nhau, và môi trường kết thúc ở commit mới nhất.

---

### User Story 3 - Hợp nhất vào `master` thì môi trường release tự cập nhật, an toàn (Priority: P3)

Khi đội quyết định phát hành, một yêu cầu hợp nhất từ `dev` vào `master` được người quản lý phát hành hợp nhất
(và được người khác tác giả duyệt khi kho có từ hai thành viên – FR-004). Sau khi hợp nhất, Jenkins tự triển khai lên release theo đúng các bước của test, cộng thêm các lớp an toàn: xác nhận mã này
đã chạy tốt trên test, kiểm tra migration với phiên bản đang chạy ở release, và tự quay về bản trước nếu bản
mới không khỏe.

**Why this priority**: Đây là nơi có dữ liệu và bài đăng của khách hàng thật. Chỉ cần khi sắp ra mắt, và phải
dựa trên US1, US2 đã ổn định.

**Independent Test**: Hợp nhất `dev` vào `master`; release tự cập nhật trong thời hạn SC-004. Sau đó thử ba
tình huống xấu: hợp nhất vào `master` một nội dung chưa từng triển khai thành công trên test → bị chặn; phát
hành một bản cố ý không khởi động được → release tự về bản trước, người dùng không thấy gián đoạn; dùng thông
tin triển khai của test để triển khai lên release → bị từ chối.

**Acceptance Scenarios**:

1. **Given** một yêu cầu hợp nhất vào `master`, **When** cổng chất lượng chưa đạt, hoặc người bấm hợp nhất không
   có vai trò quản lý phát hành, hoặc (khi kho có từ hai thành viên) chưa có người khác tác giả duyệt, **Then**
   không hợp nhất được.
2. **Given** một yêu cầu hợp nhất từ `dev` vào `master` chứa nội dung chưa được triển khai thành công lên
   test, **When** cổng chạy, **Then** không đạt, nêu commit nào chưa qua test.
3. **Given** một commit mới trên `master`, **When** hợp nhất xong, **Then** quy trình triển khai release tự bắt
   đầu, theo cùng các bước và cùng định nghĩa như test; khác biệt chỉ là tham số của môi trường.
4. **Given** bản mới đã triển khai lên release, **When** kiểm tra sức khỏe hoặc kiểm tra khói không đạt trong
   thời gian quan sát, **Then** `api` và `worker` tự quay về ảnh của bản trước, cấu trúc CSDL giữ nguyên, đội
   được báo ngay với mức ưu tiên cao.
5. **Given** migration thất bại giữa chừng ở release, **When** quy trình dừng, **Then** `api` và `worker` chưa
   bị đổi, bản cũ vẫn phục vụ bình thường, và nhật ký nêu migration nào lỗi.
6. **Given** bản phát hành trước có vấn đề phát hiện muộn, **When** SA yêu cầu triển khai lại một phiên bản đã
   phát hành trước đó, **Then** làm được bằng một thao tác có ghi nhận người thực hiện, dùng lại đúng ảnh cũ
   (không dựng lại).
7. **Given** một lần triển khai release bất kỳ, **When** tra lịch sử, **Then** thấy: ai hợp nhất, ai duyệt,
   commit nào, ảnh nào, migration nào đã chạy, kết quả từng bước và thời điểm.
8. **Given** release đang có lỗi và `dev` đang chứa mã chưa hoàn thiện, **When** lập trình viên tách nhánh
   `hotfix/*` từ `master`, sửa lỗi và mở yêu cầu hợp nhất vào `master`, **Then** cổng chất lượng chạy đầy đủ
   (kể cả kiểm tra tương thích ngược với bản đang chạy ở release), điều kiện "đã chạy trên test" không áp
   dụng, điều kiện hợp nhất của FR-004 vẫn áp dụng; sau khi hợp nhất, release tự triển khai như thường lệ.
9. **Given** một bản sửa nóng vừa được hợp nhất vào `master`, **When** triển khai release xong, **Then** Jenkins
   tự mở một yêu cầu hợp nhất đưa bản sửa ngược về `dev` và báo cho đội; nếu có xung đột thì yêu cầu đó vẫn
   được mở và ghi rõ cần người xử lý.
10. **Given** một nhánh không phải `dev` và không tách từ `master` theo tên `hotfix/*`, **When** nó mở yêu cầu
    hợp nhất vào `master`, **Then** bị từ chối.

---

### User Story 4 - Thông tin triển khai được giữ kín và tách theo môi trường (Priority: P4)

SA cấu hình để Jenkins giữ thông tin triển khai của từng môi trường riêng biệt. Mã chưa được review không bao
giờ chạm được thông tin triển khai; quy trình của `dev` không dùng được quyền của release; không bí mật nào hiện
trong nhật ký.

**Why this priority**: Jenkins trở thành nơi có quyền đổi môi trường release – nếu nó hở thì mọi lớp bảo vệ ở
`007` vô nghĩa (nguyên tắc VII). Cần hoàn tất trước khi US3 dùng cho dữ liệu thật.

**Independent Test**: Mở một yêu cầu hợp nhất sửa định nghĩa quy trình để in thông tin triển khai ra nhật ký →
không lấy được gì; chạy quy trình của `dev` với yêu cầu dùng quyền release → bị từ chối; quét toàn bộ nhật ký
của 20 lần chạy gần nhất → 0 bí mật.

**Acceptance Scenarios**:

1. **Given** một yêu cầu hợp nhất chưa được duyệt, **When** chặng kiểm tra chạy mã của nó, **Then** chặng đó
   không có thông tin triển khai của bất kỳ môi trường nào và không có quyền ghi vào kho ảnh.
2. **Given** quy trình triển khai test, **When** nó cố dùng thông tin triển khai của release, **Then** bị từ
   chối; và ngược lại.
3. **Given** nhật ký của mọi lần chạy, **When** quét bí mật, **Then** không có mật khẩu, khóa truy cập hay mã
   quyền nào ở dạng rõ.
4. **Given** một người không thuộc nhóm được phép, **When** họ thử chạy lại, sửa hoặc kích hoạt bằng tay quy
   trình triển khai release, **Then** bị từ chối và lần thử được ghi lại.

---

### Edge Cases

- **Migration lỗi giữa chừng**: mỗi migration chạy trọn vẹn hoặc không chạy; quy trình dừng trước khi đổi ứng
  dụng; chạy lại quy trình tiếp tục từ migration chưa xong.
- **Cần thay đổi CSDL không tương thích ngược** (bỏ cột, đổi kiểu): phải chia thành các bước mở rộng → chuyển
  mã → thu hẹp, mỗi bước là một bản phát hành riêng; cổng chỉ cho qua bước thu hẹp khi phiên bản đang chạy ở môi
  trường đích không còn dùng phần bị bỏ.
- **Quay về bản trước sau khi migration đã chạy**: an toàn vì cấu trúc mới tương thích với bản trước; đây chính
  là lý do cổng tương thích ngược tồn tại.
- **Hai lần hợp nhất sát nhau**: triển khai theo thứ tự hợp nhất; lần cũ đang chờ có thể bị bỏ qua nếu đã có lần
  mới hơn, nhưng lần đang chạy dở không bị ngắt giữa migration.
- **Bản mới khỏe ở `api` nhưng `worker` không khởi động được**: coi là triển khai hỏng, cả hai cùng quay về.
- **Việc nền dạng mới do bản mới tạo ra, sau đó quay về bản cũ**: Worker cũ gặp loại việc không biết phải để
  nguyên việc đó trong hàng chờ (không làm mất, không chôn), và cảnh báo.
- **GitHub không gửi được webhook hoặc tạm ngừng**: Jenkins đối chiếu định kỳ với kho mã để không bỏ sót lần
  hợp nhất nào; ứng dụng đang chạy không bị ảnh hưởng.
- **Telegram không gửi được**: triển khai vẫn hoàn tất; lỗi gửi được ghi trong lịch sử lần chạy và thử gửi
  lại; kết quả vẫn xem được trên GitHub và Jenkins.
- **Jenkins ngừng hoạt động**: ứng dụng đang chạy không bị ảnh hưởng; hợp nhất bị khóa cho tới khi Jenkins trở
  lại; có hướng dẫn triển khai khẩn cấp bằng tay (kế thừa tài liệu của `007`) kèm yêu cầu ghi nhận.
- **Jenkins khởi động lại giữa một lần triển khai**: lần chạy được đánh dấu hỏng; chạy lại an toàn vì mọi bước
  triển khai chạy lại được mà không gây tác dụng phụ lặp.
- **Kiểm thử chập chờn**: không tự động chạy lại để "cho qua"; lần chạy lại do người kích hoạt và được ghi nhận.
- **Kho ảnh hoặc kho bí mật không truy cập được**: quy trình dừng với thông báo rõ thành phần nào lỗi; môi
  trường giữ nguyên bản cũ.
- **Sửa nóng (hotfix) khẩn cấp cho release**: đi bằng nhánh `hotfix/*` thẳng vào `master` (FR-005a), không
  qua test nhưng không bỏ cổng nào; vượt cổng vẫn chỉ có quy trình ngoại lệ FR-009.
- **Bản sửa nóng xung đột với `dev` khi đưa ngược về**: yêu cầu hợp nhất vẫn được mở, đánh dấu cần người xử
  lý; phát hành thường bị chặn cho tới khi nó được hợp nhất (FR-005b).
- **Bản sửa nóng có kèm migration**: **không được phép** – sửa nóng không kèm migration; cần đổi cấu trúc thì
  đi đường phát hành thường (`dev` → test → `master`). Lý do (đã kiểm chứng lúc implement, research R11): bộ
  chạy migration **bỏ qua âm thầm** migration có mốc thời gian cũ hơn migration mới nhất đã áp, nên migration
  của bản sửa nóng và migration chưa phát hành của `dev` có thể làm một trong hai môi trường thiếu cấu trúc mà
  không báo lỗi. Cổng nguồn phát hành chặn nhánh `hotfix/*` có tệp migration mới; cổng migration bất biến chặn
  mọi migration mới có mốc thời gian không lớn hơn các migration đã có ở nhánh đích.
- **`dev` đang có mã chưa hoàn thiện đúng lúc cần phát hành**: phát hành thường đưa toàn bộ `dev` lên release,
  nên đội chỉ mở yêu cầu phát hành khi `dev` ở trạng thái phát hành được; việc cần gấp thì đi đường sửa nóng.
- **Ảnh chứa lỗ hổng nghiêm trọng đã biết ở phụ thuộc**: bị chặn trước khi triển khai lên release; ở test thì
  cảnh báo.
- **Giao diện web và `api` lệch phiên bản trong lúc chuyển**: giao diện mới chỉ có hiệu lực sau khi `api` mới
  đã khỏe; tệp tĩnh của bản trước còn truy cập được để người đang mở trang không bị lỗi.
- **Môi trường release chưa dựng** (`007` chưa xong): hợp nhất vào `master` vẫn chạy cổng và dựng ảnh, bước
  triển khai báo "chưa có môi trường đích" thay vì lỗi mơ hồ.

## Requirements *(mandatory)*

### Functional Requirements

**Kích hoạt và ánh xạ nhánh – môi trường**

- **FR-001**: Jenkins MUST điều phối toàn bộ quy trình tích hợp và triển khai; định nghĩa quy trình MUST nằm
  trong kho mã của dự án, được review như mã nguồn, và dựng lại được máy Jenkins từ mã cùng tài liệu.
- **FR-002**: Mỗi yêu cầu hợp nhất nhắm vào `dev` hoặc `master` MUST tự kích hoạt cổng chất lượng trên kết quả
  hợp nhất dự kiến, và chạy lại khi có commit mới; kết quả MUST hiển thị ngay trên yêu cầu hợp nhất.
- **FR-003**: Hợp nhất vào `dev` MUST tự kích hoạt triển khai lên môi trường test; hợp nhất vào `master` MUST
  tự kích hoạt triển khai lên môi trường release, chạy liền mạch tới hết mà không chờ ai xác nhận trong Jenkins.
  MUST NOT có nhánh nào khác triển khai được lên hai môi trường
  này, và MUST NOT có ánh xạ chéo (`dev` → release hoặc `master` → test).
- **FR-004**: `dev` và `master` MUST được bảo vệ: không đẩy thẳng, chỉ nhận thay đổi qua yêu cầu hợp nhất đã đạt
  cổng chất lượng. Hợp nhất vào `master` MUST chỉ do người có vai trò quản lý phát hành thực hiện (hiện là chủ
  dự án); việc người này bấm hợp nhất là bước duyệt của con người. Khi kho mã có từ hai thành viên trở lên, mọi
  yêu cầu hợp nhất vào `dev` và `master` MUST có thêm ít nhất một người khác tác giả duyệt; khi chỉ có một
  thành viên, yêu cầu này chưa áp dụng (ngoại lệ có ghi nhận so với câu "mọi thay đổi MUST qua review" của hiến
  pháp – plan.md mục Complexity Tracking) và MUST được bật lại ngay khi có thành viên thứ hai.
- **FR-005**: `master` MUST chỉ nhận yêu cầu hợp nhất từ hai nguồn: `dev` (phát hành thường) và nhánh
  `hotfix/*` (sửa nóng); mọi nguồn khác MUST bị từ chối. Với nguồn `dev`, cổng MUST từ chối yêu cầu chứa commit
  chưa được triển khai thành công lên test.
- **FR-005a**: Nhánh `hotfix/*` MUST được tách từ `master` và chỉ chứa thay đổi so với `master` (cổng MUST từ
  chối nếu nó mang theo commit của `dev` chưa có trên `master`). Yêu cầu hợp nhất sửa nóng MUST chạy đủ cổng
  chất lượng FR-006 và MUST thỏa điều kiện hợp nhất của FR-004; điều kiện "đã triển khai lên test" không áp dụng. Lần
  triển khai MUST được đánh dấu là sửa nóng trong lịch sử (FR-043).
- **FR-005b**: Sau mỗi lần sửa nóng được hợp nhất vào `master`, Jenkins MUST tự mở yêu cầu hợp nhất đưa thay
  đổi đó về `dev` và báo cho đội; yêu cầu này đi qua cổng chất lượng như mọi yêu cầu khác. Khi còn bản sửa nóng
  chưa về `dev`, cổng MUST từ chối yêu cầu phát hành thường từ `dev` vào `master` (để bản phát hành sau không
  làm mất bản sửa).

**Cổng chất lượng** (chạy ở cả hai chặng: trước khi hợp nhất và trước khi triển khai)

- **FR-006**: Cổng chất lượng MUST gồm tối thiểu, và mỗi mục không đạt MUST chặn hợp nhất lẫn triển khai:
  1. kiểm tra phụ thuộc giữa module;
  2. bộ kiểm thử truy cập chéo tenant và kiểm tra bảng có `account_id` chưa bật bảo mật mức dòng;
  3. kiểm tra thay đổi CSDL tương thích ngược;
  4. kiểm tra kiểu nghiêm ngặt và lint cho cả giao diện lẫn máy chủ;
  5. quét bí mật trong mã nguồn và trong nhật ký mẫu của các bước kiểm thử;
  6. toàn bộ kiểm thử tự động hiện có của dự án (đơn vị, CSDL thật, hàng chờ, trình duyệt);
  7. dựng được ảnh container và ảnh khởi động được ở cả hai vai `api` và `worker`.
- **FR-007**: Cổng chất lượng MUST dùng đúng các lệnh kiểm tra mà lập trình viên chạy được trên máy cá nhân,
  để kết quả ở Jenkins và ở máy cá nhân giống nhau; MUST NOT có kiểm tra nào chỉ tồn tại trong cấu hình Jenkins.
- **FR-008**: Trên Jenkins, MUST NOT có bước nào của cổng được "bỏ qua" vì thiếu điều kiện (ví dụ thiếu CSDL
  kiểm thử); một bước bị bỏ qua MUST được tính là không đạt.
- **FR-009**: MUST NOT có cách tắt hay vượt cổng bằng cấu hình thường ngày. Trường hợp khẩn cấp MUST đi qua một
  quy trình ngoại lệ: do SA hoặc PO phê duyệt, nêu lý do, được ghi lại cùng người phê duyệt, và hiển thị trong
  lịch sử triển khai.
- **FR-010**: Khi một cổng không đạt, kết quả MUST nêu: tên cổng, dòng lỗi đầu tiên có nghĩa, đường dẫn tới nhật
  ký đầy đủ, và lệnh chạy lại cổng đó trên máy cá nhân.

**Kiểm tra phụ thuộc giữa module**

- **FR-011**: Kiểm tra MUST lấy quy tắc từ tệp kê khai module (nguồn duy nhất) và MUST phát hiện: import tệp
  nội bộ của module khác; gọi module không nằm trong danh sách phụ thuộc được phép; truy cập schema CSDL của
  module khác; khóa ngoại vượt ranh giới module (trừ tới bảng tài khoản); module chỉ chạy ở `worker` bị nạp vào
  `api` hoặc ngược lại.
- **FR-012**: Một module mới chưa khai báo trong tệp kê khai MUST làm kiểm tra không đạt.

**Bộ kiểm thử truy cập chéo tenant**

- **FR-013**: Với **mỗi** bảng của khách hàng, bộ kiểm thử MUST xác nhận trên CSDL thật, bằng đúng vai trò CSDL
  mà ứng dụng dùng khi chạy: trong ngữ cảnh tài khoản A, đọc / sửa / xóa dòng của tài khoản B đều thất bại (0
  dòng bị ảnh hưởng hoặc bị từ chối), thêm dòng mang mã của tài khoản B bị từ chối; và khi không có ngữ cảnh
  tài khoản thì không thấy dòng nào.
- **FR-014**: Danh sách bảng cần kiểm MUST được lấy tự động từ cấu trúc CSDL sau khi chạy toàn bộ migration;
  một bảng khách hàng mới không được bộ kiểm thử bao phủ MUST làm cổng không đạt – không dựa vào việc lập trình
  viên nhớ thêm ca kiểm thử.
- **FR-015**: Bộ kiểm thử MUST bao gồm các đường vào dữ liệu ngoài bảng thường: khung nhìn dành cho hỗ trợ, hàm
  chạy với quyền của người định nghĩa, và bảng việc trong hàng chờ – mỗi loại không được làm lộ dữ liệu của tài
  khoản khác cho vai trò ứng dụng.
- **FR-016**: Cổng MUST xác nhận vai trò CSDL của ứng dụng không có quyền bỏ qua bảo mật mức dòng và không sở
  hữu bảng nào.

**Kiểm tra thay đổi CSDL tương thích ngược**

- **FR-017**: Mỗi migration mới MUST qua kiểm tra tĩnh từ chối các thao tác phá vỡ phiên bản đang chạy: xóa
  hoặc đổi tên bảng/cột/kiểu đang dùng; đổi kiểu cột không tương thích; thêm cột bắt buộc không có giá trị mặc
  định; thêm ràng buộc mà dữ liệu hoặc bản ứng dụng cũ có thể vi phạm; thao tác khóa bảng lâu trên bảng lớn.
  Mỗi lần từ chối MUST nêu tệp, câu lệnh, lý do và cách chia bước thay thế.
- **FR-018**: Ngoài kiểm tra tĩnh, cổng MUST kiểm tra động: áp dụng các migration mới lên một CSDL tạm, rồi chạy
  **phiên bản ứng dụng đang chạy ở môi trường đích** (chưa có thay đổi) trên cấu trúc mới và xác nhận nó vẫn
  khởi động, vẫn qua bộ kiểm thử CSDL và kiểm tra khói của chính nó.
- **FR-019**: Migration đã được áp dụng lên bất kỳ môi trường nào MUST NOT bị sửa hay xóa; cổng MUST phát hiện
  thay đổi nội dung của migration cũ.
- **FR-020**: Thao tác thu hẹp có chủ đích (bước cuối của mở rộng → chuyển mã → thu hẹp) MUST được khai báo
  tường minh ngay trong migration kèm lý do; cổng chỉ cho qua khi kiểm tra động FR-018 xác nhận phiên bản đang
  chạy ở môi trường đích không còn dùng phần bị bỏ.
- **FR-021**: Toàn bộ chuỗi migration MUST áp dụng được từ CSDL trống, và chạy lại lần hai không tạo thay đổi.

**Dựng ảnh**

- **FR-022**: Mỗi phiên bản mã được triển khai MUST tương ứng đúng **một** ảnh container, dùng cho `api`,
  `worker` và tác vụ migration (khác nhau ở lệnh khởi động). MUST NOT dựng ảnh riêng cho từng vai.
- **FR-023**: Ảnh MUST mang mã phiên bản truy được về đúng commit; mã phiên bản đã dùng MUST NOT bị ghi đè;
  `api` và `worker` đang chạy MUST báo được mã phiên bản của mình.
- **FR-024**: Ảnh MUST NOT chứa bí mật, tệp cấu hình môi trường, mã giao diện web, công cụ chỉ dùng khi phát
  triển; tiến trình trong ảnh MUST NOT chạy bằng quyền quản trị. Ảnh MUST chứa các công cụ dòng lệnh mà Worker
  cần (xử lý video) khi tính năng tương ứng đã có.
- **FR-025**: Ảnh MUST được lưu trong kho ảnh riêng tư đặt trong nước; chỉ quy trình sau hợp nhất mới có quyền
  ghi. Ảnh của các bản đã phát hành lên release MUST được giữ đủ lâu để quay về (tối thiểu 10 bản gần nhất và
  không dưới 90 ngày); ảnh cũ hơn được dọn tự động.
- **FR-026**: Trước khi triển khai lên release, ảnh MUST được quét lỗ hổng đã biết; lỗ hổng mức nghiêm trọng có
  bản vá MUST chặn triển khai release và chỉ cảnh báo ở test.

**Triển khai**

- **FR-027**: Mỗi lần triển khai MUST theo đúng thứ tự: (1) cổng chất lượng; (2) dựng và đẩy ảnh; (3) chạy
  migration; (4) cập nhật `api` và `worker`; (5) đưa giao diện web lên; (6) kiểm tra khói; (7) thông báo. Một
  bước không đạt MUST dừng các bước sau.
- **FR-028**: Migration MUST chạy bằng vai trò `owner` trong một tác vụ chạy một lần, tách khỏi tiến trình
  `api`/`worker`, dùng cùng ảnh của bản phát hành; `api` và `worker` MUST NOT tự chạy migration khi khởi động và
  MUST NOT nhận được bí mật của `owner`.
- **FR-029**: `api` và `worker` MUST được cập nhật trong cùng một lần phát hành, sang cùng một ảnh; trạng thái
  hai bên chạy hai phiên bản khác nhau chỉ được tồn tại trong lúc chuyển.
- **FR-030**: Cập nhật MUST không gây gián đoạn: `api` luôn còn ít nhất một bản khỏe phục vụ; bản mới chỉ nhận
  yêu cầu sau khi báo sẵn sàng; Worker cũ ngừng lấy việc mới và có tối đa 30 giây hoàn tất việc đang chạy; không
  việc nào trong hàng chờ bị mất hay bị chạy trùng do triển khai.
- **FR-031**: Giao diện web MUST được dựng từ cùng commit và đưa lên nơi phục vụ tĩnh của môi trường sau khi
  `api` mới đã khỏe: tệp có mã băm trong tên đưa lên trước, tệp vào (`index.html`) đưa lên cuối cùng; tệp tĩnh
  của bản trước MUST còn truy cập được ít nhất 7 ngày.
- **FR-032**: Sau triển khai MUST có kiểm tra khói tự động trên môi trường thật: `api` và `worker` báo khỏe với
  đúng mã phiên bản mới; ghi–đọc CSDL bằng vai trò ứng dụng; đăng nhập được; giao diện mở được qua HTTPS; hàng
  chờ nhận và xử lý được một việc thử. Kiểm tra khói ở release MUST NOT tạo hay sửa dữ liệu của khách hàng thật
  và MUST NOT gửi gì ra nền tảng mạng xã hội, nhà cung cấp AI hay email của khách hàng.
- **FR-033**: Nếu bản mới không khỏe hoặc kiểm tra khói không đạt, `api` và `worker` (và giao diện web) MUST tự
  quay về bản trước; cấu trúc CSDL MUST giữ nguyên; kết quả MUST được ghi là triển khai hỏng.
- **FR-034**: MUST triển khai lại được một phiên bản đã phát hành trước đó bằng một thao tác, dùng lại ảnh cũ,
  giới hạn cho nhóm được phép, có ghi nhận người thực hiện và lý do.
- **FR-035**: Tại một thời điểm MUST chỉ có một lần triển khai cho mỗi môi trường; các lần sau xếp hàng theo thứ
  tự hợp nhất; lần đang chạy MUST NOT bị ngắt giữa bước migration.
- **FR-036**: Hai môi trường MUST dùng cùng một định nghĩa quy trình triển khai; khác biệt MUST chỉ nằm ở tham
  số của môi trường (địa chỉ, số bản, tên bí mật, mức chặn của FR-026) lấy từ danh sách đầu ra của `007`.
- **FR-037**: Mọi bước triển khai MUST chạy lại được an toàn: chạy lại một lần triển khai đã xong hoặc dở dang
  không tạo tác dụng phụ lặp.

**Bí mật và quyền của Jenkins**

- **FR-038**: Thông tin triển khai của test và release MUST tách riêng; quy trình của nhánh này MUST NOT dùng
  được thông tin của môi trường kia. Chặng kiểm tra trước khi hợp nhất MUST NOT có thông tin triển khai của bất
  kỳ môi trường nào và MUST NOT có quyền ghi kho ảnh.
- **FR-039**: Jenkins MUST chỉ có quyền tối thiểu cần cho việc triển khai (đẩy ảnh, chạy tác vụ migration, cập
  nhật `api`/`worker`, đưa tệp giao diện lên); MUST NOT đọc được dữ liệu khách hàng trong CSDL hay kho tệp media
  của release, và MUST NOT giữ mật khẩu vai trò `owner` ngoài kho bí mật của môi trường.
- **FR-040**: Bí mật MUST NOT xuất hiện dạng rõ trong định nghĩa quy trình, nhật ký chạy, kết quả hiển thị trên
  yêu cầu hợp nhất hay thông báo; nhật ký chạy MUST được quét bí mật.
- **FR-041**: Jenkins MUST chạy trên một máy riêng đặt trong nước, nằm ngoài cụm Kubernetes của cả test lẫn
  release, cùng nhật ký và sản phẩm dựng của nó; máy này MUST được định nghĩa bằng mã hạ tầng và MUST chỉ có
  đường mạng tới đúng những điểm cần cho triển khai (kho ảnh, điểm quản trị của hai cụm, nơi phục vụ giao diện
  tĩnh), MUST NOT có đường mạng tới CSDL hay kho tệp media của release; giao diện quản trị Jenkins MUST
  NOT mở cho toàn internet không giới hạn – lối vào duy nhất từ internet là điểm nhận webhook của GitHub, và
  sự kiện không có chữ ký hợp lệ MUST bị từ chối; đăng nhập MUST theo từng cá nhân; quyền kích hoạt bằng tay, chạy lại
  hay sửa quy trình release MUST hẹp hơn test.
- **FR-042**: Các thành phần bên ngoài mà quy trình dùng (ảnh nền, công cụ, phần mở rộng của Jenkins) MUST được
  cố định phiên bản; mã chạy trong chặng kiểm tra MUST NOT sửa được cấu hình hay phần mở rộng của Jenkins.

**Truy vết và thông báo**

- **FR-043**: Mỗi lần chạy MUST lưu lịch sử tra được trong ít nhất 12 tháng: người hợp nhất, người duyệt,
  commit, mã phiên bản ảnh, danh sách migration đã chạy, kết quả và thời lượng từng bước, có quay về bản trước
  hay không, có dùng ngoại lệ FR-009 hay không.
- **FR-044**: Kết quả triển khai (thành công, hỏng, đã quay về bản trước) MUST được gửi vào **nhóm Telegram
  của đội** trong ≤ 5 phút kể từ khi có kết quả, kèm môi trường, commit, tác giả, bước hỏng và đường dẫn nhật
  ký; kết quả cổng chất lượng MUST hiện trên pull request của GitHub. Triển khai release hỏng hoặc bị quay về
  MUST được báo ở mức ưu tiên cao (tin nhắn có nhắc tên người hợp nhất và nhóm trực). Không gửi email cho các
  kết quả này.
- **FR-044a**: Tin nhắn thông báo MUST NOT chứa bí mật, dữ liệu khách hàng, nội dung nhật ký thô hay địa chỉ
  nội bộ ngoài đường dẫn tới Jenkins; mã truy cập của bot Telegram là một bí mật của Jenkins (FR-040). Nếu gửi
  thông báo thất bại, lần triển khai MUST NOT bị coi là hỏng vì lý do đó: Jenkins thử gửi lại và ghi nhận lỗi
  gửi trong lịch sử lần chạy.
- **FR-045**: MUST xem được, không cần vào máy chủ, mỗi môi trường đang chạy phiên bản nào và được triển khai
  lúc nào.
- **FR-046**: MUST có tài liệu bằng tiếng Việt: luồng nhánh và cách phát hành; ý nghĩa từng cổng và cách chạy
  trên máy cá nhân; cách viết migration tương thích ngược (mở rộng → chuyển mã → thu hẹp); cách quay về bản
  trước; quy trình ngoại lệ; dựng lại Jenkins; nhập và xoay thông tin triển khai; triển khai khẩn cấp bằng tay
  khi Jenkins ngừng.
- **FR-047**: Tính năng này MUST NOT thêm máy chủ cache phân tán, hệ thống tin nhắn hay dịch vụ nào khác ngoài
  Jenkins; việc đưa Jenkins vào MUST được ghi thành một ADR (nguyên tắc IX).

### Key Entities

- **Lần chạy quy trình**: một lần Jenkins thực thi cho một yêu cầu hợp nhất hoặc một commit trên `dev`/`master`;
  thuộc tính: loại (kiểm tra / triển khai), nhánh, commit, người kích hoạt, kết quả từng bước, thời lượng.
- **Cổng chất lượng**: một kiểm tra có tên, lệnh chạy được ở máy cá nhân, kết quả đạt/không đạt, dòng lỗi đầu.
- **Ảnh phát hành**: ảnh container của một commit; thuộc tính: mã phiên bản, commit, thời điểm dựng, kết quả
  quét lỗ hổng, các môi trường đã triển khai.
- **Lần triển khai**: việc đưa một ảnh phát hành lên một môi trường; thuộc tính: môi trường, ảnh, migration đã
  chạy, kết quả kiểm tra khói, trạng thái (thành công / hỏng / đã quay về), người hợp nhất, người duyệt.
- **Môi trường đích**: test (`staging`) hoặc release (`production`); thuộc tính: nhánh nguồn, bộ tham số, bộ
  thông tin triển khai, phiên bản đang chạy.
- **Migration**: một thay đổi cấu trúc CSDL có thứ tự; thuộc tính: nội dung bất biến sau khi áp dụng, phân loại
  (mở rộng / thu hẹp có khai báo), môi trường đã áp dụng.
- **Ngoại lệ vượt cổng**: bản ghi một lần bỏ qua cổng; thuộc tính: cổng, lý do, người phê duyệt, lần chạy.
- **Thông tin triển khai**: bộ quyền mà Jenkins dùng cho một môi trường; thuộc tính: môi trường, phạm vi quyền,
  lần xoay gần nhất.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% thay đổi vào `dev` và `master` đi qua yêu cầu hợp nhất đã đạt cổng chất lượng; 0 lần đẩy
  thẳng thành công.
- **SC-002**: Bộ năm vi phạm cài sẵn (import chéo module, bảng thiếu bảo mật mức dòng, bảng khách hàng chưa
  được kiểm thử truy cập chéo, migration không tương thích ngược, bí mật trong mã) bị chặn 5/5, mỗi cái nêu
  đúng nguyên nhân; yêu cầu sạch đối chứng được cho qua.
- **SC-003**: Lập trình viên nhận kết quả cổng chất lượng trên yêu cầu hợp nhất trong ≤ 15 phút (95% số lần);
  từ lúc hợp nhất vào `dev` đến lúc test chạy bản mới và đã qua kiểm tra khói ≤ 25 phút (95% số lần).
- **SC-004**: Từ lúc hợp nhất vào `master` đến lúc release chạy bản mới và đã qua kiểm tra khói ≤ 30 phút (95%
  số lần).
- **SC-005**: 0 thao tác bằng tay cho một lần triển khai bình thường lên test hoặc release, tính từ sau khi bấm
  hợp nhất.
- **SC-006**: Trong lúc triển khai, người dùng không gặp lỗi do triển khai (0 yêu cầu thất bại vì bản đang tắt
  trong phép thử gửi yêu cầu liên tục), 0 việc nền bị mất và 0 việc bị chạy trùng.
- **SC-007**: Một bản cố ý không khởi động được: môi trường tự về bản trước trong ≤ 10 phút kể từ khi bắt đầu
  cập nhật, không cần người can thiệp; đội nhận thông báo trong ≤ 5 phút sau đó.
- **SC-008**: 100% bảng của khách hàng có trong CSDL được bộ kiểm thử truy cập chéo bao phủ; số này được tính
  tự động ở mỗi lần chạy.
- **SC-009**: 100% bản phát hành thường lên release đã triển khai thành công trên test trước đó; 100% lần
  triển khai release (kể cả sửa nóng) do người quản lý phát hành hợp nhất, có người duyệt khác tác giả khi kho
  có từ hai thành viên, và đã qua đủ cổng chất lượng; 100% bản sửa
  nóng có yêu cầu hợp nhất về `dev` được mở tự động trong ≤ 10 phút sau khi triển khai xong.
- **SC-010**: Quét bí mật trên định nghĩa quy trình và nhật ký của mọi lần chạy tìm thấy 0 bí mật dạng rõ; 100%
  phép thử dùng thông tin triển khai của môi trường này cho môi trường kia bị từ chối.
- **SC-011**: Với một lần triển khai bất kỳ trong 12 tháng, trả lời được trong ≤ 5 phút: ai hợp nhất, ai duyệt,
  commit nào, ảnh nào, migration nào đã chạy, kết quả ra sao.
- **SC-012**: Kết quả cổng chất lượng ở Jenkins và ở máy cá nhân trùng nhau trên cùng một commit (0 trường hợp
  "máy tôi đạt mà Jenkins không đạt" do khác lệnh kiểm tra).
- **SC-013**: Một thành viên mới, chỉ theo tài liệu, đưa được một thay đổi nhỏ từ máy mình lên test trong ngày
  làm việc đầu tiên mà không cần ai làm hộ bước nào.
- **SC-014**: Dựng lại máy Jenkins từ mã và tài liệu trong ≤ 4 giờ; trong thời gian đó ứng dụng ở hai môi
  trường không bị ảnh hưởng.

## Assumptions

- **Luồng nhánh**: `dev` là nhánh thi công tính năng theo vòng lặp và có thể chứa mã chưa hoàn thiện; phát
  hành thường là một yêu cầu hợp nhất `dev` → `master` khi `dev` ổn định; sửa lỗi trên bản đang phát hành dùng
  nhánh `hotfix/*` tách từ `master` (Clarifications 2026-11-13). Nhánh tính năng (`impl/*`, …) chỉ hợp nhất
  vào `dev`.
- **Tên nhánh**: nhánh phát hành là `master` theo yêu cầu của người dùng. Kho mã hiện chỉ có `dev`; nhánh
  `master` được tạo từ `dev` khi bật quy trình. (Nếu đội muốn dùng tên `main` thì chỉ là đổi một tham số.)
- **Tên môi trường**: "test" và "release" của người dùng chính là `staging` và `production` ở tính năng `007`;
  không tạo môi trường thứ ba. Mã và tham số tiếp tục dùng tên của `007`.
- **Vì sao Jenkins**: là yêu cầu của chủ dự án. Hiến pháp không chốt công cụ tích hợp–triển khai trong bảng
  ngăn xếp công nghệ, nhưng Jenkins là một dịch vụ phải vận hành thêm, nên cần một ADR ghi bối cảnh, phương án
  đã cân nhắc, lý do chọn và điều kiện xem xét lại (FR-047). ADR được viết ở bước kế hoạch.
- **Nơi đặt Jenkins**: một **máy ảo riêng trên đám mây trong nước** (ADR-10), nằm **ngoài cả hai cụm
  Kubernetes**, có mạng và quyền riêng (Clarifications 2026-11-13) – để mã chưa review ở chặng kiểm tra không
  chạy chung cụm với môi trường nào, và để hỏng hay nâng cấp cụm test không làm mất khả năng triển khai
  release. Máy này là tài nguyên hạ tầng mới: được định nghĩa bằng mã theo cùng cách của `007` (không tạo bằng
  tay), gắn nhãn chi phí riêng. Một máy Jenkins là đủ cho đội 3–4 người; không cần chạy dự phòng (SC-014 là
  giới hạn chấp nhận).
- **Nơi lưu mã**: kho mã đặt trên **GitHub, kho riêng tư** (Clarifications 2026-11-13). "Yêu cầu hợp nhất"
  trong đặc tả này là pull request của GitHub; bảo vệ nhánh và kiểm tra bắt buộc của GitHub là cơ chế khóa nút
  hợp nhất (FR-004); Jenkins nhận sự kiện qua webhook và báo trạng thái từng cổng lên pull request. Mã nguồn
  không phải dữ liệu khách hàng nên không thuộc phạm vi ADR-10; điều kiện đi kèm là kho mã không chứa bí mật
  (cổng quét bí mật) và GitHub không nhận dữ liệu khách hàng nào. Vì GitHub ở ngoài mạng của dự án, điểm nhận
  webhook là lối vào duy nhất của Jenkins mở ra internet và phải xác thực chữ ký của từng sự kiện (FR-041).
- **Phát hành lên release là tự động sau khi hợp nhất**, không có nút bấm xác nhận thêm trong Jenkins và không
  giới hạn khung giờ (đã xác nhận ở Clarifications 2026-11-13): bước duyệt của con người là việc người quản lý
  phát hành hợp nhất pull request vào `master` – kèm người khác tác giả duyệt khi kho có từ hai thành viên
  (FR-004) – và người hợp nhất chịu trách nhiệm chọn thời điểm bằng cách
  chọn lúc bấm hợp nhất. An toàn được bù bằng FR-005, FR-018, FR-026, FR-030, FR-033.
- **Dựng ảnh ở mỗi nhánh**: ảnh được dựng từ commit của nhánh tương ứng (commit hợp nhất trên `master` khác
  commit trên `dev`), nên release chạy lại toàn bộ cổng thay vì tin kết quả của test. Việc dùng lại nguyên ảnh
  đã chạy ở test khi nội dung mã trùng khớp là tối ưu được phép ở kế hoạch, không bắt buộc.
- **Vì sao kiểm tra động với "phiên bản đang chạy ở môi trường đích"**: kiểm tra tĩnh không biết mã cũ thật sự
  dùng cột nào; chạy bản cũ trên cấu trúc mới là phép thử trực tiếp của điều hiến pháp yêu cầu ("API/Worker cũ
  và mới chạy song song khi phát hành") và cũng là điều kiện để quay về bản trước an toàn.
- **Không quay lui cấu trúc CSDL**: migration chỉ đi tới; sửa sai bằng một migration mới. Quay về bản ứng dụng
  trước là đủ vì cấu trúc mới tương thích với nó.
- **Kiểm tra đã có**: kiểm tra ranh giới module, quét bí mật, kiểm tra quy ước CSDL, kiểm tra tĩnh migration và
  các bộ kiểm thử trên CSDL thật đã tồn tại từ `001`–`006`. Tính năng này đưa chúng thành cổng bắt buộc, bổ
  sung phần còn thiếu (bao phủ tự động của kiểm thử truy cập chéo – FR-014/FR-015, kiểm tra động – FR-018, bất
  biến migration – FR-019) chứ không viết lại.
- **CSDL cho kiểm thử trong quy trình**: mỗi lần chạy dùng một CSDL PostgreSQL tạm, cùng phiên bản chính với
  hai môi trường, hủy sau khi chạy; không bao giờ dùng CSDL của test hay release để chạy kiểm thử.
- **Kiểm tra khói ở release** dùng một tài khoản kiểm tra nội bộ dành riêng và các điểm kiểm tra sức khỏe; không
  chạm tài khoản khách hàng. Ở test, các cổng nền tảng / AI / thông báo chạy bản giả lập theo `007` FR-029.
- **Kênh thông báo của đội**: một nhóm Telegram riêng của đội, gửi qua bot (Clarifications 2026-11-13); không
  dùng email cho thông báo triển khai. Telegram là dịch vụ ở nước ngoài nhưng chỉ nhận siêu dữ liệu triển khai
  (môi trường, commit, tên tác giả, bước hỏng, đường dẫn nhật ký) – không có dữ liệu cá nhân của khách hàng,
  nhưng vẫn được ghi vào danh sách chuyển dữ liệu xuyên biên giới với ghi chú "không có dữ liệu khách hàng"
  (hiến pháp nguyên tắc VII: mọi bên nhận mới ở nước ngoài phải được ghi). Telegram không phải thành phần của ứng
  dụng; nó ngừng thì chỉ mất thông báo, lịch sử vẫn xem được trong Jenkins và trên GitHub.
- **Quét lỗ hổng ảnh** dùng công cụ mã nguồn mở chạy trong nước, không gửi mã hay ảnh ra dịch vụ bên ngoài.
- **Tuân thủ**: GitHub (mã nguồn) và Telegram (siêu dữ liệu triển khai) là hai dịch vụ nước ngoài mới của
  **quy trình phát triển**, không nhận dữ liệu khách hàng. Cả hai được ghi vào danh sách chuyển dữ
  liệu xuyên biên giới (ghi chú: quy trình phát triển, không có dữ liệu khách hàng) và được nêu trong ADR của
  FR-047.
