# Hợp đồng giao diện – màn hình "Kênh kết nối" (010)

Dùng khung web của 011 (`apps/web/src/ui/*`, `app/shell`, `lib/api`, `useApiQuery`, `ErrorNotice`, `AsyncBoundary`, `ui-guide`). Không thêm thư viện. Tiếng Việt đời thường; thông điệp lỗi + hành động lấy từ máy chủ
(`reasonVi`, `actionsVi`) để một nguồn sự thật; mã lỗi gốc chỉ trong "Chi tiết cho hỗ trợ".

## 1. Tuyến và điều hướng

| Tuyến | Thành phần | Quyền |
|---|---|---|
| `/channels` | `ChannelsPage` (lười tải) — thay `comingSoon(t('nav.channelsPlan'))` hiện có ở `routes.tsx` | `channel.view` |
| `/channels/select/:selectionId` | `SelectChannelsPage` (chọn một/nhiều Page) | `channel.manage` |
| `/channels?reconnected=:id`, `?error=:code` | thông báo kết quả đầu trang rồi xóa tham số khỏi URL | — |

- `nav-registry.ts`: mục `channels-plan` đổi `permission: 'channel.view'` (chủ + CTV), thêm `badge: 'channelAttentionCount'` (kiểu `badge` mở rộng); `useNavItems` lấy số này từ `overview.attention.length`
  (truy vấn nhẹ dùng lại khóa `queryKeys.channels.overview()`, làm mới mỗi 60 giây khi tab hiện) → **dấu chỉ báo ở menu trên mọi màn hình** (FR-026). Cập nhật `nav-registry.spec.ts` + ma trận quyền.
- Điểm vào từ nơi khác (đã có): `ComposePage` "Kết nối kênh" → `/channels`; `error-explanations` "Kết nối lại" → `/channels`.

## 2. Bố cục `ChannelsPage`

```text
[Tiêu đề: Kênh kết nối]                      [Kết nối kênh ▾]   (chỉ chủ; ẩn khi gói hết hạn → thay bằng dòng giải thích)
[AttentionBanner]  ⚠ 2 kênh cần chú ý — liệt kê TỪNG kết nối + nút "Kết nối lại"/"Xem"   (khi attention ≠ ∅)
[Lọc: Nền tảng ▾ (Tất cả/Facebook/Instagram[/TikTok]) · Trạng thái ▾]                      [Facebook Page (2/5)]
[Nhóm Facebook Page (2/5)]  → ChannelCard × n        [Nhóm Instagram (1/5)] → ChannelCard × n        [Nhóm TikTok …] (chỉ khi features.tiktok)
[Dòng ghi chú cho CTV: "Chỉ chủ tài khoản mới kết nối được kênh – hãy báo chủ tài khoản"]
```

- **Trạng thái trống** (`EmptyState`): "Kết nối Facebook/Instagram để ứng dụng đăng bài giúp bạn" + nút "Kết nối Facebook Page", "Kết nối Instagram" (+ "Kết nối TikTok" chỉ khi bật) + dòng
  **"Ứng dụng chỉ đăng bài khi bạn bấm Duyệt."** (FR-026, US6-1). CTV: cùng nội dung nhưng thay nút bằng dòng giải thích.
- **Lỗi tải/mạng yếu**: `AsyncBoundary` + `ErrorNotice` "Không tải được danh sách kênh" + nút "Thử lại"; **không** hiện dữ liệu cũ như thể mới (có nhãn "Cập nhật lúc …" khi dùng dữ liệu đã lưu cục bộ).
- Hiển thị ≤ 1 giây: dữ liệu từ `GET /channels/overview` (không gọi nền tảng); skeleton thẻ trong lúc tải.

## 3. `ChannelCard` (mỗi kết nối một thẻ; tên ≤ 120 ký tự cắt gọn `line-clamp`, không chạy HTML – render văn bản thuần)

| Phần | Nội dung |
|---|---|
| Đầu | ảnh đại diện (alt = tên) · **tên** · nhãn loại (chữ: "Facebook Page", "Instagram", "TikTok") · mã rút gọn `#a1b2c3` (phân biệt trùng tên) |
| Trạng thái | `Badge` **chữ + biểu tượng**: ✔ Đang hoạt động · ⏳ Sắp hết hạn · ⚠ Cần kết nối lại · ⛔ Không đủ điều kiện · ⏸ Tạm tắt (không chỉ dựa vào màu) + dòng lý do `reasonVi` |
| Hạn quyền | "Quyền có hiệu lực đến 12/01/2027 (còn 5 ngày)" (UTC+7, ngày đời thường) · `none` → "Không có ngày hết hạn cố định – sẽ báo ngay nếu bị thu hồi" |
| Điều kiện tài khoản | loại tài khoản; quyền đã cấp dạng tick/chữ; **hạn mức còn lại chỉ khi `quotaRemaining ≠ null`** (không số giả) |
| Instagram | "Liên kết qua Page: *Tiệm hoa Lan*" (và cảnh báo khi Page nguồn hỏng) |
| Thời điểm | "Kiểm tra lần cuối …" · "Kết nối ngày …" |
| TikTok | chú thích "TikTok chỉ đăng video" + giới hạn thời lượng/dung lượng nếu biết; nhãn "đang thử nghiệm" khi `experimental` |
| Hành động (chủ, theo trạng thái) | `active/expiring/ineligible`: **Kiểm tra lại**, **Ngắt kết nối** · `needs_reconnect`: **Kết nối lại**, Ngắt · `suspended`: chỉ **Ngắt** (+ "Xem") · CTV: **không có nút** |
| "Chi tiết cho hỗ trợ" | thu gọn mặc định; chứa mã lỗi gốc gần nhất (`supportDetails.lastErrorCode`) |

