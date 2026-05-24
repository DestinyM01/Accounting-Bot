FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-web-store,target=/root/.local/share/pnpm/store \
    CI=true pnpm install --frozen-lockfile --shamefully-hoist
COPY . .
RUN pnpm run build:prod

FROM nginx:1.25-alpine
COPY --from=builder /app/dist/web/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
