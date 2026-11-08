# Feature Specification: Kho mã nguồn chung chia module

**Feature Branch**: `001-monorepo-module-skeleton`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Xây dựng Kho mã nguồn chung: NestJS chia module theo ADD mục 6, kiểu dữ liệu dùng chung cho React"

**Truy vết**: WBS 1.1 · ADR-01 (modular monolith, một mã nguồn → API + Worker) · ADR-09 (ranh giới
module) · T1 (backend TypeScript/NestJS/Drizzle) · T2 (frontend React + Vite) · ADD tổng thể mục 6 ·
Hiến pháp nguyên tắc IV, IX.

**Bối cảnh**: Đây là tính năng nền móng cho đội phát triển (3–4 người), không có màn hình cho khách
hàng. "Người dùng" của tính năng là lập trình viên backend, frontend và người review. Giá trị
nghiệp vụ là để mọi đầu việc GĐ1–GĐ4 (WBS 1.2 trở đi) có chỗ đặt mã đúng ranh giới module ngay từ
đầu, tránh phải tách lại về sau.

## Clarifications

### Session 2026-11-07

- Q: Module Cổng nền tảng (`platform_gateway`) có schema riêng hay dùng chung schema `publishing`? → A: Schema riêng `platform_gateway` chứa `channel_connections`; cập nhật `architecture.md` cho khớp.
- Q: Module được gọi tự do giao diện công khai của module khác, hay phải khai báo danh sách phụ thuộc được phép? → A: Danh sách cho phép: mỗi module khai báo các module được phụ thuộc; kiểm tra chặn phụ thuộc ngoài danh sách; thêm phụ thuộc mới phải qua review.
- Q: Gói dùng chung chỉ chứa kiểu, hay cả lược đồ kiểm tra dữ liệu chạy thật? → A: Lược đồ kiểm tra chạy thật dùng chung, kiểu được suy ra từ lược đồ; API bắt buộc kiểm tra đầu vào bằng lược đồ này.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Khởi chạy hai đơn vị API và Worker từ cùng một mã nguồn (Priority: P1)

Lập trình viên mới lấy mã nguồn về, cài phụ thuộc bằng một lệnh, rồi khởi chạy được đơn vị **API**
(nhận yêu cầu HTTP) và đơn vị **Worker** (chạy việc nền) trên máy mình. Cả hai được dựng từ cùng một
mã nguồn và cùng một gói đóng (ảnh container), chỉ khác lệnh khởi động. API trả lời được một yêu cầu
kiểm tra sống; Worker báo đã sẵn sàng và tắt có kiểm soát khi nhận tín hiệu dừng.

**Why this priority**: Không có khung chạy được thì không đầu việc nào khác bắt đầu được. Đây là
yêu cầu trực tiếp của ADR-01 (một mã nguồn, hai đơn vị triển khai).

**Independent Test**: Trên một máy sạch, làm theo hướng dẫn trong tài liệu khởi đầu; gọi điểm kiểm
tra sống của API nhận phản hồi thành công; khởi chạy Worker thấy dòng nhật ký "sẵn sàng"; gửi tín
hiệu dừng thấy Worker thoát trong ≤ 30 giây.

**Acceptance Scenarios**:

1. **Given** máy đã có môi trường chạy theo phiên bản ghi trong tài liệu, **When** lập trình viên chạy
   lệnh cài đặt rồi lệnh khởi chạy API, **Then** điểm kiểm tra sống trả về trạng thái thành công.
2. **Given** cùng mã nguồn đó, **When** chạy lệnh khởi chạy Worker, **Then** Worker khởi động mà
   không mở cổng nhận yêu cầu nghiệp vụ và ghi nhật ký có cấu trúc báo đã sẵn sàng.
3. **Given** Worker đang chạy, **When** nhận tín hiệu dừng, **Then** Worker ngừng nhận việc mới và
   thoát trong ≤ 30 giây.
