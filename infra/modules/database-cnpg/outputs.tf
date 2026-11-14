# Đầu ra (T048). Không giá trị bí mật nào; không `sensitive`. Chỉ TÊN Secret.

output "host" {
  description = "Dịch vụ ghi ổn định của CloudNativePG."
  value       = "pg-rw.database.svc"
}

output "port" {
  description = "Cổng PostgreSQL."
  value       = 5432
}

output "name" {
  description = "Tên CSDL ứng dụng."
  value       = "app"
}

output "sslmode" {
  description = "Chế độ SSL ứng dụng phải dùng."
  value       = "require"
}

output "superuser_secret" {
  description = "Tên Secret tài khoản quản trị (do toán tử sinh)."
  value       = "pg-superuser"
}

output "backup_secret" {
  description = "Tên Secret khóa S3 sao lưu (do `pnpm infra secrets set` nhập)."
  value       = "pg-backup-s3"
}
