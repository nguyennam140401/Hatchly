# Ảnh công cụ cho MỌI làn kiểm tra trên tác nhân `ci` (008, R9; contracts/quality-gates.md).
# Mỗi làn chạy `pnpm verify --ci --only …` bên trong ảnh này nên máy cá nhân và Jenkins dùng cùng công cụ.
# Chạy KHÔNG phải root. Dựng: docker build -t app-ci-toolchain -f ops/ci/toolchain/Dockerfile ops/ci/toolchain
# Ảnh nền cùng digest với Dockerfile gốc của ứng dụng (đổi cả hai qua cùng một pull request).
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# Phải khớp `packageManager` của package.json gốc và phiên bản @playwright/test của e2e/package.json –
# `check:pipeline` chưa so tự động; đổi một nơi thì đổi nơi kia (và dựng lại ảnh này).
ARG PNPM_VERSION=10.34.9
ARG PLAYWRIGHT_VERSION=1.64.1

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    PNPM_HOME=/opt/pnpm \
    CI=true
ENV PATH="${PNPM_HOME}:${PATH}"

# git: các cổng so với nhánh gốc (db:immutable, db:compat, check:release-source). docker CLI: check:image và
# db:compat gọi Docker rootless của tác nhân qua socket được gắn vào lúc chạy – ảnh không chứa daemon.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git curl docker.io \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && mkdir -p "${PNPM_HOME}" /opt/playwright \
 && npm install --global --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}" \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /opt/playwright \
 && rm -rf /var/lib/apt/lists/*

# Người dùng không phải root; uid trùng người dùng `ci-agent` do Jenkins truyền vào lúc chạy (--user).
RUN useradd --create-home --uid 1000 --shell /bin/bash ci
USER ci
WORKDIR /workspace
