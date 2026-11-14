# Quay về bản trước

## Tự quay về trong lúc triển khai

| Bước hỏng          | Chuyện gì xảy ra                                                                                       | Kết quả ghi lại                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `gates`, `image`   | dừng; môi trường không bị đổi                                                                          | `stopped_before_change`           |
| `migrate`          | dừng; `api`/`worker` **chưa đổi**                                                                      | `stopped_before_change`           |
| `rollout`          | `helm upgrade --atomic` tự quay về bản trước                                                           | `rolled_back`                     |
| `web` hoặc `smoke` | `helm rollback app <bản trước> --wait` + chép lại `releases/<sha trước>/index.html` thành `index.html` | `rolled_back`, `rolledBack: true` |

Giới hạn thời gian: `rollout` ≤ 8 phút, `smoke` ≤ 3 phút ⇒ quay về xong trong ≤ 10 phút kể từ khi bắt đầu cập nhật
(SC-007). Telegram báo `⚠️ … ĐÃ QUAY VỀ BẢN TRƯỚC (hỏng ở <bước>)`; ở `production` còn kèm `🚨 ƯU TIÊN CAO` và nhắc người
hợp nhất + nhóm trực.

## Vì sao CSDL chỉ đi tới

Quay về **không** hoàn tác migration. Migration đã áp là bất biến và đã được kiểm là tương thích ngược, nên bản cũ vẫn
chạy tốt trên cấu trúc mới (`db:compat` chứng minh điều đó **trước khi** hợp nhất). Hoàn tác dữ liệu là việc nguy hiểm
hơn giữ nguyên; muốn bỏ một thay đổi cấu trúc thì viết migration mới (thu hẹp) ở lần phát hành sau.

## Triển khai lại một bản cũ (`deploy/<môi trường>/redeploy`)

Dùng khi cần đưa môi trường về một bản **đã từng triển khai thành công** (lỗi chỉ lộ ra sau vài giờ, không còn là
chuyện của lần triển khai vừa xong). Chạy tay, có tham số:

| Tham số                   | Ý nghĩa                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `VERSION`                 | SHA đầy đủ của bản đã từng triển khai **thành công** lên **chính môi trường này** |
| `REASON`                  | bắt buộc, ghi vào bản ghi triển khai                                              |
| `ACK_OLDER_THAN_PREVIOUS` | **bắt buộc đánh dấu** nếu `VERSION` không phải bản liền trước                     |

Job không dựng ảnh và không chạy migration: lấy digest từ bản ghi triển khai của `VERSION`, kiểm ảnh còn trong kho, rồi
chạy rollout → web → kiểm tra khói → thông báo dưới cùng khóa `deploy-<môi trường>`. Quyền: `production` chỉ
`release-managers`; `staging` thêm `developers`.

> **Cảnh báo bản cũ hơn bản liền trước**: tương thích ngược chỉ được kiểm với **bản liền trước**. Đưa về bản cũ hơn
> nghĩa là chạy mã cũ trên cấu trúc đã đi tới nhiều bước hơn – SA phải tự đánh giá (đọc các migration giữa hai bản,
> chú ý các `-- breaking-ok:`). Ảnh quá cũ có thể đã bị `prune-images` dọn (giữ 10 bản release gần nhất + ảnh dưới 90
> ngày) – khi đó job dừng và báo ảnh không còn trong kho.

## Loại việc nền "lạ" sau khi quay về

Bản mới có thể đã tạo việc nền loại mới (vd `queue.smoke_ping`, hay loại việc của tính năng mới) trước khi bạn quay về.
Worker **bản cũ** không biết loại việc đó. Hành vi (R22): việc được **trả lại hàng chờ**, giờ chạy lùi 5 phút, **không
tính lượt thử, không bị chôn** vào `infra.dead_jobs`; ghi cảnh báo `queue.unknown_job_type` và chỉ số
`queue_unknown_job_type_total` (luật cảnh báo `QueueUnknownJobType`). Khi phát hành lại bản mới, việc được xử lý tiếp –
không mất gì. Việc thuộc loại **đã khai báo nhưng chưa có bộ xử lý** là chuyện khác (`NO_HANDLER`, vẫn tính lượt và
có thể vào việc hỏng).
