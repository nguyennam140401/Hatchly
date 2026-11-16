import { useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '../button/Button';
import { cn } from '../util/cn';

export interface FileFieldProps {
  label: string;
  help?: string;
  accept?: string;
  /** Nhận các tệp đã chọn/thả; kiểm tra loại + dung lượng do hàng đợi làm (báo theo từng tệp). */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  multiple?: boolean;
  buttonLabel?: string;
}

/** Chọn nhiều tệp hoặc kéo-thả; nút chọn tệp dùng được bằng bàn phím. */
export function FileField({
  label,
  help,
  accept,
  onFiles,
  disabled = false,
  multiple = true,
  buttonLabel = 'Chọn tệp',
}: FileFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    onFiles([...event.dataTransfer.files]);
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-label text-ink">
        {label}
      </span>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center',
          over ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-0',
        )}
      >
        <p className="text-body-sm text-ink-muted">Kéo thả tệp vào đây hoặc</p>
        <Button
          variant="secondary"
          locked={disabled}
          onClick={() => {
            inputRef.current?.click();
          }}
          aria-describedby={help !== undefined ? `${id}-help` : undefined}
        >
          {buttonLabel}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          multiple={multiple}
          {...(accept !== undefined ? { accept } : {})}
          disabled={disabled}
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
      {help !== undefined && (
        <p id={`${id}-help`} className="text-caption text-ink-muted">
          {help}
        </p>
      )}
    </div>
  );
}
