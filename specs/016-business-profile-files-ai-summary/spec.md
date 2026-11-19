# Feature Specification: Hồ sơ kinh doanh có phiên bản, tải tệp ngữ cảnh, AI tóm tắt

**Feature Branch**: `016-business-profile-files-ai-summary` (thư mục spec; nhánh làm việc `impl/016-business-profile-files-ai-summary` do hook worktree tạo khi `/speckit-plan 016`)

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Dựa trên tài liệu nghiệp vụ và tài liệu kiến trúc dự án, tài liệu thiết kế, trong vai trò PM hãy viết tài liệu tính năng 'Hồ sơ kinh doanh có phiên bản, tải tệp, AI tóm tắt' cho chương trình."

**Truy vết**: WBS **T7** · FR-01 (quản lý ngữ cảnh kinh doanh: giới thiệu, chính sách, sản phẩm; nhập chữ hoặc tải tệp; tiêu chí "lần tạo nội dung kế tiếp dùng phiên bản mới nhất") · FR-11, FR-12 (AI tính vào ngân sách, không hiện số tiền) · FR-14 (xóa tệp khi xóa tài khoản) · Đặc tả yêu cầu mục 3.1 (mã quyền `context.view`, `context.edit`) · UI/UX mục 5 F1 bước 2, mục 6 (màn hình Hồ sơ kinh doanh), mục 9 (bảng quyền màn hình) · Kiến trúc dữ liệu mục 8.3, mục 9 (bên nhận dữ liệu AI ở nước ngoài, gửi tối thiểu), mục 10 (bộ đệm lời nhắc theo phiên bản hồ sơ) · Kiến trúc triển khai (module `context`, bảng `context_files`, hàng chờ `ai_batch`) · ADD Cổng AI · ADR-06, ADR-07a, ADR-09 · Hiến pháp nguyên tắc **I, III, IV, V, VI, VII**.

**Phụ thuộc**: `006-sample-module-business-profile` (hồ sơ một phiên bản, lịch sử, khóa lạc quan, quyền xem/sửa — **mở rộng**, không viết lại) · `004-minimal-auth-rbac` (phiên, quyền) · `005-gateway-contracts-fakes` và `015-real-ai-gateway` (mọi lời gọi AI, giữ chỗ ngân sách; tính năng dùng được với bản giả lập trước khi 015 xong) · `014-media-library-basic` (cách tải thẳng lên kho tệp, dung lượng 5 GB dùng chung) · `011-ui-architecture-foundation` (khung giao diện, biểu mẫu). Tính năng **cung cấp** cho tạo nội dung AI (T9/FR-05) bản hồ sơ hiện hành, và cho lập kế hoạch (T10) từ khóa riêng.

**Bối cảnh**: Hiện hồ sơ kinh doanh (006) chỉ có vài trường chữ và lịch sử xem. Chủ cửa hàng thật sự có sẵn tài liệu: bảng giá, menu, chính sách đổi trả, giới thiệu cửa hàng ở dạng PDF/Word; gõ lại từng dòng vào ô chữ là việc họ bỏ dở, và hồ sơ nghèo thì AI viết bài chung chung. Tính năng này làm hồ sơ **đủ giàu để AI viết đúng giọng, đúng sản phẩm, đúng chính sách** mà không bắt người dùng gõ nhiều: (1) hồ sơ có đủ nhóm nội dung theo FR-01 và phiên bản rõ ràng, (2) tải tệp bảng giá/chính sách làm nguồn, (3) AI đọc nội dung nhập + tệp rồi **đề xuất bản tóm tắt**, người dùng xem, sửa, xác nhận mới thành phiên bản mới. Nguyên tắc VI: AI đề xuất, người dùng quyết định — không có bản AI nào tự thành hồ sơ chính thức.

**Không thuộc phạm vi** (làm ở tính năng khác hoặc giai đoạn sau): nhập hồ sơ bằng giọng nói; dùng hồ sơ để tạo bài (T9); từ khóa xu hướng riêng được dùng khi lập kế hoạch (T10 — ở đây chỉ **lưu** từ khóa); lấy thông tin từ website/mạng xã hội của khách (cào dữ liệu bị cấm); chỉnh sửa tệp trong ứng dụng; nhiều hồ sơ cho một tài khoản (ví dụ nhiều cửa hàng); so sánh chi tiết từng chữ giữa hai phiên bản (chỉ cần chỉ ra trường nào đã đổi); xuất toàn bộ dữ liệu.

## Clarifications

### Session 2026-11-19

Các điểm sau PM tự chốt theo mặc định hợp lý (không còn câu hỏi bắt buộc); `/speckit-clarify` có thể xem lại.

