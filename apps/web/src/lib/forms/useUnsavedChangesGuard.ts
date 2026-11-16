import { useEffect, type RefObject } from 'react';
import { useBlocker, type Blocker } from 'react-router';

/**
 * Chặn rời trang khi còn thay đổi chưa lưu (006 FR-017, rút ra dùng chung): điều hướng trong ứng dụng → `useBlocker`
 * (hộp "Bỏ các thay đổi chưa lưu?" do `<Form>` hiển thị); đóng/tải lại tab → `beforeunload` của trình duyệt.
 */
export function useUnsavedChangesGuard(dirty: boolean, suspended?: RefObject<boolean>): Blocker {
  // `suspended` là ref (đọc ở thời điểm điều hướng, không chờ render): đang gửi biểu mẫu thì không chặn việc chuyển trang
  // do chính lần gửi thành công gây ra.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && suspended?.current !== true && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  return blocker;
}
