# Quickstart – kiểm chứng 006 (Hồ sơ kinh doanh, module mẫu)

Chạy trong worktree `.claude/worktrees/006-sample-module-business-profile` (không chạy docker compose ở checkout
khác cùng lúc – trùng cổng 3000/3001/8080). PowerShell.

## 0. Chuẩn bị

```powershell
pnpm install
Copy-Item apps/server/.env.example apps/server/.env   # nếu chưa có
pnpm db:up; pnpm db:setup; pnpm db:check            # → ĐẠT: 0 vi phạm (gồm 2 bảng context mới)
pnpm dev:seed-auth                                  # chủ + cộng tác viên + nhân viên mẫu
$env:TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres_dev_only@localhost:5432/postgres'
pnpm exec playwright install chromium              # một lần, cho kiểm thử trình duyệt
```

## 1. Cổng chất lượng đầy đủ

```powershell
pnpm verify
```

Mong đợi: mọi bước ĐẠT, gồm `check:boundaries`, `test:db`, `test:queue`, `test:e2e` (SC-007).

## 2. Kiểm thử theo nhóm (FR-021)

| Nhóm | Lệnh | Chứng minh |
|---|---|---|
| (a) quy tắc thuần | `pnpm --filter @app/shared test` · `pnpm --filter @app/server test -- test/unit/context` | hợp lệ, chuẩn hóa, "không thay đổi" |
| (b) API × vai trò | `pnpm --filter @app/server test -- test/context/profile-api.e2e.spec.ts` | bảng `contracts/context-http-api.md` |
| (c) truy cập chéo | `pnpm test:db -- cross-tenant-coverage context-isolation` | SC-002 |
| (d) cạnh tranh | `pnpm test:db -- context-concurrency` (đặt `CONCURRENCY_LOOPS=100` cho SC-004) | đúng 1 thắng / 10 |
| (e) hợp đồng công khai | `pnpm test:db -- public-api.contract` | `contracts/context-public-api.md` mục 1 |
| (f) màn hình | `pnpm --filter @app/web test -- context` | `contracts/business-profile-ui.md` |
| (g) đầu-cuối | `pnpm test:e2e` | luồng chủ / CTV / hai tab / 360 px / axe |
| (h) việc nền | `pnpm test:queue -- context-profile-changed` | cùng giao dịch, chạy lại an toàn |

## 3. Kiểm tay

```powershell
pnpm dev:api; pnpm dev:worker; pnpm dev:web          # ba cửa sổ
```

1. Đăng nhập chủ mẫu → `/business-profile`: biểu mẫu trống + gợi ý. Chọn "Khác" → ô tên ngành bắt buộc.
2. Lưu → "Đã lưu phiên bản 1"; cửa sổ Worker in `context.profile_changed.processed` (`version: 1`), không có nội dung
   hồ sơ trong nhật ký.
3. Bấm Lưu lần nữa không sửa → "Không có thay đổi để lưu"; Worker không in gì mới.
4. Mở tab thứ hai, sửa và lưu ở tab 1 (v2), rồi lưu ở tab 2 → thông báo xung đột, nội dung tab 2 còn nguyên.
5. Đăng nhập cộng tác viên → trang chỉ xem, không có nút Lưu; lịch sử hiện 2 phiên bản.
6. Công cụ nhà phát triển, chế độ 360 px; điều hướng toàn bộ bằng Tab/Enter.

## 4. Kiểm chứng hướng dẫn chép mẫu (SC-008)

Một thành viên chưa làm 006 làm theo `docs/sample-module.md` để dựng tính năng thử (một bảng, một màn hình, một
thao tác ghi) trên nhánh nháp → `pnpm verify` ĐẠT; ghi thời gian và câu hỏi phát sinh vào mục "Lịch sử diễn tập" của
hướng dẫn, rồi xóa tính năng thử.
