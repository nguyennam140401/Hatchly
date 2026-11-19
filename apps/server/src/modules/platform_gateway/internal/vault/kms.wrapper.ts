import type { KeyWrapper } from './key-wrapper';

// Khung gọi KMS (T032). Hiện thực thật chờ K5 (nhà cung cấp KMS trong nước chưa chốt, ADR-13): cho tới lúc đó mọi lời
// gọi trả lỗi RÕ để production không im lặng chạy với khóa sai. Khi K5 chốt, chỉ thay thân `wrap`/`unwrap` (giao diện
// S3-tương-thích-kiểu "chuẩn mở": đổi nhà cung cấp chủ yếu là đổi cấu hình).

export class KmsKeyWrapper implements KeyWrapper {
  readonly currentKeyId: string;

  constructor(keyId: string | undefined) {
    if (keyId === undefined || keyId === '') {
      throw new Error('CREDENTIAL_VAULT_DRIVER=kms cần KMS_KEY_ID');
    }
    this.currentKeyId = `kms-${keyId}`;
  }

  wrap(): Promise<Buffer> {
    return Promise.reject(new Error('KMS_NOT_IMPLEMENTED: chờ K5 chốt nhà cung cấp KMS (ADR-13)'));
  }

  unwrap(): Promise<Buffer> {
    return Promise.reject(new Error('KMS_NOT_IMPLEMENTED: chờ K5 chốt nhà cung cấp KMS (ADR-13)'));
  }
}
