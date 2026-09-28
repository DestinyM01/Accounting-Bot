# pnpm is pinned once, here, so both installs below are exactly what CI tested.
FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# --frozen-lockfile fails loudly if the lockfile is out of date.
FROM base AS builder
RUN --mount=type=cache,id=pnpm-api-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production dependencies only: the build and test tools (Nest CLI, Jest,
# TypeScript) never run in the final image, so they don't ship in it.
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-api-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod

FROM node:24-alpine
# The user's zone: server-local months and days, and bank-mail times, are Santo Domingo's
# (UTC−4 all year, no DST). tzdata backs TZ; Node's bundled ICU would usually suffice.
RUN apk add --no-cache tzdata
ENV TZ=America/Santo_Domingo NODE_ENV=production
WORKDIR /app
# Dependencies first: they change less often than the code, so their layer stays cached.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# The api writes no files, so it runs as the image's unprivileged node user (uid 1000).
USER node
EXPOSE 4000
CMD ["node", "dist/main"]
