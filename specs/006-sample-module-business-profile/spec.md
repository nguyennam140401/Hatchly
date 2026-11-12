# Feature Specification: Module mẫu trọn luồng màn hình → CSDL – khung "Hồ sơ kinh doanh"

**Feature Branch**: `006-sample-module-business-profile`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: "Xây dựng Module mẫu làm trọn từ màn hình tới CSDL (đề xuất: khung của "Hồ sơ
kinh doanh"), kèm kiểm thử mẫu; đội sẽ chép theo mẫu này đáp ứng được yêu cầu tài liệu kiến trúc và nghiệp vụ
của app"

**Truy vết**: WBS K6 (module mẫu trọn luồng, kèm kiểm thử mẫu) · chuẩn bị WBS T7 (Hồ sơ kinh doanh có phiên
bản, tải tệp, AI tóm tắt – phát triển tiếp trên mẫu này) · FR-01 · UI/UX mục 5 F1 bước 2, mục 7 (màn hình "Hồ sơ
kinh doanh"), mục 9 (phân quyền: Chủ sửa, CTV chỉ xem –
`TaiLieuDacTa/Mo_ta_UI_UX_App_AI_Content_MXH.md#uiux-9-ho-so-kinh-doanh`), U5 · Đặc tả yêu cầu mục 3.1 danh mục quyền
(`TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#pq-context-view`, `#pq-context-edit`) · ADD tổng thể mục 6 (module Ngữ cảnh kinh doanh),
mục 7 (ngữ cảnh tenant) · Kiến trúc dữ liệu (bảng `business_profiles`, `profile_versions`; quy ước dữ liệu;
không cache) · ADR-02, ADR-09 · Hiến pháp nguyên tắc I, IV, VI, VII, VIII và mục "Quy trình phát triển & cổng
chất lượng".

**Phụ thuộc**: `001-monorepo-module-skeleton` (module `context`, tệp kê khai module, kiểm tra ranh giới) ·
`002-db-layer-tenant-rls` (giao dịch có ngữ cảnh tenant, bảo mật mức dòng, công cụ phát hiện bảng thiếu chính
sách) · `003-queue-layer-pgboss` (tạo việc trong cùng giao dịch, khung Worker) · `004-minimal-auth-rbac` (phiên đăng nhập, vai trò chủ / cộng tác viên / hỗ trợ, chặn quyền ở API) ·
`005-gateway-contracts-fakes` (chỉ để biết điểm nối với Cổng AI ở T7; tính năng này không gọi AI).

**Bối cảnh**: Sau K1–K5 đội đã có khung kho mã, lớp CSDL, hàng chờ, xác thực và hợp đồng các cổng, nhưng chưa
có **một tính năng nghiệp vụ nào chạy trọn** từ màn hình qua API, module, CSDL và ngược lại. WBS yêu cầu cuối
giai đoạn 0 "mỗi lập trình viên nhận một tính năng và viết ngay được nghiệp vụ, không phải tự quyết định cấu
trúc". Tính năng này cung cấp:

1. **Một lát dọc nghiệp vụ thật** – khung Hồ sơ kinh doanh: xem, sửa, lưu thành phiên bản mới, xem lịch sử
   phiên bản; đúng phân quyền chủ / cộng tác viên; đúng cô lập tenant; chặn ghi đè khi hai người cùng sửa; phát sự kiện "hồ sơ đã thay đổi" thành việc nền trong cùng
   giao dịch, có bộ xử lý mẫu ở Worker.
2. **Bộ kiểm thử mẫu** phủ mọi tầng (quy tắc nghiệp vụ, API, phân quyền, truy cập chéo tenant, cạnh tranh ghi,
   màn hình) để module sau chép lại.
3. **Hướng dẫn "chép mẫu"** – danh sách các bước và các điểm bắt buộc khi tạo module/tính năng mới theo mẫu.

**Ngoài phạm vi** (thuộc T7 hoặc tính năng sau): tải tệp ngữ cảnh (bảng giá, chính sách) và bảng
`context_files`; AI tóm tắt hồ sơ / tệp để người dùng xác nhận; dùng hồ sơ trong lời gọi tạo nội dung; khôi phục
một phiên bản cũ; thanh tiến độ "Bắt đầu" ở Tổng quan; màn hình tra cứu hỗ trợ đầy đủ.

## Clarifications

### Session 2026-11-11

- Q: Cộng tác viên có được xem Hồ sơ kinh doanh không (bảng quyền 004 ghi chỉ chủ, UI/UX U5 ghi CTV chỉ xem)?
  → A: Có. Tách thành 2 quyền: `context.view` (chủ + cộng tác viên) và `context.edit` (chỉ chủ); sửa bảng quyền
  FR-012 của 004 cho khớp.
