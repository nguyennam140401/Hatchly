// Lỗi của đường ống ảnh – tách riêng để `heic.ts` và `image-pipeline.ts` không phụ thuộc vòng.

/** Lý do không xử lý được ảnh (khớp `failure_code`). */
export type ImageFailure = 'corrupt' | 'unsupported' | 'too_many_pixels' | 'animated';

export class ImagePipelineError extends Error {
  constructor(readonly failure: ImageFailure) {
    super(`Không xử lý được ảnh (${failure})`);
    this.name = 'ImagePipelineError';
  }
}
