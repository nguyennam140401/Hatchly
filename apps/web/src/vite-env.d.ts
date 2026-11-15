/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  /** "1" bật danh mục thành phần ở bản dựng (CI/E2E); mặc định chỉ bật khi DEV. */
  readonly VITE_ENABLE_CATALOG?: string;
}
