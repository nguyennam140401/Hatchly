# ADR-11 (dự thảo). Nhà cung cấp hạ tầng: iNET hay VNG Cloud

- **Trạng thái**: Đã duyệt – chủ dự án chọn phương án B, trùng đề xuất của SA (2026-11-13)
- **Người soạn**: SA
- **Liên quan**: ADR-10 (đám mây trong nước), Lựa chọn công nghệ T4, T4c, T5, T6; đặc tả
  `specs/007-terraform-infra-environments/spec.md`; hiến pháp nguyên tắc VII, IX
- **Nơi lưu chính thức**: khi được duyệt, chép vào `TaiLieuDacTa/ADR_App_AI_Content_MXH.md` và cập nhật T4/T5

## 1. Bối cảnh

T4 chấm VNG Cloud 3,75 và FPT Cloud 3,35 với giả định "đội 3–4 người". Ngày 2026-11-13 chủ dự án nêu ba dữ
kiện mới làm thay đổi bài toán:

1. Người triển khai là **một cá nhân**, làm theo quy trình SDLC, **chưa quen vận hành đám mây**.
2. Muốn **học quy trình triển khai** qua dự án này.
3. Cần **tối ưu chi phí**; đang cân nhắc iNET (inet.vn).

Ràng buộc không đổi: dữ liệu lưu trong nước (ADR-10); mã quyền nền tảng mã hóa bằng khóa của một dịch vụ quản
lý khóa (nguyên tắc VII); mất dữ liệu ≤ 5 phút, khôi phục ≤ 1 giờ, khả dụng 99,5%; hạ tầng mô tả bằng
Terraform (WBS H1); chỉ dùng chuẩn mở để đổi nhà cung cấp được (nguyên tắc IX).

## 2. Vấn đề

Dựng hạ tầng trên iNET hay VNG Cloud, khi người vận hành là một cá nhân ít kinh nghiệm vận hành và nhạy cảm
về chi phí?

## 3. Dữ kiện đã kiểm tra (tài liệu công khai, 2026-11-13)

| Năng lực cần | iNET | VNG Cloud |
|---|---|---|
| Máy chủ ảo | Có (Cloud Server, Cloud VPS), loại **không quản trị**, có API | Có (vServer), có mạng riêng, cân bằng tải, tường lửa |
| Kubernetes được quản lý | **Không thấy** | Có (VKS); phần điều khiển chạy nhiều vùng, **miễn phí**; chỉ trả tiền máy, mạng, đĩa |
| PostgreSQL được quản lý | **Không thấy** | Có (vDB), sao lưu tự động bắt buộc; **khôi phục theo thời điểm ≤ 5 phút chưa xác nhận** |
| Kho tệp tương thích S3 trong nước | Có (Object Storage); chưa xác nhận lưu phiên bản, luật vòng đời | Có (vStorage) |
| CDN | **Không thấy** sản phẩm riêng (chỉ có bộ đệm trong OneShield) | Có (vCDN) |
| Dịch vụ quản lý khóa | **Không thấy** | Có theo T4; cần xác nhận lại khi báo giá |
| Terraform provider chính thức | **Không thấy** (chỉ API REST, ví dụ cURL/Python/Node/PHP) | Có, kèm ví dụ dựng cụm và nhóm máy |
| Trách nhiệm sao lưu | Hợp đồng ghi khách hàng tự sao lưu, iNET không chịu trách nhiệm dữ liệu | Có dịch vụ sao lưu; chi tiết theo hợp đồng |
| Cân bằng tải, mạng riêng giữa các máy | Không thấy trên trang sản phẩm | Có |

Các ô "không thấy" là kết quả tra trang công khai, **chưa hỏi bộ phận bán hàng**. Cả hai bên đều **chưa có
báo giá chính thức**.

## 4. Phương án

- **A – Toàn bộ trên iNET, tự vận hành Kubernetes**: tự cài và nâng cấp cụm trên Cloud Server; CSDL bằng
  CloudNativePG; tự chạy dịch vụ quản lý khóa mã nguồn mở; tự dựng cân bằng tải; CDN thuê ngoài hoặc
  OneShield; máy ảo tạo qua API hoặc bằng tay vì không có Terraform provider.
- **B – VNG Cloud, Kubernetes được quản lý**: phần điều khiển do nhà cung cấp lo; Terraform dựng toàn bộ;
  dùng sẵn cân bằng tải, khóa, CDN; CSDL được quản lý nếu đạt xác minh, không thì CloudNativePG.
- **C – iNET, không Kubernetes**: `api` và `worker` chạy bằng Docker Compose trên 1–2 Cloud Server,
  PostgreSQL trên máy ảo. Đi ngược T5.

## 5. Tiêu chí và chấm điểm

Trọng số đặt theo ba dữ kiện mới ở mục 1 (thang 1–5, điểm = Σ điểm × trọng số).

