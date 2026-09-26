FROM node:24-alpine AS builder
WORKDIR /app
# Pinned so the lockfile and the install are exactly what was tested.
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-web-store,target=/root/.local/share/pnpm/store \
    CI=true pnpm install --frozen-lockfile --shamefully-hoist
COPY . .
RUN pnpm run build:prod

FROM nginx:1.30-alpine
COPY --from=builder /app/dist/web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