4. **Given** quy trình đóng gói, **When** đóng gói một lần, **Then** chỉ tạo ra **một** ảnh container
   dùng được cho cả API và Worker.
5. **Given** một bản API đang chạy, **When** khởi chạy thêm hai bản Worker từ cùng ảnh đó, **Then** cả
   hai Worker khởi động và chạy song song mà không xung đột, API không bị ảnh hưởng (sau WBS 1.3, các
   Worker chia nhau việc trong hàng chờ).

---

### User Story 2 - Mỗi module nghiệp vụ có chỗ riêng với ranh giới được kiểm tra tự động (Priority: P1)

Lập trình viên thấy sẵn 11 module theo ADD mục 6 (Tài khoản & Gói, Ngữ cảnh kinh doanh, Thư viện
media, Xu hướng, Nội dung, Duyệt & lịch, Đăng bài, Cổng nền tảng, Cổng AI, Thông báo, Hàng chờ), mỗi
module là một thư mục riêng chỉ lộ ra một **giao diện công khai** duy nhất. Khi ai đó viết mã ở
module A dùng thẳng phần nội bộ của module B (không qua giao diện công khai), lệnh kiểm tra ranh giới
báo lỗi chỉ rõ tệp vi phạm.

**Why this priority**: Hiến pháp nguyên tắc IV yêu cầu ranh giới cứng và CI phải kiểm tra phụ thuộc
giữa module. Nếu không có từ ngày đầu, mã chéo module sẽ lan ra và rất tốn công gỡ.

**Independent Test**: Tạo một nhánh thử thêm một dòng nhập phần nội bộ của module khác → chạy lệnh
kiểm tra ranh giới → thất bại kèm tên tệp; xóa dòng đó → kiểm tra đạt.

**Acceptance Scenarios**:

1. **Given** khung mã nguồn mới tạo, **When** lập trình viên liệt kê các module, **Then** thấy đủ 11
   module theo bảng ánh xạ ở mục Key Entities, mỗi module có tên tiếng Anh và một điểm lộ giao diện
   công khai.
2. **Given** module `content` nhập phần nội bộ của module `publishing`, **When** chạy kiểm tra ranh
   giới, **Then** kiểm tra thất bại và nêu rõ tệp, dòng, module nguồn, module đích.
3. **Given** module `content` chỉ dùng giao diện công khai của `publishing` và `publishing` có trong
   danh sách phụ thuộc được phép của `content`, **When** chạy kiểm tra ranh giới, **Then** kiểm tra đạt.
4. **Given** mã giao diện web, **When** nó nhập mã phía máy chủ (không phải phần kiểu dữ liệu dùng
   chung), **Then** kiểm tra ranh giới thất bại.
5. **Given** khung mã nguồn mới tạo, **When** chạy kiểm tra ranh giới, **Then** không có vòng phụ
   thuộc giữa các module.
6. **Given** module `content` dùng giao diện công khai của `platform_gateway` (không có trong danh sách
   được phép), **When** chạy kiểm tra ranh giới, **Then** kiểm tra thất bại và gợi ý sửa danh sách
   phụ thuộc hoặc đi qua `publishing`.

---

### User Story 3 - Kiểu dữ liệu dùng chung giữa giao diện web và máy chủ (Priority: P2)

Lập trình viên frontend dùng chung một gói kiểu dữ liệu với backend cho các hợp đồng trao đổi qua API
(đối tượng yêu cầu/phản hồi, tên trạng thái, mã lỗi hiển thị). Khi backend đổi một trường trong hợp
đồng, phía web báo lỗi kiểu ngay khi kiểm tra, không đợi đến lúc chạy. Gói này chứa lược đồ kiểm tra
dữ liệu (kiểu suy ra từ lược đồ) và hằng số thuần, dùng chung cho form web và kiểm tra đầu vào API,
không kéo theo thư viện phía máy chủ vào gói web.