- Tệp ngữ cảnh chấp nhận loại nào? → PDF, Word (.docx), văn bản thuần (.txt) và ảnh chụp tài liệu (JPEG/PNG) — vì bảng giá/menu của cửa hàng nhỏ thường là ảnh chụp. Mỗi tệp ≤ 10 MB, tối đa 10 tệp đang dùng/tài khoản. Xem Assumptions.
- Tệp ngữ cảnh có tính vào 5 GB dung lượng chung không? → Có, dùng chung một bộ đếm với thư viện media (014).
- AI tóm tắt chạy đồng bộ hay nền? → Chạy nền, giao diện hiện tiến độ và vẫn dùng được; người dùng có thể rời màn hình rồi quay lại thấy kết quả.
- Khôi phục phiên bản cũ có "quay ngược thời gian" không? → Không: khôi phục = lấy nội dung phiên bản cũ làm **phiên bản mới** (lịch sử chỉ thêm, không sửa).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hoàn thiện hồ sơ bằng cách nhập chữ, nhiều nhóm nội dung (Priority: P1)

Chủ tài khoản mở **Hồ sơ kinh doanh** và nhập đủ các nhóm nội dung mà AI cần: ngành, giới thiệu cửa hàng, **sản phẩm/dịch vụ**, **chính sách** (giá, đổi trả, giao hàng, giờ mở cửa…), giọng văn mong muốn, từ khóa xu hướng riêng. Màn hình hiện mức đầy đủ của hồ sơ và gợi ý "AI sẽ viết tốt hơn nếu bạn bổ sung…" cho nhóm còn trống. Bấm lưu → hệ thống tạo phiên bản mới.

**Why this priority**: Đây là phần lõi của FR-01 và là giá trị nhỏ nhất đã dùng được — kể cả khi chưa có tệp hay AI, hồ sơ đủ nhóm đã giúp T9 viết bài tốt hơn bản mẫu 006.

**Independent Test**: Chủ tài khoản điền cả 6 nhóm, lưu → phiên bản mới xuất hiện trong lịch sử với số thứ tự kế tiếp, người lưu, thời điểm (UTC+7); cộng tác viên mở cùng màn hình chỉ xem được, không sửa được.

**Acceptance Scenarios**:

1. **Given** hồ sơ 006 hiện có (giới thiệu, ngành, giọng văn), **When** chủ mở màn hình sau khi nâng cấp, **Then** dữ liệu cũ hiển thị nguyên vẹn ở đúng nhóm; nhóm sản phẩm, chính sách, từ khóa trống kèm gợi ý bổ sung; lịch sử cũ không mất phiên bản nào.
2. **Given** chủ đã sửa ≥ 1 nhóm, **When** bấm lưu, **Then** một phiên bản mới được tạo; phiên bản cũ không bị đổi; nếu không có thay đổi nào thì không tạo phiên bản.
3. **Given** một nhóm vượt giới hạn độ dài, **When** lưu, **Then** báo lỗi ngay tại nhóm đó, nêu giới hạn và số ký tự đã dùng; nội dung đã nhập không bị mất.
4. **Given** chủ và cộng tác viên cùng mở và cùng sửa, **When** người thứ hai lưu sau, **Then** nhận thông báo xung đột nêu rõ ai đã lưu lúc nào, được chọn xem bản mới rồi áp lại phần của mình — không có bản nào bị ghi đè âm thầm.
5. **Given** cộng tác viên, **When** mở màn hình, **Then** mọi ô bị khóa kèm dòng giải thích "chỉ chủ tài khoản được sửa"; gọi thẳng chức năng sửa cũng bị từ chối.
6. **Given** nhân viên hỗ trợ, **When** cố xem hồ sơ của một khách, **Then** bị từ chối (hỗ trợ không xem hồ sơ kinh doanh).

---

### User Story 2 - Tải tệp bảng giá, chính sách làm nguồn ngữ cảnh (Priority: P1)

Thay vì gõ lại, chủ tải lên PDF/Word/văn bản/ảnh chụp tài liệu (bảng giá, menu, chính sách đổi trả, giới thiệu). Mỗi tệp hiện tiến độ, rồi trạng thái "Đã đọc xong" (hệ thống đã lấy được chữ) hoặc "Không đọc được" kèm cách xử lý. Tệp nằm trong danh sách "Tệp ngữ cảnh" của hồ sơ; chủ có thể xóa tệp.

**Why this priority**: FR-01 yêu cầu "nhập chữ hoặc tải tệp"; không có tệp thì US3 (AI tóm tắt từ tài liệu) không có đầu vào, và đây là cách nhanh nhất để người mới có hồ sơ đầy đủ (UI/UX F1 bước 2).

