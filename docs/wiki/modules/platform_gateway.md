---
type: module
title: Module platform_gateway (Cổng nền tảng)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/platform_gateway/public-api.ts,
    apps/server/src/modules/platform_gateway/index.ts,
    apps/server/src/modules/platform_gateway/platform_gateway.module.ts,
    apps/server/docs/gateways.md,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-14
status: draft
related: [modules/publishing.md, concepts/publish-idempotency.md, decisions/index.md]
---

# platform_gateway – Cổng nền tảng

## Trách nhiệm

Kết nối kênh (Facebook Page, Instagram, Zalo OA), giữ mã quyền truy cập mã hóa (chỉ module này giải mã), bộ chuyển đổi
mỗi nền tảng sau giao diện chung (ADR-05). Kết quả nghiệp vụ là hợp đóng có `kind`.

## Schema/bảng

Schema `platform_gateway`. Thiết kế: `channel_connections`. **Chưa có bảng trong mã**: bản giả lập lưu ở schema
`sandbox.pg_fake_*`; bản thật là WBS 2.2 (bảng + mã quyền qua KMS).

## Giao diện công khai

`index.ts`: `PlatformGatewayModule`, toàn bộ `public-api.ts` (`PLATFORM_GATEWAY`, `PlatformGatewayPublicApi`:
`checkAccount`, `mediaRules`, `submit`, `checkStatus`, `reconcile`, `classifyError`, `refreshToken`, `capabilities`,
`contentHash`, `getConnection`; `CHANNEL_TYPES` = facebook_page, instagram, zalo_oa, test_channel), `validateMedia`,
`applyErrorMapping`, 3 lỗi (`ChannelNotSupportedError`, `ConnectionNotFoundError`, `InvalidRequestError`), bản giả
(`fakePlatform`, `FakeOauthController`, `PlatformScenarioSpec`…). Không nhận `accountId`, không trả mã quyền.

## Phụ thuộc cho phép

`notifications`, `queue`. Chỉ `publishing` được gọi nhóm thao tác đăng.

## Chạy ở

api + worker. Chọn bản cài đặt bằng `PLATFORM_GATEWAY_DRIVER`: hiện chỉ `fake`; staging/production từ chối khởi động nếu
dùng bản giả (trừ `STAGING_ALLOW_FAKES`).

## Tính năng liên quan

[005](../features/005-gateway-contracts-fakes.md).

## Nguồn

- apps/server/src/modules/platform_gateway/public-api.ts
- apps/server/docs/gateways.md (mục 1, 5, 6)