**Why this priority**: Giảm lệch hợp đồng web ↔ API (T2). Cần sớm nhưng có thể theo sau P1 vì ban đầu
chỉ có vài hợp đồng mẫu.

**Independent Test**: Thêm một trường bắt buộc vào một kiểu mẫu trong gói dùng chung → chạy kiểm tra
kiểu toàn kho → phía web báo lỗi tại chỗ dùng kiểu đó; sửa xong → kiểm tra đạt. Kiểm tra gói web đã
đóng không chứa mã phía máy chủ.

**Acceptance Scenarios**:

1. **Given** gói kiểu dùng chung có một hợp đồng mẫu (kiểm tra sống và định dạng lỗi chuẩn), **When**
   ứng dụng web và API cùng dùng hợp đồng đó, **Then** kiểm tra kiểu nghiêm ngặt toàn kho đạt.
2. **Given** một trường của hợp đồng mẫu bị đổi tên ở gói dùng chung, **When** chạy kiểm tra kiểu,
   **Then** cả web lẫn API báo lỗi tại chỗ dùng cũ.
3. **Given** gói dùng chung, **When** có ai thêm phụ thuộc vào thư viện chỉ chạy phía máy chủ,
   **Then** kiểm tra ranh giới thất bại.
4. **Given** ứng dụng web khung, **When** chạy ở chế độ phát triển, **Then** hiển thị được trang khởi
   đầu gọi điểm kiểm tra sống của API và hiển thị kết quả bằng chữ tiếng Việt.
5. **Given** một điểm API mẫu nhận đầu vào theo lược đồ dùng chung, **When** gửi dữ liệu thiếu trường
   bắt buộc, **Then** API từ chối trước khi vào nghiệp vụ, trả định dạng lỗi chuẩn nêu trường sai; cùng
   dữ liệu đó kiểm tra bằng lược đồ phía web cho ra cùng trường lỗi.

---

### User Story 4 - Một lệnh kiểm tra chất lượng cho cả kho (Priority: P2)

Người review và CI (WBS 1.4) chạy **một lệnh** để thực hiện: kiểm tra kiểu nghiêm ngặt, lint, kiểm
tra ranh giới module và chạy kiểm thử mẫu cho cả frontend và backend. Lệnh trả mã thất bại khi có bất
kỳ lỗi nào, để sau này CI chặn hợp nhất.

**Why this priority**: Là cổng chất lượng số 3 và 4 của hiến pháp; việc gắn vào CI thuộc WBS 1.4
nhưng lệnh phải có sẵn từ đây.

**Independent Test**: Chạy lệnh trên khung sạch → đạt; cố ý đưa một lỗi kiểu, một lỗi lint, một vi
phạm ranh giới → lệnh thất bại và liệt kê đủ ba lỗi.

**Acceptance Scenarios**:

1. **Given** khung sạch, **When** chạy lệnh kiểm tra toàn kho, **Then** mọi bước đạt và trả mã thành
   công.
2. **Given** có lỗi ở một gói bất kỳ, **When** chạy lệnh, **Then** trả mã thất bại và nêu gói, tệp
   lỗi.

---

### Edge Cases

- Module "Duyệt & lịch" chưa có bảng riêng (ADD mục 6): vẫn là một module có giao diện công khai và
  MUST sở hữu schema riêng `approval` theo hiến pháp nguyên tắc IV – schema được **dành sẵn, để trống**;
  trạng thái duyệt vẫn nằm trên `content.posts`, giờ đăng trên `publishing.publish_attempts`. Bảng chỉ
  được thêm vào schema này khi có đặc tả mới.
- Module "Hàng chờ" là hạ tầng dùng chung: mọi module khác được phép phụ thuộc vào giao diện công
  khai của nó; nó MUST NOT phụ thuộc vào module nghiệp vụ nào.
- Phụ thuộc hai chiều giữa hai module (vd Nội dung ↔ Đăng bài) → kiểm tra ranh giới báo vòng phụ
  thuộc; cách giải là sự kiện qua hàng chờ, không gọi ngược.
