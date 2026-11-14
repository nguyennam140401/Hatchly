# Backend S3 của trạng thái Terraform (contracts/environment-parameters.md mục 5). Không bí mật.
# `key` do `pnpm infra` truyền theo stack (cloud.tfstate / platform.tfstate, hoặc drill/…). Bucket tạo tay (C7).
bucket = "app-tfstate-production"
region = "HCM03"

# Điểm cuối vStorage – xác nhận lúc P6 (V5).
endpoints = {
  s3 = "https://hcm03.vstorage.vngcloud.vn"
}

# Khóa trạng thái bằng ghi có điều kiện của S3 (V6). Nếu vStorage không hỗ trợ: đặt `false`, CLI tự khóa bằng
# đối tượng `locks/<stack>.json` (research R3).
use_lockfile = true

# Cờ bỏ kiểm tra riêng của AWS (vStorage không phải AWS).
skip_credentials_validation = true
skip_region_validation      = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
skip_s3_checksum            = true
use_path_style              = true # đổi theo kết quả V5
