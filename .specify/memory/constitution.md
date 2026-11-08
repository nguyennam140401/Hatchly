<!--
SYNC IMPACT REPORT (tạm thời – xóa trước khi commit)
- Thay đổi phiên bản: (mẫu chưa điền) → 1.0.0 (ban hành lần đầu)
- Nguyên tắc: thay toàn bộ 5 chỗ trống của mẫu bằng 9 nguyên tắc
  I. Cô lập dữ liệu giữa tài khoản
  II. Đăng bài tin cậy, không bao giờ đăng trùng
  III. Mọi lời gọi AI đi qua Cổng AI, chặn ngân sách trước khi gọi
  IV. Modular monolith có ranh giới cứng
  V. Việc nền bền vững và chạy lại được an toàn
  VI. AI đề xuất, con người quyết định
  VII. Bảo vệ bí mật và dữ liệu cá nhân
  VIII. Quan sát được và truy vết được
  IX. Đơn giản, chuẩn mở, quyết định có truy vết
- Mục thêm mới: "Ràng buộc kỹ thuật & tiêu chuẩn chất lượng", "Quy trình phát triển & cổng chất lượng"
- Mục bị xóa: không
- Template phụ thuộc: không sửa (đọc hiến pháp lúc chạy)
- TODO hoãn lại:
  - Q-D3/C6 (hồ sơ chuyển dữ liệu xuyên biên giới) chưa chốt – phải chốt trước ngày ra mắt.
  - T11 (mô hình AI, chuyển giọng nói) chốt sau POC-1, POC-4; nhà cung cấp đám mây chốt sau 3 điểm xác minh (T4).
-->

# Hiến pháp dự án – Ứng dụng AI tạo & đăng nội dung mạng xã hội

Nguồn căn cứ: `TaiLieuDacTa/` – Đặc tả yêu cầu v1.7, ADD tổng thể v1.2 và các ADD module
(Worker, Đăng bài, Cổng AI), ADR-01…ADR-10, Kiến trúc dữ liệu & cache, Lựa chọn công nghệ v1.1,
Mô tả UI/UX. Khi có mâu thuẫn, hiến pháp này thắng; chi tiết thực thi tra trong các tài liệu trên.

## Core Principles

### I. Cô lập dữ liệu giữa tài khoản (KHÔNG THƯƠNG LƯỢNG)

Tenant = 1 tài khoản khách hàng (1 chủ + tối đa 2 cộng tác viên). Dữ liệu của tenant này
KHÔNG BAO GIỜ được đọc, sửa hay xóa từ tenant khác (ADR-02).

- Mã tài khoản MUST lấy từ phiên đăng nhập; MUST NOT nhận từ tham số, thân yêu cầu hay
  đường dẫn do người dùng gửi lên.
- Mọi bảng nghiệp vụ của khách hàng MUST có `tai_khoan_id NOT NULL` (cột đầu của chỉ mục) và
  MUST bật Row-Level Security của PostgreSQL; thiếu biến phiên → không thấy dòng nào.
- Biến phiên tenant MUST đặt ở phạm vi giao dịch, không ở phạm vi kết nối.
- Ứng dụng chạy bằng vai trò CSDL `ung_dung`, MUST NOT có quyền bỏ qua chính sách bảo mật mức
  dòng; vai trò `chu_so_huu` chỉ dùng cho công cụ cập nhật cấu trúc.
- Việc nền MUST mang mã tài khoản và Worker MUST đặt lại ngữ cảnh tenant trước khi xử lý.
- Tệp media MUST nằm dưới tiền tố `tenants/{mã}/`; đường dẫn ký sẵn chỉ cấp đúng tiền tố đó.
- Nhật ký, chỉ số MUST gắn mã tài khoản. Đội hỗ trợ/quản trị nội bộ là vai trò riêng, chỉ đọc
  qua khung nhìn đã lọc, mọi lần xem dữ liệu khách hàng MUST được ghi nhật ký kiểm toán.

**Lý do:** chung một CSDL để giữ chi phí thấp; một lỗi lập trình có thể lộ dữ liệu chéo, nên
cần hai lớp chặn (ứng dụng + CSDL) và kiểm thử tự động.

