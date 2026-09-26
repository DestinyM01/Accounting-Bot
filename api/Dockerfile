FROM node:20-alpine AS builder
WORKDIR /app
# pnpm is pinned: the newest line that runs on this image's Node 20 (pnpm 11+ needs Node 22.13).
# It reads the v9 lockfile; --frozen-lockfile installs exactly the tested dependency versions
# and fails loudly if the lockfile is out of date.
RUN npm install -g pnpm@10.34.5
COPY package.json pnpm.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:20-alpine
# The user's zone: server-local months and days, and bank-mail times, are Santo Domingo's
# (UTC−4 all year, no DST). tzdata backs TZ; Node's bundled ICU would usually suffice.
RUN apk add --no-cache tzdata
ENV TZ=America/Santo_Domingo
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/main"]