**Independent Test**: Tải 1 PDF 2 MB, 1 ảnh chụp bảng giá, 1 tệp không đọc được (PDF chỉ có ảnh quét rất mờ hoặc có mật khẩu) → hai tệp đầu "Đã đọc xong", tệp thứ ba "Không đọc được" kèm gợi ý "Thử chụp lại rõ hơn hoặc dán nội dung vào ô chữ"; dung lượng 5 GB tăng đúng bằng tổng kích thước.

**Acceptance Scenarios**:

1. **Given** chủ có quyền sửa hồ sơ, **When** chọn nhiều tệp hợp lệ, **Then** mỗi tệp có tiến độ riêng; tệp lớn không làm đứng giao diện; tệp lỗi không chặn tệp còn lại; tệp không đi qua máy chủ ứng dụng.
2. **Given** tệp sai loại hoặc quá 10 MB, **When** chọn, **Then** từ chối ngay trước khi tải, nêu loại được nhận và giới hạn.
3. **Given** đã đủ 10 tệp đang dùng hoặc tải thêm sẽ vượt 5 GB, **When** chọn thêm, **Then** từ chối kèm hướng dẫn (xóa tệp cũ / giải phóng dung lượng).
4. **Given** tệp trùng nội dung với tệp đã có trong hồ sơ, **When** tải lại, **Then** báo "đã có" và không xử lý đọc/AI lại (tránh tốn chi phí).
5. **Given** tệp đã đọc xong, **When** chủ xóa, **Then** tệp biến khỏi danh sách và khỏi lần tóm tắt sau; các phiên bản cũ từng tham chiếu tệp hiển thị "tệp đã xóa" thay vì lỗi; dung lượng được hoàn lại.
6. **Given** cộng tác viên, **When** mở danh sách tệp, **Then** thấy tên, loại, ngày tải, trạng thái nhưng không tải lên/xóa được và không tải nội dung gốc về nếu không có quyền xem.
7. **Given** tài khoản A, **When** cố mở/ghi tệp ngữ cảnh của tài khoản B (đoán mã, đổi đường dẫn), **Then** thất bại như thể tệp không tồn tại.

---

### User Story 3 - AI tóm tắt và đề xuất hồ sơ để người dùng xác nhận (Priority: P1)

Sau khi nhập chữ và/hoặc tải tệp, chủ bấm **"AI tóm tắt giúp tôi"**. AI đọc nội dung đã nhập và chữ lấy từ các tệp, rồi đề xuất nội dung cho từng nhóm (giới thiệu ngắn gọn, danh sách sản phẩm/dịch vụ chính kèm giá nếu có, các chính sách chính, gợi ý giọng văn, gợi ý từ khóa). Bản đề xuất hiện **cạnh nội dung hiện tại**, có nhãn "Bản nháp do AI đề xuất"; chủ sửa tay, chọn nhận/bỏ từng nhóm rồi bấm "Xác nhận" → mới tạo phiên bản. Không xác nhận thì hồ sơ hiện hành giữ nguyên.

**Why this priority**: Đây là điểm khác biệt của tính năng và là bước 2 của luồng F1 (người mới vào dùng); nguyên tắc VI bắt buộc AI chỉ đề xuất. Xếp P1 vì cùng US1, US2 tạo thành một lát dùng được trọn vẹn: tải tài liệu → AI tóm tắt → xác nhận.

**Independent Test**: Hồ sơ trống, tải bảng giá 1 trang + gõ 2 dòng giới thiệu, bấm tóm tắt → trong ≤ 60 giây thấy bản đề xuất đủ nhóm có dữ liệu; sửa 1 nhóm, bỏ 1 nhóm, xác nhận → phiên bản mới chỉ chứa nhóm đã nhận, ghi rõ "có dùng gợi ý AI"; bản đề xuất chưa xác nhận không ảnh hưởng hồ sơ hiện hành.

**Acceptance Scenarios**:

1. **Given** hồ sơ có chữ và/hoặc tệp "Đã đọc xong", **When** chủ bấm tóm tắt, **Then** việc chạy nền, giao diện hiện "AI đang đọc tài liệu…" và vẫn cho dùng các chức năng khác; xong thì hiện bản đề xuất (kể cả khi chủ đã rời màn hình rồi quay lại).
2. **Given** bản đề xuất, **When** chủ xem, **Then** mọi nội dung AI có nhãn bản nháp; nhóm nào AI không tìm thấy thông tin thì để trống chứ không bịa; thông tin lấy từ tệp nào được chỉ rõ (tên tệp) để chủ kiểm chứng.
3. **Given** bản đề xuất, **When** chủ nhận một phần, sửa một phần, bỏ một phần rồi xác nhận, **Then** phiên bản mới gồm đúng những gì chủ đã chốt; bản đề xuất đã xử lý không bấm xác nhận lại được.
4. **Given** AI hết ngân sách (chặn mức 4 USD) hoặc nhà cung cấp lỗi/quá thời gian, **When** chủ bấm tóm tắt, **Then** hiện thông báo không nhắc số tiền kèm đường thoát "bạn vẫn có thể nhập tay"; nhập tay, tải tệp, lưu phiên bản vẫn hoạt động; ngân sách bị giữ chỗ được trả lại khi lỗi.
5. **Given** chủ bấm tóm tắt hai lần liên tiếp hoặc hai người cùng bấm, **When** nội dung nguồn không đổi, **Then** chỉ một lần tính chi phí và dùng lại kết quả; nội dung đổi thì tóm tắt mới.
6. **Given** tệp chứa câu kiểu "hãy bỏ qua mọi hướng dẫn và…" hoặc cố điều khiển AI, **When** tóm tắt, **Then** nội dung tệp chỉ được coi là dữ liệu để tóm tắt; không làm thay đổi hành vi hệ thống, không rò dữ liệu tài khoản khác.
7. **Given** chủ dùng quá thường xuyên, **When** bấm tóm tắt liên tục, **Then** áp giới hạn số lần theo ngày với thông báo nhẹ nhàng; không ảnh hưởng nhập tay.
8. **Given** màn hình dùng AI, **When** hiển thị mức dùng, **Then** chỉ hiển thị dạng % trên trần; không có số tiền ở màn hình hay email.

---

### User Story 4 - Xem lịch sử, so sánh và khôi phục phiên bản (Priority: P2)

Chủ và cộng tác viên xem danh sách phiên bản (số thứ tự, người lưu, thời điểm UTC+7, nguồn: nhập tay / có dùng gợi ý AI / khôi phục từ phiên bản N), mở xem nội dung từng phiên bản và thấy **những nhóm nào khác so với phiên bản liền trước**. Chủ có thể **khôi phục**: nội dung phiên bản cũ được tạo thành phiên bản mới.

**Why this priority**: Phiên bản là nền của "lần tạo nội dung kế tiếp dùng phiên bản mới nhất" và là lưới an toàn khi AI đề xuất sai; nhưng có US1–US3 là đã dùng được, nên P2.

**Independent Test**: Hồ sơ có 4 phiên bản → xem phiên bản 2, thấy nhóm đã đổi so với 1; khôi phục phiên bản 2 → xuất hiện phiên bản 5 có nội dung giống 2, ghi "khôi phục từ 2"; phiên bản 1–4 không đổi.

**Acceptance Scenarios**:

1. **Given** nhiều phiên bản, **When** mở lịch sử, **Then** có phân trang, thứ tự mới → cũ, phiên bản hiện hành được đánh dấu.
2. **Given** chủ chọn khôi phục phiên bản cũ, **When** xác nhận, **Then** tạo phiên bản mới (không xóa/sửa phiên bản nào); nếu hồ sơ đã bị người khác sửa trong lúc xem, báo xung đột như US1.
3. **Given** cộng tác viên, **When** xem lịch sử, **Then** xem được, không có nút khôi phục; gọi thẳng cũng bị từ chối.
4. **Given** phiên bản cũ tham chiếu tệp đã xóa, **When** mở xem hoặc khôi phục, **Then** hiển thị rõ tệp đã xóa; khôi phục không "hồi sinh" tệp.

---

### User Story 5 - Hồ sơ hiện hành là nguồn duy nhất cho AI của các tính năng sau (Priority: P2)

Mỗi khi chủ lưu phiên bản mới, các tính năng AI về sau (tạo bài, lập kế hoạch) đọc **đúng phiên bản hiện hành, không bản cũ lưu tạm**. Với tính năng này, phần cung cấp là giao diện công khai của module trả về hồ sơ hiện hành đã gọn và an toàn để gửi AI (chỉ các nhóm nghiệp vụ; không email/số điện thoại chủ tài khoản; có số phiên bản để các bên gắn vào bài/lời gọi).

**Why this priority**: Là tiêu chí chấp nhận của FR-01; nhưng người tiêu dùng (T9, T10) chưa làm nên kiểm bằng hợp đồng và kiểm thử tự động, không cần màn hình.

**Independent Test**: Lưu phiên bản 5 rồi gọi ngay giao diện đọc hồ sơ hiện hành từ module khác → nhận phiên bản 5 (không phiên bản 4); kiểm thử cho thấy kết quả không chứa trường liên hệ chủ tài khoản.