- Lập trình viên đặt mã dùng chung (tiện ích, kiểu nội bộ máy chủ) không thuộc module nào: phải có một
  vị trí "lõi dùng chung phía máy chủ" rõ ràng, và lõi này MUST NOT phụ thuộc vào module nghiệp vụ.
- Kiểu dữ liệu dùng chung chứa tiền: MUST biểu diễn là số nguyên micro-USD, không dùng số thực; thời
  gian MUST truyền dạng chuỗi chuẩn ISO 8601 có múi giờ UTC.
- Gói kiểu dùng chung MUST NOT chứa kiểu nào lộ số tiền chi phí AI sang giao diện khách hàng (chỉ phần
  trăm trên trần) – nguyên tắc III.
- Worker khởi động khi chưa cấu hình kết nối CSDL/hàng chờ (vì WBS 1.2, 1.3 chưa làm): Worker vẫn khởi
  động ở chế độ khung và ghi rõ chưa có hàng chờ nào được đăng ký, không sập.
- Thiếu biến cấu hình bắt buộc khi khởi chạy: tiến trình thoát với thông báo nêu tên biến thiếu,
  không in giá trị bí mật.

## Requirements *(mandatory)*

### Functional Requirements

**Cấu trúc kho & đơn vị triển khai**

- **FR-001**: Kho mã nguồn MUST là một kho duy nhất gồm ba phần: ứng dụng web, ứng dụng máy chủ, gói
  kiểu dữ liệu dùng chung; quản lý phụ thuộc chung bằng một lệnh cài đặt ở gốc kho.
- **FR-002**: Ứng dụng máy chủ MUST có hai điểm khởi động – **API** và **Worker** – dùng chung toàn bộ
  mã module; quy trình đóng gói MUST tạo một ảnh container duy nhất cho cả hai (ADR-01). API và Worker
  MUST là **hai đơn vị triển khai độc lập** khi chạy: số bản chạy, giới hạn CPU/RAM và cách co giãn đặt
  riêng; tăng/giảm số bản Worker MUST NOT cần phát hành lại hay khởi động lại API. Worker MUST NOT giữ
  trạng thái nghiệp vụ trong tiến trình, để chạy nhiều bản song song được.
- **FR-003**: API MUST có điểm kiểm tra sống (liveness) và kiểm tra sẵn sàng (readiness) không cần
  đăng nhập, không trả dữ liệu tenant.
- **FR-004**: Worker MUST NOT mở cổng nhận yêu cầu nghiệp vụ; MAY mở cổng kiểm tra sống/chỉ số cho
  hạ tầng chạy ứng dụng.
- **FR-005**: Worker MUST tắt có kiểm soát: khi nhận tín hiệu dừng, ngừng nhận việc mới và thoát trong
  ≤ 30 giây (nguyên tắc V).
- **FR-006**: Cấu hình MUST đọc từ biến môi trường và được kiểm tra hợp lệ khi khởi động; thiếu/sai →
  thoát với thông báo nêu tên biến, MUST NOT in giá trị bí mật (nguyên tắc VII).

**Module & ranh giới**

- **FR-007**: Ứng dụng máy chủ MUST có đủ 11 module theo ADD mục 6 với tên tiếng Anh theo bảng ánh
  xạ ở mục Key Entities; mỗi module là một thư mục riêng.
- **FR-008**: Mỗi module MUST lộ ra đúng một điểm giao diện công khai; module khác MUST chỉ dùng điểm
  này (nguyên tắc IV).
- **FR-009**: **Mỗi** module MUST khai báo sẵn tên schema riêng, không trùng module khác (chưa cần bảng –
  bảng làm ở WBS 1.2 và các đầu việc nghiệp vụ) theo hiến pháp nguyên tắc IV; module "Duyệt & lịch"
  (`approval`) có schema `approval` dành sẵn, để trống.
