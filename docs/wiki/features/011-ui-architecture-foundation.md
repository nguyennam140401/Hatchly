---
type: feature
title: 011 Nền kiến trúc giao diện (apps/web)
sources:
  [
    specs/011-ui-architecture-foundation/spec.md,
    specs/011-ui-architecture-foundation/plan.md,
    specs/011-ui-architecture-foundation/tasks.md,
    specs/011-ui-architecture-foundation/quickstart.md,
    specs/011-ui-architecture-foundation/figma-extract.md,
    apps/web/docs/ui-guide.md,
  ]
updated: 2026-11-16
status: draft
related:
  [
    concepts/web-ui.md,
    concepts/auth-rbac.md,
    concepts/ci-cd.md,
    modules/context.md,
    features/006-sample-module-business-profile.md,
    features/009-social-login-members.md,
  ]
---

# 011 Nền kiến trúc giao diện (apps/web)

> **CÒN VIỆC CHƯA LÀM – đừng bỏ sót.** 84/85 việc xong. Còn **T074**: chuyển `ProfileForm`/`KeywordsInput` của 006 sang
> `useAppForm`/`TagListField` (mới chuyển lớp giao diện, máy trạng thái 006 giữ nguyên). Nhánh `impl/011-ui-architecture-foundation`
> và worktree được **giữ lại** để làm tiếp bằng `/speckit-implement 011`. Trang này để `draft` vì tasks chưa xong.
> Danh sách đầy đủ ở mục "Việc còn lại" bên dưới và ở banner đầu `specs/011-ui-architecture-foundation/tasks.md`.

## Mục tiêu

Dựng **một nền chung cho mọi màn hình** của web để các tính năng sau (Tổng quan, Lịch, Bài viết, Thư viện, Kênh và gói…) chỉ ghép
thành phần có sẵn: bộ thành phần theo thiết kế Figma, khung điều hướng theo quyền, nền tảng biểu mẫu, lớp dữ liệu máy chủ,
mô hình 5 trạng thái hiển thị, danh mục thành phần, kiểm thử tự động; đồng thời chuyển các trang đã có của 004/006/009 sang nền mới
mà **không đổi hành vi**.

## Mã FR/NFR

- Spec: FR-001…FR-038, SC-001…SC-013 (`specs/011-ui-architecture-foundation/spec.md`); truy vết UI/UX mục 3, 4, 6, 7, 9, 10.
- Hiến pháp: I (không gửi/giữ mã tài khoản, xóa dữ liệu khi đổi phiên), III (không hiển thị số tiền AI), VI (lỗi luôn có hành động,
  WCAG 2.1 AA, 360 px), VII (bản nháp chỉ RAM, không lưu bí mật), IX (không thêm hạ tầng, không ADR mới).

## Trạng thái

`draft` (84/85 việc xong, merge vào `dev` ngày 2026-11-16, commit `efeadc5`).

| Hạng mục                   | Kết quả đo ngày 2026-11-16                                                       |
| -------------------------- | -------------------------------------------------------------------------------- |
| Vitest `apps/web`          | 410/410 ca                                                                       |
| Playwright 360/768/1280 px | 51/51 (axe 0 lỗi nghiêm trọng, không cuộn ngang, vùng chạm ≥ 44 px, cỡ chữ 200%) |
| `check:web-rules`          | 163 tệp, 0 vi phạm                                                               |
| Gói khởi đầu               | 203,8 KB gzip (ngưỡng 240 KB), không chứa `/_catalog`, `/internal`               |
| ESLint                     | 0 lỗi                                                                            |

`pnpm verify` còn 4 bước đỏ do nguyên nhân **có sẵn ở `dev` hoặc môi trường Windows**, không thuộc 011: `typecheck`
(`tooling/test/check-wiki.spec.ts`), `test` (`tooling/infra` thiếu `kubeconfig.mjs` của 007), `lint` (prettier báo CRLF ở bản chép
Windows). Nguồn: `specs/011-ui-architecture-foundation/quickstart.md` mục 6.

## Quyết định chính

- **Giá trị thiết kế lấy từ Figma**, đồng bộ bằng `figma-tokens.json` → `tooling/sync-design-tokens.mjs` → khối `@theme` của
  `tokens.css`. Đổi màu thương hiệu chỉ đổi 2 tệp, 0 tệp thành phần (đã đo, T080). Chỉ giao diện sáng, không bóng đổ, điểm ngắt `lg` = 1024 px.
- **Điều hướng một nguồn duy nhất**: `NAV_ITEMS` (thanh bên 7 mục, thanh dưới 5 ô). Thêm mục = một phần tử + một tuyến + một hàng ma trận quyền.
- **Một lớp gọi API**: chỉ `lib/api` được `fetch`; lỗi luôn là `AppError`; điểm cuối ở `lib/api/endpoints/*`. Lớp cũ `lib/api-client.ts` đã gỡ.
- **Hết phiên giữa chừng không chuyển trang**: `AuthGate` mở hộp đăng nhập lại tại chỗ, giữ màn hình và bản nháp; chỉ GET và thao tác
  `safeToReplay` được phát lại tự động (nguyên tắc II).
- **Nút khóa dùng `aria-disabled` kèm lý do**, không `disabled` thuần.
- **Thư viện bên thứ ba cố định phiên bản, bọc một lớp**: React Router, TanStack Query, React Hook Form, Radix (4 gói), Sonner,
  Tailwind. Không Storybook, Zustand, date-fns, Uppy, dnd-kit.
