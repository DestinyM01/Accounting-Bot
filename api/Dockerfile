FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm.json ./
RUN pnpm install
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
