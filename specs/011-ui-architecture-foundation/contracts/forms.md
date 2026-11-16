# Hợp đồng: nền tảng biểu mẫu (`apps/web/src/ui/form`, `lib/forms`)

Bọc `react-hook-form` + `@hookform/resolvers/zod`; màn hình **không** nhập trực tiếp hai gói này (lint). Lược đồ kiểm tra là
**lược đồ Zod của `@app/shared`** (cùng lược đồ máy chủ – FR-014).

## 1. Dùng

```tsx
const form = useAppForm({
  schema: ProfileFields,                // Zod từ @app/shared (cùng của máy chủ)
  defaultValues,                        // từ dữ liệu máy chủ (loại (a)), KHÔNG copy sang kho riêng khác
  version: profile.version,             // phiên bản bản ghi (FR-018)
  readOnly: !can('context.edit'),       // FR-019
  draftKey: 'business-profile',         // tùy chọn: giữ bản nháp trong RAM khi hết phiên (FR-017)
  onSubmit: (values, { version }) => mutation.mutateAsync({ ...values, version }),
});

<Form form={form} title="Hồ sơ kinh doanh" submitLabel="Lưu">
  <TextField name="introduction" label="Giới thiệu" maxChars={PROFILE_LIMITS.introduction} required />
  <SelectField name="industryCode" label="Ngành nghề" options={INDUSTRIES} />
  <TagListField name="keywords" label="Từ khóa" max={…} />
</Form>
```

`<Form>` dựng: `<form noValidate>`, `InlineAlert` lỗi chung ở đầu, vùng nút (Gửi/Hủy), `ConflictNotice` khi xung đột, `ReadOnlyNotice`.

## 2. Ô nhập (FR-013)

`TextField`, `TextAreaField`, `SelectField` (phần tử `<select>` gốc), `MultiSelectField` (nhóm hộp kiểm), `DateTimeField`
(`<input type="datetime-local">` hiển thị UTC+7, giá trị lưu ISO UTC), `SwitchField`, `TagListField` (thẻ nhập danh sách:
từ khóa/hashtag; thêm/xóa bằng bàn phím, `useFieldArray`), `FileField` (tải tệp, mục 5). Mỗi ô: nhãn `label for`, trợ giúp
`aria-describedby`, bộ đếm ký tự khi `maxChars` (`aria-live="polite"` khi ≥ 90% – hành vi của 006 giữ nguyên), lỗi liên kết
`aria-describedby` + `aria-invalid`, dấu `*` `aria-hidden` kèm `required`. Cỡ chữ ô nhập ≥ 16 px; chiều cao ≥ 44 px.
Lỗi luôn kèm **biểu tượng + chữ + cách sửa**, không chỉ màu (Story 3.1).

## 3. Lỗi từ máy chủ (FR-015)

`form.handleServerError(appError)`:
1. `fieldErrors` → `setError(path, { message })` đúng ô; nối đường dẫn chấm ("keywords.2"); `setFocus` ô lỗi đầu tiên theo thứ tự
   `FIELD_ORDER` của biểu mẫu.
2. `version_conflict` → bật `ConflictNotice` (mục 4), **không** ghi đè.
3. `session_expired` → không xử lý ở đây (đã có `AuthGate`; bản nháp còn nguyên, nút Gửi sẽ gửi lại sau đăng nhập).
4. còn lại (mất mạng, hệ thống) → `InlineAlert` đầu biểu mẫu với "Thử lại" (gọi lại `submit` với cùng dữ liệu), dữ liệu giữ
   nguyên; **không báo thành công** khi chưa có 2xx (FR-016).

## 4. Gửi trùng, chặn mất dữ liệu, xung đột, chỉ xem

- **Chống gửi trùng**: khóa theo `isSubmitting`; Enter trên ô không gửi lần hai; nút ở `loading` (`aria-busy`, chữ "Đang lưu…").
  Kiểm thử bấm nhanh (SC-007): 10 lần bấm → đúng 1 lời gọi.
- **Chặn rời trang**: `useUnsavedChangesGuard(form.formState.isDirty)` (rút từ 006) → hộp `ConfirmDialog` "Bỏ các thay đổi chưa lưu?"
  (chuyển trang trong ứng dụng) + `beforeunload` (đóng tab).