- Q: Nhân viên hỗ trợ có được đọc Hồ sơ kinh doanh của khách hàng không? → A: Không. Giữ đúng bảng quyền 004; mọi
  yêu cầu từ vai trò hỗ trợ/quản trị nội bộ vào hồ sơ đều bị từ chối; không làm khung nhìn hỗ trợ cho hồ sơ.
- Q: Khi gói tạm dừng/hết hạn, chủ còn được sửa hồ sơ không? → A: Có, sửa bình thường; hướng dẫn chép mẫu chỉ ghi
  chú điểm gắn kiểm tra trạng thái gói cho tính năng gói dịch vụ sau này.
- Q: Chốt giới hạn độ dài và danh mục ngành? → A: Chốt: giới thiệu ≤ 2.000 ký tự; sản phẩm/dịch vụ, chính sách
  ≤ 5.000 mỗi trường; giọng văn ≤ 500; ≤ 20 từ khóa, mỗi từ ≤ 50; chọn đúng 1 ngành trong danh mục cố định; chọn
  "Khác" thì bắt buộc nhập tên ngành tự do ≤ 100 ký tự.
- Q: Mẫu có minh họa phát sự kiện "hồ sơ đã thay đổi" (= tạo job trong cùng giao dịch lưu + bộ xử lý mẫu ở Worker)
  không? → A: Có. Bộ xử lý mẫu chỉ ghi nhật ký có cấu trúc, idempotent, không tác dụng phụ thật; T7 gắn AI tóm tắt
  vào đây. Không tạo bảng/cơ chế sự kiện riêng ngoài hàng chờ (tránh cần ADR mới).

## User Scenarios & Testing *(mandatory)*

Tính năng có hai nhóm người dùng: **chủ kinh doanh và cộng tác viên** (dùng màn hình Hồ sơ kinh doanh) và **đội
phát triển** (chép mẫu). Mỗi câu chuyện nghiệp vụ dưới đây đồng thời là một phần của mẫu.

### User Story 1 - Chủ tài khoản điền và cập nhật hồ sơ kinh doanh (Priority: P1)

Chủ tài khoản mở "Hồ sơ kinh doanh", chọn ngành, nhập giới thiệu, sản phẩm/dịch vụ, chính sách, giọng văn mong
muốn và từ khóa riêng, rồi bấm "Lưu". Mỗi lần lưu tạo một phiên bản mới; phiên bản mới nhất là hồ sơ hiện hành
(sau này AI dùng cho lần tạo nội dung kế tiếp – FR-01). Lần đầu mở khi chưa có hồ sơ, màn hình hiện biểu mẫu trống
kèm lời gợi ý vì sao nên điền.

**Why this priority**: Đây là lát dọc tối thiểu chứng minh mẫu chạy trọn từ màn hình tới CSDL; cũng là bước 2
của luồng bắt đầu sử dụng (F1).

**Independent Test**: Đăng nhập bằng chủ tài khoản mới → mở màn hình → thấy biểu mẫu trống có gợi ý → điền và lưu
→ tải lại trang thấy đúng dữ liệu, ghi "Phiên bản 1"; sửa một trường và lưu → "Phiên bản 2".

**Acceptance Scenarios**:

1. **Given** tài khoản chưa có hồ sơ, **When** chủ mở màn hình, **Then** thấy biểu mẫu trống và thông điệp gợi ý
   "AI sẽ viết tốt hơn nếu bạn bổ sung…", không thấy lỗi.
2. **Given** biểu mẫu hợp lệ, **When** chủ bấm "Lưu", **Then** hồ sơ được lưu thành phiên bản 1, màn hình báo
   thành công bằng chữ tiếng Việt và hiển thị thời điểm lưu theo giờ Việt Nam (UTC+7).
3. **Given** hồ sơ đang ở phiên bản N, **When** chủ sửa và lưu, **Then** tạo phiên bản N+1; phiên bản N vẫn còn
   nguyên trong lịch sử.
4. **Given** chủ để trống trường bắt buộc hoặc nhập vượt độ dài cho phép, **When** bấm "Lưu", **Then** không lưu,
   lỗi hiện ngay cạnh trường bằng tiếng Việt đời thường kèm cách sửa; kiểm tra này diễn ra cả ở màn hình và ở máy
   chủ (gửi thẳng yêu cầu sai lên máy chủ cũng bị từ chối với cùng thông điệp).
