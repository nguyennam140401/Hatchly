import { useNavigate } from 'react-router';

/** Điều hướng trong ứng dụng cho các thành phần `ui/*` (chỉ `ui/nav` được dùng react-router). */
export function useNavigateTo(): (href: string) => void {
  const navigate = useNavigate();
  return (href) => {
    void navigate(href);
  };
}