### II. Đăng bài tin cậy, không bao giờ đăng trùng (KHÔNG THƯƠNG LƯỢNG)

Mục tiêu: 0 bài đăng trùng, ≥ 98% bài đã duyệt đăng thành công, lệch lịch ≤ 5 phút,
không mất bài trong hàng chờ khi khởi động lại (ADR-03, ADR-04).

- Mỗi cặp (bài, kênh) MUST có tối đa một lượt đăng hiệu lực (ràng buộc duy nhất trong CSDL);
  mọi chuyển trạng thái lượt đăng MUST là cập nhật có điều kiện theo trạng thái hiện tại.
- Duyệt bài, tạo lượt đăng và tạo việc MUST nằm trong cùng một giao dịch.
- Trạng thái "Đã gửi, chờ phản hồi" MUST được ghi trước khi gửi lên nền tảng.
- Lỗi MUST được phân 3 loại: *chắc chắn chưa được nhận* → tự thử lại có giãn cách (tối đa 5 lần
  /30 phút); *cần người dùng xử lý* → dừng, báo trong ứng dụng + email kèm cách khắc phục;
  *không xác định* → MUST NOT gửi lại ngay, MUST đối soát trước; không đối soát được → chuyển
  "Cần kiểm tra" để người dùng chọn "Đã đăng" hoặc "Đăng lại".
- Mỗi lượt đăng MUST ghi đủ 5 bước (kiểm tra trước, chuẩn bị media, gửi, chờ xử lý, xác nhận),
  mỗi bước có thời điểm, kết quả, mã lỗi gốc, lời giải thích dễ hiểu và cách khắc phục (FR-08).
- Mỗi nền tảng MUST là một bộ chuyển đổi sau giao diện chung (ADR-05). Thêm nền tảng = thêm bộ
  chuyển đổi; MUST NOT sửa luồng đăng chính.
- Giai đoạn 1 MUST dùng bộ hẹn giờ chung của hệ thống cho mọi kênh, không dùng hẹn giờ của
  nền tảng.

**Lý do:** API đăng bài của nền tảng không có khóa chống trùng; đăng trùng lên Page của khách
hàng gây hại uy tín trực tiếp, nặng hơn việc chậm vài phút.

### III. Mọi lời gọi AI đi qua Cổng AI, chặn ngân sách trước khi gọi (KHÔNG THƯƠNG LƯỢNG)

Chi phí AI mục tiêu ≤ 2 USD, trần cứng 4 USD mỗi tài khoản mỗi chu kỳ; tổng chi KHÔNG BAO GIỜ
được vượt trần (ADR-06, FR-11).

- Mọi lời gọi AI và chuyển giọng nói (tạo bài, lập kế hoạch, gán nhãn, tóm tắt xu hướng) MUST
  đi qua module Cổng AI; module khác MUST NOT gọi trực tiếp SDK nhà cung cấp.
- Trước mỗi lời gọi, Cổng AI MUST giữ chỗ theo chi phí tối đa ước tính bằng một câu lệnh cập
  nhật có điều kiện; không đủ → chặn. Sau lời gọi MUST quyết toán chi phí thực và trả phần giữ
  chỗ; lỗi/hết thời gian MUST trả lại giữ chỗ.
- Từ 2 USD MUST tự chuyển sang mô hình rẻ; từ 4 USD MUST chặn mọi chức năng AI đến hết chu kỳ.
  Khi bị chặn, người dùng MUST vẫn soạn/sửa tay, duyệt, lên lịch, đăng, tải media, gắn nhãn tay.
- Mỗi lời gọi MUST ghi sổ chi phí (tài khoản, chức năng, mô hình, token, chi phí). Tiền MUST lưu
  bằng số nguyên micro-USD; MUST NOT dùng số thực.
- Bảng giá mô hình là cấu hình, đổi không cần phát hành. Kiểm tra ngân sách ≤ 50 ms.
- Số tiền chi phí AI MUST NOT hiển thị ở bất kỳ màn hình hay email nào của khách hàng; chỉ hiển
  thị dạng % trên trần 4 USD (FR-12).