- **FR-010**: MUST có một vị trí "lõi dùng chung phía máy chủ" (cấu hình, nhật ký, ngữ cảnh yêu cầu,
  lỗi chuẩn) mà mọi module được dùng; lõi MUST NOT phụ thuộc vào module nghiệp vụ.
- **FR-011**: MUST có lệnh kiểm tra ranh giới tự động phát hiện: (a) nhập phần nội bộ của module
  khác; (b) vòng phụ thuộc giữa module; (c) lõi dùng chung hoặc module Hàng chờ phụ thuộc module
  nghiệp vụ; (d) ứng dụng web nhập mã phía máy chủ; (e) gói kiểu dùng chung phụ thuộc thư viện phía
  máy chủ hoặc ứng dụng nào; (f) module dùng giao diện công khai của một module **không có** trong
  danh sách phụ thuộc được phép của nó. Kết quả nêu tệp, module nguồn, module đích.
- **FR-011a**: Mỗi module MUST khai báo danh sách các module nó được phép phụ thuộc, đặt tại một nơi
  tập trung để review dễ thấy thay đổi. Danh sách ban đầu MUST thể hiện tối thiểu: chỉ `publishing`
  được phụ thuộc `platform_gateway` (nguyên tắc II); module cần AI chỉ phụ thuộc `ai_gateway`, không
  module nào khác gọi nhà cung cấp AI (nguyên tắc III); `queue` và lõi dùng chung không phụ thuộc
  module nghiệp vụ nào. Thêm phụ thuộc mới = sửa danh sách và phải qua review.
- **FR-012**: Mỗi module MUST đăng ký được vào cả hai điểm khởi động; module chỉ dùng ở một phía
  (vd bộ xử lý việc nền) MUST khai báo rõ chạy ở API, Worker hay cả hai.

**Kiểu dữ liệu dùng chung**

- **FR-013**: Gói dùng chung MUST chứa **lược đồ kiểm tra dữ liệu chạy thật** cho mọi hợp đồng web ↔
  API, và kiểu dữ liệu MUST được suy ra từ lược đồ (một nguồn duy nhất, không khai báo kiểu song song);
  ngoài ra chỉ chứa hằng số thuần. Thư viện kiểm tra MUST chạy được ở cả trình duyệt lẫn máy chủ, được
  cố định phiên bản; gói MUST NOT phụ thuộc thư viện chỉ chạy phía máy chủ.
- **FR-013a**: API MUST kiểm tra mọi đầu vào (thân, tham số, truy vấn) bằng lược đồ dùng chung trước
  khi vào nghiệp vụ; dữ liệu sai → trả định dạng lỗi chuẩn (FR-014) nêu trường sai bằng tiếng Việt.
  Web MUST dùng cùng lược đồ để kiểm tra form, nên form và API báo cùng một quy tắc.
- **FR-014**: Gói MUST có sẵn các hợp đồng nền: phản hồi kiểm tra sống; định dạng lỗi chuẩn gồm mã lỗi,
  lời giải thích tiếng Việt dễ hiểu, ít nhất một hành động khắc phục và mục "chi tiết cho hỗ trợ"
  (nguyên tắc VI); kiểu mã định danh (UUID v7) dạng chuỗi; kiểu thời gian dạng chuỗi ISO 8601 UTC;
  kiểu tiền là số nguyên micro-USD.
- **FR-015**: Gói MUST tổ chức theo cùng tên module như máy chủ để hợp đồng của mỗi module dễ tìm;
  thêm hợp đồng mới MUST NOT yêu cầu sửa module khác.
- **FR-016**: Ứng dụng web khung MUST dùng gói kiểu chung để gọi điểm kiểm tra sống của API và hiển
  thị kết quả bằng chữ tiếng Việt kèm biểu tượng (không chỉ dựa vào màu).

**Chất lượng & tài liệu**

- **FR-017**: Toàn kho MUST bật kiểm tra kiểu nghiêm ngặt và lint cho cả web lẫn máy chủ (cổng chất
  lượng số 4 của hiến pháp).