**Acceptance Scenarios**:

1. **Given** vừa lưu phiên bản mới, **When** module khác đọc hồ sơ hiện hành, **Then** nhận phiên bản mới ngay (không trễ, không cache).
2. **Given** nội dung tệp ngữ cảnh, **When** module khác cần ngữ cảnh, **Then** chỉ nhận phần nội dung đã được người dùng xác nhận trong phiên bản, không nhận chữ thô của tệp.
3. **Given** hồ sơ chưa tạo, **When** đọc, **Then** nhận kết quả "chưa có hồ sơ" rõ ràng để bên dùng quyết định (không lỗi).

---

### Edge Cases

- Tệp ảnh chụp bảng giá mờ, nghiêng, chữ viết tay → "Không đọc được hoặc đọc chưa chắc"; nội dung đọc không chắc được đánh dấu để người dùng kiểm tra; không tự đưa vào hồ sơ.
- Tệp PDF có mật khẩu, bị hỏng, hoặc đổi đuôi (ví dụ .exe đổi thành .pdf) → từ chối/báo không đọc được; loại tệp xác định theo nội dung chứ không chỉ theo đuôi.
- Tệp rất dài (hàng trăm trang): chỉ dùng phần đầu trong giới hạn xử lý đã quy định; hệ thống nói rõ "đã đọc N trang đầu" để người dùng không hiểu nhầm là đã đọc hết.
- Tệp chứa thông tin cá nhân của khách hàng của cửa hàng (danh sách số điện thoại): hiển thị cảnh báo trước khi tải ("Không tải danh sách khách hàng"); không dùng cơ chế tự phát hiện bắt buộc ở giai đoạn này, nhưng nội dung gửi AI vẫn ở mức tối thiểu cần thiết.
- Nhập chữ + tệp mâu thuẫn nhau (giá khác nhau) → AI nêu mâu thuẫn trong đề xuất để chủ chọn, không tự chọn.
- Đang tóm tắt mà chủ sửa hồ sơ/xóa tệp → kết quả cũ gắn với nội dung nguồn lúc bấm; khi hiện, báo "nội dung đã đổi từ lúc tóm tắt" và cho chọn tóm tắt lại; không tự ghi đè.
- Worker chết giữa chừng khi đọc tệp/tóm tắt → việc chạy lại an toàn, không tính chi phí hai lần, không tạo hai bản đề xuất.
- Tài khoản hết hạn gói: xem lịch sử và tải bản xuống còn được trong thời gian giữ dữ liệu; tạo mới bị chặn theo quy tắc gói (như các tính năng khác).
- Tài khoản bị xóa theo yêu cầu: toàn bộ hồ sơ, phiên bản, tệp ngữ cảnh và chữ đã trích bị xóa trong ≤ 30 ngày, không để lại dữ liệu cá nhân (FR-14).
- Hồ sơ có > 100 phiên bản: lịch sử phân trang, không chậm.
- Cùng lúc nhiều tài khoản bấm tóm tắt: một tài khoản không được chiếm hết năng lực của người khác (giới hạn đồng thời theo tài khoản).

## Requirements *(mandatory)*

### Functional Requirements

**Hồ sơ và phiên bản**

- **FR-001**: Hồ sơ kinh doanh MUST gồm các nhóm nội dung: ngành, giới thiệu, sản phẩm/dịch vụ, chính sách, giọng văn mong muốn, từ khóa xu hướng riêng; mỗi nhóm có giới hạn độ dài do một nguồn quy định chung cho giao diện và máy chủ (hợp lệ ở cả hai lớp).
- **FR-002**: Mỗi lần lưu có thay đổi MUST tạo **phiên bản mới bất biến** (số thứ tự tăng dần, người lưu, thời điểm, nguồn tạo: nhập tay / có dùng gợi ý AI / khôi phục từ phiên bản N); lưu không có thay đổi MUST NOT tạo phiên bản.
- **FR-003**: Hệ thống MUST chặn ghi đè khi nhiều người cùng sửa (khóa lạc quan theo số phiên bản hiện hành), thông báo xung đột nêu ai lưu lúc nào và cho phép xem bản mới trước khi áp lại.
- **FR-004**: Dữ liệu hồ sơ tạo từ 006 MUST được giữ nguyên, hiển thị đúng ở nhóm tương ứng; việc nâng cấp MUST tương thích ngược (API/Worker bản cũ và mới chạy song song được).
- **FR-005**: Màn hình MUST hiện mức đầy đủ của hồ sơ và gợi ý "AI sẽ viết tốt hơn nếu bạn bổ sung…" cho nhóm còn thiếu; không chặn người dùng khi hồ sơ chưa đầy đủ.
- **FR-006**: Lịch sử MUST liệt kê phiên bản (phân trang, mới → cũ), cho xem nội dung từng phiên bản và chỉ ra nhóm nào khác so với phiên bản liền trước.
- **FR-007**: Chủ tài khoản MUST có thể khôi phục một phiên bản cũ; kết quả luôn là phiên bản mới, không sửa hay xóa phiên bản nào.

