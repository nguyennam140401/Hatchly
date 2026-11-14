# Nạp NGUYÊN tệp tham số của một môi trường và bắt nó qua mọi `validation` (T017, FR-003).
# Không có `variables` ở đây: giá trị đến từ `-var-file=../../envs/<env>.tfvars` do `pnpm infra check` truyền,
# lần lượt cho staging rồi production.
#   terraform -chdir=infra/stacks/cloud test -test-directory=../../tests/cloud/env-load -var-file=../../envs/staging.tfvars

mock_provider "vngcloud" {}
mock_provider "aws" {}

# Chứng thực giả cho provider được mock (thật sự do CLI truyền qua TF_VAR_… khi plan).
variables {
  vngcloud_client_id     = "mock-id"
  vngcloud_client_secret = "mock-value"
}

run "tep_tham_so_qua_validation" {
  command = plan
}
