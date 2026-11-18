"""Sinh tệp mẫu cho kiểm thử media (014). Tất cả tự tạo, không dùng ảnh có bản quyền.
Chạy: python generate.py   (cần pillow, pillow-heif, imageio-ffmpeg)
"""
import os
import subprocess

import imageio_ffmpeg
import pillow_heif
from PIL import Image, ImageDraw

pillow_heif.register_heif_opener()
HERE = os.path.dirname(os.path.abspath(__file__))


def out(n):
    return os.path.join(HERE, n)


def scene(w, h):
    im = Image.new('RGB', (w, h), (30, 90, 160))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w // 2, h // 2], fill=(220, 60, 40))  # góc trên-trái đỏ: nhận biết chiều ảnh
    d.ellipse([w // 2, h // 2, w - 5, h - 5], fill=(250, 220, 40))
    return im


# jpg thường (400x300) và jpg xoay bằng EXIF (có GPS)
scene(400, 300).save(out('plain.jpg'), quality=85)
im = scene(300, 400)  # điểm ảnh lưu dọc, EXIF Orientation=6 => hiển thị 400x300 sau xoay
exif = Image.Exif()
exif[0x0112] = 6
exif[0x010F] = 'FixtureCam'
gps = exif.get_ifd(0x8825)
gps[1] = 'N'
gps[2] = (10.0, 46.0, 0.0)
gps[3] = 'E'
gps[4] = (106.0, 40.0, 0.0)
im.save(out('exif-rotated-gps.jpg'), quality=85, exif=exif)
# 8 hướng EXIF
for o in range(1, 9):
    e = Image.Exif()
    e[0x0112] = o
    scene(120, 80).save(out(f'orient-{o}.jpg'), quality=85, exif=e)

scene(320, 240).save(out('plain.png'))
scene(320, 240).save(out('plain.webp'), quality=80)
frames = [scene(64, 64), Image.new('RGB', (64, 64), (0, 200, 0))]
frames[0].save(out('animated.webp'), save_all=True, append_images=frames[1:], duration=100, loop=0)
frames[0].save(out('animated.gif'), save_all=True, append_images=frames[1:], duration=100, loop=0)
scene(400, 300).save(out('plain.heic'), format='HEIF', quality=70)

# tệp giả đuôi .jpg
open(out('fake-html.jpg'), 'wb').write(b'<!doctype html><html><body><script>alert(1)</script></body></html>')
open(out('fake-exe.jpg'), 'wb').write(b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff' + b'\x00' * 200)
open(out('script.svg'), 'wb').write(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
open(out('empty.jpg'), 'wb').close()
data = open(out('plain.jpg'), 'rb').read()
open(out('truncated.jpg'), 'wb').write(data[: len(data) // 2])

# video: mp4 (moov ở cuối), mov, mp4 xoay 90 độ, mp4 chỉ có âm thanh
ff = imageio_ffmpeg.get_ffmpeg_exe()


def run(*a):
    subprocess.run([ff, '-y', '-loglevel', 'error', *a], check=True)


src = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15']
run(*src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out('moov-end.mp4'))  # mặc định: moov ở cuối
run(*src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out('faststart.mp4'))
run(*src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mov', out('clip.mov'))
run('-display_rotation', '90', '-i', out('moov-end.mp4'), '-c', 'copy', out('rotated90.mp4'))  # ma trận xoay 90 độ
run('-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac', out('audio-only.mp4'))
print('ok')
