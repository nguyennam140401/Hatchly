import type { ChannelConnectionStatus, ChannelType } from '../../public-api';

// Trạng thái hiển thị của kênh – HÀM THUẦN (010 data-model.md "Trạng thái hiển thị", R3, R4).
// CSDL chỉ lưu 4 giá trị (`active|needs_reconnect|ineligible|disconnected`). `expiring` (sắp hết hạn) và `suspended`
// (công tắc tắt) được DẪN XUẤT từ hạn quyền, Page nguồn và công tắc nên: bật/tắt công tắc có hiệu lực ngay (≤ 1 phút),
// Page phục hồi thì Instagram tự đúng, không có "trạng thái phụ" nào cần dọn trong CSDL.

export type StoredStatus = 'active' | 'needs_reconnect' | 'ineligible' | 'disconnected';

/** Trạng thái hiển thị (FR-025). */
export type DerivedState =
  'active' | 'expiring' | 'needs_reconnect' | 'ineligible' | 'suspended' | 'disconnected';

/** Phần của hàng kết nối mà việc dẫn xuất cần (không có mã quyền). */
export interface StateInput {
  channelType: ChannelType | 'tiktok';
  status: StoredStatus;
  /** `null` ⇔ không có mốc hạn cố định (`expiry_kind = 'none'`). */
  tokenExpiresAt: Date | null;
  reasonCode: string | null;
  /** Chỉ Instagram: có Page nguồn được liên kết hay không. */
  sourceConnectionId: string | null;
}

export interface DeriveContext {
  now: Date;
  /** Số ngày báo trước hết hạn (`channel.expiry_warn_days`, mặc định 7). */
  warnDays: number;
  /** Công tắc `channel.tiktok` đã tính (ghi đè ?? mặc định); lỗi đọc ⇒ `false`. */
  featureEnabled: boolean;
  /**
   * Hàng của Page nguồn (chỉ khi `sourceConnectionId` có giá trị): `null` nếu không tìm thấy (đã xóa) –
   * coi như Page nguồn đã mất.
   */
  source?: StateInput | null | undefined;
}

export interface DerivedResult {
  state: DerivedState;
  /** Mã lý do hiển thị/kiểm toán (đã lọc `[A-Za-z0-9_.:-]{1,64}` khi lưu). */
  reasonCode: string | null;
}

const DAY_MS = 86_400_000;
/** Việt Nam UTC+7 – hiển thị và đếm ngày theo giờ Việt Nam (Hiến pháp: lưu UTC, hiển thị UTC+7). */
const VN_OFFSET_MS = 7 * 3_600_000;

/** Chỉ số ngày theo lịch UTC+7 của một thời điểm. */
function vnDayIndex(t: Date): number {
  return Math.floor((t.getTime() + VN_OFFSET_MS) / DAY_MS);
}

/**
 * Số ngày (theo lịch UTC+7) từ `now` đến `expiresAt`: cùng ngày = 0, ngày mai = 1, đã qua = âm.
 * Dùng cho "còn N ngày" và mốc nhắc d7/d1 để người dùng thấy cùng con số ở màn hình và thông báo.
 */
export function daysLeft(expiresAt: Date, now: Date): number {
  return vnDayIndex(expiresAt) - vnDayIndex(now);
}

/** Dẫn xuất cho một hàng KHÔNG xét Page nguồn/công tắc – dùng để hỏi trạng thái của chính Page nguồn. */
function ownState(row: StateInput, ctx: Pick<DeriveContext, 'now' | 'warnDays'>): DerivedResult {
  if (row.status === 'disconnected') return { state: 'disconnected', reasonCode: null };
  if (row.status === 'needs_reconnect') {
    return { state: 'needs_reconnect', reasonCode: row.reasonCode };
  }
  if (row.status === 'ineligible') return { state: 'ineligible', reasonCode: row.reasonCode };
  // status = 'active'
  if (row.tokenExpiresAt !== null) {
    const ms = row.tokenExpiresAt.getTime() - ctx.now.getTime();
    if (ms <= 0) return { state: 'needs_reconnect', reasonCode: 'TOKEN_EXPIRED' };
    if (ms < ctx.warnDays * DAY_MS) return { state: 'expiring', reasonCode: 'TOKEN_EXPIRING' };
  }
  return { state: 'active', reasonCode: null };
}

/** Bảng ưu tiên của data-model.md (từ trên xuống). */
export function deriveState(row: StateInput, ctx: DeriveContext): DerivedResult {
  if (row.status === 'disconnected') return { state: 'disconnected', reasonCode: null };

  // TikTok: công tắc tắt/không đọc được ⇒ tạm tắt. Giữ nguyên mã quyền, Worker không gọi nền tảng (FR-038).
  if (row.channelType === 'tiktok' && !ctx.featureEnabled) {
    return { state: 'suspended', reasonCode: 'FEATURE_OFF' };
  }

  // Instagram phụ thuộc Page nguồn (FR-042): Page nguồn không còn dùng được ⇒ cần kết nối lại, không cần cấp quyền lại
  // khi Page phục hồi (dẫn xuất nên tự đúng).
  if (row.channelType === 'instagram' && row.sourceConnectionId !== null) {
    const source = ctx.source;
    const sourceState =
      source === null || source === undefined ? null : ownState(source, ctx).state;
    if (sourceState !== 'active' && sourceState !== 'expiring') {
      return { state: 'needs_reconnect', reasonCode: 'SOURCE_PAGE_LOST' };
    }
  }

  return ownState(row, ctx);
}

/**
 * `status` công khai (hợp đồng 012/013, giữ đúng 4 giá trị – R3). Mọi trạng thái KHÔNG dùng được để đăng ánh xạ về
 * `expired`/`disconnected` để `publishing/precheck` dừng, không bao giờ đăng bằng quyền hỏng.
 */
export function toLegacyStatus(state: DerivedState): ChannelConnectionStatus {
  switch (state) {
    case 'active':
      return 'active';
    case 'expiring':
      return 'expiring';
    case 'needs_reconnect':
    case 'ineligible':
      return 'expired';
    case 'suspended':
    case 'disconnected':
      return 'disconnected';
  }
}

/** Kết nối dùng được để đăng bài ⇔ `active|expiring` (bất biến của R3). */
export function isUsableState(state: DerivedState): boolean {
  return state === 'active' || state === 'expiring';
}
