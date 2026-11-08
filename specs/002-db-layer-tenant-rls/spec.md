# Feature Specification: Lớp CSDL – schema theo module, ngữ cảnh tenant trong giao dịch, RLS mẫu

**Feature Branch**: `002-db-layer-tenant-rls`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Xây dựng Lớp CSDL cho dự án (Đọc tài liệu đặc tả @TaiLieuDacTa trước): Drizzle, mỗi module một schema, đặt biến phiên tenant trong giao dịch, chính sách bảo mật mức dòng mẫu"

**Truy vết**: WBS 1.2 · ADR-02 (chung CSDL, mã tài khoản + bảo mật mức dòng) · ADR-09 (khóa ngoại chỉ
trong module và tới bảng tài khoản) · ADR-01 (mỗi module một schema) · Kiến trúc dữ liệu mục 4.1, 4.3,
6, 8.1 · Kiến trúc triển khai mục 4, 5, 8 · NFR bảo mật (cô lập tenant) · Hiến pháp nguyên tắc I, IV,
IX và phần "Quy ước dữ liệu".

**Phụ thuộc**: `001-monorepo-module-skeleton` (WBS 1.1) – khung mã nguồn, 11 module, lõi dùng chung
phía máy chủ, lệnh kiểm tra toàn kho.

**Bối cảnh**: Tính năng nền móng, không có màn hình cho khách hàng. "Người dùng" là lập trình viên
backend, người review và (gián tiếp) chủ tài khoản – người được bảo đảm dữ liệu của mình không bao giờ
lộ sang tài khoản khác. Giá trị nghiệp vụ: mọi đầu việc sau (GĐ1–GĐ4) có sẵn một cách duy nhất, an
toàn mặc định để đọc/ghi dữ liệu khách hàng; một lỗi quên lọc theo tài khoản ở mã ứng dụng vẫn bị CSDL
chặn (lớp bảo vệ thứ hai của ADR-02).

## Clarifications

### Session 2026-11-07

- Q: Truy vấn bảng khách hàng ngoài giao dịch có ngữ cảnh tenant ở dev/test nên cảnh báo hay ném lỗi? → A: Dev/test ném lỗi; môi trường chính thức trả 0 dòng và ghi nhật ký cảnh báo.
- Q: Khi xóa hẳn một tài khoản, dữ liệu ở các bảng khác được dọn thế nào? → A: Bảng nghiệp vụ dùng khóa ngoại xóa dây chuyền tới `account.accounts`; bảng nhật ký phân vùng không có khóa ngoại tới tài khoản, hết hạn theo phân vùng, dữ liệu cá nhân trong đó được ẩn danh hóa khi xóa tài khoản.
- Q: Vai trò `system` chạm vào bảng khách hàng thì CSDL phản ứng thế nào? → A: `system` được đặt ngữ cảnh tenant như `app` khi cần xử lý cho từng tài khoản (chịu chính sách bảo mật mức dòng; không có ngữ cảnh → 0 dòng).
- Q: Mỗi lần mở ngữ cảnh hỗ trợ được xem bao nhiêu tài khoản? → A: Hai bước – tìm kiếm xuyên tài khoản trên khung nhìn hẹp (chỉ mã + trạng thái, có kiểm toán theo từ khóa tìm); xem chi tiết đúng một tài khoản mỗi ngữ cảnh (đặt ngữ cảnh tenant + kiểm toán).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc/ghi dữ liệu khách hàng chỉ trong ngữ cảnh tenant của giao dịch (Priority: P1)

Lập trình viên backend viết mã nghiệp vụ cho một tài khoản bằng cách mở một **giao dịch có ngữ cảnh
tenant**: lớp CSDL nhận mã tài khoản (lấy từ phiên đăng nhập ở API hoặc từ dữ liệu việc ở Worker), đặt
biến phiên tenant ở **phạm vi giao dịch**, rồi chạy các truy vấn bên trong. Trong giao dịch đó, mọi
truy vấn tới bảng của khách hàng chỉ thấy và chỉ ghi được dòng của đúng tài khoản ấy, kể cả khi lập
trình viên quên thêm điều kiện lọc. Kết thúc giao dịch (thành công hay lỗi), kết nối trả về bể không
còn mang mã tài khoản.

**Why this priority**: Đây là nguyên tắc I (KHÔNG THƯƠNG LƯỢNG) của hiến pháp; mọi module có dữ liệu
khách hàng đều phụ thuộc vào cơ chế này. Không có nó thì không đầu việc nghiệp vụ nào được bắt đầu.

**Independent Test**: Tạo hai tài khoản A và B, mỗi tài khoản vài dòng trong bảng mẫu. Mở giao dịch
ngữ cảnh A, truy vấn **không có điều kiện lọc** → chỉ thấy dòng của A. Sau đó dùng lại cùng kết nối
(bể 1 kết nối) mà không đặt ngữ cảnh → không thấy dòng nào.