5. **Given** chủ bấm "Lưu" mà nội dung không thay đổi so với phiên bản hiện hành, **When** gửi, **Then** không tạo
   phiên bản mới và báo "Không có thay đổi để lưu".
6. **Given** chủ đang sửa dở, **When** rời màn hình, **Then** được hỏi xác nhận trước khi bỏ thay đổi chưa lưu.

---

### User Story 2 - Phân quyền: chủ sửa, cộng tác viên chỉ xem, chặn ở máy chủ (Priority: P1)

Cộng tác viên mở "Hồ sơ kinh doanh" để hiểu giọng văn của cửa hàng, nhưng không được sửa (UI/UX U5 đã chốt).
Màn hình hiện ở chế độ chỉ xem; nếu cộng tác viên cố gửi yêu cầu sửa thẳng lên máy chủ thì vẫn bị từ chối.

**Why this priority**: Nguyên tắc VI yêu cầu kiểm tra quyền ở API, không chỉ ẩn nút. Mẫu phải chỉ rõ cách làm để
mọi module sau làm giống.

**Independent Test**: Đăng nhập cộng tác viên → màn hình chỉ xem, không có nút "Lưu"; gửi trực tiếp yêu cầu lưu →
bị từ chối với thông điệp tiếng Việt kèm hướng dẫn ("Nhờ chủ tài khoản cập nhật"), không phiên bản nào được tạo.

**Acceptance Scenarios**:

1. **Given** người dùng là cộng tác viên, **When** mở màn hình, **Then** thấy toàn bộ nội dung hồ sơ hiện hành và
   lịch sử phiên bản, các trường không sửa được, có dòng giải thích vì sao chỉ xem.
2. **Given** cộng tác viên, **When** gửi yêu cầu lưu bằng bất kỳ cách nào, **Then** máy chủ từ chối là "không đủ
   quyền", không đổi dữ liệu.
3. **Given** người chưa đăng nhập, **When** truy cập màn hình hoặc API, **Then** bị chuyển tới đăng nhập / từ chối.

---

### User Story 3 - Cô lập dữ liệu giữa tài khoản (Priority: P1)

Hồ sơ của tài khoản A không bao giờ đọc, sửa được từ tài khoản B, kể cả khi B đoán hay sửa tay mã phiên bản, mã
hồ sơ trong yêu cầu. Mã tài khoản luôn lấy từ phiên đăng nhập.

**Why this priority**: Nguyên tắc I không thương lượng; đây là bài kiểm thử truy cập chéo bắt buộc trong CI mà mọi
module sau phải chép.

**Independent Test**: Tạo hồ sơ cho A và B; đăng nhập B, thử đọc phiên bản của A bằng mã của nó, thử lưu đè hồ sơ
A → đều thất bại như thể không tồn tại; ở tầng CSDL, truy vấn không có ngữ cảnh tenant không thấy dòng nào.

**Acceptance Scenarios**:

1. **Given** B đăng nhập, **When** yêu cầu xem phiên bản thuộc A theo mã, **Then** nhận "không tìm thấy" (không lộ
   sự tồn tại).
2. **Given** yêu cầu kèm mã tài khoản trong tham số, thân hoặc đường dẫn, **When** máy chủ xử lý, **Then** giá trị
   đó bị bỏ qua hoặc yêu cầu bị từ chối; dữ liệu chỉ thuộc tài khoản của phiên.
3. **Given** truy cập CSDL bằng vai trò ứng dụng mà không có ngữ cảnh tenant, **When** đọc bảng hồ sơ, **Then**
   không thấy dòng nào.
4. **Given** công cụ phát hiện bảng thiếu chính sách bảo mật mức dòng chạy trong CI, **When** quét các bảng mới của
   tính năng, **Then** không báo lỗi.

---

### User Story 4 - Hai người cùng sửa không ghi đè nhau (Priority: P2)

Chủ tài khoản mở hồ sơ trên máy tính và điện thoại (hoặc hai tab), sửa ở cả hai rồi lưu. Lần lưu sau phải bị chặn
vì dựa trên phiên bản cũ, kèm hướng dẫn tải lại để xem bản mới nhất; không mất âm thầm thay đổi nào.

**Why this priority**: Quy ước dữ liệu yêu cầu cột phiên bản chặn ghi đè; mẫu cần một ví dụ rõ để bài, phiên bản
kênh (module Nội dung) chép theo.

**Independent Test**: Mở hai phiên cùng ở phiên bản N; lưu phiên 1 → N+1; lưu phiên 2 → bị từ chối "Hồ sơ vừa được
cập nhật ở nơi khác", có nút "Tải bản mới nhất"; gửi đồng thời nhiều yêu cầu lưu từ cùng phiên bản N → đúng một
yêu cầu thành công.

