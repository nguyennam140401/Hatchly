import { objectSchema, required } from '../../lib/forms/rules';
import { useAppForm, type FormComponentProps } from '../../lib/forms/useAppForm';
import { Form } from '../../ui/form/Form';
import { TextField } from '../../ui/form/fields/inputs';

// Biểu mẫu "Mời cộng tác viên" (009 US3). Tách riêng để kiểm thử theo hợp đồng biểu mẫu (SC-007).

export interface InviteValues extends Record<string, unknown> {
  email: string;
}

export function InviteForm({
  onSubmit,
  loadLatest,
  readOnly,
  draftKey,
  lockedReason,
}: FormComponentProps<InviteValues> & { lockedReason?: string }) {
  const form = useAppForm<InviteValues>({
    schema: objectSchema<InviteValues>({
      email: required('Vui lòng nhập email của người bạn muốn mời.'),
    }),
    defaultValues: { email: '' },
    clearOnSuccess: true,
    readOnly: readOnly ?? false,
    draftKey,
    loadLatest,
    // Lời mời gửi tới người khác: địa chỉ email không vào bản nháp.
    sensitiveFields: ['email'],
    onSubmit,
  });
  return (
    <Form
      form={form}
      title="Mời cộng tác viên"
      submitLabel="Mời"
      {...(lockedReason !== undefined ? { submitLocked: lockedReason } : {})}
    >
      <TextField name="email" label="Email của người được mời" type="email" autoComplete="off" />
    </Form>
  );
}