- **Playwright một phiên bản** (1.64.1) qua `overrides` ở `pnpm-workspace.yaml`, vì `@axe-core/playwright` chỉ đòi `>= 1.0.0` và
  từng kéo hai bản làm lệch kiểu giữa `e2e` và `apps/web`.
- Không có migration, không bảng mới; phía máy chủ chỉ cộng thêm trường `reason` (lý do hết phiên) ở auth/lỗi.

## Chạm tới

- Web: `apps/web/src/{ui,lib,app,features,catalog}`; chi tiết ở [concepts/web-ui.md](../concepts/web-ui.md).
- Công cụ: `tooling/{check-web-rules,check-web-bundle,sync-design-tokens,run-web-e2e}.mjs`; cổng mới `check:web-rules` (làn static)
  và `test:web-e2e` (làn e2e) trong `pnpm verify` ([concepts/ci-cd.md](../concepts/ci-cd.md)).
- Máy chủ: `apps/server/src/core/{auth,errors}`, `packages/shared/src/core/error-response.ts` (trường `reason`).
- Tài liệu: `TaiLieuDacTa/Mo_ta_UI_UX_App_AI_Content_MXH.md` mục 4 (đã sửa theo Figma), `apps/web/docs/ui-guide.md`.
- Trang đã chuyển sang nền mới: đăng nhập, đăng ký, xác nhận email, quên/đặt lại mật khẩu, nội bộ, OAuth, tài khoản chờ, cách đăng nhập,
  bảo mật, thành viên, lời mời, hồ sơ kinh doanh (một phần – xem dưới), `StartPage`.

## Điểm cần biết khi sửa tiếp

- Đọc trước `apps/web/docs/ui-guide.md`: thêm thành phần, mục điều hướng, biểu mẫu, dữ liệu máy chủ, khóa theo quyền/giới hạn.
- Biểu mẫu mới: dùng `useAppForm` + `<Form>`, tách thành thành phần nhận `FormComponentProps` rồi đăng ký vào `testForm()` (10 hành vi).
  Mẫu: `apps/web/src/features/forms.contract.spec.tsx`.
- Thao tác ghi mới: thêm **một hàng vào `MUTATIONS`** (`lib/api/mutations.ts`), nếu không `mutations.spec.ts` đỏ.
- Quy tắc nhập khẩu do ESLint ép: màn hình không nhập `react-hook-form`/`react-router`/`@radix-ui`; thành phần `ui/*` không biết API/phiên.
- Giá trị lạ của `status` bài hiển thị "Đang cập nhật" (trung tính), không ném lỗi.
- Prettier trên Windows báo CRLF vì bản chép làm việc; repo dùng `* text=auto eol=lf`, trên Linux/CI không gặp.

## Việc còn lại (đừng bỏ sót)

| Việc                         | Chi tiết                                                                                                                                                                                                                                                  | Nguồn                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **T074**                     | Chuyển `ProfileForm`/`KeywordsInput` sang `useAppForm`/`TagListField` (ước ~700 dòng cần viết lại cùng kiểm thử 006). Chưa thử RHF; chọn giữ máy trạng thái 006 ngay từ đầu. Nên làm ở tính năng sửa hồ sơ kế tiếp, khi đã có `loadLatest`/`version` thật | `plan.md` → Complexity Tracking #3; `tasks.md` |
| Rà kiểm thử cũ               | SC-011 nói không sửa kỳ vọng kiểm thử 004/006/009, nhưng đã chỉnh khẳng định: nút khóa kiểm `aria-disabled`, thêm `waitFor` ở `register.spec`, vùng chạm ở `StartPage.spec` kiểm lớp `min-h-touch`. Hành vi không đổi; cần người review                   | `quickstart.md` mục 6                          |
| Kiểm thủ công                | Kịch bản 12 (`prefers-reduced-motion`), 13 (bộ đọc màn hình thật), và đo cập nhật ≤ 1 giây (kịch bản 9) chưa làm                                                                                                                                          | `quickstart.md` mục 6                          |
| Figma còn thiếu              | "Đã hủy", trạng thái của Field, khung chờ/hộp thoại/biểu ngữ ngoại tuyến, `ChannelTabs` đủ 4 kênh, màn Hồ sơ/Cài đặt/xác thực; chưa có Figma Variables                                                                                                    | `figma-extract.md` mục 7                       |
| PO xác nhận                  | Điều hướng 7/5 mục, "Kênh & gói" cấp một, điểm ngắt 1024 px, bảng màu teal (trang cũ đổi diện mạo)                                                                                                                                                        | `figma-extract.md` mục 7                       |
| Cổng `pnpm verify` đỏ có sẵn | `check-wiki.spec.ts` (typecheck), `tooling/infra` thiếu `kubeconfig.mjs` (test) – cần sửa ở tính năng sở hữu chúng                                                                                                                                        | `quickstart.md` mục 6                          |

## Nguồn

`specs/011-ui-architecture-foundation/` (spec, plan, tasks, research, data-model, contracts, quickstart, figma-extract),
`apps/web/docs/ui-guide.md`, `tooling/verify.mjs`, `ops/ci/gate-lanes.json`.