Vùng chạm ≥ 44 × 44 px; hoạt động từ 360 px (thẻ một cột, nút xếp dọc); tương phản AA; thứ tự tab hợp lý; trạng thái thông báo `aria-live="polite"`; hộp thoại có bẫy tiêu điểm và đóng bằng Esc.

## 4. Các luồng

- **Kết nối** (`ConnectMenu`): chọn nền tảng → hiện `used/limit` ("Facebook Page 2/5") → nếu `canAdd=false` hiện lý do (đủ giới hạn/gói hết hạn) → `POST /connect` → `window.location.assign(authorizeUrl)`. Quay về `/channels/select/:id`.
- **Chọn Page** (`SelectChannelsPage`): danh sách ứng viên có ảnh + tên; **một ứng viên chọn được thì chọn sẵn** (US1-3); `blocked` hiện "Đã kết nối"/lý do + hành động (ví dụ Instagram cá nhân → hướng dẫn 3 bước + nút "Kiểm tra lại"); chọn nhiều tới `remainingSlots` (nút "Xác nhận" vô hiệu kèm giải thích khi vượt); kết quả **từng Page** hiện riêng sau `confirm`; hủy/lỗi → thông điệp + "Thử lại", không lưu gì.
- **Kết nối lại**: nút trên đúng thẻ → `connect {reconnectConnectionId}`; sai Page → thông báo `WRONG_CHANNEL` + lựa chọn "Chọn lại"/"Ngắt kênh"; thành công → banner "Đã kết nối lại" (bài đã lên lịch giữ nguyên).
- **Kiểm tra lại**: nút có trạng thái đang chạy; `429` → "Hãy thử lại sau {n} giây" (nút vô hiệu đếm ngược); `unavailable` → "Chưa kiểm tra được, thử lại sau" (trạng thái thẻ không đổi).
- **Ngắt kết nối** (`DisconnectDialog`): mở bằng `disconnect-preview` → nêu **số bài đã lên lịch cho riêng kênh này** (và "Instagram @… liên kết với Page này sẽ cần kết nối lại" khi Page có phụ thuộc) + "bài và lịch sử đã đăng vẫn được giữ"; nút xác nhận mô tả hậu quả ("Ngắt và xóa quyền"); sau khi xong: nếu `revoked='failed'` hiện `hintVi` ("Bạn có thể gỡ ứng dụng trong cài đặt Facebook").
- **Hai thiết bị cùng thao tác**: mọi thao tác ghi dựa `version` ở máy chủ; giao diện làm mới lại danh sách sau mỗi thao tác (`useApiMutation` + `invalidate(queryKeys.channels.*)`), thấy kết quả nhất quán.

## 5. Trợ năng & kiểm thử giao diện

- E2E Playwright (011) ở **360 / 768 / 1280 px**: không cuộn ngang, vùng chạm ≥ 44 px, axe (WCAG 2.1 AA) không vi phạm trên: trống, nhiều kết nối đủ trạng thái, CTV chỉ xem, hộp xác nhận, chọn Page.
- Ma trận quyền giao diện (`nav-registry.spec`/`permission-matrix`): CTV thấy trang nhưng **không** thấy nút Kết nối/Kết nối lại/Kiểm tra lại/Ngắt; gọi API trực tiếp bị `403` (kiểm ở máy chủ).
- Kiểm thử TikTok vô hình: `features.tiktok=false` ⇒ **0** nút/thẻ/bộ lọc/văn bản chứa "TikTok" (truy vấn DOM) ở `ChannelsPage`, `SelectChannelsPage`, menu.
- Thành phần mới đều dùng bộ `ui/` sẵn có (`Badge`, `Alert`, `Card`, `EmptyState`, `Dialog`, `ChipTabs`, `ErrorNotice`); thêm chuỗi vào `lib/i18n/vi.ts` (khóa `channels.*`), **không** hằng chuỗi rải rác.