**Acceptance Scenarios**:

1. **Given** bảng mẫu có dữ liệu của A và B, **When** mở giao dịch ngữ cảnh A và đọc toàn bộ bảng
   không lọc, **Then** chỉ nhận dòng của A.
2. **Given** giao dịch ngữ cảnh A, **When** sửa hoặc xóa toàn bộ bảng không lọc, **Then** chỉ dòng
   của A bị ảnh hưởng; dòng của B giữ nguyên.
3. **Given** giao dịch ngữ cảnh A, **When** chèn hoặc sửa một dòng sao cho mã tài khoản của dòng là B,
   **Then** CSDL từ chối thao tác và giao dịch báo lỗi.
4. **Given** một giao dịch ngữ cảnh A vừa kết thúc (thành công hoặc bị hoàn tác do lỗi), **When** kết
   nối đó được dùng lại cho truy vấn không có ngữ cảnh, **Then** không thấy dòng nào của bất kỳ tài
   khoản nào.
5. **Given** hai giao dịch ngữ cảnh A và B chạy đồng thời trên hai kết nối của cùng bể, **When** cả
   hai đọc bảng mẫu, **Then** mỗi giao dịch chỉ thấy dòng của tài khoản mình (không rò ngữ cảnh chéo).
6. **Given** mã ứng dụng truy vấn bảng của khách hàng **ngoài** giao dịch có ngữ cảnh tenant, **When**
   truy vấn chạy, **Then** ở chế độ phát triển/kiểm thử lớp CSDL ném lỗi rõ ràng (nêu bảng bị truy vấn);
   ở môi trường chính thức CSDL trả về 0 dòng và lớp CSDL ghi một nhật ký cảnh báo có cấu trúc.

---

### User Story 2 - Mỗi module có schema riêng, cấu trúc CSDL được quản lý bằng migration (Priority: P1)

Lập trình viên của một module khai báo bảng của mình **trong schema của module đó**; một lệnh duy nhất
tạo/cập nhật cấu trúc CSDL (migration) theo thứ tự, chạy được lặp lại an toàn, bằng vai trò CSDL sở
hữu cấu trúc – không phải vai trò mà API/Worker dùng khi chạy. Khi cài một CSDL trống, sau lệnh này có
đủ schema của các module có dữ liệu, các vai trò CSDL, bảng tài khoản gốc và bảng mẫu có chính sách
bảo mật mức dòng.

**Why this priority**: Nguyên tắc IV (mỗi module sở hữu schema riêng) và ADR-09. Phải có ngay để các
module sau không đặt bảng sai chỗ và mọi thay đổi cấu trúc đều truy vết được.

**Independent Test**: Trên CSDL trống, chạy lệnh migration → kiểm tra đủ danh sách schema theo bảng ánh
xạ, đủ 4 vai trò, bảng `account.accounts`; chạy lại lần hai → không lỗi, không thay đổi gì.

**Acceptance Scenarios**:

1. **Given** CSDL trống, **When** chạy lệnh migration, **Then** tồn tại đúng các schema: `account`,
   `context`, `media`, `trends`, `content`, `approval` (dành sẵn, để trống), `publishing`,
   `platform_gateway`, `ai_gateway`, `notifications`, `infra` – đúng theo tệp kê khai module của tính
   năng 001 (cập nhật 2026-11-08, xem Assumptions).
2. **Given** migration đã chạy, **When** chạy lại, **Then** lệnh kết thúc thành công và không thay đổi
   cấu trúc.
3. **Given** migration đã chạy, **When** kiểm tra chủ sở hữu bảng và schema, **Then** tất cả thuộc vai
   trò `owner`; vai trò `app` chỉ có quyền dùng dữ liệu (đọc/ghi theo cấp), không có quyền đổi cấu
   trúc, không có quyền bỏ qua chính sách bảo mật mức dòng.
4. **Given** một lập trình viên khai báo bảng của module `content` có khóa ngoại tới bảng của module
   `publishing`, **When** chạy kiểm tra quy ước CSDL, **Then** kiểm tra thất bại, nêu bảng và khóa
   ngoại vi phạm ADR-09. Khóa ngoại tới `account.accounts` hoặc trong nội bộ module thì đạt.
5. **Given** API hoặc Worker khởi động, **When** đọc cấu hình kết nối, **Then** dùng vai trò `app`
   (không bao giờ dùng `owner`); thiếu cấu hình kết nối → thoát với thông báo nêu tên biến, không in
   mật khẩu.

---

### User Story 3 - Chính sách bảo mật mức dòng mẫu và bộ cột chuẩn dùng lại được (Priority: P1)

