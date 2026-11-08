# Contract – Lệnh ở gốc kho

Các lệnh dưới đây là giao diện ổn định cho lập trình viên và CI (WBS 1.4 gọi đúng các tên này). Chạy
được trên Windows (PowerShell/Git Bash) và Linux. Mã thoát 0 = thành công.

| Lệnh | Việc làm | Ghi chú |
|---|---|---|
| `pnpm install` | Cài mọi gói theo `pnpm-lock.yaml` | CI dùng `--frozen-lockfile` |
| `pnpm dev:api` | Chạy API ở chế độ theo dõi thay đổi, cổng `API_PORT` | Tự build `@app/shared` ở chế độ watch |
| `pnpm dev:worker` | Chạy Worker ở chế độ theo dõi thay đổi | |
| `pnpm dev:web` | Chạy web Vite ở `http://localhost:5173`, proxy sang API | |
| `pnpm build` | Build `shared` → `server` → `web` | |
| `pnpm start:api` / `pnpm start:worker` | Chạy bản đã build (`node dist/api.js` / `node dist/worker.js`) | |
| `pnpm typecheck` | `tsc --noEmit` nghiêm ngặt cho mọi gói | FR-017 |
| `pnpm lint` | ESLint + `prettier --check` cho mọi gói | FR-017 |
| `pnpm check:boundaries` | dependency-cruiser theo tệp kê khai module | FR-011 |
| `pnpm test` | Vitest cho mọi gói + bộ mẫu ranh giới | FR-019, SC-002 |
| `pnpm verify` | Chạy **tất cả** bước trên theo thứ tự, in bảng tổng kết, thất bại nếu một bước lỗi | FR-018 |
| `pnpm check:web-bundle` | Kiểm tra `apps/web/dist` không chứa mã có nguồn từ `apps/server` | SC-008; nằm trong `verify` |
| `docker build -t app:<tag> .` | Một ảnh container cho cả API và Worker | FR-002, SC-003 |
| `docker run app:<tag>` / `docker run app:<tag> node dist/worker.js` | Chạy API / Worker từ cùng ảnh | |

`pnpm verify` in ra dạng:

```text
Bước               Kết quả   Thời gian
build:shared       ✓ đạt     4,1 s
typecheck          ✗ lỗi     9,8 s   (apps/web/src/lib/api-client.ts:12)
lint               ✓ đạt     7,2 s
check:boundaries   ✗ lỗi     3,0 s   (1 vi phạm)
test               ✓ đạt     21,5 s
check:web-bundle   ✓ đạt     0,4 s
→ THẤT BẠI: 2/6 bước lỗi
```
