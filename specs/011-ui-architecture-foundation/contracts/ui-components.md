# Hợp đồng: thành phần giao diện dùng chung (`apps/web/src/ui`)

Đây là **hợp đồng sử dụng** mà các tính năng sau phải theo; không phải mã. Bảng biến thể đầy đủ ở `data-model.md` mục 2.

## 1. Quy tắc chung (mọi thành phần)

1. **Chỉ dùng giá trị thiết kế**: lớp Tailwind từ `tokens.css`; không `style={{}}` với màu/cỡ chữ/khoảng cách; không giá trị
   tùy ý `[…]` (kiểm tra `check-web-rules`).
2. **Thuần hiển thị**: `ui/*` **không** nhập `lib/api`, `lib/session`, `features/*`, `react-router` (trừ `NavLink` trong
   `app/shell`). Dữ liệu và hành vi vào bằng thuộc tính. Lint `no-restricted-imports` theo thư mục.
3. **Chuỗi chữ**: thuộc tính văn bản do nơi gọi truyền (đã lấy từ `t()`); thành phần không chứa câu tiếng Việt cố định ngoại
   trừ nhãn thuộc về chính nó (ví dụ "Chi tiết cho hỗ trợ") đặt trong `lib/i18n/vi.ts`.
4. **Truy cập**: vùng chạm ≥ `min-h-touch min-w-touch`; tiêu điểm nhìn thấy (`focus-visible:ring`); vai trò/nhãn đúng; trạng
   thái = chữ + biểu tượng; chạy từ 360 px (`min-w-0`, `truncate`/`line-clamp` + `Tooltip` với chữ dài – FR-004).
5. **Chuyển động**: `motion-safe:` cho hiệu ứng; `motion-reduce` giữ chữ trạng thái (Edge case giảm chuyển động).
6. **Mỗi thành phần có**: `*.spec.tsx` (mọi biến thể: render, tương tác, `axe`), `*.catalog.tsx` (đủ biến thể cho `/_catalog`).
7. **Thêm thành phần** theo `apps/web/docs/ui-guide.md` (mẫu ngắn): thêm hàng ở `figma-variants.ts` → thành phần → catalog → spec.

## 2. Chữ ký công khai chính (rút gọn)

```ts
// Nút – variant × trạng thái khóa có lý do (Story 1.3)
<Button variant="primary|secondary|ghost|danger" loading? locked? lockedReason? reopensAt? icon? fullWidth? />

// Huy hiệu – luôn chữ + biểu tượng; status lạ → "Đang cập nhật"
<StatusBadge status={PostDisplayStatus | string} size?="sm|md" />
<SuggestionTag />                                   // "Gợi ý hôm nay", ngoài bảng trạng thái bài

<ChannelTag channel manualPublish? />   // nhãn kênh (Figma ChannelTag); manualPublish do máy chủ báo
<ChannelRow  channel state="connected|expiring|disconnected|manual" detail? action? />
<UsageMeter label value limit level="normal|warning|exhausted" />   // chỉ số đếm/%, KHÔNG nhận tiền
<IdeaCard idea reason? featured? selected? onSelect? onEdit? onRemove? />
<PostCard post={{id,title,excerpt,status,channels,scheduledAt?}} onOpen? actions? />

<InlineAlert tone="info|warning|error" title? actions?={ErrorActionView[]} support?={{traceId,code,detail}} />
//   tone=error bắt buộc ≥ 1 action (kiểu TypeScript: actions: [A, ...A[]]) – SC-010; "Chi tiết cho hỗ trợ" thu gọn ở đây
<Chip selected? onClick? removable? /> ;  <ChannelTabs channels value onChange />   // Figma chỉ vẽ FB·TikTok; mã nhận mọi kênh
<StepRow state="done|error|pending" title time? explanation? remedy? />
<DayCell date today? items count? /> ; <CalendarItem status time title onClick />

<AppShell /> <Sidebar items /> <NavBar items /> <TopBar kind="logo|back" title? onBack? actions? />
<PageHeader title description? actions? /> <EmptyState message action /> <Skeleton shape /> <ProgressRow done total state />
<ConfirmDialog tone? title body confirmLabel onConfirm /> <ConflictNotice onLoadLatest onKeepMine />
<Icon name={IconName} title? />                      // 26 tên; aria-hidden nếu không có title
```

`InlineAlert` là **thành phần lỗi duy nhất** hiển thị `AppError` (hàm `<ErrorNotice error>` trong `lib/api` chỉ chuyển
`AppError` → `InlineAlert`); `ErrorNotice` hiện có trong `features/auth/ui.tsx` được thay bằng nó (FR-036).
Toast (`sonner`) chỉ cho xác nhận ngắn "Đã lưu", **không** thay lỗi có hành động.

## 3. Mô hình trạng thái hiển thị (Story 5)

Một thành phần bao `<AsyncBoundary query={…} empty={…} lockedBy={…}>` nhận kết quả `useApiQuery` và hiển thị đúng một trong 5
mẫu: `loading` (khung chờ cùng hình dạng, `aria-busy`, thông báo "Đang tải" cho bộ đọc màn hình), `empty` (lời nhắn + hành động),
`error` (`InlineAlert` kèm "Thử lại"), `locked` (giải thích + ngày mở lại), `partial` (nơi gọi truyền `partial={…}` dựng dòng
"Đã đăng: … · Cần bạn xử lý: …"). Danh sách/màn hình mới **không** tự viết các nhánh này.

## 4. Biểu tượng (26 tên)

`IconName` là tập đóng sinh từ thư mục `ui/icons/svg/` (tên tệp = tên). Kiểm thử "đủ 26 tên + mỗi tên có tệp SVG hợp lệ
(viewBox, không `fill` cứng – dùng `currentColor`)". **26 tên chốt từ Figma**: `check clock calendar send alert bulb info home list more plus image refresh copy back bell download film link store gear library chevron-right pencil chevron-down x`. Figma không có biểu tượng riêng cho từng kênh/trạng thái → `ChannelTag` dùng chữ, `StatusBadge` chọn từ bộ này.

## 5. Danh mục thành phần (`/_catalog`) – FR-033

- Chỉ khi `import.meta.env.DEV` hoặc `VITE_ENABLE_CATALOG=1`; tải lười; **không** nằm trong gói sản xuất mặc định.
- Mỗi `*.catalog.tsx` xuất `{ name, description, a11yNotes, variants: Variant[] }`; trang liệt kê theo nhóm, chọn khung
  360/768/1280 px, công tắc "cỡ chữ 200%" và "tương phản cao".
- Dữ liệu từ MSW (`catalog/fixtures`): năm tình huống tải/trống/lỗi/khóa/một phần cho `AsyncBoundary`.
- "Màn hình mẫu" (danh sách + thẻ + biểu mẫu, SC-002) là trang `/_catalog/sample` dựng **chỉ** từ thành phần dùng chung.
