# Biến thể CSDL `managed` – CHỈ KHAI HỢP ĐỒNG (T035, research R6). Chưa hiện thực: chờ V1 (vDB PostgreSQL có lưu
# nhật ký giao dịch liên tục và khôi phục về thời điểm bất kỳ không). Tránh viết mã chưa chạy được.
#
# Khi V1 đạt: thay khối dưới bằng `vngcloud_vdb_postgresql_cluster` (kèm `..._config_group`, sao lưu), rồi điền
# đầu ra `database.managed_host` / `database.managed_port` trong outputs.tf từ tài nguyên đó. `platform` đã sẵn
# `Service` ExternalName tên `pg-rw` cho nhánh này (infra/modules/database-cnpg, T048).

resource "terraform_data" "managed_db_not_implemented" {
  # Thiếu `managed_db` đã bị `validation` của biến chặn trước (thông điệp rõ hơn); ở đây chỉ chặn khi đã khai đủ.
  count = var.db_variant == "managed" && var.managed_db != null ? 1 : 0

  lifecycle {
    precondition {
      condition     = var.db_variant != "managed"
      error_message = "Biến thể managed chưa hiện thực – chờ V1 (research R6). Dùng db_variant = \"cnpg\"."
    }
  }
}
