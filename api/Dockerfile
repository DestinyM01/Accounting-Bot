FROM node:24-alpine AS builder
WORKDIR /app
# pnpm is pinned so the lockfile and the install are exactly what CI tested.
# --frozen-lockfile fails loudly if the lockfile is out of date.
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production dependencies only: the build and test tools (Nest CLI, Jest,
# TypeScript) never run in the final image, so they don't ship in it.
FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
# The user's zone: server-local months and days, and bank-mail times, are Santo Domingo's
# (UTC−4 all year, no DST). tzdata backs TZ; Node's bundled ICU would usually suffice.
RUN apk add --no-cache tzdata
ENV TZ=America/Santo_Domingo
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/main"]
