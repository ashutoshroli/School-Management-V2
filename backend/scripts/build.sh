#!/usr/bin/env bash
# Build script for deploying the backend (e.g. on Render/Railway).
# Run this from the REPOSITORY ROOT (not from inside backend/), since it
# needs to touch both the `db` and `backend` packages, which are
# siblings - not a parent/child relationship.
#
# The Prisma client is generated from db/prisma/schema.prisma inside the
# `db` package (a separate npm package from `backend`), so it has to be
# generated there and then copied into backend/node_modules - this
# mirrors exactly what .github/workflows/ci.yml already does for CI.
set -euo pipefail

echo "==> Installing db package dependencies"
# --include=dev overrides npm's default behaviour of skipping
# devDependencies when NODE_ENV=production is set in the environment
# (which render.yaml does, since the app needs to run in production
# mode). TypeScript, @types/*, and Prisma's CLI all live in
# devDependencies for db/ and backend/ - without this flag, `npx prisma
# generate`/`npm run build` fail because none of those got installed.
(cd db && npm install --include=dev)

echo "==> Generating Prisma client"
(cd db && npx prisma generate)

echo "==> Installing backend dependencies"
(cd backend && npm install --include=dev)

echo "==> Linking generated Prisma client into backend/node_modules"
rm -rf backend/node_modules/@prisma/client backend/node_modules/.prisma
cp -r db/node_modules/@prisma/client backend/node_modules/@prisma/client
cp -r db/node_modules/.prisma backend/node_modules/.prisma

echo "==> Syncing database schema"
# NOTE: this repo's db/prisma/migrations/ directory is gitignored (no
# migration history is committed), so `prisma migrate deploy` has
# nothing to apply. For a trial/demo deployment, `db push` syncs the
# schema directly against the database without needing migration
# files - fine for this purpose, but NOT how a real production
# deployment with a proper migration history should work.
(cd db && npx prisma db push --accept-data-loss --skip-generate)

echo "==> Building backend (TypeScript -> dist/)"
(cd backend && npm run build)

echo "==> Build complete"
