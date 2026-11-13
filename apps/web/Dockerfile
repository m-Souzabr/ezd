# The EZDesign web app: the Vite build served by Caddy, which also proxies /api to the API
# so the browser sees one origin (the session and CSRF cookies need that). Build from the
# repository root:
#
#   docker build -f apps/web/Dockerfile -t ezd-web .

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ezd/web...
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @ezd/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
# PORT is set by the host; API_UPSTREAM is the API's address, for example
# http://api.railway.internal:8000
ENV PORT=8080
EXPOSE 8080
