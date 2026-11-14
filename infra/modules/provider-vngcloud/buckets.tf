# Bucket media và bucket sao lưu CSDL trên vStorage qua giao diện S3 (T034) – vStorage chưa có tài nguyên Terraform
# riêng nên dùng provider `aws` trỏ điểm cuối vStorage (cấu hình ở stack gọi module). Chỉ module này được dùng
# `aws_s3_*` (FR-031). Không tạo bucket nào ở môi trường tạm diễn tập.
#
# Giả định chờ xác minh V5: vStorage hỗ trợ lọc vòng đời theo NHÃN đối tượng, mã hóa mặc định, chặn truy cập công
# khai và bucket policy với danh tính `arn:aws:iam:::user/<tên>`. Nếu mục nào không đạt: cấu hình tay + kiểm bằng
# `pnpm infra bootstrap-check` (xem research.md V5).

locals {
  create_buckets = !local.is_drill

  media_bucket  = "${var.name_prefix}-media-${var.environment}"
  backup_bucket = "${var.name_prefix}-db-backup-${var.environment}"

  # Danh tính (tài khoản dịch vụ vStorage) tạo tay ở danh sách khởi tạo một lần: app-<env>, dbbackup-<env>.
  app_principal    = "arn:aws:iam:::user/app-${var.environment}"
  backup_principal = "arn:aws:iam:::user/dbbackup-${var.environment}"

  create_backup_bucket = local.create_buckets && var.backup_bucket_enabled
}

# ---------------------------------------------------------------- media

resource "aws_s3_bucket" "media" {
  count = local.create_buckets ? 1 : 0

  bucket        = local.media_bucket
  force_destroy = !local.deletion_protection

  tags = merge(local.base_labels, { component = "media", data = "true" })
}

resource "aws_s3_bucket_public_access_block" "media" {
  count = local.create_buckets ? 1 : 0

  bucket                  = aws_s3_bucket.media[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  count = local.create_buckets ? 1 : 0

  bucket = aws_s3_bucket.media[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  count = local.create_buckets ? 1 : 0

  bucket = aws_s3_bucket.media[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Ba luật vòng đời (FR-016): phiên bản cũ hết hạn, hủy tải nhiều phần dở, tệp tạm (nhãn lifecycle=tmp) hết hạn.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  count = local.create_buckets ? 1 : 0

  bucket = aws_s3_bucket.media[0].id

  rule {
    id     = "noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.media_retention.noncurrent_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = var.media_retention.multipart_abort_days
    }
  }

  rule {
    id     = "expire-tmp"
    status = "Enabled"

    filter {
      tag {
        key   = "lifecycle"
        value = "tmp"
      }
    }

    expiration {
      days = var.media_retention.tmp_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.media]
}

# CORS chỉ cho nguồn gốc giao diện (không `*`) – tải thẳng từ trình duyệt bằng đường dẫn ký sẵn.
resource "aws_s3_bucket_cors_configuration" "media" {
  count = local.create_buckets ? 1 : 0

  bucket = aws_s3_bucket.media[0].id

  cors_rule {
    allowed_origins = var.web_origins
    allowed_methods = ["PUT", "POST", "GET", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# Chỉ `app-<env>` được dùng đối tượng; không hành động cấu hình bucket, không `Principal: *`.
resource "aws_s3_bucket_policy" "media" {
  count = local.create_buckets ? 1 : 0

  bucket = aws_s3_bucket.media[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AppObjectAccess"
      Effect    = "Allow"
      Principal = { AWS = [local.app_principal] }
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectTagging",
        "s3:PutObjectTagging",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
      ]
      Resource = ["${aws_s3_bucket.media[0].arn}/*"]
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.media]
}

# ---------------------------------------------------------------- sao lưu CSDL

resource "aws_s3_bucket" "backup" {
  count = local.create_backup_bucket ? 1 : 0

  bucket        = local.backup_bucket
  force_destroy = !local.deletion_protection

  tags = merge(local.base_labels, { component = "db-backup", data = "true" })
}

resource "aws_s3_bucket_public_access_block" "backup" {
  count = local.create_backup_bucket ? 1 : 0

  bucket                  = aws_s3_bucket.backup[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "backup" {
  count = local.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  count = local.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Bucket sao lưu: KHÔNG CORS; chỉ `dbbackup-<env>` (không có danh tính của ứng dụng).
resource "aws_s3_bucket_policy" "backup" {
  count = local.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "BackupObjectAccess"
        Effect    = "Allow"
        Principal = { AWS = [local.backup_principal] }
        Action    = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource  = ["${aws_s3_bucket.backup[0].arn}/*"]
      },
      {
        Sid       = "BackupList"
        Effect    = "Allow"
        Principal = { AWS = [local.backup_principal] }
        Action    = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource  = [aws_s3_bucket.backup[0].arn]
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.backup]
}
