import { useState } from 'react';
import { Link } from 'react-router';
import { Chip } from '../ui/chip-tabs/Chip';
import type { CatalogEntry } from '../ui/catalog-types';
import { PageHeader } from '../ui/layout/PageHeader';

// Danh mục thành phần (FR-033): liệt kê mọi `*.catalog.tsx` trong `ui/` theo nhóm, mỗi biến thể một khung; chọn khung
// 360/768/1280 px, công tắc "cỡ chữ 200%" và "tương phản cao". Chỉ chạy khi DEV hoặc VITE_ENABLE_CATALOG=1 (xem routes.tsx).

const modules = import.meta.glob<Record<string, unknown>>('../ui/**/*.catalog.tsx', { eager: true });

function isEntry(value: unknown): value is CatalogEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'variants' in value &&
    Array.isArray((value as CatalogEntry).variants)
  );
}

/** Mọi mục danh mục, sắp theo nhóm (thư mục) rồi tên. */
export function collectCatalog(): { group: string; entry: CatalogEntry }[] {
  const out: { group: string; entry: CatalogEntry }[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const group = path.split('/').at(-2) ?? 'khác';
    for (const value of Object.values(mod)) if (isEntry(value)) out.push({ group, entry: value });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.entry.name.localeCompare(b.entry.name));
}

const FRAMES = [
  { id: 'phone', label: '360 px', cls: 'w-(--frame)', width: '360px' },
  { id: 'tablet', label: '768 px', cls: 'w-(--frame)', width: '768px' },
  { id: 'desktop', label: '1280 px', cls: 'w-(--frame)', width: '1280px' },
] as const;

export function CatalogPage() {
  const [frame, setFrame] = useState<(typeof FRAMES)[number]>(FRAMES[0]);
  const [bigText, setBigText] = useState(false);
  const [contrast, setContrast] = useState(false);
  const entries = collectCatalog();

  return (
    <div
      data-catalog-text={bigText ? '200' : undefined}
      data-catalog-contrast={contrast ? 'high' : undefined}
      className="mx-auto flex max-w-full flex-col gap-6 bg-surface-100 p-gutter text-ink"
    >
      <PageHeader
        title="Danh mục thành phần"
        description="Mọi biến thể của bộ thành phần dùng chung. Chỉ dành cho phát triển."
      />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tùy chọn xem">
        {FRAMES.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            selected={frame.id === f.id}
            onClick={() => {
              setFrame(f);
            }}
          />
        ))}
        <Chip
          label="Cỡ chữ 200%"
          selected={bigText}
          onClick={() => {
            setBigText((v) => !v);
          }}
        />
        <Chip
          label="Tương phản cao"
          selected={contrast}
          onClick={() => {
            setContrast((v) => !v);
          }}
        />
        <Link
          to="/_catalog/sample"
          className="inline-flex min-h-touch items-center px-4 text-label text-brand underline focus-visible:ring-2 focus-visible:ring-brand"
        >
          Màn hình mẫu
        </Link>
      </div>
      {entries.map(({ group, entry }) => (
        <section key={`${group}/${entry.name}`} aria-labelledby={`cat-${entry.name}`} className="flex flex-col gap-3">
          <h2 id={`cat-${entry.name}`} className="text-title">
            {entry.name} <span className="text-body-sm text-ink-muted">({group})</span>
          </h2>
          <p className="text-body text-ink-muted">{entry.description}</p>
          <p className="text-body-sm text-ink-muted">Trợ năng: {entry.a11yNotes}</p>
          <div className="flex flex-wrap gap-4">
            {entry.variants.map((variant) => (
              <figure key={variant.label} className="flex min-w-0 flex-col gap-2">
                <figcaption className="text-caption text-ink-muted">{variant.label}</figcaption>
                <div
                  className={`${frame.cls} max-w-full overflow-x-auto rounded-lg border border-line bg-surface-0 p-4`}
                  style={{ '--frame': frame.width } as React.CSSProperties}
                >
                  {variant.render()}
                </div>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
