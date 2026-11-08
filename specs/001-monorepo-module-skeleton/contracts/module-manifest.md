# Contract – Tệp kê khai module và quy tắc ranh giới

Tệp: `apps/server/src/modules/modules.manifest.json`. Là hợp đồng giữa lập trình viên (khai báo),
công cụ kiểm tra ranh giới (thực thi) và registry ghép module (khởi động). Mọi thay đổi tệp này
MUST qua review (FR-011a).

## Định dạng

```jsonc
{
  "$schema": "./modules.manifest.schema.json",
  // Gói npm mà packages/shared được phép phụ thuộc (FR-011e)
  "sharedAllowedPackages": ["zod"],
  // Mẫu tên gói SDK nhà cung cấp AI – chỉ được nhập trong modules/ai_gateway (nguyên tắc III)
  "aiProviderPackagePatterns": ["^@anthropic-ai/", "^openai$", "^@google/genai$", "^@mistralai/"],
  "modules": [
    {
      "name": "publishing",
      "title": "Đăng bài",
      "kind": "business",
      "schema": "publishing",
      "runsIn": ["api", "worker"],
      "allowedDeps": ["content", "media", "platform_gateway", "notifications", "queue"]
    }
    // … đủ 11 module, xem data-model.md mục 1
  ]
}
```

`modules.manifest.schema.json` (JSON Schema) đi kèm để trình soạn thảo gợi ý và để kiểm thử xác thực.

## Cấu trúc thư mục mỗi module

```text
apps/server/src/modules/<name>/
├── index.ts            # GIAO DIỆN CÔNG KHAI DUY NHẤT: export <Name>Module + kiểu/token công khai
├── <name>.module.ts    # @Module NestJS; chỉ export provider công khai
├── public-api.ts       # interface công khai (ban đầu giữ chỗ)
└── internal/           # mọi thứ còn lại – module khác KHÔNG được nhập
```

## Quy tắc (sinh vào `.dependency-cruiser.cjs`)

| Mã | Từ | Tới | Mức | Ý nghĩa |
|---|---|---|---|---|
| `no-internal-cross-module` | `apps/server/src/modules/X/**` | `apps/server/src/modules/Y/**` trừ `Y/index.ts` (Y ≠ X) | error | FR-011(a) |
| `no-circular` | mọi tệp | vòng phụ thuộc | error | FR-011(b) |
| `core-no-modules` | `apps/server/src/core/**` | `apps/server/src/modules/**` | error | FR-011(c) |
| `infra-no-business` | module `kind = infra` | module khác | error | FR-011(c) |
| `web-only-shared` | `apps/web/**` | `apps/server/**`, `packages/*` ≠ `shared` | error | FR-011(d) |
| `shared-pure` | `packages/shared/**` | `apps/**`; npm ngoài `sharedAllowedPackages`; module lõi Node (`fs`, `net`…) | error | FR-011(e) |
| `allowed-deps-X` | `apps/server/src/modules/X/**` | `modules/Y/index.ts` với Y ∉ `X.allowedDeps` | error | FR-011(f) |
| `ai-sdk-only-in-ai-gateway` | ngoài `modules/ai_gateway/**` | gói khớp `aiProviderPackagePatterns` | error | Nguyên tắc III |
| `no-unresolvable` | mọi tệp | đường dẫn không phân giải được | error | Chặn "nhập lậu" qua đường dẫn tương đối |

`apps/server/src/api.ts`, `worker.ts`, `app/*.module.ts` (tầng ghép) được nhập `index.ts` của mọi module.

## Đầu ra khi vi phạm

Mỗi dòng: `<mã quy tắc>: <tệp nguồn> → <tệp đích> (module <nguồn> → <đích>)` kèm gợi ý sửa, ví dụ:

```text
✖ allowed-deps-content: apps/server/src/modules/content/internal/x.ts → apps/server/src/modules/platform_gateway/index.ts
  (module content → platform_gateway) – thêm "platform_gateway" vào allowedDeps của content (cần review)
  hoặc đi qua giao diện công khai của publishing.
```

Mã thoát: 0 nếu sạch, 1 nếu có vi phạm.

## Bộ mẫu kiểm chứng (SC-002)

`tooling/boundaries/fixtures/<case>/` – mỗi trường hợp là một cây mã nhỏ + kết quả mong đợi; tối thiểu:
`a-internal-import`, `b-cycle`, `c-core-imports-module`, `d-web-imports-server`, `e-shared-imports-node`,
`f-not-in-allowed-deps`, cộng `clean` (phải không báo gì).
