# Một ảnh container cho cả API và Worker (ADR-01, R14).
#   API    : docker run app:<tag>                      (lệnh mặc định node dist/api.js)
#   Worker : docker run app:<tag> node dist/worker.js  (Kubernetes ghi đè `command`)
# Ảnh không chứa mã web – web build riêng, phục vụ tĩnh qua CDN.

# ---- Tầng build ----
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
WORKDIR /repo
RUN corepack enable

# Cài phụ thuộc trước (tận dụng cache khi chỉ đổi mã nguồn).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY tooling/package.json tooling/
RUN pnpm install --frozen-lockfile --filter @app/server... --filter @app/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @app/shared build \
 && pnpm --filter @app/server build \
 && pnpm deploy --filter @app/server --prod /out
# /out có dist/ và drizzle/ (migration + bootstrap/roles.sql – trường "files" của apps/server):
# Job migrate chạy `node dist/db/migrate.js` từ cùng ảnh (WBS 1.5).

# ---- Tầng chạy ----
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime
# Mã phiên bản của bản phát hành (008, R13): quy trình truyền SHA đầy đủ của commit; `api` và `worker` trả
# giá trị này ở điểm sức khỏe để kiểm tra khói biết đúng bản đang chạy. Dựng tay không truyền → "dev".
ARG APP_VERSION=dev
ARG IMAGE_CREATED=
ARG IMAGE_SOURCE=
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.revision=$APP_VERSION
LABEL org.opencontainers.image.created=$IMAGE_CREATED
LABEL org.opencontainers.image.source=$IMAGE_SOURCE
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000 3001
CMD ["node", "dist/api.js"]
