import { Chip } from '../../ui/chip-tabs/Chip';

// Bộ lọc thư viện (014 FR-021 / contracts/media-ui.md mục 1): loại, khoảng ngày tải, tìm theo tên. Trạng thái nằm trên URL
// (`?kind=&from=&to=&q=`) nên chia sẻ/tải lại không mất. Ngày người dùng chọn tính theo giờ Việt Nam (UTC+7) và đổi sang UTC.

export type KindFilter = 'all' | 'image' | 'video';

export interface MediaFilterValues {
  kind: KindFilter;
  /** `YYYY-MM-DD` (ngày theo giờ Việt Nam) hoặc rỗng. */
  from: string;
  to: string;
  q: string;
}

const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'image', label: 'Ảnh' },
  { id: 'video', label: 'Video' },
];

/** Đầu ngày `YYYY-MM-DD` theo UTC+7 → ISO UTC. */
export function startOfDayVn(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}

/** Cuối ngày `YYYY-MM-DD` theo UTC+7 → ISO UTC. */
export function endOfDayVn(date: string): string {
  return new Date(`${date}T23:59:59.999+07:00`).toISOString();
}

const inputClass =
  'min-h-touch rounded-md border border-line-strong bg-surface-0 px-3 text-body text-ink';

export function MediaFilters({
  values,
  onChange,
}: {
  values: MediaFilterValues;
  onChange: (key: keyof MediaFilterValues, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo loại">
        {KINDS.map((k) => (
          <Chip
            key={k.id}
            label={k.label}
            selected={values.kind === k.id}
            onClick={() => {
              onChange('kind', k.id);
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-label text-ink">
          Từ ngày
          <input
            type="date"
            className={inputClass}
            value={values.from}
            max={values.to === '' ? undefined : values.to}
            onChange={(e) => {
              onChange('from', e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-label text-ink">
          Đến ngày
          <input
            type="date"
            className={inputClass}
            value={values.to}
            min={values.from === '' ? undefined : values.from}
            onChange={(e) => {
              onChange('to', e.target.value);
            }}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-label text-ink">
          Tìm theo tên tệp
          <input
            type="search"
            className={inputClass}
            value={values.q}
            maxLength={100}
            onChange={(e) => {
              onChange('q', e.target.value);
            }}
          />
        </label>
      </div>
    </div>
  );
}