**Lý do:** biên lợi nhuận mỏng; cộng chi phí sau khi gọi không chặn được khi nhiều người cùng
bấm, và cho phép vượt trần.

### IV. Modular monolith có ranh giới cứng

- Một mã nguồn, hai đơn vị triển khai: **API** và **Worker**, từ cùng một ảnh container
  (ADR-01). MUST NOT tách microservice ở giai đoạn 1 khi chưa có ADR mới.
- Mỗi module (Tài khoản & Gói, Ngữ cảnh kinh doanh, Thư viện media, Xu hướng, Nội dung,
  Duyệt & lịch, Đăng bài, Cổng nền tảng, Cổng AI, Thông báo, Hàng chờ) MUST sở hữu schema riêng.
- Module MUST chỉ gọi nhau qua giao diện công khai; MUST NOT đọc/ghi bảng của module khác.
- Khóa ngoại MUST chỉ nằm trong nội bộ module và tới bảng tài khoản; tham chiếu giữa module là
  mã tham chiếu, kiểm tra khi ghi qua module sở hữu (ADR-09).
- Sự kiện giữa module MUST ghi vào hàng chờ trong cùng giao dịch với dữ liệu nghiệp vụ.

**Lý do:** đội nhỏ (3–4 người) cần đơn giản như monolith nhưng phải giữ được khả năng tách
module (vd Worker media) khi cần.

### V. Việc nền bền vững và chạy lại được an toàn

- Mọi việc chạy lâu hoặc cần tin cậy (đăng bài, media, AI hàng loạt, xu hướng, thông báo, định
  kỳ) MUST đi qua hàng chờ bền vững trong PostgreSQL (pg-boss); MUST NOT dùng hàng chờ trong bộ
  nhớ hay hệ thống tin nhắn riêng ở giai đoạn 1 (ADR-03).
- Mỗi bộ xử lý MUST chạy lại được an toàn (idempotent): có thể bị chạy lại khi khóa hết hạn
  hoặc Worker khởi động lại mà không gây tác dụng phụ lặp.
- Các hàng chờ MUST tách theo loại việc với giới hạn đồng thời riêng; `dang_bai` ưu tiên cao.
  MUST có giới hạn đồng thời theo tenant (chống "hàng xóm ồn ào").
- Tệp lớn MUST tải thẳng từ trình duyệt lên kho tệp bằng đường dẫn ký sẵn; MUST NOT đi qua API
  (ADR-07a). Tệp trùng nội dung (cùng dấu tệp) MUST NOT bị xử lý AI lại.
- Worker MUST tắt có kiểm soát: ngừng lấy việc mới, chờ việc đang chạy tối đa 30 giây.

**Lý do:** xử lý video, gán nhãn và đăng bài không được làm chậm giao diện hay mất việc khi
phát hành/khởi động lại.

### VI. AI đề xuất, con người quyết định

- Nội dung do AI tạo MUST hiển thị là bản nháp; chỉ chủ tài khoản bấm "Duyệt" mới đưa bài vào
  lịch. Sửa nội dung bài đã duyệt MUST đưa bài về "Chờ duyệt"; đổi giờ thì không cần duyệt lại.
- Quyền MUST được kiểm tra ở API, không chỉ ẩn trên giao diện (chủ / cộng tác viên / hỗ trợ /
  quản trị nội bộ theo bảng phân quyền của đặc tả).
- Giao diện MUST dùng tiếng Việt đời thường; mã lỗi gốc chỉ hiện trong "Chi tiết cho hỗ trợ".
- Mỗi thông báo lỗi MUST kèm ít nhất một hành động khắc phục.
- Trạng thái MUST hiển thị bằng chữ + biểu tượng, không chỉ dựa vào màu; đạt WCAG 2.1 AA, vùng
  chạm ≥ 44 × 44 px, hoạt động từ 360 px; ưu tiên điện thoại cho việc hằng ngày.
- MUST NOT chặn người dùng khi không cần (hết AI, gán nhãn lỗi vẫn làm tay được).

