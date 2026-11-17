// Giải mã HEIC/HEIF bằng bộ giải mã WASM (`libheif-js`, 014 R4): bản dựng sẵn của `sharp` KHÔNG giải mã HEVC. Trả điểm ảnh
// thô RGBA (đã áp ma trận xoay/lật của tệp) để đưa vào `sharp` (input `raw`). Chạy trong Worker. Thử nghiệm T029: ảnh
// 12 MP xử lý ~0,4 giây, RSS đỉnh ~200 MB, đúng chiều, sRGB.
import { HeifDecoder } from 'libheif-js/wasm-bundle';
import { ImagePipelineError } from './image-errors';

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
}

export async function decodeHeic(input: Buffer): Promise<RawImage> {
  let image;
  try {
    const images = new HeifDecoder().decode(input);
    image = images[0];
  } catch {
    throw new ImagePipelineError('corrupt');
  }
  if (image === undefined) throw new ImagePipelineError('corrupt');
  const width = image.get_width();
  const height = image.get_height();
  if (width * height > 50_000_000) throw new ImagePipelineError('too_many_pixels');
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) => {
    image.display({ data, width, height }, (result) => {
      if (result === null || result === undefined || result === false) {
        reject(new ImagePipelineError('corrupt'));
      } else {
        resolve();
      }
    });
  });
  return { data: Buffer.from(data.buffer), width, height, channels: 4 };
}
