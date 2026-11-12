# syntax=docker/dockerfile:1

## ---- deps stage: install node_modules ----------------------------------
# Debian-slim (glibc) rather than alpine: mediasoup ships prebuilt worker
# binaries for glibc linux only. On alpine (musl), npm install would fall
# back to compiling the worker from source every time, which works but
# adds several minutes to every build.
FROM node:26-bookworm-slim AS deps
WORKDIR /app

# Toolchain for mediasoup's from-source fallback (used if no prebuilt
# worker binary is available for this platform/arch, or if the GitHub
# Releases download is blocked by network policy). Also needed to build
# other native addons (bcryptjs has an optional native path, etc).
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip build-essential pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

## ---- runtime stage -------------------------------------------------------
FROM node:26-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# mediasoup's worker binary is a real media-plane process (SRTP, DTLS,
# ICE) — it needs libssl at runtime even when it was fetched prebuilt,
# since the runtime image doesn't inherit the builder's apt packages.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
      libssl3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --create-home --shell /usr/sbin/nologin appuser \
    && npm install -g pm2@7.1.2 \
    && npm cache clean --force

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chown -R appuser:appuser /app
USER 1001

EXPOSE 4000
# The mediasoup RTC port range (see MEDIASOUP_MIN_PORT/MAX_PORT) is UDP/TCP
# media traffic, not HTTP — it's documented here for operators wiring up
# firewall rules and Kubernetes hostPort/hostNetwork, not something a
# reverse proxy would ever forward.
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://localhost:4000/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"]

# PM2 keeps the API up and runs the reminder sweep every 5 minutes
# (see ecosystem.config.js). `docker run ... node src/server.js` still works.
CMD ["pm2-runtime", "ecosystem.config.js", "--env", "production"]
