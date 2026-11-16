import { useMemo } from 'react';
import { useAppForm } from '../../../lib/forms/useAppForm';
import { useUploadQueue } from '../../../lib/upload/useUploadQueue';
import type { UploadTransport } from '../../../lib/upload/transports/types';
import type { HarnessProps } from '../../../ui/form/__tests__/form-contract';
import { Form } from '../../../ui/form/Form';
import { TextField } from '../../../ui/form/fields/inputs';
import { FileField } from '../../../ui/upload/FileField';
import { UploadQueue } from '../../../ui/upload/UploadQueue';
import { minLength, objectSchema } from './sample-schema';

interface Values extends Record<string, unknown> {
  albumName: string;
  secretCode: string;
}

const schema = objectSchema<Values>({
  albumName: minLength(2, 'Tên bộ ảnh quá ngắn. Hãy nhập ít nhất 2 ký tự.'),
});

/** Vận chuyển mẫu cho danh mục: không có kho thật nên chỉ giả lập tiến độ. */
function demoTransport(): UploadTransport {
  return {
    start: (file) =>
      Promise.resolve({ uploadUrl: 'https://kho.invalid/demo', completionRef: file.name }),
    putPart: (_session, _file, onProgress) => {
      onProgress(100);
      return Promise.resolve();
    },
    complete: () => Promise.resolve(),
  };
}

/** Biểu mẫu mẫu 3: tải tệp (chọn nhiều/kéo-thả, hàng đợi, tiến độ). */
export function UploadForm({ onSubmit, loadLatest, readOnly, draftKey }: HarnessProps) {
  const form = useAppForm<Values>({
    schema,
    defaultValues: { albumName: '', secretCode: '' },
    version: 1,
    readOnly: readOnly ?? false,
    draftKey,
    sensitiveFields: ['secretCode'],
    onSubmit: (values, ctx) => onSubmit(values, ctx),
    loadLatest: loadLatest as never,
  });
  const transport = useMemo(() => demoTransport(), []);
  const { queue, items } = useUploadQueue({ transport });
  return (
    <main>
      <Form form={form} title="Bộ ảnh" submitLabel="Lưu bộ ảnh">
        <TextField name="albumName" label="Tên bộ ảnh" required />
        <FileField
          label="Ảnh và video"
          help="Ảnh JPG/PNG/WebP; video MP4/MOV tối đa 500 MB."
          disabled={form.readOnly}
          onFiles={(files) => {
            queue.add(files);
          }}
        />
        <UploadQueue
          items={items}
          onCancel={queue.cancel}
          onRetry={queue.retry}
          freeUpHref="/media"
        />
        <TextField name="secretCode" label="Mã bí mật" />
      </Form>
    </main>
  );
}
