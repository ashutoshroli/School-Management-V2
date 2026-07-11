# Dockerfile for deploying the backend with LibreOffice available, so
# uploaded .docx certificate/document templates (Templates page) can
# actually be converted to PDF - see backend/src/services/docxToPdf.
# service.ts for why this is optional-but-recommended: without
# LibreOffice on PATH, every generator silently falls back to its
# built-in PDFKit layout instead of failing, but a school's own
# uploaded template design is only ever *used* when this is present.
#
# Render's free tier has no Shell access to `apt-get install` anything
# after the fact, but it DOES support deploying from a Dockerfile
# (Render Dashboard > New > Web Service > "Docker" runtime, or set
# `runtime: docker` in render.yaml) - the OS package install below runs
# automatically as part of Render's build step, no shell needed.
#
# Build context: this Dockerfile expects to be built from the
# REPOSITORY ROOT (not from inside backend/), since it needs the
# sibling `db` package - e.g. `docker build -f backend/Dockerfile .`
# Render's Docker runtime is told this via `dockerfilePath`/`dockerContext`
# in render.yaml.

FROM node:20-slim

# --- System dependencies -----------------------------------------------
# libreoffice: headless DOCX -> PDF conversion (the whole point of this
#   Dockerfile - see docxToPdf.service.ts). `--no-install-recommends`
#   keeps the image reasonably small; libreoffice still pulls in a lot
#   since it's a full office suite, but there's no lighter-weight tool
#   that reliably renders arbitrary Word documents (tables, images,
#   page breaks, embedded fonts) as a real PDF.
# fontconfig + fonts-liberation: without at least one usable font,
#   LibreOffice's headless conversion can produce blank/garbled text.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fontconfig \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Install dependencies (db package first, for Prisma) ---------------
# Copying only the package.json/lockfile first (before the rest of the
# source) lets Docker cache this layer across builds when only
# application code changes, not dependencies - keeps redeploys fast.
COPY db/package.json db/package-lock.json ./db/
RUN cd db && npm install --include=dev

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm install --include=dev

# --- Copy source and generate the Prisma client -------------------------
COPY db ./db
COPY backend ./backend

RUN cd db && npx prisma generate

# Prisma's client is generated into db/node_modules/@prisma/client (a
# separate npm package from backend/) - link it into backend's
# node_modules the same way backend/scripts/build.sh already does for
# non-Docker deployments (Render's non-Docker Node runtime, CI), so
# both deployment paths produce an identical backend/node_modules
# layout.
RUN rm -rf backend/node_modules/@prisma/client backend/node_modules/.prisma && \
    cp -r db/node_modules/@prisma/client backend/node_modules/@prisma/client && \
    cp -r db/node_modules/.prisma backend/node_modules/.prisma

# --- Build TypeScript -> dist/ -------------------------------------------
RUN cd backend && npm run build

ENV NODE_ENV=production
# Matches config/index.ts's default PORT (5000) - Render overrides this
# via its own injected PORT env var at runtime regardless, this is just
# documentation for anyone running the image directly.
EXPOSE 5000

# Schema sync (`prisma db push`) runs at container STARTUP, not build
# time, because DATABASE_URL is a runtime secret injected by Render's
# environment - it isn't available during `docker build`. This mirrors
# what backend/scripts/build.sh does for the non-Docker deploy path,
# just shifted from build-time to start-time.
CMD ["sh", "-c", "cd db && npx prisma db push --accept-data-loss --skip-generate && cd ../backend && node dist/server.js"]
