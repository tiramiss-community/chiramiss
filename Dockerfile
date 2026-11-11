# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:26-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Node 26 no longer bundles corepack, so install it first (pinned); it then fetches pnpm per packageManager.
RUN npm install -g corepack@0.36.0 && corepack enable
# Manifests and lockfile first, so the install layer is reused until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/chiramiss/package.json packages/chiramiss/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# `pnpm deploy` (pnpm 10+) needs either `inject-workspace-packages=true` or `--legacy`.
# We pass the setting via env so the workspace config stays untouched: with injection,
# the deployed /out gets a hard copy of the lib (including packages/chiramiss/built)
# instead of a symlink to the sources.
ENV npm_config_inject_workspace_packages=true
RUN pnpm --filter @tiramiss-community/chiramiss-server deploy --prod /out

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/tiramiss-community/chiramiss"
# Listen on all interfaces by default. The default is given under the lowest-precedence name (SUMMALY_HOST, which the
# server reads only when CHIRAMISS_HOST is unset or empty), so that CHIRAMISS_HOST or SUMMALY_HOST given at run time
# overrides it. The port is left to the server's default (3000) for the same reason: an image-level CHIRAMISS_PORT
# would hide a SUMMALY_PORT given at run time.
ENV NODE_ENV=production SUMMALY_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out/ ./
USER node
EXPOSE 3000
# Follows the port the server reads: CHIRAMISS_PORT, then SUMMALY_PORT, then 3000 (empty means unset, as in the server's config).
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+(process.env.CHIRAMISS_PORT||process.env.SUMMALY_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "built/index.js"]
