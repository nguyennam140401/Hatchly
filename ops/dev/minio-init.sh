#!/bin/sh
# Khởi tạo kho tệp S3 dev (005, contracts/runtime-config.md mục 4) – chạy một lần bởi dịch vụ minio-init.
# Idempotent: chạy lại không lỗi. CHỈ dev – môi trường thật tạo bucket/luật bằng hạ tầng của nhà cung cấp.
set -eu

mc alias set local "$MINIO_URL" "$MINIO_USER" "$MINIO_PASSWORD" >/dev/null
mc mb --ignore-existing "local/$BUCKET"
# Không công khai: mọi lượt đọc/ghi đi qua đường dẫn ký sẵn.
mc anonymous set none "local/$BUCKET"
# Tệp tạm của việc nền (tenants/{acc}/tmp/{jobId}/…) mang nhãn lifecycle=tmp → hết hạn sau 1 ngày.
if ! mc ilm rule ls "local/$BUCKET" 2>/dev/null | grep -q 'lifecycle=tmp'; then
  mc ilm rule add --expire-days 1 --tags 'lifecycle=tmp' "local/$BUCKET"
fi
mc ilm rule ls "local/$BUCKET"
echo "minio-init: bucket $BUCKET sẵn sàng (CORS: $CORS_ORIGINS qua MINIO_API_CORS_ALLOW_ORIGIN)"