Khi thêm một bảng khách hàng mới, lập trình viên dùng **một khuôn mẫu chung**: bộ cột chuẩn
(`account_id NOT NULL` có khóa ngoại tới bảng tài khoản, `id` UUID v7 sinh ở ứng dụng, `created_at`,
`updated_at`, tùy chọn `deleted_at` và `version`) và một **chính sách bảo mật mức dòng mẫu** áp dụng
bằng một khai báo, không phải tự viết lại câu điều kiện. Một lệnh kiểm tra phát hiện bảng có cột
`account_id` mà chưa bật chính sách, hoặc chỉ mục không bắt đầu bằng `account_id`.

**Why this priority**: Nếu mỗi người tự viết chính sách, sớm muộn sẽ có bảng bị quên hoặc viết sai.
Khuôn mẫu + kiểm tra tự động là điều kiện để cổng chất lượng số 2 của hiến pháp hoạt động (CI ở WBS 1.4).

**Independent Test**: Thêm một bảng thử có `account_id` nhưng không áp khuôn chính sách → lệnh kiểm tra
thất bại, nêu tên bảng; áp khuôn → đạt và kịch bản ở User Story 1 cũng đúng với bảng thử này.

**Acceptance Scenarios**:

1. **Given** một bảng khai báo bằng bộ cột chuẩn và khuôn chính sách mẫu, **When** chạy migration,
   **Then** bảng có `account_id NOT NULL` + khóa ngoại tới `account.accounts`, chính sách bảo mật mức
   dòng được bật và áp dụng cho cả đọc lẫn ghi (kể cả điều kiện kiểm tra khi ghi).
2. **Given** một bảng có cột `account_id` nhưng chưa bật chính sách, **When** chạy lệnh kiểm tra quy
   ước CSDL, **Then** kiểm tra thất bại và nêu schema, tên bảng.
3. **Given** một bảng khách hàng có chỉ mục không bắt đầu bằng `account_id` (ngoài khóa chính), **When**
   chạy kiểm tra, **Then** kiểm tra thất bại, trừ khi chỉ mục được đánh dấu ngoại lệ có ghi lý do.
4. **Given** chèn một dòng không truyền `id`, **When** lưu, **Then** `id` là UUID v7 do ứng dụng sinh;
   `created_at`, `updated_at` là thời điểm UTC.
5. **Given** một bảng có cột `version`, **When** hai giao dịch cùng cập nhật một dòng với cùng
   `version` cũ, **Then** chỉ một giao dịch thành công; giao dịch còn lại nhận lỗi "xung đột phiên bản"
   có mã lỗi riêng để tầng trên hiển thị "Bài vừa được người khác sửa".

---

### User Story 4 - Ngữ cảnh hệ thống và hỗ trợ tách biệt với ngữ cảnh khách hàng (Priority: P2)

Một số việc không thuộc một tài khoản (thu thập xu hướng dùng chung, việc định kỳ, công cụ tra cứu hỗ
trợ). Lớp CSDL cung cấp các ngữ cảnh riêng có tên rõ ràng: **ngữ cảnh hệ thống** ghi được schema
dùng chung; khi cần xử lý cho một tài khoản cụ thể (vd chia chi phí xu hướng dùng chung vào từng tài
khoản), việc hệ thống mở thêm ngữ cảnh tenant của tài khoản đó và chịu cùng chính sách như `app`;
**ngữ cảnh hỗ trợ** chỉ đọc qua khung nhìn đã
lọc và mọi lần dùng được ghi nhật ký kiểm toán. Không có cách nào "tắt chính sách" từ mã ứng dụng.

**Why this priority**: Cần có vai trò và ranh giới ngay để các module sau không lấy tắt bằng vai trò
`owner`; còn khung nhìn hỗ trợ cụ thể và hàm bộ đếm sẽ làm cùng các module nghiệp vụ.

**Independent Test**: Dùng ngữ cảnh hệ thống không có ngữ cảnh tenant đọc bảng mẫu → 0 dòng; dùng ngữ
cảnh hệ thống + ngữ cảnh tenant A → chỉ thấy dòng của A; dùng ngữ cảnh hỗ trợ đọc trực tiếp bảng gốc → bị từ chối; mỗi lần mở ngữ cảnh hỗ trợ tạo đúng
một dòng nhật ký kiểm toán.

**Acceptance Scenarios**:

1. **Given** vai trò `system` chưa đặt ngữ cảnh tenant, **When** đọc bảng khách hàng mẫu, **Then**
   không thấy dòng nào (dev/test: lỗi theo FR-008).
2. **Given** vai trò `system` trong giao dịch có ngữ cảnh tenant A, **When** đọc/ghi bảng khách hàng
   mẫu, **Then** chỉ thấy và chỉ ghi được dòng của A; ghi dòng của B bị từ chối (giống `app`).
