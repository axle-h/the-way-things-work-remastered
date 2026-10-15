# syntax=docker/dockerfile:1.7
# The built web app and the static server, and no disc data: the extracted disc is DK's material, so it
# lives on a volume mounted at /data (`k8s/sync-data.sh` fills it) and never in an image layer.
# `.dockerignore` is an allow-list for the same reason.
#
# Base images are pinned by version and by digest. To update one, change both.

# ── 1. the web app ───────────────────────────────────────────────────────────────────────────────
# glibc, as on the machines the lockfile is made on: Vite's native bindings are per libc.
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS web

# pnpm at the version `packageManager` in package.json pins, through Corepack (PLAN §3).
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /src

# The manifests first, so the install layer is reused until a dependency changes. These are the web
# app and the workspace packages it depends on; a new dependency between them fails the frozen
# install below until it is added here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/engine/package.json packages/engine/
COPY packages/formats/package.json packages/formats/
RUN corepack install

# The frozen lockfile, with dependency lifecycle scripts blocked: pnpm 11 reads `strictDepBuilds`,
# `allowBuilds` and `minimumReleaseAge` from pnpm-workspace.yaml.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '@twtw/web...' --store-dir /pnpm/store

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm --filter @twtw/web build && test -f apps/web/dist/index.html

# The server runs from its TypeScript source (Node strips the types) and imports only node: modules.
RUN mkdir -p /out/server/src \
    && cp apps/server/package.json /out/server/ \
    && find apps/server/src -maxdepth 1 -name '*.ts' ! -name '*.test.ts' -exec cp {} /out/server/src/ \; \
    && cp -r apps/web/dist /out/web

# ── 2. node ──────────────────────────────────────────────────────────────────────────────────────
# Only its binary and the two C++ runtime libraries it links are taken: none of npm, Corepack, yarn or
# the headers, which deleting in a later layer would hide but not remove.
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS node

# ── 3. the image ─────────────────────────────────────────────────────────────────────────────────
# The same Alpine release as the node image above, so its musl matches the binary.
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6

COPY --from=node /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /usr/lib/
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# `k8s/` relies on uid 10001.
RUN addgroup -S -g 10001 twtw \
    && adduser -S -D -H -u 10001 -G twtw -h /app twtw \
    && mkdir -p /data \
    && node --version

COPY --from=web /out/server /app/server
COPY --from=web /out/web /app/web

# Filled in by CI. Below the COPYs, so a new commit does not invalidate the build stage.
ARG SOURCE_URL=""
ARG GIT_REVISION=""
ARG BUILD_DATE=""
LABEL org.opencontainers.image.source="$SOURCE_URL" \
      org.opencontainers.image.revision="$GIT_REVISION" \
      org.opencontainers.image.created="$BUILD_DATE" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="The Way Things Work, remastered: the web app and its static server (disc data not included)"

# The server only reads, so /data may be (and in k8s is) a read-only mount, and the root filesystem
# may be read-only too. An empty /data still serves the app, /healthz and /robots.txt.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TWTW_CD=/data \
    TWTW_DIST=/app/web
VOLUME /data
EXPOSE 8080

USER 10001:10001
WORKDIR /app

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Exec form, so node is PID 1 and gets SIGTERM (`main.ts` handles it).
CMD ["node", "server/src/main.ts"]
