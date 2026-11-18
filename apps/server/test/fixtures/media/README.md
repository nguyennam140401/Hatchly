# Tệp mẫu cho kiểm thử media (014)

Tất cả tệp **tự sinh** bằng `generate.py` (Pillow, pillow-heif, ffmpeg `testsrc`/`sine`) – không dùng ảnh/video có
bản quyền, không chứa dữ liệu cá nhân. Chạy lại: `pip install pillow pillow-heif imageio-ffmpeg && python generate.py`.

| Tệp                                           | Mô tả                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `plain.jpg`                                   | JPEG 400×300, không EXIF                                                     |
| `exif-rotated-gps.jpg`                        | điểm ảnh 300×400, EXIF Orientation=6 (hiển thị 400×300), có GPS + hãng máy   |
| `orient-1..8.jpg`                             | 120×80 với 8 giá trị EXIF Orientation; góc trên-trái (đỏ) để nhận biết chiều |
| `plain.png`, `plain.webp`                     | ảnh tĩnh 320×240                                                             |
| `plain.heic`                                  | HEIC 400×300 (pillow-heif)                                                   |
| `animated.webp`, `animated.gif`               | ảnh động – phải bị từ chối                                                   |
| `moov-end.mp4`                                | MP4 H.264 2 giây, `moov` ở cuối tệp (mặc định của ffmpeg)                    |
| `faststart.mp4`                               | cùng nội dung, `moov` ở đầu                                                  |
| `clip.mov`                                    | MOV H.264                                                                    |
| `rotated90.mp4`                               | MP4 có ma trận xoay 90°                                                      |
| `audio-only.mp4`                              | chỉ có âm thanh – `no_video_stream`                                          |
| `fake-html.jpg`, `fake-exe.jpg`, `script.svg` | tệp giả loại – phải bị loại khi dò nội dung                                  |
| `empty.jpg`, `truncated.jpg`                  | 0 byte; ảnh cắt dở                                                           |

Giấy phép: do dự án tự tạo, dùng tự do trong repo.