3. **Given** vai trò `support`, **When** đọc trực tiếp bảng gốc của khách hàng, **Then** bị từ chối;
   chỉ đọc được khung nhìn đã được cấp quyền.
4. **Given** ngữ cảnh hỗ trợ được mở để xem chi tiết tài khoản A, **When** truy vấn chạy, **Then** chỉ
   thấy dữ liệu của A qua khung nhìn chi tiết, và có một dòng nhật ký kiểm toán ghi người xem, tài
   khoản bị xem, thời điểm, lý do – không chứa dữ liệu bí mật.
5. **Given** nhân viên hỗ trợ tìm theo một từ khóa (email, mã bài, mã lượt đăng), **When** chạy bước
   tìm kiếm, **Then** chỉ nhận về mã tài khoản, mã đối tượng và trạng thái (không có nội dung bài, không
   có cột bí mật), và có một dòng nhật ký kiểm toán ghi người tìm, loại từ khóa, thời điểm.
6. **Given** mã ứng dụng chạy bằng vai trò `app`, **When** thử tắt chính sách bảo mật mức dòng hoặc
   chuyển sang vai trò khác, **Then** CSDL từ chối.

---

### Edge Cases

- Mã tài khoản truyền vào ngữ cảnh rỗng, sai định dạng UUID hoặc là tài khoản không tồn tại: lớp CSDL
  từ chối mở giao dịch (lỗi rõ ràng), MUST NOT rơi về "không ngữ cảnh" một cách âm thầm rồi chạy tiếp.
- Giao dịch lồng nhau (một hàm đã ở trong giao dịch ngữ cảnh A gọi hàm khác cũng mở giao dịch): dùng lại
  giao dịch ngoài nếu cùng tài khoản; nếu khác tài khoản → lỗi, MUST NOT đổi ngữ cảnh giữa chừng.
- Lỗi giữa giao dịch: giao dịch hoàn tác toàn bộ, biến phiên tự mất cùng giao dịch, kết nối trả bể sạch.
- Kết nối bị ngắt giữa giao dịch: không để lại ngữ cảnh trên kết nối mới; lỗi trả về cho người gọi.
- Truy vấn chạy ngoài giao dịch qua bể kết nối dùng chung (vd chế độ tự xác nhận từng câu lệnh): MUST
  NOT thấy dữ liệu khách hàng.
- Bảng dùng chung không có `account_id` (vd `trends.industries`, `ai_gateway.model_prices`): không bật
  chính sách tenant; kiểm tra quy ước MUST phân biệt được bảng dùng chung (khai báo rõ) với bảng
  khách hàng bị quên cột.
- Bảng `account.accounts` là gốc tenant: chính sách chỉ cho thấy đúng dòng của tài khoản trong ngữ cảnh;
  việc tạo tài khoản mới (đăng ký) cần một đường riêng sẽ đặc tả ở module `account` (xem Assumptions).
- Xóa hẳn tài khoản: xóa dòng `account.accounts` MUST xóa dây chuyền toàn bộ dòng của tài khoản đó ở
  mọi bảng nghiệp vụ trong một giao dịch – phục vụ yêu cầu xóa ≤ 30 ngày (nguyên tắc VII). Bảng nhật ký
  phân vùng (vd `infra.audit_log`) không bị xóa dây chuyền: dòng của tài khoản giữ đến khi phân vùng hết
  hạn 12 tháng, nhưng các trường dữ liệu cá nhân MUST được ẩn danh hóa khi tài khoản bị xóa. Việc thực
  thi ẩn danh hóa thuộc luồng xóa tài khoản của module `account`; ở đây chỉ cần cấu trúc cho phép.
- Hai bản API/Worker cũ và mới chạy song song khi phát hành: migration MUST tương thích ngược (chỉ
  thêm, không đổi tên/xóa cột đang dùng trong cùng lần phát hành).
- Chuỗi kết nối, mật khẩu vai trò CSDL MUST NOT xuất hiện trong nhật ký, thông báo lỗi, kết quả kiểm tra.

## Requirements *(mandatory)*

### Functional Requirements

**Kết nối & vai trò CSDL**

- **FR-001**: Hệ thống MUST có 4 vai trò CSDL theo kiến trúc dữ liệu mục 6: `owner` (chỉ dùng cho
  migration, sở hữu mọi schema/bảng), `app` (API và Worker khi xử lý việc của khách hàng; chịu chính
  sách bảo mật mức dòng, không có quyền bỏ qua), `system` (việc dùng chung; ghi schema dùng chung;
  với bảng khách hàng có cùng quyền như `app` và chịu cùng chính sách bảo mật mức dòng, không có quyền
  bỏ qua), `support` (chỉ đọc khung nhìn đã lọc).