- **FR-018**: MUST có một lệnh gốc chạy lần lượt: kiểm tra kiểu, lint, kiểm tra ranh giới, kiểm thử;
  trả mã thất bại nếu bất kỳ bước nào lỗi.
- **FR-019**: Mỗi phần (web, máy chủ, gói chung) MUST có ít nhất một kiểm thử mẫu chạy được, làm khuôn
  cho các đầu việc sau.
- **FR-020**: Phiên bản môi trường chạy và các thư viện quan trọng MUST được cố định (khóa phiên bản)
  để mọi máy và CI cài ra cùng một kết quả (nguyên tắc IX).
- **FR-021**: MUST có tài liệu khởi đầu bằng tiếng Việt: yêu cầu môi trường, lệnh cài đặt, khởi chạy
  API/Worker/web, lệnh kiểm tra, sơ đồ module, quy tắc ranh giới và cách thêm một module/hợp đồng mới.
- **FR-022**: Mọi tên định danh trong mã (thư mục, tệp, module, schema, kiểu) MUST dùng tiếng Anh theo
  bảng ánh xạ; chú thích mã viết tiếng Việt.
- **FR-023**: Tài liệu kiến trúc triển khai (`.specify/memory/architecture.md`) MUST được cập nhật để
  bảng module/schema khớp với bảng ánh xạ ở mục Key Entities (gồm schema riêng `platform_gateway`,
  module `approval` với schema `approval` dành sẵn, để trống), và tăng phiên bản tài liệu.

### Key Entities *(include if feature involves data)*

- **Module**: một khối nghiệp vụ hoặc hạ tầng với tên, schema sở hữu (nếu có), giao diện công khai và
  phía chạy (API/Worker/cả hai). Ánh xạ tên (giữ một ánh xạ cho mỗi thuật ngữ):

  | Module (ADD mục 6) | Tên mã | Schema | Ghi chú |
  |---|---|---|---|
  | Tài khoản & Gói | `account` | `account` | |
  | Ngữ cảnh kinh doanh | `context` | `context` | |
  | Thư viện media | `media` | `media` | |
  | Xu hướng | `trends` | `trends` | Có dữ liệu dùng chung theo ngành |
  | Nội dung | `content` | `content` | |
  | Duyệt & lịch | `approval` | `approval` (dành sẵn, để trống) | Luồng nghiệp vụ; trạng thái duyệt trên `content`, giờ đăng trên `publishing` |
  | Đăng bài | `publishing` | `publishing` | |
  | Cổng nền tảng | `platform_gateway` | `platform_gateway` | Sở hữu `channel_connections` (quyền truy cập mã hóa); chỉ module này được giải mã |
  | Cổng AI | `ai_gateway` | `ai_gateway` | |
  | Thông báo | `notifications` | `notifications` | |
  | Hàng chờ (hạ tầng) | `queue` | `infra` | Không phụ thuộc module nghiệp vụ |

- **Hợp đồng dùng chung**: lược đồ kiểm tra dữ liệu yêu cầu/phản hồi giữa web và API (kiểu suy ra từ
  lược đồ), gắn với một module; chỉ chứa quy tắc kiểm tra dữ liệu, không chứa nghiệp vụ.
- **Lõi dùng chung phía máy chủ**: cấu hình, nhật ký có cấu trúc, ngữ cảnh yêu cầu, lỗi chuẩn – không
  phải module nghiệp vụ, không sở hữu schema.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Một lập trình viên mới, chỉ đọc tài liệu khởi đầu, chạy được API, Worker và web trên máy
  sạch trong ≤ 30 phút, không cần hỏi người khác.
- **SC-002**: 100% các vi phạm ranh giới trong bộ mẫu kiểm chứng (ít nhất 6 trường hợp, mỗi loại
  (a)–(f) ở FR-011 một trường hợp) bị lệnh kiểm tra phát hiện; 0 báo sai trên khung sạch.
