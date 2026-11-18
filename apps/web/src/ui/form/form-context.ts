import { createContext, useContext } from 'react';

/** Trạng thái chung của một `<Form>` cho các ô con (chế độ chỉ xem). */
export interface FormUiState {
  readOnly: boolean;
}

export const FormUiContext = createContext<FormUiState>({ readOnly: false });

export function useFormUi(): FormUiState {
  return useContext(FormUiContext);
}