- **FR-002**: API và Worker MUST kết nối bằng vai trò `app` qua một bể kết nối dùng chung trong tiến
  trình; công cụ migration MUST dùng `owner` với cấu hình kết nối riêng. Cấu hình được kiểm tra khi
  khởi động theo FR-006 của tính năng 001.
- **FR-003**: Lớp CSDL MUST là cách duy nhất để module truy cập CSDL; mỗi module chỉ thấy định nghĩa
  bảng của chính mình (nguyên tắc IV). Kiểm tra ranh giới của tính năng 001 MUST phát hiện module nhập
  định nghĩa bảng của module khác.

**Ngữ cảnh tenant trong giao dịch**

- **FR-004**: Lớp CSDL MUST cung cấp thao tác "chạy trong giao dịch của tài khoản X": mở giao dịch, đặt
  biến phiên tenant ở phạm vi **giao dịch** (không phải phạm vi kết nối), chạy công việc, xác nhận hoặc
  hoàn tác. Mã tài khoản MUST đến từ ngữ cảnh yêu cầu đã xác thực (API) hoặc dữ liệu việc (Worker);
  thao tác MUST NOT nhận mã tài khoản từ tham số/thân yêu cầu/đường dẫn của người dùng.
- **FR-005**: Thao tác ở FR-004 MUST từ chối mã tài khoản rỗng hoặc sai định dạng; MUST báo lỗi khi
  được gọi lồng trong một giao dịch của tài khoản khác.
- **FR-006**: Sau khi giao dịch kết thúc (xác nhận, hoàn tác, hoặc lỗi kết nối), kết nối trả về bể
  MUST NOT còn biến phiên tenant.
- **FR-007**: Ngữ cảnh tenant hiện hành MUST đọc được từ lõi dùng chung (để gắn `account_id` vào nhật ký
  có cấu trúc – nguyên tắc VIII), và MUST dùng được giống nhau ở API và Worker (Worker sẽ dùng khi
  gắn với hàng chờ ở WBS 1.3).
- **FR-008**: Truy vấn tới bảng khách hàng ngoài ngữ cảnh tenant: ở chế độ phát triển và kiểm thử lớp
  CSDL MUST ném lỗi nêu tên bảng; ở môi trường chính thức MUST NOT ném lỗi mà ghi nhật ký cảnh báo có
  cấu trúc (không chứa dữ liệu khách hàng). Ở mọi chế độ, CSDL MUST trả về 0 dòng (lớp chặn cuối).

**Schema theo module & migration**

- **FR-009**: MUST tạo schema cho mỗi module theo tệp kê khai module (`modules.manifest.json`) và bảng
  ánh xạ ở Key Entities (11 schema); `approval` là schema dành sẵn, để trống; `platform_gateway` có
  schema riêng (Clarifications của tính năng 001).
- **FR-010**: Cấu trúc CSDL MUST được quản lý bằng migration có thứ tự, lưu trong kho mã nguồn, chạy
  bằng một lệnh; chạy lại trên CSDL đã cập nhật MUST không lỗi và không thay đổi gì.
- **FR-011**: Migration MUST tạo vai trò, cấp quyền mặc định cho bảng mới (để bảng thêm sau tự có đúng
  quyền cho `app`/`system`/`support` mà không phải nhớ cấp tay) và thu hồi quyền tạo đối tượng của
  `app`.
- **FR-012**: MUST có hướng dẫn và quy tắc kiểm tra cho migration tương thích ngược (chỉ thêm; đổi tên/
  xóa cột phải tách hai lần phát hành). Việc gắn kiểm tra tự động vào CI thuộc WBS 1.4.

**Bảng gốc, bộ cột chuẩn & chính sách mẫu**

- **FR-013**: MUST tạo bảng gốc tenant `account.accounts` tối thiểu (mã, trạng thái, `created_at`,
  `updated_at`, `deleted_at`) làm đích khóa ngoại cho mọi bảng khách hàng; các cột nghiệp vụ khác (gói,
  ngày kích hoạt, …) do module `account` bổ sung sau.
- **FR-014**: MUST có bộ cột chuẩn dùng lại cho bảng khách hàng: `id` UUID v7 sinh ở ứng dụng;
  `account_id` NOT NULL, khóa ngoại tới `account.accounts` **xóa dây chuyền**; `created_at`, `updated_at` kiểu thời gian có
  múi giờ lưu UTC, tự đặt khi chèn/sửa; tùy chọn `deleted_at` (xóa mềm) và `version` (khóa lạc quan).
- **FR-015**: MUST có kiểu cột tiền dùng lại là số nguyên micro-USD (bigint); kiểm tra quy ước MUST
  phát hiện cột tiền khai báo bằng kiểu số thực.
