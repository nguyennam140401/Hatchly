# Ảnh web: chạy cục bộ bằng docker compose (đặt API_UPSTREAM) và làm nguồn gốc `origin-app.<tên miền>` ở môi
# trường thật (007, research R7: không đặt API_UPSTREAM; CDN đứng trước khi bật).
# Build từ gốc repo: docker build -f apps/web/Dockerfile .

# ---- Tầng build ----
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY tooling/package.json tooling/
RUN pnpm install --frozen-lockfile --filter @app/web... --filter @app/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @app/shared build \
 && pnpm --filter @app/web build

# ---- Tầng phục vụ tĩnh ----
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# Sinh khối chuyển tiếp /api (khi có API_UPSTREAM) và tiêu đề noindex (khi SEARCH_INDEXING=false) lúc khởi động.
COPY --chmod=755 apps/web/docker-entrypoint.d/15-web-config.sh /docker-entrypoint.d/15-web-config.sh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
