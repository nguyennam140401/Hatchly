// Giao diện bọc/mở khóa DEK (T032, ADR-13). Kho mã quyền (`KmsCredentialVault`) chỉ biết giao diện này; bản hiện thực
// là khóa chủ trong biến môi trường (dev/test/staging) hoặc KMS (production, chờ K5). Đổi nhà cung cấp = đổi bản
// hiện thực + cấu hình, không đổi định dạng bản mã.

export interface KeyWrapper {
  /** Mã khóa đang dùng để bọc DEK mới – ghi vào đầu mỗi bản mã để xoay khóa vẫn giải mã được bản cũ. */
  readonly currentKeyId: string;
  /** Bọc DEK bằng khóa hiện hành; `aad` ràng buộc DEK đã bọc với bản ghi. */
  wrap(dek: Buffer, aad: Buffer): Promise<Buffer>;
  /** Mở DEK đã bọc bằng khóa có mã `keyId` (khóa hiện hành hoặc khóa cũ còn giữ để giải mã). */
  unwrap(keyId: string, wrapped: Buffer, aad: Buffer): Promise<Buffer>;
}