**Acceptance Scenarios**:

1. **Given** hai phiên cùng dựa trên phiên bản N, **When** cả hai lưu, **Then** chỉ một tạo được N+1, phiên còn lại
   nhận thông báo xung đột kèm hành động khắc phục; thay đổi chưa lưu của phiên đó vẫn còn trên màn hình.
2. **Given** 10 yêu cầu lưu đồng thời dựa trên cùng phiên bản, **When** xử lý, **Then** đúng 1 thành công, số phiên
   bản không có lỗ hay trùng.

---

### User Story 5 - Xem lịch sử phiên bản (Priority: P2)

Chủ và cộng tác viên xem danh sách phiên bản hồ sơ (số phiên bản, thời điểm, người lưu) và mở xem nội dung một
phiên bản cũ ở chế độ chỉ đọc.

**Why this priority**: FR-01 yêu cầu hồ sơ có phiên bản; UI/UX ghi thao tác "xem lịch sử phiên bản". Đây cũng là
mẫu cho danh sách có phân trang.

**Independent Test**: Lưu 3 lần → lịch sử hiện 3 dòng, mới nhất đầu tiên, ghi người lưu và giờ UTC+7; mở phiên bản 1
thấy đúng nội dung lúc đó.

**Acceptance Scenarios**:

1. **Given** hồ sơ có nhiều phiên bản, **When** mở lịch sử, **Then** thấy danh sách sắp xếp mới nhất trước, phân
   trang khi quá 20 dòng.