- **FR-016**: MUST có một **khuôn chính sách bảo mật mức dòng mẫu** áp dụng bằng một khai báo cho mỗi
  bảng khách hàng: bật chính sách cho bảng; điều kiện đọc/sửa/xóa là `account_id` = biến phiên tenant;
  điều kiện ghi kiểm tra cùng điều kiện đó; thiếu biến phiên → không có dòng nào thỏa (mặc định an
  toàn). Chính sách MUST có hiệu lực với vai trò `app`.
- **FR-017**: MUST có một **bảng mẫu** dùng khuôn ở FR-014–FR-016 để kiểm chứng và làm ví dụ cho các
  module sau; bảng mẫu MUST chỉ tồn tại trong môi trường phát triển/kiểm thử, không có trong migration
  của môi trường chính thức.
- **FR-018**: Khóa ngoại MUST chỉ nằm trong nội bộ một schema hoặc trỏ tới `account.accounts`
  (ADR-09). Tham chiếu sang module khác là cột mã tham chiếu, không có khóa ngoại. Mỗi bảng MUST được
  khai báo thuộc một trong ba loại: **bảng khách hàng** (có `account_id` + khóa ngoại xóa dây chuyền +
  chính sách tenant), **bảng dùng chung** (không có `account_id`), **bảng nhật ký phân vùng** (có
  `account_id` nhưng không có khóa ngoại tới tài khoản; xóa theo phân vùng).
- **FR-019**: Khóa lạc quan: cập nhật dòng có cột `version` MUST là cập nhật có điều kiện theo
  `version` hiện tại và tăng `version`; không có dòng nào khớp → lỗi "xung đột phiên bản" có mã lỗi
  chuẩn theo định dạng lỗi chung của tính năng 001.

**Kiểm tra quy ước CSDL**

- **FR-020**: MUST có lệnh kiểm tra quy ước CSDL, chạy trên CSDL sau migration, phát hiện: (a) bảng có
  cột `account_id` chưa bật chính sách bảo mật mức dòng; (b) bảng khách hàng thiếu `account_id` mà
  không được khai báo là bảng dùng chung; (c) khóa ngoại xuyên schema không trỏ tới `account.accounts`;
  (d) chỉ mục của bảng khách hàng không bắt đầu bằng `account_id` mà không có ngoại lệ ghi lý do;
  (e) cột tiền kiểu số thực; (f) bảng/schema không thuộc `owner`; (g) vai trò `app` có quyền bỏ qua
  chính sách hoặc quyền đổi cấu trúc; (h) bảng khách hàng có khóa ngoại tới `account.accounts` không
  xóa dây chuyền, hoặc bảng nhật ký phân vùng có khóa ngoại tới tài khoản. Kết quả nêu schema, bảng,
  quy tắc vi phạm; trả mã thất bại.
- **FR-021**: Lệnh ở FR-020 MUST được thêm vào lệnh kiểm tra toàn kho (FR-018 của tính năng 001) khi có
  CSDL kiểm thử; việc chạy trong CI thuộc WBS 1.4.

**Ngữ cảnh hệ thống & hỗ trợ**

- **FR-022**: Lớp CSDL MUST có thao tác "chạy trong ngữ cảnh hệ thống" dùng vai trò `system` cho việc
  dùng chung. Khi chưa đặt ngữ cảnh tenant, `system` MUST thấy 0 dòng ở bảng khách hàng (dev/test: lỗi
  theo FR-008). Khi cần xử lý cho một tài khoản, `system` MUST dùng cùng thao tác đặt ngữ cảnh tenant
  trong giao dịch như FR-004–FR-006 và chịu cùng chính sách; mỗi giao dịch chỉ một tài khoản.
- **FR-023**: Lớp CSDL MUST có hai thao tác hỗ trợ dùng vai trò `support`, mỗi lần gọi MUST ghi một
  dòng vào `infra.audit_log` trong cùng giao dịch (không chứa dữ liệu bí mật):
  (1) **tìm kiếm** – xuyên tài khoản, chỉ trên khung nhìn tìm kiếm hẹp trả về mã tài khoản, mã đối
  tượng, trạng thái; MUST NOT trả nội dung bài hay cột bí mật; kiểm toán ghi người tìm, loại từ khóa,
  thời điểm; (2) **xem chi tiết** – nhận người xem, đúng một tài khoản và lý do; đặt ngữ cảnh tenant của
  tài khoản đó như FR-004 và chỉ đọc khung nhìn chi tiết đã lọc; kiểm toán ghi người xem, tài khoản,
  thời điểm, lý do. Ở tính năng này chỉ cần khung nhìn tìm kiếm mẫu và khung nhìn chi tiết mẫu trên bảng
  mẫu; khung nhìn thật làm cùng màn hình hỗ trợ (FR-10 của đặc tả gốc).
