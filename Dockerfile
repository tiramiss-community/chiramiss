# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:26-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Node 26 no longer bundles corepack, so install it first; it then fetches pnpm per packageManager.
RUN npm install -g corepack && corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# `pnpm deploy` (pnpm 10+) needs either `inject-workspace-packages=true` or `--legacy`.
# We pass the setting via env so the workspace config stays untouched: with injection,
# the deployed /out gets a hard copy of the lib (including packages/chiramiss/built)
# instead of a symlink to the sources.
ENV npm_config_inject_workspace_packages=true
RUN pnpm --filter @tiramiss-community/chiramiss-server deploy --prod /out

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/tiramiss-community/chiramiss"
ENV NODE_ENV=production SUMMALY_HOST=0.0.0.0 SUMMALY_PORT=3000
WORKDIR /app
COPY --from=build /out/ ./
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "built/index.js"]