- **SC-003**: Một lần đóng gói tạo đúng 1 ảnh container; cùng ảnh đó khởi chạy được cả API và Worker.
- **SC-004**: Worker thoát trong ≤ 30 giây sau tín hiệu dừng ở 10/10 lần thử.
- **SC-005**: Đổi một trường trong hợp đồng dùng chung khiến kiểm tra kiểu phát hiện 100% chỗ dùng
  cũ ở cả web lẫn máy chủ.
- **SC-006**: Lệnh kiểm tra toàn kho chạy xong trên khung sạch trong ≤ 5 phút trên máy phát triển
  thông thường.
- **SC-007**: Thêm một module mới theo hướng dẫn mất ≤ 15 phút và không phải sửa mã của module có sẵn
  (ngoài nơi đăng ký module).
- **SC-008**: Gói web đã đóng có 0 tệp có nguồn gốc từ mã phía máy chủ.
- **SC-009**: Khởi chạy được N bản Worker (N ≥ 2) song song với 1 bản API từ cùng một ảnh, 0 xung đột
  (cổng, tệp, trạng thái trong tiến trình); thêm/bớt bản Worker không làm API khởi động lại.

## Assumptions

- Phạm vi chỉ là WBS 1.1. **Ngoài phạm vi**: lớp CSDL, bảng, đặt biến phiên tenant và RLS (WBS 1.2);
  lớp hàng chờ pg-boss và 6 hàng chờ (1.3); gắn lệnh kiểm tra vào CI, kiểm thử truy cập chéo tenant,
  kiểm tra migration (1.4); hạ tầng Terraform (1.5); OpenTelemetry/giám sát đầy đủ (1.6 – ở đây chỉ
  nhật ký có cấu trúc tối thiểu); định tuyến, điều hướng và thư viện thành phần của web (1.7); giao
  diện công khai chi tiết của bộ chuyển đổi nền tảng và Cổng AI (1.8). Mỗi module ở đây chỉ là khung
  rỗng có giao diện công khai giữ chỗ.
- Ngăn xếp đã chốt theo hiến pháp (React + Vite, NestJS, Drizzle, pg-boss, TypeScript); đặc tả này
  không chọn lại. Công cụ quản lý workspace, công cụ kiểm tra ranh giới và khung kiểm thử cụ thể do
  `/speckit-plan` chọn, ghi lý do.
- Bố cục đề xuất của tài liệu kiến trúc (`apps/web`, `apps/server`, `packages/shared`, module trong
  `apps/server/src/modules/<module>/` lộ ra qua một tệp chỉ mục) được dùng làm mặc định.
- Cổng nền tảng và Đăng bài là **hai module riêng, mỗi module một schema** (`platform_gateway`,
  `publishing`) theo ADD mục 6 và nguyên tắc IV; bảng `channel_connections` thuộc schema
  `platform_gateway`. Tài liệu `.specify/memory/architecture.md` mục 4 (hiện gộp `channel_connections`
  vào `publishing`) MUST được cập nhật cho khớp trong tính năng này (xem FR-023).
- "Duyệt & lịch" được đặt tên mã `approval` (mapping mới, ghi vào plan/data-model). ADD mục 6 ghi module
  này "không có bảng riêng"; để tuân thủ hiến pháp nguyên tắc IV (mỗi module sở hữu schema riêng – hiến
  pháp thắng khi mâu thuẫn), module vẫn có schema `approval` dành sẵn nhưng không có bảng.
- Module Hàng chờ đặt tên mã `queue`, sở hữu schema `infra` theo tài liệu kiến trúc.
- Kho chưa là kho git có lịch sử; chủ dự án sẽ tự thiết lập kho từ xa sau – không ảnh hưởng phạm vi.
- Môi trường phát triển chính là Windows; tài liệu và lệnh MUST chạy được trên Windows lẫn Linux
  (CI, container).
