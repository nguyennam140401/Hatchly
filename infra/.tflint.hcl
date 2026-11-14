# Cấu hình tflint – phiên bản tflint cố định: 0.55.1 (nguyên tắc IX: cố định phiên bản công cụ).
# Cố ý KHÔNG bật `terraform_unused_declarations`: `variables.shared.tf` được dùng chung cho hai stack
# (`cloud`, `platform`), mỗi stack chỉ dùng một phần biến nên luật này sẽ báo sai.
config {
  call_module_type = "local"
}

# Bộ luật `terraform` bật sẵn nhóm "recommended", trong đó có `terraform_unused_declarations` → tắt tường minh.
rule "terraform_unused_declarations" {
  enabled = false
}

rule "terraform_required_version" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}

rule "terraform_typed_variables" {
  enabled = true
}

rule "terraform_naming_convention" {
  enabled = true
}