| Tiêu chí (trọng số) | A. iNET + tự vận hành K8s | B. VNG Cloud được quản lý | C. iNET + Docker Compose |
|---|---|---|---|
| Công vận hành cho một người ít kinh nghiệm (30%) | 1 – tự lo cài cụm, nâng cấp, chứng chỉ nội bộ, mạng, cân bằng tải, dịch vụ khóa, sao lưu | 4 – chỉ lo phần ứng dụng; cụm, cân bằng tải, khóa có sẵn | 3 – ít thành phần, nhưng tự vá máy, tự chuyển khi hỏng |
| Tiền mặt hằng tháng (25%) | 4 | 3 | 5 |
| An toàn dữ liệu và độ tin cậy: 99,5%, mất ≤ 5 phút (20%) | 2 – mọi điểm hỏng đều do một người xử lý; cần ≥ 3 máy để cụm chịu lỗi | 4 | 2 – hỏng máy là dừng dịch vụ |
| Hạ tầng dựng lại được bằng Terraform + giá trị học (15%) | 2 – không có provider; học nhiều nhưng là học quản trị cụm, không phải quy trình triển khai | 5 – đúng thứ cần học: Terraform, triển khai lên Kubernetes, sao lưu, phát hành | 2 |
| Dễ chuyển nhà cung cấp (10%) | 5 | 4 – cùng chuẩn mở; phần riêng gom vào lớp nhà cung cấp | 3 |
| **Tổng** | **2,50** | **3,90** | **3,15** |

**Độ nhạy**: nâng trọng số tiền mặt lên 40% (vận hành 20%, tin cậy 15%, Terraform 15%, chuyển đổi 10%) →
A 2,90 · B 3,75 · C 3,50. B vẫn dẫn. A chỉ thắng B khi công vận hành được coi là không đáng kể (< 10%), tức
khi có người vận hành Kubernetes thành thạo – ngược với dữ kiện 1.

## 6. Ước tính chi phí hằng tháng

**Độ tin cậy thấp**: chưa có báo giá của bên nào. Giá máy VNG lấy từ trang một đại lý (100.000đ/vCPU,
96.000đ/GB RAM mỗi tháng, trả trước 12 tháng, chưa VAT, có thể đã cũ). Giá máy iNET không tra được, lấy
khoảng giá thị trường máy ảo trong nước cho 4 vCPU / 8 GB. Chỉ dùng để so bậc độ lớn.

| Khoản | A. iNET | B. VNG Cloud |
|---|---|---|
| Phát hành – máy chạy ứng dụng | 3 máy 4 vCPU/8 GB (tối thiểu để cụm tự vận hành chịu được lỗi một máy): ~1,2–2,4 triệu | 2 máy 4 vCPU/8 GB (phần điều khiển miễn phí): ~2,3 triệu |
| Thử nghiệm | 1 máy, trả theo tháng dù không dùng: ~0,4–0,8 triệu | 1 máy, **bật khi cần** (dựng/hủy bằng Terraform): ~0,3 triệu nếu dùng ~25% thời gian; ~1,2 triệu nếu bật suốt |
| Đĩa cho CSDL và giám sát (~100 GB) | ~0,45 triệu (4.500đ/GB, số của iNET) | chưa có giá; giả định tương đương |
| Kho tệp ~50 GB | < 0,1 triệu | < 0,1 triệu |
| CDN + băng thông ~600 GB | thuê ngoài: ~0,4–0,6 triệu | ~0,4–0,6 triệu |
| Cân bằng tải, khóa | tự chạy trên các máy sẵn có: 0đ tiền mặt, tốn công | ~0,3–0,5 triệu (giả định) |
| **Tổng tiền mặt** | **~2,5–4,4 triệu** | **~3,5–5,2 triệu** (dùng CloudNativePG; CSDL được quản lý tính thêm) |

Chênh lệch tiền mặt: B đắt hơn A khoảng **0,5–1,5 triệu đồng/tháng**.

Công bỏ ra thêm ở A (nguồn: bài so sánh của chính GreenNode/VNG – là bên bán, nên coi là cận trên): dựng cụm
3–5 ngày với người đã có kinh nghiệm, gấp đôi nếu chưa; nâng cấp ~3 lần/năm, mỗi lần 4–8 giờ; cộng dịch vụ
khóa, cân bằng tải và sao lưu tự dựng. Với một người làm cả sản phẩm, đây là thời gian lấy từ việc viết tính
năng, và là rủi ro mất dữ liệu khách hàng khi sự cố xảy ra lúc chưa đủ kinh nghiệm xử lý.

## 7. Đề xuất của SA và quyết định

**Chọn B – VNG Cloud**, kèm ba biện pháp giảm chi phí:

1. **Thử nghiệm bật khi cần**: phần điều khiển miễn phí và hạ tầng dựng bằng Terraform nên môi trường thử
   nghiệm có thể hủy khi không dùng và dựng lại trong chưa tới một giờ.
