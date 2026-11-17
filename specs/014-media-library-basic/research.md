# Research: Thư viện media cơ bản (014)

**Ngày**: 2026-11-16 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Mỗi mục có **Quyết định · Lý do · Phương án đã loại**. Mục ghi **[Kiểm chứng]** là giả định chưa chắc: theo hiến pháp IX
phải kiểm bằng thử nghiệm ngắn có tiêu chí đạt (xếp ở giai đoạn đầu của `tasks.md`) trước khi các phần phụ thuộc vào nó
được coi là xong.

## Bảng kết luận nhanh

| # | Chủ đề | Quyết định |
|---|---|---|
| R1 | Tải có tiếp tục | ≤ 8 MiB: một lần POST ký sẵn (đã có); > 8 MiB: **S3 multipart**, phần 8 MiB, URL từng phần ký sẵn |
| R2 | Nhận lại phiên tải dở | Khóa nhận dạng `fingerprint` = SHA-256(tên\|dung lượng\|lastModified) gửi lúc bắt đầu; danh sách phần đã lên lấy từ `ListParts` của kho (nguồn sự thật) |
| R3 | Dấu tệp (hash) và chống trùng | Worker tính SHA-256 theo luồng; API chỉ `stat` + dò nội dung; trùng → chỉ báo "đã có", hoàn dung lượng |
| R4 | Thư viện xử lý ảnh | `sharp` (cố định phiên bản); HEIC qua bộ giải mã WASM + `sharp` **[Kiểm chứng]** |
| R5 | Xử lý video | `ffprobe`/`ffmpeg` cài vào ảnh container; tải tệp về thư mục tạm của việc rồi trích khung hình |
| R6 | Bộ đếm 5 GB | Bảng `media.storage_quotas` trong schema `media` (không ghi vào schema `account`) |
| R7 | Dọn dẹp | Quét hằng giờ bằng hàm `SECURITY DEFINER` → việc `media.cleanup` theo từng tài khoản; không có việc hẹn giờ theo từng phiên |
| R8 | Kiểm tra nội dung thật | Hàm dò "magic bytes" của chính dự án (không thêm thư viện), chạy lúc xác nhận |
| R9 | Đường dẫn công khai | Chỉ qua `MediaPublicApi.issuePublicUrl`; HTTP không có cửa nào trả loại này |
| R10 | "Bài nào đang dùng media" | Đảo phụ thuộc: `media` định nghĩa cổng `MediaUsageProvider`, module bài đăng ký vào (tránh vòng `content ↔ media`) |
| R11 | Giới hạn đồng thời việc `media` | Giữ **1 việc/tài khoản** theo `infra.queue_settings`; sửa spec FR-014 cho khớp |
| R12 | Quyền và gói hết hạn | Thêm `media.view`, `media.delete`; cổng gói là một cổng nội bộ mặc định "đang hiệu lực" cho tới WBS 2.6 |
| R13 | Mâu thuẫn tài liệu | Bảng "Sửa tài liệu gốc" trong plan.md (10 MB → 20 MB, nơi lưu bộ đếm, 1 giờ → 24 giờ…) |
| R14 | Ảnh xem trước | Đường dẫn ký sẵn ngắn hạn của kho; CDN là tối ưu sau, không phải điều kiện đạt SC-007 |
| R15 | Phía giao diện | Dùng lại `lib/upload` của 011, mở rộng trạng thái + vận chuyển POST/multipart |

---

## R1. Tải thẳng có tiếp tục

**Quyết định.** Hai chế độ, chọn theo dung lượng khai báo lúc bắt đầu (`MEDIA_LIMITS.singleUploadMaxBytes` = 8 MiB):

- **`single`** (≤ 8 MiB, đa số ảnh): đúng đường dẫn đã có trong kho tệp 005 — `presignUpload` (POST policy: khóa, `Content-Type`,
  `content-length-range` ràng buộc). Gián đoạn thì tải lại cả tệp (≤ 8 MiB nên rẻ).