- **FR-024**: Bảng `infra.audit_log` MUST được tạo ở dạng bảng nhật ký phân vùng theo tháng (theo kiến
  trúc dữ liệu mục 7.2; không có khóa ngoại tới tài khoản – FR-018), chỉ thêm, không sửa/xóa từ vai trò `app`/`support`; việc tạo phân vùng tháng mới tự động là
  việc định kỳ ở WBS 1.3 – ở đây tạo sẵn phân vùng tháng hiện tại và tháng kế tiếp.

**Kiểm thử & tài liệu**

- **FR-025**: MUST có bộ kiểm thử tích hợp chạy trên PostgreSQL thật (không giả lập) chứng minh mọi kịch
  bản ở User Story 1–4, gồm: đọc/sửa/xóa/chèn chéo tenant đều thất bại trên bảng mẫu; không rò biến
  phiên khi dùng lại kết nối; hai giao dịch đồng thời của hai tài khoản. Bộ kiểm thử truy cập chéo
  tổng quát cho **mọi** bảng và gắn CI thuộc WBS 1.4, nhưng MUST tái sử dụng được khuôn kiểm thử ở đây.
- **FR-026**: MUST có tài liệu tiếng Việt: cách thêm bảng khách hàng mới (bộ cột chuẩn + khuôn chính
  sách), cách thêm bảng dùng chung, cách viết migration tương thích ngược, cách dùng các ngữ cảnh
  tenant/hệ thống/hỗ trợ, và danh sách ánh xạ thuật ngữ mới (nếu có) bổ sung vào bảng thuật ngữ.
- **FR-027**: Môi trường phát triển MUST dựng được PostgreSQL cục bộ bằng một lệnh, cùng phiên bản lớn
  với môi trường chính thức (≥ 13), chạy được trên Windows và Linux.

### Key Entities *(include if feature involves data)*

- **Schema module** (ánh xạ theo tính năng 001):

  | Module | Schema | Bảng tạo trong tính năng này |
  |---|---|---|
  | `account` | `account` | `accounts` (tối thiểu – FR-013) |
  | `context` | `context` | — |
  | `media` | `media` | — |
  | `trends` | `trends` | — |
  | `content` | `content` | — |
  | `approval` | `approval` (dành sẵn, để trống) | — |
  | `publishing` | `publishing` | — |
  | `platform_gateway` | `platform_gateway` | — |
  | `ai_gateway` | `ai_gateway` | — |
  | `notifications` | `notifications` | — |
  | `queue` | `infra` | `audit_log` (phân vùng theo tháng – FR-024) |
  | (chỉ phát triển/kiểm thử) | schema kiểm thử riêng | bảng mẫu tenant + khung nhìn tìm kiếm hỗ trợ mẫu + khung nhìn chi tiết hỗ trợ mẫu (FR-017, FR-023) |

- **Tài khoản (`account.accounts`)**: gốc tenant; mọi bảng khách hàng có khóa ngoại tới đây.
- **Ngữ cảnh tenant**: mã tài khoản gắn với một giao dịch; tồn tại đúng trong thời gian giao dịch.
- **Vai trò CSDL**: `owner`, `app`, `system`, `support` – quyền theo FR-001.
- **Khuôn chính sách mẫu**: điều kiện chuẩn "chỉ dòng của tài khoản trong ngữ cảnh" cho đọc và ghi.
- **Nhật ký kiểm toán (`infra.audit_log`)**: ai xem dữ liệu tài khoản nào, khi nào, vì sao.
- **Thuật ngữ mới cần thêm vào bảng ánh xạ**: biến phiên tenant → `app.account_id` (đã có trong kiến
  trúc triển khai mục 5); bảng mẫu → tên do plan đặt; "bảng dùng chung" → đánh dấu `shared`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% các thao tác đọc/sửa/xóa/chèn chéo tenant trong bộ kiểm thử (tối thiểu 4 thao tác ×
  2 chiều A→B, B→A trên bảng mẫu) bị chặn; 0 dòng của tài khoản khác bị lộ hoặc bị thay đổi.
- **SC-002**: 0 lần rò ngữ cảnh tenant qua kết nối dùng lại trong 1.000 vòng lặp giao dịch xen kẽ hai
  tài khoản (gồm cả giao dịch bị hoàn tác do lỗi) trên bể kết nối nhỏ.
- **SC-003**: 100% các vi phạm mẫu (ít nhất một trường hợp cho mỗi quy tắc (a)–(h) ở FR-020) bị lệnh
  kiểm tra quy ước phát hiện; 0 báo sai trên cấu trúc sạch sau migration.
