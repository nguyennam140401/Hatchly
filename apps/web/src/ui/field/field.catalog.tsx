import type { CatalogEntry } from '../catalog-types';
import { Field, type FieldState } from './Field';

const STATES: FieldState[] = ['default', 'focus', 'error', 'disabled', 'readOnly'];

export const fieldCatalog: CatalogEntry = {
  name: 'Field',
  description: 'Ô nhập: nhãn + ô + trợ giúp + lỗi. Figma chỉ vẽ trạng thái mặc định; các trạng thái còn lại dựng theo token.',
  a11yNotes: 'Nhãn gắn bằng for/id; lỗi có biểu tượng + chữ + cách sửa, liên kết aria-describedby; ô cao ≥ 44 px, chữ ≥ 16 px.',
  variants: STATES.map((state) => ({
    label: state,
    render: () => (
      <Field
        label="Tên cửa hàng"
        help="Hiện ở đầu mỗi bài."
        state={state}
        required
        error={state === 'error' ? { message: 'Chưa nhập tên.', fix: 'Hãy nhập ít nhất 2 ký tự.' } : undefined}
      >
        {(control) => (
          <input
            {...control}
            type="text"
            disabled={state === 'disabled'}
            readOnly={state === 'readOnly'}
            defaultValue={state === 'error' ? '' : 'Tiệm Hoa Nhỏ'}
          />
        )}
      </Field>
    ),
  })),
};
