# Trạng thái lưu ở bucket S3 của vStorage (research R3). Cấu hình lúc `init` nạp từ infra/envs/<env>.backend.hcl;
# `key` do `pnpm infra` truyền theo stack. Không viết giá trị nào ở đây.
terraform {
  backend "s3" {}
}
