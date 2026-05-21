# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Build-time deps (compiler, headers) — stays in this layer only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    build-essential \
    g++ \
    pkg-config \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production --legacy-peer-deps

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Runtime-only shared libraries — no compiler, no headers
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libjpeg62-turbo \
    libpango1.0-0 \
    libgif7 \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled app and pruned node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000

CMD ["node", "dist/main"]
