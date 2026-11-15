import { get, useFormContext } from 'react-hook-form';
import type { FieldError } from '../../field/Field';
import { useFormUi } from '../form-context';

/** Dữ liệu chung của mọi ô trong `<Form>`: lỗi theo đường dẫn chấm (đúng ô) và chế độ chỉ xem. */
export function useFieldMeta(name: string): { error: FieldError | undefined; readOnly: boolean } {
  const {
    formState: { errors },
  } = useFormContext();
  const { readOnly } = useFormUi();
  const entry: unknown = get(errors, name);
  const message =
    typeof entry === 'object' && entry !== null && 'message' in entry && typeof entry.message === 'string'
      ? entry.message
      : undefined;
  return { error: message !== undefined ? { message } : undefined, readOnly };
}
