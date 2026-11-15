---
type: glossary
title: Thuật ngữ Việt → Anh
sources:
  [.specify/memory/architecture.md, CLAUDE.md, specs/007-terraform-infra-environments/data-model.md]
updated: 2026-11-14
status: current
related: [concepts/tenant-rls.md, concepts/queues.md]
---

# Thuật ngữ Việt → Anh

Bảng đầy đủ nằm ở mục 11 của `.specify/memory/architecture.md` (nguồn duy nhất; thuật ngữ mới phải thêm
vào đó trong cùng thay đổi). Trang này chỉ giữ các cặp hay gặp nhất để tra nhanh.

| Tài liệu gốc (VN)                                                                     | Mã nguồn (EN)                                                        |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| tai_khoan / `tai_khoan_id`                                                            | `account` / `account_id`                                             |
| nguoi_dung · thanh_vien · goi_dich_vu                                                 | `users` · `memberships` · `subscriptions`                            |
| ho_so_kinh_doanh                                                                      | `business_profiles`                                                  |
| bai · phien_ban_kenh                                                                  | `posts` · `channel_variants`                                         |
| luot_dang · buoc_dang                                                                 | `publish_attempts` · `publish_steps`                                 |
| ngan_sach_ai · so_chi_phi_ai                                                          | `ai_budgets` · `ai_cost_ledger`                                      |
| nhat_ky_kiem_toan                                                                     | `audit_log`                                                          |
| hàng chờ `dang_bai` / `media` / `ai_hang_loat` / `xu_huong` / `thong_bao` / `dinh_ky` | `publish` / `media` / `ai_batch` / `trends` / `notify` / `scheduled` |
| vai trò CSDL chu_so_huu / ung_dung / he_thong / ho_tro                                | `owner` / `app` / `system` / `support`                               |
| Chủ tài khoản / Cộng tác viên / Hỗ trợ / Quản trị nội bộ                              | `owner` / `collaborator` / `support` / `admin`                       |
| Nháp / Chờ duyệt / Đã duyệt                                                           | `draft` / `pending_review` / `approved`                              |
| chắc chắn chưa nhận / cần người dùng / không xác định                                 | `transient` / `user_action` / `unknown`                              |
| da_xoa_luc / tao_luc / cap_nhat_luc / phien_ban                                       | `deleted_at` / `created_at` / `updated_at` / `version`               |
| Biến phiên tenant                                                                     | GUC `app.account_id`; đọc qua `account.current_account_id()`         |
| Giao dịch có ngữ cảnh tenant / hệ thống / hỗ trợ                                      | `tenantTx` / `systemTx` / `supportSearch`, `supportViewAccount`      |
| Cổng nền tảng · Cổng AI · Duyệt & lịch                                                | `platform_gateway` · `ai_gateway` · `approval`                       |
| Cổng chất lượng · môi trường test / release                                           | `gate` · `staging` / `production`                                    |

Quy ước số liệu: tiền là số nguyên micro-USD; thời gian `timestamptz` UTC (hiển thị UTC+7); khóa chính UUID v7.