- **Xung đột phiên bản**: nhận `VERSION_CONFLICT` → `ConflictNotice` với hai lựa chọn: "Tải bản mới nhất" (refetch + `reset`
  nhưng **giữ bản của tôi** trong một khung "Bản của bạn" chỉ đọc để đối chiếu), "Giữ bản của tôi để xem lại" (giữ giá trị,
  gắn cờ `stale`; lần gửi kế tiếp dùng `version` mới sau khi người dùng xác nhận). Không tự gửi lại.
- **Chỉ xem**: `readOnly` → mọi ô `readOnly`/`disabled`+`aria-readonly`, ẩn nút gửi, hiển thị `ReadOnlyNotice` (lý do: "Chỉ chủ
  tài khoản mới sửa được"). Giữ cách trình bày của 006 (`ReadOnlyView.spec`).
- **Bản nháp khi hết phiên (FR-017)**: giá trị trường không `sensitive` ghi vào `DraftStore` (RAM) mỗi lần đổi (debounce 300 ms);
  khôi phục khi mở lại cùng `draftKey` nếu `subject` (user.id) khớp; xóa khi gửi thành công, đăng xuất, đổi tài khoản.
  Trường mật khẩu/mã/tệp: `sensitive` → không bao giờ vào bản nháp.

## 5. Nhiều bước và biểu mẫu động (FR-020)

`useWizard({ steps: [{ id, schema, skippable }] })`: giữ chung một `useAppForm`, kiểm tra theo lược đồ của bước hiện tại, cho
"Bỏ qua" (`skippable`) và quay lại bước trước; trạng thái bước hiện tại trong URL (`?step=`) để tải lại/quay lại trình duyệt đúng
chỗ (không nhạy cảm). Hành trình "Bắt đầu" 5 bước dùng nền này ở tính năng sau. `useFieldArray` cho danh sách chủ đề đề xuất
(chọn/sửa/bỏ/thêm) và thẻ từ khóa.

## 6. Tải tệp (FR-021)

`FileField`/`UploadQueue` (`ui/upload`, `lib/upload`):
- Chọn nhiều/kéo-thả; kiểm loại/dung lượng **trước khi tải** (ảnh theo cấu hình, **video ≤ 500 MB**), báo lỗi theo từng tệp.
- Hàng đợi đồng thời tối đa 3 tệp; mỗi tệp có thanh tiến độ (chữ "%" + `role="progressbar"`), nút Hủy/Thử lại riêng; lỗi một tệp
  không dừng tệp khác.
- Tải **thẳng lên kho tệp bằng đường dẫn ký sẵn** (`UploadTransport`), không qua API (hiến pháp V); API chỉ cấp đường dẫn và nhận
  xác nhận hoàn tất. Thử lại phần/tệp có giãn cách (1 s, 3 s, 10 s); khi `multipart` có: tiếp tục từ phần đang dở.
- Dung lượng đầy (`409`/`limit_reached` của kho): thông báo "Đã đầy 5 GB" + hành động "Xóa bớt tệp" (liên kết Thư viện).
- Giá trị tiến độ không nhạy cảm; **không** lưu tên tệp/đường dẫn ký sẵn vào bộ lưu cục bộ (đường dẫn ký sẵn là bí mật tạm thời).

## 7. Kiểm thử bắt buộc cho mọi biểu mẫu (SC-007) – `testForm()` dùng chung

Bộ kiểm thử dùng chung `ui/form/__tests__/form-contract.ts` chạy với từng biểu mẫu đăng ký: (1) lỗi gắn đúng ô + `aria`; (2) lỗi
máy chủ theo ô, tiêu điểm tới ô đầu; (3) lỗi chung có "Thử lại"; (4) bấm nhanh 10 lần = 1 lời gọi; (5) chặn rời trang khi dirty;
(6) xung đột phiên bản → hai lựa chọn, không ghi đè; (7) chế độ chỉ xem; (8) không có giá trị `sensitive` trong bản nháp/bộ lưu;
(9) `axe` không vi phạm; (10) chỉ thao tác bằng bàn phím. `ProfileForm` (006), `LoginForm`, `RegisterForm`, mời thành viên đăng ký
vào bộ này ở bước chuyển (FR-036); biểu mẫu mẫu của danh mục (đơn, danh sách thẻ, tải tệp) chạy đủ 10.