**Tệp ngữ cảnh**

- **FR-008**: Chủ tài khoản MUST tải được tệp PDF, Word (.docx), văn bản thuần (.txt) và ảnh chụp tài liệu (JPEG/PNG), tối đa 10 MB/tệp và 10 tệp đang dùng/tài khoản; loại tệp xác định theo nội dung thật, không chỉ theo đuôi.
- **FR-009**: Tệp MUST được tải thẳng từ trình duyệt lên kho tệp qua đường dẫn ký sẵn có hạn, đúng tiền tố của tài khoản; MUST NOT đi qua máy chủ ứng dụng; hỗ trợ nhiều tệp cùng lúc, tệp lỗi không chặn tệp khác.
- **FR-010**: Sau khi tải, hệ thống MUST xử lý nền để lấy chữ từ tệp, rồi hiển thị trạng thái: Đang đọc / Đã đọc xong / Không đọc được (kèm lý do dễ hiểu và cách xử lý). Xử lý MUST chạy lại an toàn.
- **FR-011**: Tệp trùng nội dung (cùng dấu tệp) trong cùng tài khoản MUST NOT bị đọc/xử lý AI lại; hệ thống báo "đã có".
- **FR-012**: Dung lượng tệp ngữ cảnh MUST tính vào hạn mức 5 GB chung và trừ bằng cập nhật có điều kiện cùng giao dịch với thao tác; vượt hạn mức → từ chối; xóa tệp → hoàn dung lượng.
- **FR-013**: Chủ MUST xóa được tệp ngữ cảnh; phiên bản cũ từng tham chiếu tệp hiển thị "tệp đã xóa" thay vì lỗi; chữ đã trích bị xóa cùng tệp.
- **FR-014**: Tệp và chữ trích từ tệp MUST thuộc phạm vi một tài khoản; đường dẫn ký sẵn chỉ cấp đúng tiền tố `tenants/{mã tài khoản}/`; tài khoản này không đọc/ghi/xóa được tệp tài khoản khác.

**AI tóm tắt**

- **FR-015**: Chủ MUST bấm được "AI tóm tắt giúp tôi" khi hồ sơ có chữ hoặc có ít nhất một tệp "Đã đọc xong"; hệ thống tạo **bản đề xuất** cho từng nhóm từ chữ nhập + chữ trích từ tệp.
- **FR-016**: Mọi lời gọi AI và chuyển chữ bằng AI MUST đi qua Cổng AI, giữ chỗ ngân sách trước khi gọi, quyết toán sau khi gọi, trả lại khi lỗi/hết thời gian; tính vào ngân sách AI của tài khoản; MUST NOT hiện số tiền ở bất kỳ màn hình hay email nào, chỉ dạng %.
- **FR-017**: Bản đề xuất MUST hiển thị là **bản nháp do AI đề xuất**, tách khỏi hồ sơ hiện hành; chỉ khi chủ bấm "Xác nhận" (có thể nhận/bỏ/sửa từng nhóm) mới tạo phiên bản mới; không xác nhận → hồ sơ hiện hành không đổi.
- **FR-018**: Bản đề xuất MUST nêu nguồn của từng nhóm (tên tệp hoặc "từ phần bạn nhập"), để trống nhóm không có thông tin thay vì suy đoán, và nêu mâu thuẫn giữa các nguồn để chủ chọn.
- **FR-019**: Tóm tắt MUST chạy nền, giao diện hiện tiến độ và không chặn các chức năng khác; kết quả giữ lại để chủ quay lại xem; việc MUST chạy lại an toàn, không tính chi phí hai lần, không tạo hai bản đề xuất.
- **FR-020**: Khi nội dung nguồn không đổi, tóm tắt lặp lại MUST dùng lại kết quả (không gọi AI lại); khi nội dung đổi sau lúc bấm, bản đề xuất MUST báo "nội dung đã đổi" và cho tóm tắt lại.
- **FR-021**: Khi AI bị chặn ngân sách, nhà cung cấp lỗi hoặc quá thời gian, hệ thống MUST thông báo bằng tiếng Việt đời thường kèm hành động thay thế (nhập tay), mọi chức năng thủ công (nhập, tải tệp, lưu, khôi phục, xem lịch sử) MUST vẫn dùng được.
- **FR-022**: Nội dung tệp MUST được coi là **dữ liệu không tin cậy**: không được làm AI thực hiện hành động ngoài tóm tắt, không làm lộ dữ liệu tài khoản khác hay chỉ dẫn hệ thống.
- **FR-023**: Dữ liệu gửi nhà cung cấp AI MUST ở mức tối thiểu: chỉ chữ cần tóm tắt; không gửi email, số điện thoại chủ tài khoản; trước khi dùng lần đầu, màn hình MUST nói rõ nội dung sẽ được gửi cho nhà cung cấp AI và nhắc không tải danh sách khách hàng; ô đồng ý MUST NOT đặt sẵn.
- **FR-024**: Có giới hạn số lần tóm tắt theo tài khoản mỗi ngày và giới hạn đồng thời theo tài khoản; vượt giới hạn → thông báo nhẹ nhàng, không ảnh hưởng chức năng thủ công.

