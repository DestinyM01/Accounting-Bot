FROM node:20-alpine AS builder
WORKDIR /app
# Pinned: pnpm 11+ needs Node 22.13; 10.x is the newest line that runs on Node 20.
RUN npm install -g pnpm@10.34.5
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-web-store,target=/root/.local/share/pnpm/store \
    CI=true pnpm install --frozen-lockfile --shamefully-hoist
COPY . .
RUN pnpm run build:prod

FROM nginx:1.25-alpine
COPY --from=builder /app/dist/web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
