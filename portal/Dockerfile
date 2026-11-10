# syntax=docker/dockerfile:1

## ---- build stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The API's base URL is baked into the static bundle at build time (Vite
# inlines import.meta.env.* during `vite build`), not read at container
# runtime — so it has to be supplied as a build arg, not an env var on the
# running container. Point this at your backend's public URL.
ARG VITE_API_BASE=http://localhost:4000/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

## ---- runtime stage ---------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# hadolint ignore=DL3025
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