**Lý do:** người dùng là chủ kinh doanh cá nhân, không có đội kỹ thuật; nội dung đăng lên Page
của họ phải do họ chịu trách nhiệm.

### VII. Bảo vệ bí mật và dữ liệu cá nhân

- Mã quyền truy cập nền tảng MUST được mã hóa khi lưu bằng khóa của dịch vụ quản lý khóa; chỉ
  module Cổng nền tảng được giải mã. Mã quyền, mật khẩu, bí mật MUST NOT xuất hiện trong nhật
  ký, chỉ số, thông báo lỗi hay màn hình hỗ trợ.
- Dữ liệu lưu trữ (CSDL, tệp media, nhật ký giám sát) MUST đặt tại đám mây trong nước (ADR-10).
- Dữ liệu gửi ra bên ngoài MUST tối thiểu: chỉ phần hồ sơ cần cho lời gọi; không gửi email, số
  điện thoại của chủ tài khoản; khung hình thu nhỏ. Mọi bên nhận mới ở nước ngoài MUST được ghi
  vào danh sách chuyển dữ liệu xuyên biên giới (Kiến trúc dữ liệu mục 9).
- Nhà cung cấp AI MUST cam kết không dùng dữ liệu để huấn luyện. Màn hình đồng ý MUST NOT đặt
  sẵn ô đồng ý.
- Xác thực MUST dùng thư viện mã nguồn mở đã kiểm chứng; MUST NOT tự viết phần mật mã. Đăng nhập
  Google/Facebook có email trùng MUST xác nhận trước khi liên kết, không tự gộp (FR-15).
- Vòng đời dữ liệu MUST tuân thủ: tài khoản hết hạn giữ 90 ngày rồi xóa; yêu cầu xóa tài khoản
  → xóa CSDL và tệp ≤ 30 ngày, ngắt kết nối kênh ngay; nhật ký duyệt/đăng giữ 12 tháng; nhật ký
  kiểm toán còn lại không chứa dữ liệu cá nhân.
- MUST NOT cào dữ liệu từ mạng xã hội.

**Lý do:** Luật BVDLCN 2025 (Luật 91/2025/QH15) áp dụng; ứng dụng giữ khuôn mặt, giọng nói và
quyền đăng bài thay khách hàng.

### VIII. Quan sát được và truy vết được

- Mỗi lượt đăng MUST có mã theo dõi xuyên suốt API → hàng chờ → Worker → nền tảng.
- Đo đạc MUST theo chuẩn OpenTelemetry; nhật ký MUST có cấu trúc.
- Nhật ký nghiệp vụ (5 bước đăng, cho người dùng và hỗ trợ) MUST tách khỏi nhật ký kỹ thuật.
- Cảnh báo vận hành MUST có tối thiểu: tỷ lệ lỗi đăng một kênh > 5%/15 phút; việc `dang_bai`
  quá hạn > 5 phút; quyền truy cập còn < 7 ngày (nhắc người dùng); > 5% tài khoản chạm ngưỡng
  2 USD; sổ chi phí AI lệch hóa đơn nhà cung cấp > 5%.
- Thao tác của quản trị nội bộ (kích hoạt, gia hạn, tạm dừng gói) MUST được ghi nhật ký.

**Lý do:** chỉ số thành công là báo lỗi cho người dùng ≤ 5 phút và hỗ trợ tra được từng bước.

### IX. Đơn giản, chuẩn mở, quyết định có truy vết

- Ưu tiên ít thành phần: MUST NOT thêm máy chủ cache phân tán, hệ thống tin nhắn hay dịch vụ
  mới ở giai đoạn 1 khi chưa có ADR (ADR-08). Không làm tính năng ngoài phạm vi giai đoạn 1.
- MUST chỉ dùng thành phần chuẩn mở (PostgreSQL, Kubernetes, giao diện S3, OpenTelemetry, SMTP)
  để đổi nhà cung cấp chủ yếu là đổi cấu hình. Thư viện bên ngoài quan trọng (pg-boss, SDK AI)
  MUST cố định phiên bản và bọc sau giao diện nội bộ.