**Phân quyền, truy cập, tương thích**

- **FR-025**: Quyền MUST kiểm tra ở API: chủ có `context.view` + `context.edit` (sửa, tải/xóa tệp, tóm tắt, khôi phục); cộng tác viên chỉ `context.view` (xem hồ sơ, lịch sử, danh sách tệp); hỗ trợ và quản trị nội bộ không xem hồ sơ kinh doanh.
- **FR-026**: Mã tài khoản MUST lấy từ phiên đăng nhập; mọi bảng mới của khách hàng MUST có cột tài khoản và bật cô lập mức dòng; kiểm thử truy cập chéo MUST bao phủ các bảng mới.
- **FR-027**: Module khác MUST đọc hồ sơ hiện hành chỉ qua giao diện công khai của module hồ sơ, luôn lấy phiên bản mới nhất (không cache); kết quả gồm số phiên bản, không chứa dữ liệu liên hệ chủ tài khoản, không chứa chữ thô của tệp.
- **FR-028**: Nhật ký MUST gắn mã tài khoản và MUST NOT chứa nội dung hồ sơ, nội dung tệp hay chữ trích; sự kiện hồ sơ đổi MUST ghi vào hàng chờ trong cùng giao dịch lưu phiên bản.
- **FR-029**: Giao diện MUST dùng tiếng Việt đời thường, trạng thái bằng chữ + biểu tượng (không chỉ màu), vùng chạm ≥ 44 × 44 px, dùng được từ 360 px, đạt WCAG 2.1 AA, mọi lỗi kèm ít nhất một hành động khắc phục; mã lỗi gốc chỉ ở "Chi tiết cho hỗ trợ".
- **FR-030**: Khi xóa tài khoản theo yêu cầu hoặc hết hạn 90 ngày, hồ sơ, phiên bản, tệp ngữ cảnh, chữ trích và bản đề xuất MUST bị xóa theo vòng đời dữ liệu hiện hành.

### Key Entities *(include if feature involves data)*

