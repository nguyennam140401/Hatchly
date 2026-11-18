import { useAppForm } from '../../../lib/forms/useAppForm';
import type { HarnessProps } from '../../../ui/form/__tests__/form-contract';
import { Form } from '../../../ui/form/Form';
import { TextField } from '../../../ui/form/fields/inputs';
import { TagListField } from '../../../ui/form/fields/TagListField';
import { nonEmptyList, objectSchema } from './sample-schema';

interface Values extends Record<string, unknown> {
  keywords: string[];
  secretCode: string;
}

const schema = objectSchema<Values>({
  keywords: nonEmptyList('Hãy thêm ít nhất một từ khóa.'),
});

/** Biểu mẫu mẫu 2: danh sách thẻ từ khóa (thêm/xóa bằng bàn phím). */
export function KeywordsForm({ onSubmit, loadLatest, readOnly, draftKey }: HarnessProps) {
  const form = useAppForm<Values>({
    schema,
    defaultValues: { keywords: [], secretCode: '' },
    version: 3,
    readOnly: readOnly ?? false,
    draftKey,
    sensitiveFields: ['secretCode'],
    onSubmit: (values, ctx) => onSubmit(values, ctx),
    loadLatest: loadLatest as never,
  });
  return (
    <main>
      <Form form={form} title="Từ khóa" submitLabel="Lưu từ khóa">
        <TagListField name="keywords" label="Từ khóa" help="Nhấn Enter để thêm." max={10} />
        <TextField name="secretCode" label="Mã bí mật" />
      </Form>
    </main>
  );
}
