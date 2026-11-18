// Khai báo kiểu tối thiểu cho bộ giải mã HEIC WASM (`libheif-js`, bản đóng gói sẵn WASM – 014 R4). Thư viện không kèm kiểu.
declare module 'libheif-js/wasm-bundle' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: unknown) => void,
    ): void;
  }
  export class HeifDecoder {
    decode(buffer: Uint8Array | Buffer): HeifImage[];
  }
}