2. **Given** chọn một phiên bản cũ, **When** mở, **Then** thấy đúng nội dung phiên bản đó, ghi rõ "Bản cũ – chỉ xem".
3. **Given** người lưu đã bị gỡ khỏi tài khoản, **When** xem lịch sử, **Then** vẫn hiển thị được (vd "Thành viên đã
   rời"), không lỗi.

---

### User Story 6 - Module khác đọc hồ sơ hiện hành qua giao diện công khai (Priority: P2)

Module Nội dung / Cổng AI (sau này) cần hồ sơ hiện hành của tài khoản đang xử lý, kèm số phiên bản (để ghi bài được
tạo từ phiên bản nào và giữ thứ tự lời nhắc theo phiên bản). Module đó chỉ gọi giao diện công khai của module Ngữ
cảnh kinh doanh, không đọc bảng của nó.

**Why this priority**: Nguyên tắc IV; mẫu phải có một ví dụ thao tác công khai cùng kiểm thử hợp đồng của nó, chạy
được cả trong yêu cầu API lẫn trong việc nền của Worker.

**Independent Test**: Gọi thao tác công khai "lấy hồ sơ hiện hành" trong ngữ cảnh tenant A → nhận hồ sơ A với số
phiên bản; trong ngữ cảnh B chưa có hồ sơ → nhận "chưa có hồ sơ" (không lỗi); không có ngữ cảnh tenant → bị từ chối.
Kiểm tra ranh giới module báo lỗi nếu module khác import phần nội bộ hoặc truy cập schema `context`.

**Acceptance Scenarios**:

1. **Given** ngữ cảnh tenant hợp lệ, **When** gọi thao tác công khai, **Then** nhận hồ sơ hiện hành của đúng tenant
   đó kèm số phiên bản, chỉ gồm các trường nghiệp vụ (không có thông tin liên hệ của chủ tài khoản).
2. **Given** một module viết mã đọc thẳng bảng của `context`, **When** chạy kiểm tra ranh giới trong CI, **Then**
   kiểm tra thất bại.
3. **Given** chủ lưu hồ sơ thành phiên bản N, **When** giao dịch lưu thành công, **Then** đúng một việc nền "hồ sơ đã
   thay đổi" mang mã tài khoản và số phiên bản N được tạo; Worker đặt lại ngữ cảnh tenant, chạy bộ xử lý mẫu và ghi
   nhật ký có cấu trúc.
4. **Given** giao dịch lưu bị hủy (lỗi hợp lệ, xung đột, lỗi giữa chừng), **When** kết thúc, **Then** không có việc
   nền nào được tạo.
5. **Given** cùng một việc nền bị chạy lại (Worker khởi động lại, khóa hết hạn), **When** bộ xử lý chạy lần hai,
   **Then** kết quả giống lần một, không có tác dụng phụ lặp.

---

### User Story 7 - Lập trình viên chép mẫu để tạo tính năng mới (Priority: P3)

Một lập trình viên được giao tính năng mới (vd Kênh kết nối, Thư viện media) đọc hướng dẫn chép mẫu và dựng được
khung tính năng mới trọn luồng mà không phải tự quyết định cấu trúc: nơi đặt mã ở mỗi tầng, cách khai báo bảng có
bảo mật mức dòng, cách khai báo quyền, cách viết thông báo lỗi, các kiểm thử bắt buộc phải có.

**Why this priority**: Đây là mục tiêu cuối của K6 nhưng phụ thuộc các câu chuyện trên đã xong.

**Independent Test**: Một thành viên chưa tham gia làm mẫu, chỉ dùng hướng dẫn, dựng một tính năng thử tối giản
(một bảng, một màn hình, một thao tác ghi) → toàn bộ cổng chất lượng CI qua, có đủ nhóm kiểm thử bắt buộc, trong
≤ 1 ngày công.

**Acceptance Scenarios**:

1. **Given** hướng dẫn chép mẫu, **When** lập trình viên làm theo, **Then** mỗi bước chỉ rõ tệp/khu vực cần tạo, ví
   dụ tương ứng trong module mẫu và kiểm tra tự động nào xác nhận bước đó đúng.
2. **Given** lập trình viên quên bật bảo mật mức dòng, quên kiểm tra quyền ở máy chủ hoặc import nội bộ module khác,
   **When** chạy CI, **Then** có kiểm tra tự động hoặc kiểm thử mẫu báo lỗi chỉ đúng chỗ thiếu.

---

### Edge Cases

- Tài khoản chưa có hồ sơ: màn hình, API và thao tác công khai đều trả "chưa có hồ sơ" như trạng thái hợp lệ, không
  phải lỗi.
- Nội dung chứa ký tự tiếng Việt có dấu, biểu tượng cảm xúc, xuống dòng, khoảng trắng thừa đầu/cuối: lưu và hiển thị
  đúng; khoảng trắng đầu/cuối được cắt trước khi so "không có thay đổi".
- Nội dung có thẻ/mã HTML hoặc mã kịch bản: hiển thị nguyên văn như chữ, không thực thi.
- Mạng chập chờn, bấm "Lưu" hai lần liên tiếp: không tạo hai phiên bản từ một lần sửa (lần thứ hai bị coi là xung
  đột hoặc "không có thay đổi").
- Phiên đăng nhập hết hạn khi đang sửa: lưu thất bại với hướng dẫn đăng nhập lại, nội dung đang gõ không mất ngay
  trên màn hình.
- Vai trò bị đổi (chủ gỡ cộng tác viên) trong lúc cộng tác viên đang mở màn hình: yêu cầu kế tiếp bị từ chối đúng.
- Tài khoản đang tạm dừng/hết hạn gói: xem và sửa hồ sơ bình thường (không tốn AI, không đăng bài – nguyên tắc VI);
  hướng dẫn chép mẫu ghi chú nơi tính năng gói dịch vụ sẽ gắn kiểm tra trạng thái gói cho các thao tác cần chặn
  (kiểm thử bổ sung khi có tính năng gói dịch vụ – hiện chưa có trạng thái gói).
- Màn hình rộng 360 px, chỉ dùng bàn phím, dùng trình đọc màn hình: thao tác được đầy đủ.

## Requirements *(mandatory)*

### Functional Requirements

**Nghiệp vụ hồ sơ kinh doanh (FR-01 – phần khung)**

- **FR-001**: Mỗi tài khoản MUST có tối đa một hồ sơ kinh doanh; hồ sơ gồm các trường: ngành (chọn từ danh mục),
  giới thiệu, sản phẩm/dịch vụ, chính sách (đổi trả, giao hàng, giờ mở cửa…), giọng văn mong muốn, từ khóa riêng
  (danh sách). Chỉ "ngành" và "giới thiệu" là bắt buộc; các trường còn lại tùy chọn. Ngành: chọn đúng 1 mục trong
  danh mục; chọn "Khác" thì bắt buộc nhập tên ngành tự do.
- **FR-001a**: Giới hạn độ dài (tính theo ký tự, sau khi cắt khoảng trắng đầu/cuối): tên ngành tự do ≤ 100; giới
  thiệu ≤ 2.000; sản phẩm/dịch vụ ≤ 5.000; chính sách ≤ 5.000; giọng văn ≤ 500; từ khóa tối đa 20, mỗi từ 1–50 ký tự,
  không trùng nhau (không phân biệt hoa thường).
- **FR-002**: Mỗi lần lưu có thay đổi MUST tạo một phiên bản mới bất biến, đánh số tăng liên tục từ 1 trong phạm vi
  tài khoản, ghi người lưu và thời điểm; phiên bản mới nhất là hồ sơ hiện hành.
- **FR-003**: Lưu mà nội dung (sau khi chuẩn hóa khoảng trắng đầu/cuối) giống phiên bản hiện hành MUST NOT tạo phiên
  bản mới.
- **FR-004**: Mỗi trường MUST có giới hạn độ dài và quy tắc hợp lệ; quy tắc được khai báo một lần và dùng chung cho
  kiểm tra ở màn hình và ở máy chủ, cho cùng thông điệp lỗi tiếng Việt.
- **FR-005**: Lưu MUST mang số phiên bản mà người sửa đã dựa vào; nếu không còn là phiên bản hiện hành, hệ thống MUST
  từ chối là "xung đột" và MUST NOT tạo phiên bản. Kiểm tra và tạo phiên bản MUST nguyên tử (đúng một yêu cầu thắng
  khi cạnh tranh).
- **FR-006**: Người dùng MUST xem được danh sách phiên bản (mới nhất trước, phân trang 20/trang) và nội dung từng
  phiên bản ở chế độ chỉ đọc.
- **FR-007**: Màn hình MUST hiển thị gợi ý bổ sung khi các trường tùy chọn còn trống ("AI sẽ viết tốt hơn nếu bạn bổ
  sung…"), không chặn việc lưu.

**Phân quyền và cô lập tenant**

- **FR-008**: Danh mục quyền MUST có hai quyền riêng: `context.view` (xem hồ sơ hiện hành và lịch sử – chủ + cộng tác
  viên) và `context.edit` (lưu hồ sơ – chỉ chủ). Dòng "Xem/sửa ngữ cảnh kinh doanh" trong bảng quyền FR-012 của 004
  MUST được tách tương ứng; mã cũ `context.manage` MUST được gỡ khỏi mã nguồn (đã ghi "Ngừng dùng" ở danh mục quyền
  `TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#pq-context-manage`). Chú thích quyền trong mã MUST trỏ tới mốc
  neo tương ứng (`#pq-context-view`, `#pq-context-edit`). Quyền MUST được kiểm tra ở máy chủ cho mọi thao tác; màn
  hình chỉ phản ánh quyền. Đây là ví dụ mẫu về tách quyền xem/sửa cho các module sau.
- **FR-009**: Mã tài khoản MUST lấy từ phiên đăng nhập; mọi mã tài khoản do người dùng gửi lên MUST bị bỏ qua hoặc làm
  yêu cầu bị từ chối.
- **FR-010**: Các bảng của tính năng MUST có mã tài khoản bắt buộc, đứng đầu chỉ mục, và MUST bật bảo mật mức dòng;
  mọi truy cập CSDL MUST đi qua lớp giao dịch có ngữ cảnh tenant đã có (002).
- **FR-011**: Truy cập phiên bản của tài khoản khác MUST trả "không tìm thấy", không phân biệt với mã không tồn tại.
- **FR-012**: Vai trò hỗ trợ và quản trị nội bộ MUST NOT đọc hay sửa được hồ sơ (đúng bảng quyền 004 và
  `TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#pq-support-lookup`); mọi yêu cầu
  của nhân viên nội bộ vào các thao tác hồ sơ MUST bị từ chối là "không đủ quyền". Tính năng không tạo khung nhìn hỗ
  trợ cho hồ sơ.

**Ranh giới module**

- **FR-013**: Module Ngữ cảnh kinh doanh MUST sở hữu riêng schema của mình; MUST cung cấp thao tác công khai "lấy hồ sơ
  hiện hành của tài khoản trong ngữ cảnh" trả về nội dung + số phiên bản, hoặc "chưa có hồ sơ"; thao tác MUST chạy
  được trong yêu cầu API và trong việc nền, và MUST từ chối khi không có ngữ cảnh tenant.
- **FR-013a**: Mỗi lần lưu tạo phiên bản mới MUST tạo đúng một việc nền "hồ sơ đã thay đổi" trong **cùng giao dịch**
  với việc lưu, qua lớp hàng chờ đã có (003); việc mang mã tài khoản (lấy từ ngữ cảnh) và số phiên bản, không mang
  nội dung hồ sơ. Giao dịch bị hủy MUST NOT để lại việc. Lưu "không có thay đổi" MUST NOT tạo việc.
- **FR-013b**: Worker MUST có bộ xử lý mẫu cho việc này: đặt lại ngữ cảnh tenant từ việc, đọc hồ sơ qua thao tác công
  khai, ghi nhật ký có cấu trúc (mã tài khoản, số phiên bản, mã theo dõi); MUST chạy lại được an toàn (idempotent) và
  bỏ qua có ghi nhật ký khi phiên bản trong việc đã cũ hơn phiên bản hiện hành. Không có tác dụng phụ nghiệp vụ khác
  (T7 sẽ gắn AI tóm tắt vào đây). Không tạo bảng hay cơ chế sự kiện riêng ngoài hàng chờ.
- **FR-014**: Dữ liệu thao tác công khai trả ra MUST chỉ gồm các trường nghiệp vụ của hồ sơ (tối thiểu hóa dữ liệu cho
  bên dùng sau, gồm Cổng AI).
- **FR-015**: Hồ sơ và trạng thái phiên bản MUST NOT được cache (đọc luôn từ CSDL), để lần tạo nội dung kế tiếp chắc
  chắn dùng phiên bản mới nhất.

**Trải nghiệm và chất lượng giao diện**

- **FR-016**: Mọi thông báo MUST bằng tiếng Việt đời thường; mỗi thông báo lỗi MUST kèm ít nhất một hành động khắc phục
  (sửa trường, tải bản mới nhất, đăng nhập lại, thử lại, nhờ chủ tài khoản); mã lỗi kỹ thuật chỉ nằm trong phần "Chi
  tiết cho hỗ trợ" thu gọn.
- **FR-017**: Màn hình MUST có đủ trạng thái: đang tải, trống (chưa có hồ sơ), chỉ xem, đang lưu, lưu thành công, lỗi
  hợp lệ, xung đột, mất kết nối/lỗi máy chủ; trạng thái hiển thị bằng chữ + biểu tượng, không chỉ màu.
- **FR-018**: Màn hình MUST đạt WCAG 2.1 AA, vùng chạm ≥ 44 × 44 px, dùng được từ 360 px, thao tác được hoàn toàn bằng
  bàn phím; thời gian hiển thị theo UTC+7.
- **FR-019**: Rời màn hình khi còn thay đổi chưa lưu MUST hỏi xác nhận.

**Quan sát được**

- **FR-020**: Mỗi lần lưu và mỗi lần từ chối (quyền, hợp lệ, xung đột) MUST ghi nhật ký có cấu trúc gắn mã tài khoản và
  mã theo dõi của yêu cầu; nhật ký MUST NOT chứa toàn văn nội dung hồ sơ, mật khẩu hay mã phiên.

**Mẫu cho đội (kiểm thử và hướng dẫn)**

- **FR-021**: Tính năng MUST kèm bộ kiểm thử mẫu, mỗi nhóm có tên và chú thích rõ để chép: (a) quy tắc nghiệp vụ thuần
  (hợp lệ, so "không thay đổi", đánh số phiên bản); (b) API theo từng vai trò (chủ, cộng tác viên, hỗ trợ, chưa đăng
  nhập); (c) truy cập chéo tenant đọc/sửa cho mọi bảng của tính năng; (d) cạnh tranh ghi đồng thời; (e) hợp đồng của
  thao tác công khai, gồm chạy trong việc nền; (f) màn hình: các trạng thái, phân quyền hiển thị, hợp lệ, xung đột, khả
  năng truy cập cơ bản; (g) một kịch bản đầu-cuối người dùng thật qua trình duyệt; (h) việc nền: tạo việc cùng
  giao dịch (hủy giao dịch → không có việc), bộ xử lý chạy lại hai lần cho cùng kết quả, việc mang phiên bản cũ được
  bỏ qua.
- **FR-022**: Tính năng MUST kèm hướng dẫn "chép mẫu" bằng tiếng Việt, liệt kê theo thứ tự các bước tạo tính năng mới ở
  từng tầng (CSDL, module, API, quyền, màn hình, kiểm thử), mỗi bước trỏ tới ví dụ trong module mẫu, nêu điều bắt buộc
  theo hiến pháp và kiểm tra tự động xác nhận bước đó; kèm danh sách kiểm tra trước khi gửi review.
- **FR-023**: Toàn bộ cổng chất lượng CI hiện có (truy cập chéo, phát hiện bảng thiếu bảo mật mức dòng, ranh giới
  module, kiểu nghiêm ngặt + lint, quét bí mật) MUST qua với tính năng này; bảng mới MUST được bộ kiểm thử truy cập chéo
  chung tự nhận diện hoặc khai báo theo cách hướng dẫn mô tả.
- **FR-024**: Thay đổi cấu trúc CSDL của tính năng MUST tương thích ngược (chỉ thêm), áp dụng được bằng công cụ thay
  đổi cấu trúc đã có.

### Key Entities *(include if feature involves data)*

- **Hồ sơ kinh doanh** (`business_profile`): một bản ghi mỗi tài khoản; thuộc tài khoản; trỏ tới phiên bản hiện hành
  và giữ số phiên bản hiện hành (dùng để chặn ghi đè); thời điểm tạo/cập nhật; hỗ trợ xóa mềm theo quy ước chung.
- **Phiên bản hồ sơ** (`profile_version`): bất biến; thuộc tài khoản và hồ sơ; số phiên bản (duy nhất trong hồ sơ);
  toàn bộ nội dung các trường (ngành, tên ngành tự do khi chọn "Khác", giới thiệu, sản phẩm/dịch vụ, chính sách, giọng văn, từ khóa); người lưu (mã
  người dùng – tham chiếu sang module Tài khoản bằng mã, không ràng buộc chéo module ngoài bảng tài khoản); thời điểm
  lưu.
- **Danh mục ngành** (`industry`): danh sách cố định cấu hình sẵn (vd thời trang, ăn uống, mỹ phẩm, giáo dục, dịch vụ
  làm đẹp, khác), dùng chung mọi tài khoản, không chứa dữ liệu khách hàng.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Chủ tài khoản mới điền và lưu hồ sơ lần đầu trong ≤ 3 phút; trang hồ sơ hiển thị nội dung ≤ 1 giây khi
  chuyển từ màn hình khác, lưu xong và thấy xác nhận ≤ 1 giây trong điều kiện bình thường.
- **SC-002**: 100% kịch bản truy cập chéo (đọc, sửa ở mọi bảng của tính năng, giữa hai tài khoản) thất bại đúng như
  mong đợi; 0 dòng nhìn thấy khi không có ngữ cảnh tenant.
- **SC-003**: 100% yêu cầu sửa từ cộng tác viên, hỗ trợ hoặc người chưa đăng nhập bị từ chối ở máy chủ, không tạo phiên
  bản.
- **SC-004**: Với 10 yêu cầu lưu đồng thời trên cùng phiên bản, chạy lặp 100 lần: luôn đúng 1 thành công, 0 lần mất thay
  đổi âm thầm, 0 số phiên bản trùng hoặc lỗ.
- **SC-005**: Sau khi lưu, thao tác công khai trả phiên bản mới ngay lần gọi kế tiếp trong 100% lần thử.
- **SC-006**: Màn hình đạt 0 lỗi nghiêm trọng khi kiểm tra tự động WCAG 2.1 AA, dùng đầy đủ ở 360 px và chỉ bằng bàn
  phím.
- **SC-007**: Mỗi nhóm kiểm thử mẫu (a)–(h) có ít nhất một kiểm thử chạy trong CI; toàn bộ cổng chất lượng CI qua.
- **SC-008**: Một lập trình viên chưa tham gia làm mẫu, chỉ dùng hướng dẫn, dựng được tính năng thử tối giản qua toàn
  bộ cổng CI trong ≤ 1 ngày công, không cần hỏi SA về cấu trúc (ghi nhận lại câu hỏi phát sinh để bổ sung hướng dẫn).

## Assumptions

- Đây là **khung** của Hồ sơ kinh doanh; T7 sẽ thêm tải tệp ngữ cảnh, AI tóm tắt và việc dùng hồ sơ khi tạo nội dung
  ngay trên mẫu này, không đổi cấu trúc đã dựng.
- Giới hạn độ dài đã chốt (FR-001a); danh sách mục cụ thể của danh mục ngành là dữ liệu cấu hình, bổ sung mục mới
  không cần đổi cấu trúc.
- Không có "khôi phục phiên bản cũ" ở giai đoạn này; người dùng xem bản cũ và tự chép nội dung nếu cần.
- Phiên bản hồ sơ được giữ suốt vòng đời tài khoản và xóa cùng tài khoản theo vòng đời dữ liệu chung (hết hạn 90 ngày,
  yêu cầu xóa ≤ 30 ngày); tính năng không tự đặt chính sách giữ riêng.
- Xác thực, vai trò, danh mục quyền và ngữ cảnh tenant dùng lại từ 002/004. Mẫu truy cập hỗ trợ có kiểm toán
  (`supportViewAccount` của 002) không dùng ở đây; hướng dẫn chép mẫu chỉ trỏ tới tài liệu của nó cho module cần.
- Hồ sơ là dữ liệu kinh doanh, có thể chứa thông tin cá nhân do khách tự nhập (vd số điện thoại cửa hàng); được bảo vệ
  như mọi dữ liệu khách hàng; tính năng không gửi dữ liệu ra ngoài.
- Kịch bản đầu-cuối chạy trên môi trường cục bộ/CI đã có (docker compose của dự án), không cần môi trường đám mây.