- **`multipart`** (> 8 MiB: video, ảnh nặng): mở rộng cổng `ObjectStorage` thêm 5 thao tác (`createMultipart`, `presignPart`,
  `listParts`, `completeMultipart`, `abortMultipart` – xem [contracts/storage-multipart.md](./contracts/storage-multipart.md)).
  Tệp chia phần 8 MiB (S3 yêu cầu ≥ 5 MiB trừ phần cuối; video 500 MB ≈ 63 phần, trần S3 là 10.000 phần). Trình duyệt `PUT`
  từng phần lên URL ký sẵn; phần lỗi chỉ gửi lại phần đó (FR-005).

Quyền tải ký sẵn ≤ 15 phút mỗi URL (đúng `MAX_UPLOAD_TTL_SEC`); hết hạn giữa chừng thì web gọi
`POST /media/uploads/:id/part-urls` để lấy URL mới trong cùng phiên (FR-006).

**Lý do.** Giao diện 011 đã dựng sẵn khung `UploadTransport` + `createMultipartTransport` (đang tắt, ghi rõ "bật khi kho hỗ
trợ multipart – quyết định ở tính năng Thư viện media"). Hạ tầng 007 đã có sẵn: luật hủy tải nhiều phần dở
(`abort_incomplete_multipart_upload`), quyền IAM `s3:AbortMultipartUpload`/`ListMultipartUploadParts`, CORS cho `PUT`/`POST`.
Multipart là chuẩn S3 nên đổi nhà cung cấp chỉ là đổi cấu hình (hiến pháp IX). Hai chế độ giữ đường POST đã được kiểm thử hợp
đồng 005 cho phần lớn tệp, và chỉ tệp lớn mới trả chi phí multipart (3 yêu cầu so với 1).

**Phương án đã loại.**
- *Mọi tệp đều multipart*: một đường dẫn mã duy nhất, nhưng ảnh 3 MB tốn 3 yêu cầu S3 và bỏ phí hợp đồng POST đã kiểm.
- *Giao thức tải tiếp tục tus / dịch vụ trung gian*: thêm dịch vụ mới, trái hiến pháp IX và ADR-07a (tệp không qua API).
- *PUT một lần có `Range`*: S3 không hỗ trợ ghi tiếp một đối tượng đơn.

**Rủi ro dư.** (a) Ràng buộc kích thước của phần: URL ký sẵn `UploadPart` chỉ chặn được kích thước nếu ký cả `Content-Length`.
Cách chặn: ký `Content-Length` đúng bằng độ dài phần dự kiến khi nhà cung cấp cho phép **[Kiểm chứng ở V5/MinIO]**; nếu không ký
được thì **bước xác nhận** vẫn so tổng `stat` với dung lượng khai báo và bác tệp lệch; phần thừa trong phiên chưa ghép chỉ tồn tại
tới khi dọn (24 giờ) hoặc luật hủy tải dở của bucket. (b) vStorage HCM04 phải hỗ trợ multipart đầy đủ — đã nằm ở câu hỏi nhà
cung cấp **V5** (`infra/docs/p6-cau-hoi-nha-cung-cap.md`); không đạt thì chế độ `single` vẫn dùng được, video lớn quay về "tải lại
cả tệp" và SC-002 chưa đạt (ghi vào rủi ro).

## R2. Nhận lại phiên tải dở khi chọn lại tệp

**Quyết định.** Trình duyệt tính `fingerprint = SHA-256(hex)` của chuỗi `tên|dung lượng|lastModified` (WebCrypto, trên chuỗi ngắn,
không đọc nội dung tệp) và gửi lúc `POST /media/uploads`. Máy chủ tìm phiên đang mở của **cùng (tài khoản, người dùng, fingerprint)**
(chỉ mục duy nhất có điều kiện). Có → trả lại phiên cũ kèm danh sách phần đã lên lấy từ `listParts` của kho; hết hạn → tạo mới và báo
"Lần tải trước đã hết hạn, đang tải lại từ đầu" (US2 kịch bản 3). Phiên gắn theo **người dùng** (không phải cả tài khoản) để cộng tác
viên A không "nhặt" nhầm phiên dở của B.

**Lý do.** Không cần băm nội dung 500 MB trên điện thoại (chậm, tốn pin). Nguồn sự thật về phần đã lên là kho tệp, nên không
lệch với DB khi mất kết nối giữa chừng. Fingerprint không phải bí mật và chỉ có tác dụng trong phạm vi tài khoản + người dùng đã
đăng nhập.

**Phương án đã loại.** Lưu tiến độ ở `localStorage` (mất khi đổi thiết bị/xóa dữ liệu trình duyệt; lại thêm dữ liệu cục bộ);
băm toàn bộ nội dung trước khi tải (chậm trên di động, và chỉ cần cho dedupe sớm — xem R3).

**Giới hạn đã chấp nhận.** iOS có thể đổi `lastModified` khi xuất lại ảnh → lệch fingerprint → bắt đầu lại từ đầu; phiên cũ tự
hết hạn sau 24 giờ và được dọn.

## R3. Dấu tệp, trùng nội dung, và vị trí tính hash

**Quyết định.** Hash là **SHA-256 do máy chủ tính, ở Worker**, không phải ở API và không phải do trình duyệt khai:
1. Lúc **xác nhận** (`POST /media/uploads/:id/complete`), API chỉ: ghép multipart (nếu có), `stat` (tồn tại, đúng dung lượng khai báo),
   đọc **vài KB đầu** để dò nội dung thật (R8), chuyển dung lượng từ "giữ chỗ" sang "đã dùng", đổi trạng thái `processing` và tạo việc
   `media.process` — tất cả trong một giao dịch (trừ lời gọi kho).
2. Worker `media.process`: `stat({ hash: true })` (đọc theo luồng, đã có ở bản S3 của 005) → cập nhật `file_hash` bằng câu lệnh có điều
   kiện. Vi phạm chỉ mục duy nhất `(account_id, file_hash)` ⇒ **đường trùng**: xóa tệp vừa tải, trả dung lượng, ghi `duplicate_of` vào
   phiên; web hỏi trạng thái phiên và hiện "Tệp này đã có trong thư viện" kèm liên kết (FR-020).

**Lý do.** Kiến trúc triển khai §7.3 viết "API xác nhận (tồn tại, kích thước, hash)", nhưng API không được xử lý tệp lớn
(hiến pháp V, ADR-01: "`api` không xử lý tệp lớn"); băm 500 MB trong một yêu cầu HTTP làm nghẽn API. Chỉ mục duy nhất của CSDL là
cơ chế chống trùng đúng nghĩa kể cả khi hai thiết bị cùng tải một tệp (US7 kịch bản 3): bên thua nhận lỗi 23505 và đi đường trùng,
không cần khóa ứng dụng. Mọi việc ghi đều an toàn khi chạy lại (kiểm `file_hash` đã bằng giá trị đang tính thì bỏ qua).

**Đánh đổi chấp nhận.** Người dùng tải lại tệp trùng vẫn tốn băng thông tải lên (rồi mới được báo "đã có"). Spec không yêu cầu
chặn trước khi tải; tối ưu "gửi hash do trình duyệt tính để bỏ qua tải" **không** làm ở giai đoạn này (chậm trên điện thoại,
thêm đường mã; xem lại nếu số liệu cho thấy nhiều tệp trùng).

**Phương án đã loại.** Băm trong API khi xác nhận (chỉ ổn cho ảnh ≤ 20 MB, nhưng tạo hai đường mã khác nhau cho ảnh/video);
dùng ETag của S3 làm dấu (không phải hash nội dung với multipart).

**Chỉ mục.** `UNIQUE (account_id, file_hash) WHERE file_hash IS NOT NULL AND deleted_at IS NULL AND status IN ('processing','ready')`
— tệp đã xóa mềm và tệp "Không xử lý được" không chiếm dấu, nên tải lại được như tệp mới (US7 kịch bản 4).

## R4. Xử lý ảnh: `sharp` + HEIC

**Quyết định.** `sharp` (libvips) cố định phiên bản chính xác. Quy trình một ảnh:
`metadata()` (kiểm số điểm ảnh ≤ 50 triệu, `pages === 1`) → xoay theo hướng chụp (`rotate()`) → chuyển sang sRGB → bản chuẩn
`resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })` → JPEG chất lượng cố định 82, `progressive`, **không** `withMetadata`
(loại EXIF/GPS/ICC nhúng — FR-011, FR-023) → ghi `media/{id}/normalized/jpeg`. Ảnh thu nhỏ: cạnh dài ≤ 480 px, JPEG chất lượng 75
→ `media/{id}/thumb`. Hai tệp ghi đè theo khóa cố định theo `mediaId` nên chạy lại an toàn.

**HEIC/HEIF [Kiểm chứng].** Bản dựng sẵn của `sharp` **không** giải mã HEVC (chỉ AV1/AVIF; lý do bằng sáng chế). Hướng chọn:
giải mã HEIC bằng bộ giải mã WASM (`libheif-js`/`heic-decode`) ra điểm ảnh thô rồi đưa vào `sharp` (`raw` input), chạy trong
Worker. Thử nghiệm đạt khi: ảnh iPhone 12 MP giải mã ≤ 5 giây, đúng chiều, RSS đỉnh ≤ 500 MB, kết quả giống ảnh gốc về màu
(sRGB). Không đạt → phương án dự phòng theo thứ tự: (1) dựng libvips có libheif + x265 vào ảnh Worker; (2) bỏ HEIC khỏi danh
sách chấp nhận (SC-004 chỉ còn JPEG/PNG/WebP) và để thiết bị tự chuyển — Safari iOS thường tự đổi HEIC → JPEG khi trường chọn tệp
chỉ khai `image/jpeg,image/png,image/webp` **[kiểm lại trên thiết bị thật]**. Thông báo pháp lý: bằng sáng chế HEVC/HEIC cần được
chủ dự án xem trước khi phát hành thương mại; ghi vào `docs/` như một mục "việc còn mở", không chặn các phần khác.

**Ảnh động.** WebP có cờ hoạt ảnh và GIF bị bác ngay lúc xác nhận (R8); `pages > 1` trong Worker là chốt dự phòng → "Không xử lý được".

**Phương án đã loại.** `jimp`/`canvas` (chậm, kém chắc với ảnh lớn); ImageMagick CLI (thêm tiến trình, phạm vi bảo mật chính sách
`policy.xml`); `ffmpeg` giải mã ảnh (HEIC lưới chưa ổn định giữa các bản).

## R5. Xử lý video

**Quyết định.** Cài `ffmpeg` (kèm `ffprobe`) vào **ảnh container dùng chung** (ADR-01 giữ một ảnh; Kiến trúc triển khai §2 đã ghi
"công cụ dòng lệnh (vd ffmpeg) trong ảnh container của Worker"). Việc `media.process` cho video:
1. Tải tệp gốc về `os.tmpdir()` của việc (`emptyDir` có giới hạn dung lượng trong manifest K8s; xóa trong `finally`).
2. `ffprobe -show_format -show_streams -of json`: thời lượng, rộng/cao (đã tính góc xoay). Không có luồng hình → "Không xử lý được".
3. `ffmpeg -ss <t> -i file -frames:v 1 -vf scale=480:480:force_original_aspect_ratio=decrease` ra JPEG, `t = min(1 giây, 10% thời lượng)`.
4. Ghi `thumb`; video gốc giữ nguyên (không chuyển mã — spec Assumptions).

Tiến trình con chạy với `AbortSignal` của việc (`ctx.signal`), thời gian tối đa theo khóa việc 15 phút, `-nostdin -loglevel error`;
đối số không chứa đường dẫn ký sẵn (tệp được đọc từ đĩa) nên nhật ký không rò URL (FR-023).

**Lý do chọn tệp tạm thay vì cho `ffmpeg` đọc URL.** Hoạt động với mọi bản `ffmpeg`/nhà cung cấp, không đưa URL ký sẵn vào đối số
tiến trình, cho phép đọc `moov` ở cuối tệp MP4. Chi phí: ≤ 500 MB ghi đĩa mỗi việc; với giới hạn 1 việc/tài khoản và 2 việc/Worker,
cần ≥ 2 GiB `emptyDir` — ghi vào manifest triển khai.

**Phương án đã loại.** Đọc qua HTTP ranged từ URL ký sẵn (tối ưu hơn nhưng thêm rủi ro rò URL và phụ thuộc hành vi `ffmpeg` +
nhà cung cấp; có thể làm sau); `ffmpeg-static` (gói nhị phân bên thứ ba, khó kiểm giấy phép/CVE).

## R6. Bộ đếm 5 GB nằm ở đâu

**Quyết định.** Bảng **`media.storage_quotas`** (một dòng/tài khoản: `used_bytes`, `reserved_bytes`, `limit_bytes`) thuộc schema `media`.
Mọi thay đổi là một câu `UPDATE … WHERE used_bytes + reserved_bytes + :n <= limit_bytes` trong cùng giao dịch với bản ghi `media` /
`upload_sessions`, kèm `CHECK (used_bytes + reserved_bytes <= limit_bytes)` làm chốt chặn cuối. Dòng được tạo lười lúc tải đầu tiên
(`INSERT … ON CONFLICT DO NOTHING`), `limit_bytes` lấy từ cấu hình `MEDIA_QUOTA_BYTES` (mặc định 5 × 1024³).

**Lý do.** Kiến trúc dữ liệu D-5 nói bộ đếm "lưu ở bảng tài khoản" (module `account`). Nhưng hiến pháp IV cấm `media` ghi bảng của
`account` và cấm khóa/giao dịch chéo module; còn D-2/8.1 đòi **giữ chỗ cùng giao dịch với thao tác tạo bản ghi tải lên** — chỉ
thực hiện được khi bộ đếm cùng schema. Bộ đếm `media.storage_quotas` giữ đúng mọi ràng buộc D-5 (cập nhật có điều kiện, CHECK,
không cache) và chuyển sang dạng "mỗi module sở hữu hạn mức của mình" giống `ai_budgets` ở Cổng AI. Cần **sửa Kiến trúc dữ liệu D-5/§5
và Đặc tả triển khai §4** (ghi ở bảng R13). Hạn mức theo gói (nếu sau này khác 5 GB) đọc từ module `account` khi tạo dòng.

**Bất biến kiểm được** (dùng cho SC-009): `used_bytes = Σ original_bytes` của media `processing`/`ready` chưa xóa;
`reserved_bytes = Σ declared_bytes` của phiên `open`/`completing`. Việc dọn dẹp chế độ `full` so khớp, ghi nhật ký + chỉ số
`media_quota_drift`, và tự sửa.

**Phương án đã loại.** Cột trên `account.accounts` (vi phạm IV); gọi hàm của `account` trong cùng giao dịch (cần giao dịch
chéo module); tính `SUM(...)` mỗi lần (chậm, không chặn được đồng thời nếu thiếu khóa).

## R7. Dọn dẹp, đối soát, xóa tệp thật

**Quyết định.**
- **Xóa người dùng**: giao dịch xóa mềm (`deleted_at`) + trả dung lượng + tạo việc `media.purge_files` (`media` queue). Việc này xóa
  `original`, `normalized/jpeg`, `thumb` rồi ghi `files_purged_at`; xóa đối tượng không có → không lỗi (đã đúng ở `ObjectStorage.delete`).
- **Quét hằng giờ**: lịch `media.sweep` (việc hệ thống, hàng chờ `scheduled`) gọi hàm `media.list_cleanup_accounts(kind, cutoff, limit)`
  (`SECURITY DEFINER`, chỉ trả danh sách mã tài khoản có phiên quá hạn / media chờ dọn; chỉ `system` được `EXECUTE`) rồi tạo mỗi tài khoản
  một việc `media.cleanup` (việc tenant, dedupe `media_cleanup:{accountId}:{scope}`).
- **Việc `media.cleanup`** (chạy trong ngữ cảnh tài khoản, RLS bình thường): (1) phiên `open` có `expires_at < now()` → hủy multipart,
  xóa tệp dở, trả giữ chỗ, xóa bản ghi `uploading`, đặt phiên `expired`; (2) media đã xóa mềm mà chưa xóa tệp → xóa tệp; (3) media xóa
  mềm > 30 ngày và tệp đã xóa → xóa hẳn dòng. Phạm vi `full` (hằng tuần) thêm: liệt kê `tenants/{acc}/media/` tìm tệp mồ côi (không có dòng,
  lớn hơn 24 giờ) và đối soát bộ đếm (R6).

**Lý do.** Cùng mẫu đã dùng ở Cổng AI (việc theo tài khoản chạy trong ngữ cảnh tài khoản, không quét chéo) nhưng dùng **quét** thay
vì "hẹn việc theo từng phiên": phiên được gia hạn mỗi lần hoạt động, nên việc hẹn cố định phải hủy/hẹn lại liên tục và va chạm khóa
chống trùng `exclusive`; quét hằng giờ tự chữa lành cả trường hợp việc bị mất. Hàm `SECURITY DEFINER` hẹp là mẫu có sẵn của dự án
(0004, 0008, 0010 trong `drizzle/migrations`) và là cách duy nhất để vai trò `system` biết tài khoản nào cần dọn mà không đọc dữ liệu tenant.

**Phương án đã loại.** `system` đọc thẳng bảng tenant bỏ qua RLS (vi phạm I); dùng luật vòng đời bucket cho tệp dở (bucket chỉ lọc
được theo nhãn/tiền tố, không biết phiên đã hết hạn — vẫn giữ luật `abort_incomplete_multipart_upload` làm lưới an toàn thứ hai).

## R8. Kiểm tra loại tệp theo nội dung thật

**Quyết định.** Hàm thuần `sniffMedia(head: Buffer)` trong `modules/media/internal/sniff.ts`, đọc ≤ 64 KB đầu qua `ObjectStorage.read`
(rồi hủy luồng). Nhận diện theo chữ ký: JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF…WEBP` (cờ hoạt ảnh trong khối `VP8X` ⇒ bác),
HEIC/HEIF qua hộp `ftyp` với brand `heic|heix|hevc|mif1|msf1`, MP4/MOV qua `ftyp` brand `isom|iso2|mp41|mp42|avc1|M4V |qt  `. GIF, SVG, HTML,
tệp thực thi, tệp lạ ⇒ bác. Kết quả (`kind`, `contentType`) phải **khớp** loại khai báo lúc bắt đầu; không khớp ⇒ bác (loại khai báo
chỉ dùng để chọn đường tải, không phải chân lý). Bảng kiểm thử theo mẫu (tệp `.jpg` chứa HTML/EXE/SVG…).

**Lý do.** Cần ≤ 100 dòng, không thêm phụ thuộc; kiểm thử bằng bảng đầu vào là đủ. Thư viện thứ ba (`file-type`) tăng bề mặt
phụ thuộc không cần cho 6 định dạng.

## R9. Đường dẫn công khai có hạn

**Quyết định.** `MediaPublicApi.issuePublicUrl(mediaId, opts)` là thao tác duy nhất cấp đường dẫn loại `public`: ảnh → `signedUrl(loc.mediaNormalized(id,'jpeg'), 'public', ttl)`,
video → `signedUrl(loc.mediaOriginal(id), 'public', ttl)`, `ttl` mặc định 24 giờ (`MEDIA_PUBLIC_URL_TTL_SEC`, trần 86.400 theo `MAX_PUBLIC_TTL_SEC`).
Trả `kind` rõ: `ok | not_ready | deleted | not_found` (FR-016). Không nhận mã tài khoản (lấy từ ngữ cảnh việc đăng), không có điểm cuối HTTP
nào gọi hàm này (FR-017); một kiểm thử hợp đồng quét mọi phản hồi của controller `media` để chắc không có URL loại `public`.
Đường dẫn ký sẵn của S3 gắn chữ ký với **khóa đối tượng cụ thể** (chứa `mediaId` UUID) nên "chỉ mở được một tệp" đúng bản chất; kiểm
thử hợp đồng 005 đã có (mục 5 và ma trận truy cập chéo).

**Ảnh xem trước trong giao diện**: `signedUrl(..., 'preview', ≤ 3600)` cho `thumb` (lưới) và `normalized`/`original video` (xem chi tiết),
cấp trong `GET /media` và `GET /media/:id` cho đúng media của tài khoản trong phiên.

## R10. "Bài nào đang dùng media" mà không tạo vòng phụ thuộc

**Vấn đề.** FR-021 đòi tra cứu bài dùng media qua giao diện công khai của module bài (`content`), nhưng `modules.manifest.json` cho
`content` phụ thuộc `media` (để đính media) — nếu `media` lại gọi `content` sẽ vòng (kiểm tra ranh giới chặn).

**Quyết định.** Đảo phụ thuộc: `media` xuất cổng `MediaUsageProvider { findUsages(mediaIds): Promise<MediaUsage[]> }` và hàm
`registerMediaUsageProvider(provider)` (cùng kiểu `registerJobHandler`). Module bài (012) gọi đăng ký lúc khởi động. `MediaUsage = { mediaId, postId, postTitle, postStatus }`
với `postStatus ∈ draft | pending_review | approved | scheduled | published | …`; đường dẫn mở bài do web dựng từ `postId`. `media` không biết
gì về bảng bài. Khi chưa có nhà cung cấp (012 chưa xong) cổng trả "không có bài nào dùng" — hợp đồng kiểm thử dùng nhà cung cấp giả.

**Chặn nặng/nhẹ.** Quy tắc nằm ở `media`: có bất kỳ `postStatus ∈ {approved, scheduled}` ⇒ **chặn** (`MEDIA_IN_USE`); chỉ có `draft`/`pending_review`/
`published` ⇒ xóa được sau khi `confirm=true`. Bài nháp giữ nguyên mã media; khi hiển thị, `MediaPublicApi.describe()` trả `deleted`
(hoặc không tìm thấy sau 30 ngày) ⇒ giao diện bài hiện "Media đã bị xóa" (Clarifications Q3).

**Rủi ro dư (chấp nhận).** Giữa lúc kiểm tra "không ai dùng" và lúc commit xóa, một bài có thể vừa đính media này. Không phá bất biến dữ liệu:
bước 2 của Đăng bài (013) nhận lỗi phân loại `deleted` từ `issuePublicUrl` và dừng với cách khắc phục "chọn media khác" (FR-016). Spec Edge Cases
nói "kiểm tra đang dùng tại thời điểm xóa" — đúng với thiết kế này.

## R11. Giới hạn đồng thời việc `media`

`infra.queue_settings` (migration 0006) đặt hàng chờ `media`: 2 việc đồng thời/bản Worker, **1 việc/tenant**, khóa 900 giây, thử lại 3 lần 60 → 300 → 900 giây.
Spec FR-014/Assumptions đang ghi "≤ 2 việc/tài khoản". **Quyết định:** giữ 1 (đúng kiến trúc §6, thông số cấu hình được trong CSDL, không cần
phát hành). Tính hiệu năng: xử lý một ảnh ≈ 0,5–3 giây ⇒ lô 10 ảnh xong ≤ 30 giây (SC-003 đo với lô ≤ 10 tệp); lô 100 ảnh vẫn chạy nhưng
nối đuôi, trong lúc đó việc `publish` của tài khoản khác không bị chiếm (SC-010). Sửa chữ trong spec: FR-014 và Assumptions ("mặc định theo `queue_settings`,
hiện 1"), SC-003 ("lô ≤ 10 tệp").

## R12. Quyền và gói hết hạn

- Danh mục quyền chỉ có `media.upload`. Thêm `media.view` (chủ + cộng tác viên) và `media.delete` (chủ + cộng tác viên; điều kiện "chỉ tệp của
  mình" của cộng tác viên kiểm ở dịch vụ theo `uploaded_by_user_id`, vì ma trận quyền là boolean theo vai trò). Hỗ trợ/quản trị = `false` cho cả ba
  (FR-018). Cập nhật bảng phân quyền mục 3.1 của Đặc tả yêu cầu (có neo `#pq-media-*`) cùng lúc.
- **Gói hết hạn chặn tải lên nhưng không chặn xem/xóa**: module `account` chưa có thông tin gói (WBS 2.6 chưa làm; không có `subscriptions` trong mã).
  Plan chọn **cổng nội bộ `UploadGate`** trong `media` (giao diện một hàm `canUpload(): Promise<{ allowed: true } | { allowed: false; reason }>`), bản mặc
  định luôn `allowed: true`; khi 2.6 xong, thay bằng bản gọi `AccountPublicApi`. Có kiểm thử hợp đồng cho cổng với bản giả "hết hạn" để
  chứng minh `POST /media/uploads` trả `MEDIA_PLAN_EXPIRED` còn `GET`/`DELETE` vẫn được — không để lọt khi 2.6 đến.

## R13. Mâu thuẫn tài liệu cần sửa

Xem bảng "Sửa tài liệu gốc" ở [plan.md](./plan.md#sửa-tài-liệu-gốc-theo-hiến-pháp-governance) — nơi gom đủ 7 điểm để `tasks.md` có việc sửa cụ thể.

## R14. Ảnh xem trước và CDN

ADR-07/Kiến trúc dữ liệu nêu "media xem trước qua CDN ≤ 1 giờ". Giai đoạn này dùng đường dẫn ký sẵn của chính kho tệp (không thêm cấu hình CDN,
vì V3 — Security Link/nguồn riêng tư của vCDN — chưa xác minh). Lưới nạp thumbnail ≤ 480 px (~20–40 KB), chỉ nạp ô sắp hiện (lazy) nên
200 tệp vẫn đạt SC-007 (đo ở kiểm thử hiệu năng). Khi V3 đạt, chuyển `signedUrl('preview')` sang ký theo CDN là đổi cài đặt trong `core/storage`, không đổi hợp đồng.

## R15. Phía giao diện

- **Dùng lại** `apps/web/src/lib/upload` (`createUploadQueue`, 3 tệp song song, thử lại 1/3/10 giây, hủy/thử lại) và `ui/upload`
  (`FileField`, `UploadQueue`). **Mở rộng**: trạng thái `waiting_network` ("Tạm dừng – đang chờ mạng", bắt `online`/`offline` + `navigator.onLine`), `processing`
  ("Đang xử lý", hỏi `GET /media/uploads/:id` mỗi 2 giây rồi giãn dần), `duplicate` ("Tệp này đã có", kèm liên kết), `UploadSession` thêm `fields` (cho POST) và
  `parts`. Thêm hai vận chuyển: `post.ts` (multipart/form-data tới `fields`) và bật `createMultipartTransport` (`MULTIPART_SUPPORTED = true`, phần 8 MiB).
- Quy tắc kiểm tệp mặc định (`DEFAULT_RULES`) đã đặt ảnh ≤ 20 MB, video ≤ 500 MB; **thêm** `image/heic`, `image/heif` vào `imageTypes` (và đuôi `.heic`/`.heif` khi trình duyệt không khai `type`).
- Màn hình mới `features/media/`: trang thư viện (lưới, lọc, tìm, thanh dung lượng, khung tải), hộp chi tiết, hộp xác nhận xóa liệt kê bài đang dùng.
  Dùng hệ thống trạng thái (`ui/badge`), `ui/feedback`, `ui/layout` của 011; không thêm thư viện giao diện/trạng thái. Hợp đồng chi tiết: [contracts/media-ui.md](./contracts/media-ui.md).
- Không lưu tên tệp/đường dẫn ký sẵn vào `localStorage` (quy tắc có sẵn của hàng đợi); chỉ giữ trong bộ nhớ của hàng đợi.