- **SC-004**: Từ CSDL trống, lệnh migration hoàn tất trong ≤ 1 phút; chạy lại lần hai không thay đổi gì.
- **SC-005**: Thêm một bảng khách hàng mới theo tài liệu hướng dẫn (có chính sách, bộ cột chuẩn, đạt
  kiểm tra quy ước) mất ≤ 15 phút với lập trình viên đã đọc tài liệu.
- **SC-006**: Việc đặt ngữ cảnh tenant làm tăng thời gian một giao dịch đơn giản không quá 5 ms ở p95
  trên môi trường phát triển (giữ được mục tiêu kiểm tra ngân sách AI ≤ 50 ms về sau).
- **SC-007**: 100% lần tìm kiếm và lần xem chi tiết hỗ trợ có đúng một dòng nhật ký kiểm toán tương
  ứng; 0 cột nội dung bài hoặc bí mật xuất hiện trong kết quả tìm kiếm.
- **SC-008**: 0 chuỗi kết nối/mật khẩu CSDL xuất hiện trong nhật ký và thông báo lỗi khi chạy toàn bộ
  bộ kiểm thử (kiểm bằng quét nhật ký mẫu).

## Assumptions

- Phạm vi là WBS 1.2. **Ngoài phạm vi**: bảng nghiệp vụ thật của các module (users, posts,
  publish_attempts, ai_budgets, …) – làm trong đặc tả của từng module; hàm `SECURITY DEFINER` cho bộ đếm
  hạn mức/ngân sách – làm cùng module `account`/`ai_gateway`; khung nhìn hỗ trợ thật; lớp hàng chờ
  pg-boss, việc định kỳ tạo phân vùng, Worker đặt lại ngữ cảnh khi lấy việc (WBS 1.3); gắn kiểm tra vào
  CI, bộ kiểm thử truy cập chéo cho mọi bảng, kiểm tra migration tương thích ngược tự động (WBS 1.4);
  hạ tầng CSDL được quản lý/CloudNativePG, sao lưu, khôi phục theo thời điểm (WBS 1.5).
- Ngăn xếp đã chốt theo hiến pháp: PostgreSQL ≥ 13 có Row-Level Security, Drizzle làm lớp truy cập và
  công cụ migration. Đặc tả không chọn lại; chi tiết (trình điều khiển kết nối, cách sinh UUID v7, cách
  phát hiện truy vấn ngoài ngữ cảnh) do `/speckit-plan` quyết định, ghi lý do.
- Biến phiên tenant tên `app.account_id`, đặt bằng cơ chế cấu hình phạm vi giao dịch của PostgreSQL;
  chính sách so sánh `account_id` với giá trị biến này, thiếu biến → NULL → không dòng nào thỏa (theo
  kiến trúc triển khai mục 5). ADR-02 ghi "mỗi kết nối đặt biến phiên"; hiến pháp và kiến trúc dữ liệu
  mục 6 chốt **phạm vi giao dịch** – đặc tả theo hiến pháp, plan nên đề xuất sửa câu chữ ADR-02.
- Quyết định cho vai trò `system` (Clarifications 2026-11-07) khác kiến trúc dữ liệu mục 6 và kiến trúc
  triển khai mục 5 ("không đọc nội dung bài"; ghi bộ đếm qua hàm được cấp quyền riêng): `system` đặt
  được ngữ cảnh tenant và khi đó đọc/ghi được dữ liệu của đúng tài khoản ấy. Cô lập tenant (nguyên tắc
  I) vẫn giữ vì `system` chịu cùng chính sách. Plan MUST ghi lý do vào "Theo dõi độ phức tạp" và đề xuất
  sửa hai tài liệu trên (hoặc ADR bổ sung).
- ~~`platform_gateway` dùng chung schema `publishing`~~ – cập nhật 2026-11-08 theo plan/Clarifications
  của tính năng 001 và `architecture.md` v1.1: `platform_gateway` có schema riêng, `approval` có schema
  dành sẵn để trống. Danh sách schema lấy từ `modules.manifest.json` (11 schema).
- Việc đăng ký tài khoản mới (chèn dòng `account.accounts` khi chưa có ngữ cảnh tenant) cần một đường
  riêng có kiểm soát; tính năng này chỉ cung cấp khả năng tạo tài khoản trong kiểm thử. Cơ chế cho môi
  trường thật được đặc tả ở module `account` (FR-13/14/15 của đặc tả gốc).
- Bảng `infra.audit_log` được tạo sớm ở đây vì ngữ cảnh hỗ trợ cần nó; cấu trúc tối thiểu, module hạ
  tầng có thể bổ sung cột (theo hướng chỉ thêm).
- Bảng mẫu chỉ có ở phát triển/kiểm thử; các module thật sẽ thay thế nó làm ví dụ về sau.
- Kho chưa có lịch sử git; không ảnh hưởng phạm vi.
