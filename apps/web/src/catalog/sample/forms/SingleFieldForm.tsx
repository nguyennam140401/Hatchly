import { useAppForm } from '../../../lib/forms/useAppForm';
import type { HarnessProps } from '../../../ui/form/__tests__/form-contract';
import { Form } from '../../../ui/form/Form';
import { TextField } from '../../../ui/form/fields/inputs';
import { TextAreaField } from '../../../ui/form/fields/inputs';
import { minLength, objectSchema } from './sample-schema';

interface Values extends Record<string, unknown> {
  shopName: string;
  intro: string;
  secretCode: string;
}

const schema = objectSchema<Values>({
  shopName: minLength(2, 'Tên cửa hàng quá ngắn. Hãy nhập ít nhất 2 ký tự.'),
});

/** Biểu mẫu mẫu 1: ô đơn + ô nhiều dòng có bộ đếm + một ô nhạy cảm (không vào bản nháp). */
export function SingleFieldForm({ onSubmit, loadLatest, readOnly, draftKey }: HarnessProps) {
  const form = useAppForm<Values>({
    schema,
    defaultValues: { shopName: '', intro: '', secretCode: '' },
    version: 7,
    readOnly: readOnly ?? false,
    draftKey,
    sensitiveFields: ['secretCode'],
    onSubmit: (values, ctx) => onSubmit(values, ctx),
    loadLatest: loadLatest as never,
  });
  return (
    <main>
      <Form form={form} title="Cửa hàng" submitLabel="Lưu cửa hàng">
        <TextField name="shopName" label="Tên cửa hàng" help="Hiện ở đầu mỗi bài." required />
        <TextAreaField name="intro" label="Giới thiệu" maxChars={100} />
        <TextField name="secretCode" label="Mã bí mật" />
      </Form>
    </main>
  );
}