- Mọi quyết định kiến trúc mới hoặc đi ngược ADR hiện có MUST có ADR: bối cảnh, phương án, tiêu
  chí có trọng số, quyết định, hệ quả, điều kiện xem xét lại. Quyết định của khách hàng khác đề
  xuất của SA MUST ghi lý do.
- Giả định chưa kiểm chứng (chi phí AI, đối soát, nguồn xu hướng, gán nhãn video) MUST được kiểm
  bằng POC có tiêu chí đạt trước khi chốt lựa chọn phụ thuộc vào nó.

**Lý do:** tải nhỏ, rủi ro nằm ở phụ thuộc bên ngoài; mỗi thành phần thêm vào là chi phí vận
hành cho đội nhỏ.

## Ràng buộc kỹ thuật & tiêu chuẩn chất lượng

**Ngăn xếp công nghệ (đã chốt):**

| Lớp | Công nghệ |
|---|---|
| Giao diện | React + Vite (TypeScript), ứng dụng một trang, phục vụ tĩnh qua CDN trong nước |
| API + Worker | Node.js (TypeScript), NestJS, Drizzle, pg-boss |
| CSDL | PostgreSQL ≥ 13 có Row-Level Security; được quản lý nếu có khôi phục theo thời điểm, nếu không CloudNativePG |
| Kho tệp | Tương thích S3 + CDN của nhà cung cấp trong nước |
| Chạy ứng dụng | Kubernetes được quản lý (ưu tiên VNG Cloud) |
| Giám sát | OpenTelemetry, Prometheus, Loki, Tempo, Grafana, GlitchTip – tự chạy trong nước |
| Email | Amazon SES qua SMTP |
| Xu hướng | RSS báo chính thống + Brave Search API (tổng hợp theo tuần) |
| Mô hình AI, chuyển giọng nói | Chốt sau POC-1, POC-4; truy cập chỉ qua Cổng AI |

Đổi một lựa chọn trong bảng MUST có ADR.

**Quy ước dữ liệu:**

- Khóa chính UUID v7 sinh ở ứng dụng; thời gian `timestamptz` lưu UTC, hiển thị UTC+7.
- Tiền là số nguyên micro-USD. Bảng nghiệp vụ xóa mềm (`da_xoa_luc`) 30 ngày rồi xóa hẳn; nhật
  ký chỉ xóa theo phân vùng.
- Bài và phiên bản kênh MUST có cột `phien_ban` để chặn ghi đè khi nhiều người cùng sửa.
- Bộ đếm hạn mức (100 bài/chu kỳ, tối đa 5 lần tạo lại/bài, 5 GB dung lượng) MUST trừ bằng cập
  nhật có điều kiện trong cùng giao dịch với thao tác.
- MUST NOT cache: ngân sách AI, hạn mức, trạng thái lượt đăng, quyền truy cập nền tảng.
- Chu kỳ theo ngày kích hoạt gói, lặp hằng tháng; tháng không có ngày đó → ngày cuối tháng.

**Chỉ số phi chức năng MUST đạt:**

- Tạo 1 bài (mọi kênh) p95 ≤ 45 giây, chữ đầu tiên ≤ 5 giây; 10 chủ đề ≤ 60 giây.
- Gán nhãn ảnh ≤ 1 phút, video ≤ 10 phút (8 khung hình + lời nói 5 phút đầu nếu có giọng nói).
- Khả dụng 99,5%/tháng; mất dữ liệu ≤ 5 phút; khôi phục ≤ 1 giờ.
- Chịu gấp 10 tải ước tính (30.000 lượt đăng/tháng, 500 GB) không đổi kiến trúc.
- Tải trang đầu ≤ 3 giây trên 4G; chuyển màn hình ≤ 1 giây.

## Quy trình phát triển & cổng chất lượng

**Kiểm tra tự động bắt buộc trong CI (chặn hợp nhất khi thất bại):**

1. Kiểm thử truy cập chéo: với mỗi bảng của khách hàng, đăng nhập tài khoản A thử đọc/sửa/xóa
   dữ liệu tài khoản B → MUST thất bại.
