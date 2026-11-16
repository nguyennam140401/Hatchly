import { useState, type ReactElement, type ReactNode } from 'react';
import { ConfirmDialog } from '../../ui/alert/ConfirmDialog';
import { InlineAlert } from '../../ui/alert/InlineAlert';
import type { ApiMutationResult } from './hooks';

// Thao tác không đảo ngược (xóa, ngắt kết nối, hủy lịch – FR-025): LUÔN hỏi xác nhận TRƯỚC và CHỜ máy chủ xác nhận;
// không cập nhật lạc quan. Hộp chỉ đóng khi máy chủ trả 2xx; lỗi hiện ngay trong hộp kèm hành động khắc phục.

export interface DestructiveActionOptions<V, R> {
  mutation: ApiMutationResult<V, R>;
  title: string;
  /** Hệ quả của thao tác, nói rõ cho người dùng. */
  body: ReactNode;
  confirmLabel: string;
}

export function useDestructiveAction<V, R>(
  options: DestructiveActionOptions<V, R>,
): {
  /** Mở hộp xác nhận cho `vars`. */
  ask: (vars: V) => void;
  dialog: ReactElement;
} {
  const { mutation } = options;
  const [target, setTarget] = useState<{ vars: V } | null>(null);

  const confirm = () => {
    if (target === null) return;
    mutation.mutate(target.vars, {
      onSuccess: () => {
        setTarget(null);
      },
    });
  };

  const error = mutation.error;
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          setTarget(null);
          mutation.reset();
        }
      }}
      tone="danger"
      title={options.title}
      body={
        <div className="flex flex-col gap-3">
          <div>{options.body}</div>
          {error !== null && (
            <InlineAlert
              tone="error"
              actions={error.actions}
              support={{ traceId: error.support.traceId, code: error.code }}
              onAction={confirm}
            >
              {error.message}
            </InlineAlert>
          )}
        </div>
      }
      confirmLabel={options.confirmLabel}
      loading={mutation.isPending}
      onConfirm={confirm}
    />
  );

  return {
    ask: (vars) => {
      mutation.reset();
      setTarget({ vars });
    },
    dialog,
  };
}
