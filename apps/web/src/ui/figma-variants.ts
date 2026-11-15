// Bảng biến thể đồng bộ với Figma (data-model mục 2) – dữ liệu cho kiểm thử "đủ biến thể" (SC-001).
// `designPending`: biến thể CHƯA có thiết kế trong Figma, dựng theo token; không tính vào 100% của SC-001 cho đến khi
// người thiết kế bổ sung (figma-extract.md mục 4).

export interface VariantRow {
  /** Tên xuất khẩu trong `ui/index.ts` (trùng tên thành phần Figma). */
  component: string;
  /** Thuộc tính biến thể và các giá trị. */
  props: Record<string, readonly (string | boolean)[]>;
  /** Số tổ hợp có trong Figma. */
  figmaCombinations: number;
  /** Số tổ hợp thêm nhưng chưa có thiết kế. */
  pendingCombinations: number;
  designPending?: boolean;
}

export const FIGMA_VARIANTS: readonly VariantRow[] = [
  {
    component: 'Button',
    props: { variant: ['primary', 'secondary', 'ghost', 'danger'], state: ['default', 'locked'] },
    figmaCombinations: 8,
    pendingCombinations: 4, // loading
  },
  {
    component: 'StatusBadge',
    props: {
      status: ['draft', 'review', 'scheduled', 'publishing', 'published', 'attention', 'cancelled', 'unknown'],
    },
    figmaCombinations: 6,
    pendingCombinations: 2, // cancelled, unknown
  },
  { component: 'SuggestionTag', props: {}, figmaCombinations: 1, pendingCombinations: 0 },
  {
    component: 'ChannelTag',
    props: { channel: ['facebook', 'tiktok', 'instagram', 'zalo'], manualPublish: [true, false] },
    figmaCombinations: 8,
    pendingCombinations: 0,
  },
  {
    component: 'UsageMeter',
    props: { level: ['normal', 'warning', 'exhausted'] },
    figmaCombinations: 3,
    pendingCombinations: 0,
  },
  { component: 'IdeaCard', props: { featured: [true, false] }, figmaCombinations: 2, pendingCombinations: 0 },
  { component: 'PostCard', props: {}, figmaCombinations: 1, pendingCombinations: 0 },
  { component: 'NavBar', props: { active: ['overview', 'calendar', 'posts', 'more', 'create-post'] }, figmaCombinations: 5, pendingCombinations: 0 },
  {
    component: 'Sidebar',
    props: {
      active: ['overview', 'calendar', 'posts', 'media', 'business-profile', 'channels-plan', 'settings'],
    },
    figmaCombinations: 7,
    pendingCombinations: 0,
  },
  { component: 'TopBar', props: { kind: ['logo', 'back'] }, figmaCombinations: 2, pendingCombinations: 0 },
  {
    component: 'InlineAlert',
    props: { tone: ['info', 'warning', 'error'] },
    figmaCombinations: 3,
    pendingCombinations: 0,
  },
  { component: 'Chip', props: { selected: [true, false] }, figmaCombinations: 2, pendingCombinations: 0 },
  {
    component: 'ChannelTabs',
    props: { selected: ['facebook', 'tiktok', 'instagram', 'zalo'] },
    figmaCombinations: 2,
    pendingCombinations: 2, // Instagram, Zalo
  },
  { component: 'StepRow', props: { state: ['done', 'error', 'pending'] }, figmaCombinations: 3, pendingCombinations: 0 },
  {
    component: 'ChannelRow',
    props: { state: ['connected', 'expiring', 'disconnected', 'manual'] },
    figmaCombinations: 4,
    pendingCombinations: 0,
  },
  { component: 'DayCell', props: { selected: [true, false] }, figmaCombinations: 2, pendingCombinations: 0 },
  {
    component: 'CalendarItem',
    props: { status: ['review', 'scheduled', 'attention', 'published'] },
    figmaCombinations: 4,
    pendingCombinations: 0,
  },
  {
    component: 'Field',
    props: { state: ['default', 'focus', 'error', 'disabled', 'readOnly'] },
    figmaCombinations: 1,
    pendingCombinations: 4,
  },
  { component: 'Logo', props: {}, figmaCombinations: 1, pendingCombinations: 0 },
  // Dựng chỉ bằng token, không có trong Figma.
  { component: 'ConfirmDialog', props: { tone: ['default', 'danger'] }, figmaCombinations: 0, pendingCombinations: 2, designPending: true },
  { component: 'Skeleton', props: {}, figmaCombinations: 0, pendingCombinations: 1, designPending: true },
  { component: 'EmptyState', props: {}, figmaCombinations: 0, pendingCombinations: 1, designPending: true },
  { component: 'ProgressRow', props: {}, figmaCombinations: 0, pendingCombinations: 1, designPending: true },
  { component: 'PageHeader', props: {}, figmaCombinations: 0, pendingCombinations: 1, designPending: true },
];

/** Tổng số tổ hợp đã có thiết kế (mẫu số của SC-001). */
export function figmaCombinationTotal(): number {
  return FIGMA_VARIANTS.reduce((sum, row) => sum + row.figmaCombinations, 0);
}