- **Hồ sơ kinh doanh**: một hồ sơ cho mỗi tài khoản; trỏ tới phiên bản hiện hành; mở rộng từ hồ sơ 006.
- **Phiên bản hồ sơ**: bản chụp bất biến các nhóm nội dung tại một lần lưu; có số thứ tự, người lưu, thời điểm, nguồn tạo, danh sách tệp tham chiếu.
- **Tệp ngữ cảnh**: tệp người dùng tải làm nguồn; có tên, loại, kích thước, dấu tệp, trạng thái xử lý (đang đọc / đã đọc / không đọc được), chữ đã trích; thuộc một tài khoản.
- **Bản đề xuất AI**: kết quả một lần tóm tắt; gắn với phiên bản và nội dung nguồn lúc bấm; trạng thái chờ xử lý / sẵn sàng / đã xác nhận / đã bỏ / lỗi; chứa nội dung đề xuất theo nhóm kèm nguồn; không phải hồ sơ chính thức.
- **Mức sử dụng**: dung lượng 5 GB (dùng chung với thư viện media) và ngân sách AI (hiển thị %).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Chủ cửa hàng mới có hồ sơ đầy đủ các nhóm (tải ≥ 1 tài liệu, AI tóm tắt, xác nhận) trong ≤ 10 phút kể từ lúc mở màn hình lần đầu, không cần tài liệu hướng dẫn, ở ≥ 80% lượt thử với người dùng thật.
- **SC-002**: Bản đề xuất AI hiện ra trong ≤ 60 giây (tính từ lúc bấm đến khi thấy kết quả) với ≥ 95% lượt tóm tắt hợp lệ có tài liệu tới 10 trang; trong lúc chờ giao diện vẫn thao tác được.
- **SC-003**: 100% phiên bản đã lưu giữ nguyên nội dung sau mọi thao tác khác (sửa, khôi phục, xóa tệp, tóm tắt) — kiểm thử tự động xác nhận không phiên bản nào bị đổi.
- **SC-004**: Sau khi lưu phiên bản mới, 100% lần đọc hồ sơ hiện hành từ tính năng khác nhận đúng phiên bản mới nhất (0 lần nhận bản cũ).
- **SC-005**: 0 lần dữ liệu hồ sơ hoặc tệp của một tài khoản bị đọc/sửa/xóa từ tài khoản khác (kiểm thử truy cập chéo cho mọi bảng và đường dẫn tệp mới).
- **SC-006**: 0 phiên bản hồ sơ được tạo từ AI mà người dùng chưa bấm xác nhận.
- **SC-007**: Khi AI bị chặn hoặc lỗi, 100% chức năng nhập tay, tải tệp, lưu và khôi phục vẫn dùng được; người dùng nhìn thấy thông báo có hướng dẫn trong ≤ 2 giây.
- **SC-008**: Chi phí AI trung bình cho phần tóm tắt hồ sơ ≤ 0,05 USD mỗi lần và tổng phần này chiếm ≤ 5% mục tiêu 2 USD/tài khoản/chu kỳ; tổng chi không bao giờ vượt trần 4 USD kể cả khi nhiều người bấm đồng thời.
- **SC-009**: Tệp trùng nội dung gây 0 lần xử lý/gọi AI lặp lại.
- **SC-010**: Không có số tiền chi phí AI xuất hiện ở bất kỳ màn hình hay email nào của khách hàng của tính năng này (kiểm tra tự động trên bản giao diện và mẫu email).
- **SC-011**: ≥ 90% người dùng thử có thể tìm và khôi phục một phiên bản cũ trong ≤ 1 phút.
- **SC-012**: Chuyển màn hình Hồ sơ kinh doanh ≤ 1 giây; tải trang đầu ≤ 3 giây trên 4G; chạy được ở 360 px, đạt WCAG 2.1 AA.

## Assumptions

- Người dùng của tính năng là **chủ tài khoản** (sửa) và **cộng tác viên** (chỉ xem), theo quyền đã chốt ở đặc tả 006 và mục 3.1.
- Mỗi tài khoản có **một** hồ sơ (một cửa hàng/thương hiệu); nhiều hồ sơ nằm ngoài giai đoạn 1.
- Loại tệp, giới hạn 10 MB/tệp và 10 tệp/tài khoản là mặc định PM chọn cho cửa hàng nhỏ (bảng giá, menu, chính sách thường ngắn); điều chỉnh bằng cấu hình sau khi có dữ liệu sử dụng thực tế, không cần phát hành lại.
- Việc lấy chữ từ ảnh chụp dùng năng lực nhìn của AI qua Cổng AI nên tính vào ngân sách AI; tệp PDF/Word/TXT có chữ thì lấy chữ trực tiếp không tốn AI. Cách làm cụ thể chốt ở bước plan.
- "Chữ đã trích" chỉ lưu để tóm tắt lại và để chủ kiểm chứng; không được module khác đọc trực tiếp (chỉ nội dung chủ đã xác nhận trong phiên bản mới ra ngoài).
- Phiên bản hồ sơ dùng làm một phần phần đầu lời nhắc để tận dụng bộ đệm lời nhắc của nhà cung cấp AI (Kiến trúc dữ liệu mục 10); số phiên bản là khóa nhận diện.
- Mô hình AI/nhà cung cấp chưa chốt (POC-1, POC-4): tính năng chỉ dùng hợp đồng Cổng AI; có thể phát triển và kiểm thử bằng bản giả lập (005) rồi chạy bản thật khi 015 hoàn tất.
- Gợi ý "tóm tắt" là một chức năng AI **thủ công do người dùng kích hoạt**; không có tóm tắt tự động chạy ngầm khi lưu hồ sơ.
- Ngôn ngữ nội dung hồ sơ chủ yếu là tiếng Việt; tiếng Anh được chấp nhận ở mức đọc và tóm tắt.
- Giai đoạn 1 chỉ ứng dụng web chạy tốt trên điện thoại; không có ứng dụng di động riêng.
- Thông báo trong ứng dụng khi tóm tắt xong là tùy chọn; bắt buộc chỉ là giao diện hiện kết quả khi người dùng quay lại; email không dùng cho tính năng này.