2. Công cụ phát hiện bảng có `tai_khoan_id` mà chưa bật chính sách bảo mật mức dòng.
3. Kiểm tra phụ thuộc giữa module (không import nội bộ, không truy cập schema của module khác).
4. Kiểm tra kiểu TypeScript nghiêm ngặt và lint cho cả frontend lẫn backend.
5. Quét bí mật trong mã nguồn và nhật ký mẫu.

**Kiểm thử bắt buộc theo vùng rủi ro:**

- Đăng bài: mỗi loại lỗi (chắc chắn chưa nhận / cần người dùng / không xác định), đối soát,
  hai Worker cùng lấy một lượt đăng, Worker chết giữa chừng → không đăng trùng.
- Cổng AI: giữ chỗ khi nhiều người gọi đồng thời không vượt trần; chuyển mô hình ở ngưỡng 2 USD;
  chặn ở 4 USD; trả lại giữ chỗ khi lỗi.
- Mỗi bộ chuyển đổi nền tảng MUST có kiểm thử hợp đồng theo giao diện chung.
- Bộ xử lý việc nền: chạy lại hai lần cho cùng kết quả.
- Hạn mức và chu kỳ: ngày 29–31, tháng ngắn, gia hạn giữ ngày chu kỳ.

**Quy trình:**

- Mọi tính năng MUST bắt đầu từ đặc tả (`/speckit-specify`) truy vết về mã FR/NFR; kế hoạch
  (`/speckit-plan`) MUST có mục "Kiểm tra hiến pháp" đối chiếu chín nguyên tắc.
- Mọi thay đổi MUST qua review; người review MUST xác nhận tuân thủ hiến pháp, nhất là nguyên
  tắc I, II, III.
- Thay đổi cấu trúc CSDL MUST tương thích ngược để API/Worker cũ và mới chạy song song khi phát
  hành; API và Worker phát hành cùng nhau.
- Khôi phục CSDL MUST được diễn tập mỗi quý ra môi trường riêng, đo thời gian.
- Trước ngày ra mắt MUST có: hồ sơ đánh giá tác động chuyển dữ liệu xuyên biên giới (Q-D3/C6),
  App Review của Meta được duyệt, kết quả POC-1…POC-4.

## Governance

- Hiến pháp này có hiệu lực cao hơn mọi quy ước, hướng dẫn và thói quen khác của dự án. Tài
  liệu trong `TaiLieuDacTa/` là hướng dẫn chi tiết; mâu thuẫn với hiến pháp MUST được giải quyết
  bằng sửa tài liệu hoặc sửa đổi hiến pháp, không được bỏ qua.
- **Sửa đổi:** đề xuất bằng văn bản nêu nguyên tắc bị ảnh hưởng, lý do, tác động tới mã và tài
  liệu hiện có, kế hoạch chuyển đổi. Thay đổi nguyên tắc I, II, III hoặc thay đổi ràng buộc từ
  quyết định của khách hàng (ADR-04, ADR-05, ADR-07b, ADR-10) MUST được PO duyệt; thay đổi khác do
  SA duyệt.
- **Phiên bản (semantic versioning):** MAJOR – bỏ hoặc định nghĩa lại nguyên tắc theo cách không
  tương thích; MINOR – thêm nguyên tắc/mục hoặc mở rộng đáng kể; PATCH – làm rõ câu chữ, sửa lỗi
  không đổi nghĩa. Mỗi sửa đổi cập nhật ngày "Last Amended".
- **Tuân thủ:** mọi review và mọi kế hoạch tính năng MUST kiểm tra tuân thủ. Vi phạm có chủ đích
  MUST ghi trong mục "Theo dõi độ phức tạp" của kế hoạch kèm lý do và phương án đơn giản hơn đã
  bị loại. Rà soát hiến pháp khi một điều kiện "Xem xét lại khi" của ADR xảy ra, khi có kết quả
  POC, hoặc khi có kết luận pháp lý Q-D3.

**Version**: 1.0.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-07