2. **CSDL bằng CloudNativePG trên cụm** ở giai đoạn đầu thay vì trả tiền CSDL được quản lý; chuyển sang CSDL
   được quản lý khi có khách hàng trả tiền và đã xác minh khôi phục theo thời điểm.
3. **Phát hành bắt đầu 2 máy**, tăng theo tải thật.

Lý do chính: khoản tiết kiệm ~0,5–1,5 triệu đồng/tháng của iNET không bù được việc một người chưa quen vận
hành phải tự giữ cụm Kubernetes, dịch vụ khóa và sao lưu cho dữ liệu và quyền đăng bài của khách hàng. Thứ
chủ dự án muốn học – quy trình triển khai – nằm trọn trong phương án B; phương án A buộc học thêm quản trị
cụm, là phần ít giá trị nhất với sản phẩm.

**iNET vẫn dùng tốt cho**: tên miền, DNS, và có thể cả kho tệp nếu giá thấp hơn rõ rệt (mã chỉ dùng giao diện
S3 nên đổi nơi lưu là đổi cấu hình).

Nếu chủ dự án vẫn chọn A: ghi vào ADR này lý do khác đề xuất (theo hiến pháp nguyên tắc IX), đổi T5 thành
"Kubernetes tự vận hành", và đặc tả 007 thêm phạm vi: cài và nâng cấp cụm, cân bằng tải, dịch vụ khóa tự
chạy, cách tạo máy ảo khi không có Terraform provider.

**Quyết định (chủ dự án, 2026-11-13):** chọn **B – VNG Cloud** cho toàn bộ hạ tầng, áp dụng cả ba biện pháp
giảm chi phí ở trên.

## 8. Hệ quả

- **Nếu B**: không đổi T5; lớp nhà cung cấp đầu tiên của 007 viết cho VNG Cloud; vẫn cần xác minh 3 điểm của
  T4 trước khi ký; đặc tả 007 thêm yêu cầu "thử nghiệm dựng/hủy theo nhu cầu".
- **Nếu A**: đi ngược T5, phạm vi 007 tăng đáng kể, mục tiêu 99,5% và "Terraform dựng toàn bộ" có rủi ro
  không đạt; cần tài liệu xử lý sự cố cụm và diễn tập thường xuyên hơn.
- **Cả hai**: đặc tả 007 phải sửa các chỗ giả định "đội nhiều người" (ví dụ yêu cầu người thứ hai duyệt
  thay đổi lên phát hành) cho hợp với một cá nhân.

## 9. Xem xét lại khi

- Báo giá thật cho thấy B đắt hơn A trên 3 triệu đồng/tháng; hoặc
- iNET xác nhận có Kubernetes được quản lý, dịch vụ quản lý khóa và Terraform provider; hoặc
- VNG Cloud không đạt 3 điểm xác minh của T4; hoặc
- Dự án có người vận hành Kubernetes thành thạo.

## 10. Câu hỏi cần gửi nhà cung cấp trước khi chốt

**Gửi iNET**: Có Kubernetes được quản lý không? Có mạng riêng giữa các Cloud Server và cân bằng tải không? Có
dịch vụ quản lý khóa không? Object Storage có lưu phiên bản, luật vòng đời theo nhãn, đường dẫn ký sẵn, CORS
không? Có Terraform provider hay kế hoạch phát hành không? Cloud Server tính theo giờ hay theo tháng? Cam kết
khả dụng trong hợp đồng là bao nhiêu? Giá gói 4 vCPU / 8 GB?

**Gửi VNG Cloud**: vDB PostgreSQL có lưu nhật ký giao dịch liên tục và khôi phục về thời điểm bất kỳ không?
Giá máy trả theo giờ, giá cân bằng tải, vStorage, vCDN theo GB, dịch vụ quản lý khóa? Cam kết khả dụng của
VKS và vDB? Có ưu đãi dùng thử cho tài khoản mới không?

## Nguồn

- https://inet.vn/ · https://inet.vn/cloud-server · https://inet.vn/vps · https://developers.inet.vn/
- https://inet.vn/bieu-mau-ho-so/vps/BM12-Hop%20dong%20cung%20cap%20Cloud%20VPS.doc
- https://docs.vngcloud.vn/vng-cloud-document/vn/vks/cach-tinh-gia
- https://docs.vngcloud.vn/vng-cloud-document/vn/vks/vks-la-gi
- https://docs.vngcloud.vn/vng-cloud-document/vks/su-dung-vks-voi-terraform
- https://docs.vngcloud.vn/vng-cloud-document/vn/vdb/relational-database-service-rds/postgresql-cluster
- https://greennode.ai/en/blog/managed-kubernetes-for-startups
- https://hitechcloud.vn/vks/ (giá đại lý, chưa kiểm chứng)
