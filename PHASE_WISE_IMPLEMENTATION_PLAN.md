# Phase-wise Implementation Plan - School Management V2

**Analysis Date:** July 11, 2026  
**Current Status:** 85% Complete  
**Total Phases:** 6 phases (2 weeks work)

---

## Overview

Har phase mein:
1. ✅ Missing files add karenge
2. ✅ Code implement karenge
3. ✅ Tests likhenge
4. ✅ Build + test chalayenge
5. ✅ Git branch banake PR ready karenge

**Aapko sirf bolna hai:** "Phase 1 build karo" ya "next phase"

---

## Phase 1: Monitoring + Structured Logging ✅ COMPLETED

**Priority:** CRITICAL  
**Duration:** ~1 day (actual)  
**Status:** ✅ **DONE**

> **Correction:** The original Phase 1/2 plan below assumed SMS/WhatsApp/Push
> providers were `console.log()` stubs. Re-inspection of the actual code
> (`backend/src/services/notification/{sms,whatsapp,push}Provider.ts`) and
> `README.md`'s "Known limitations" section confirmed all three are already
> **real integrations** (MSG91, Interakt, Firebase Cloud Messaging) with
> full test coverage - they just no-op/fail-fast without gateway credentials
> in `.env`, which is by design. So that work was skipped as unnecessary,
> and Phase 1 was redirected to the next most critical gap: monitoring.

### What was actually done:

1. ✅ Added `winston` + `@sentry/node` dependencies to `backend/package.json`
2. ✅ **New file** `backend/src/config/logger.ts` - structured Winston logger
   (colorized dev output, JSON in prod/test, `logError()` helper)
3. ✅ **New file** `backend/src/config/sentry.ts` - opt-in Sentry error
   tracking (`initSentry`, `setupSentryErrorHandler`, `captureException`),
   no-ops cleanly if `SENTRY_DSN` is unset
4. ✅ Wired `initSentry()`/`setupSentryErrorHandler()` into `app.ts`
5. ✅ `server.ts` now logs startup via `logger.info` and captures
   `unhandledRejection`/`uncaughtException`
6. ✅ Replaced `console.error`/`console.log` with `logger`/`logError` in
   `errorHandler.ts`, `notification.service.ts`, `pushProvider.ts`
7. ✅ Added `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` to
   `.env.example` + `config/index.ts`
8. ✅ **New tests:** `backend/src/config/__tests__/logger.test.ts`,
   `backend/src/config/__tests__/sentry.test.ts`
9. ✅ Verified: `npx tsc --noEmit` clean, `npm test` → **49 suites / 447 tests pass**,
   `npm run build` clean

### Deliverables:
- ✅ Structured logging in place (replaces ad-hoc console.log)
- ✅ Sentry error tracking ready (opt-in via env var)
- ✅ All existing + new tests passing
- ✅ Build clean
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 2: WhatsApp + Push Notifications — ⏭️ SKIPPED (already implemented)

**Status:** ⏭️ **Not needed** - verified real MSG91/Interakt/FCM integrations
already exist with tests. No action taken. See correction note in Phase 1.

---

## Phase 3: Database Backups + docker-compose ✅ COMPLETED

**Priority:** CRITICAL  
**Duration:** ~1 day (actual)  
**Status:** ✅ **DONE**

### What was actually done:

1. ✅ **New file** `docker-compose.yml` (root) - Postgres 15 + Redis 7,
   named volumes, health checks. Redis isn't consumed by any backend
   code yet (reserved for the caching/background-jobs phase) but comes
   up for free with the same `docker compose up`.
2. ✅ **New file** `scripts/backup-database.sh` - timestamped, gzip-
   compressed `pg_dump`, strips Prisma's `?schema=` query param (libpq
   doesn't understand it), verifies the dump is non-empty and has a
   valid pg_dump header, prunes backups older than 30 days (configurable).
3. ✅ **New file** `scripts/restore-database.sh` - restores a `.sql`/`.sql.gz`
   backup with a confirmation prompt (`--yes` to skip), verifies table
   count after restore.
4. ✅ Updated `DEPLOY.md` with a "Local development database
   (docker-compose)" section and a "Database backups & restore" section.
5. ✅ Fixed a stale/incorrect line in `DEPLOY.md` claiming SMS/WhatsApp
   are stubs (they aren't - see Phase 1's correction note).
6. ✅ Added `backups/` to `.gitignore` (runtime artifacts, may contain PII).
7. ✅ Added `npm run db:backup` / `npm run db:restore` convenience scripts
   to the root `package.json`.

### Verification performed (real, not just config validation):
- `docker compose config` - valid Compose Spec v2 syntax
- `docker compose up -d` - **actually started** real Postgres 15 +
  Redis 7 containers (via podman's Docker-compatible API in this
  sandbox), confirmed with `pg_isready` and `redis-cli ping`
- **Full backup/restore cycle test**: created a table + row → ran
  `backup-database.sh` → dropped the table (simulated data loss) →
  confirmed the table was gone → ran `restore-database.sh` → confirmed
  the exact row came back
- `bash -n` syntax check on both scripts
- Backend `npx tsc --noEmit` / `npm test` (49 suites / 447 tests) /
  `npm run build` re-verified clean (no backend code touched this phase,
  confirming no regression)

> Note: this sandbox's nested container environment has some rootless-podman
> quirks (flaky host<->container port publishing, occasional DNS resolution
> failures between containers) unrelated to the compose file itself - worked
> around during testing by running scripts inside the Postgres container's
> own network namespace. A normal Docker Desktop / Docker Engine setup (what
> an actual developer will use) does not have this limitation.

### Deliverables:
- ✅ docker-compose.yml working (verified end-to-end)
- ✅ Automated backup script working (verified end-to-end)
- ✅ Restore tested (verified end-to-end, data actually came back)
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 4: Missing Validators + Caching ✅ COMPLETED

**Priority:** HIGH  
**Duration:** ~1 day (actual)  
**Status:** ✅ **DONE**

### What was actually done:

#### 1. Created 11 new/expanded validator files
```
backend/src/validators/
├── staff.validator.ts (new - createStaff/updateStaff)
├── payroll.validator.ts (new - salary structure, run payroll)
├── attendance.validator.ts (new - staff+student mark/bulk/card-tap)
├── leave.validator.ts (new - apply leave, approve/reject)
├── exam.validator.ts (new - create/update exam, enter marks)
├── timetable.validator.ts (new - get-or-create, upsert slot)
├── homework.validator.ts (new - create/update/submit)
├── library.validator.ts (new - add book, issue book)
├── inventory.validator.ts (new - add item, purchase/issue stock)
├── transport.validator.ts (new - route, stop, allocate, vehicle)
├── hostel.validator.ts (new - building, floor, room, allocate)
├── notice.validator.ts (new - create notice)
└── attendanceDevice.validator.ts (new - create/update device)
```

#### 2. Wired `validate()` into 5 route files
`hr.routes.ts`, `academics.routes.ts`, `facilities.routes.ts`,
`communication.routes.ts`, `staff.routes.ts` - every previously-
unvalidated create/update endpoint across HR, academics, facilities,
communication, and staff management now runs its Zod schema before
reaching the controller.

#### 3. Implemented Redis caching layer
- **New file** `backend/src/config/redis.ts` - `ioredis` client,
  opt-in via `REDIS_URL`, no-ops cleanly when unset (same pattern as
  Sentry/SMS/WhatsApp/Push)
- **New file** `backend/src/services/cache.service.ts` -
  `cacheGet`/`cacheSet`/`cacheDel`/`cached()` cache-aside helper,
  `CacheKeys`/`CacheTTL` constants, and branch-scoped
  `invalidateBranchesCache`/`invalidateClassesCache`/`invalidateFeeStructuresCache`
  helpers
- Wired into: `branch.controller.ts` (`getBranchById` cached 1 day;
  create/update/delete invalidate), `class.controller.ts`
  (`getClasses` cached 1 hour; class+section create/update/delete
  invalidate), `feeStructure.controller.ts` (`getFeeStructures`
  cached 1 hour for the whole-branch/whole-year query shape;
  create/update/delete invalidate)
- Added `REDIS_URL` to `.env.example` + `config/index.ts`; Redis 7
  was already added to `docker-compose.yml` in Phase 3 (unused until
  now)

#### 4. Added tests
`config/__tests__/redis.test.ts`, `services/__tests__/cache.service.test.ts`
(covers cache hit/miss, error fallback, wildcard invalidation via
SCAN, and the disabled/no-Redis-configured path)

### Verification performed:
- `npx tsc --noEmit` - clean
- `npm test` - **51 suites / 470 tests pass** (2 new suites added: 4
  redis tests + 19 cache.service tests; zero regressions in the other
  49 pre-existing suites, confirming validators didn't break any
  controller-level test that calls controllers directly)
- `npm run build` - clean

### Deliverables:
- ✅ 13 new validator files covering every previously-unvalidated module
- ✅ Redis caching working (branches, classes, fee structures) with
  branch-scoped invalidation on every write
- ✅ All existing + new tests passing, build clean
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 5: Background Jobs + Performance ✅ COMPLETED

**Priority:** HIGH  
**Duration:** ~1 day (actual)  
**Status:** ✅ **DONE**

### What was actually done:

#### 1. Bull queue system
```
backend/src/queues/
├── index.ts               (getQueue/QUEUE_NAMES, opt-in via REDIS_URL)
├── notification.queue.ts   (enqueueFeeReminders - queues or runs inline)
└── report.queue.ts         (enqueueDefaultersCsvExport)
```
Deliberately did NOT add a separate `email.queue.ts` - emails are already
sent as part of `notification.service.ts`'s multi-channel `notify()` per
recipient, which the notification queue's job (fee reminders) already
calls; a distinct email-only queue would just be a second path to the
same delivery code with no clear separate use case yet.

#### 2. Queue workers (standalone process, not inside the API server)
```
backend/src/workers/
├── index.ts                 (standalone entrypoint - run separately from server.ts)
├── notificationWorker.ts    (processes "fee-reminders" jobs)
└── reportWorker.ts          (processes "defaulters-csv" jobs, saves via storage.service.ts)
```
No separate `emailWorker.ts` for the same reason as above.

#### 3. Updated controller for async operation
`feeCollection.controller.ts`'s `sendFeeRemindersHandler` now calls
`enqueueFeeReminders()`: with Redis configured, returns `202 { queued: true, jobId }`
immediately; without Redis, runs `sendFeeReminders()` inline exactly as
before (identical response shape/behavior to pre-Phase-5).

`feeReports.controller.ts`'s `fetchDefaulters`/`DEFAULTER_CSV_COLUMNS` were
exported (not duplicated) so `reportWorker.ts` builds the exact same CSV
a background job would as the existing synchronous
`exportDefaultersCsv` endpoint - didn't wire a new queued HTTP endpoint
for this in this phase (the existing synchronous CSV export endpoint is
untouched/still works), the worker + queue infrastructure is ready for a
future "queue this if it's a big branch" endpoint to use.

#### 4. Database indexes (schema.prisma, not a separate .sql file -
Prisma migrations/db push apply them the same way as any other schema
change):
```prisma
model Payment          { @@index([branchId, paidAt]) @@index([branchId, status]) @@index([studentId]) }
model FeeAssignment     { @@index([status]) }
model StudentAttendance { @@index([sectionId, date]) @@index([studentId, date]) }
model StaffAttendance   { @@index([date]) }
```
Each targets a real, named query site (see the doc-comments next to each
index in schema.prisma) - the fee reports/day-book/collection-trend
queries, the defaulters list, and the attendance-marking/history views.

#### 5. Query optimization - NOT done broadly in this phase (scoped out)
A full audit of `select`/`include` usage and cursor pagination across
~20 files was judged lower-value than the queue+index work for the time
available, and risks introducing subtle behavior changes (dropped fields
a frontend page depends on) without a much larger review. Left as a
future incremental improvement, not blocking.

### Verification performed (real, not just unit tests):
- `npx tsc --noEmit` / `npm test` (56 suites / 485 tests, up from 51/470 -
  5 new suites: `queues/__tests__/index.test.ts`,
  `queues/__tests__/notification.queue.test.ts`,
  `queues/__tests__/report.queue.test.ts`,
  `workers/__tests__/notificationWorker.test.ts`,
  `workers/__tests__/reportWorker.test.ts`) / `npm run build` - all clean
- `npx prisma validate` + `npx prisma generate` - schema with new indexes
  is valid, client regenerates and links into backend/node_modules cleanly
- **Real Bull + Redis end-to-end test**: started the Phase 3
  docker-compose Redis service, ran a Node script requiring the actual
  *compiled* `dist/queues/index.js` (not just the bare Bull library) -
  confirmed `isRedisConfigured() === true`, `getQueue()` returns a real
  Bull queue, and a job added via `queue.add()` was picked up by a
  `queue.process()` handler and returned its result via
  `job.finished()` - the exact producer/consumer pattern
  `notification.queue.ts`/`notificationWorker.ts` use.

### Deliverables:
- ✅ Background job queue working (real Redis test passed)
- ✅ Fee reminders no longer risk a request timeout when Redis is configured
- ✅ Database indexes added for the highest-traffic query patterns
- 🔲 Git branch + PR - pending user's "PR banao" instruction
- ✅ Database optimized
- ✅ Git branch: `feat/phase-6-background-jobs`

---

## Phase 6: S3 Storage + API Docs ✅ COMPLETED (BONUS)

**Priority:** MEDIUM  
**Duration:** ~1 day (actual)  
**Status:** ✅ **DONE**

### What was actually done:

#### 1. S3 storage provider
- **New file** `backend/src/services/storage/s3Provider.ts` - `S3StorageProvider`
  implementing the existing `StorageProvider` interface (save/deleteByUrl/readByUrl),
  using AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`).
  Works with real AWS S3 or any S3-compatible service (Cloudflare R2, MinIO,
  DigitalOcean Spaces, Backblaze B2) via `S3_ENDPOINT` + `forcePathStyle`.
  Also exposes `getSignedDownloadUrl()` for a future private-bucket use case
  (not wired into any endpoint yet - available for one to use).
- `storage.service.ts` gained a `getStorageProvider()` factory selecting
  between `LocalStorageProvider` (unchanged, still the default) and the new
  `S3StorageProvider` based on `STORAGE_PROVIDER` - **fails closed** to local
  storage if S3 config is incomplete, rather than crashing every upload on
  a config typo. Uses a lazy `require()` for the S3 provider so deployments
  that only ever use local storage don't pay for loading the AWS SDK.
- Added `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL` to `.env.example` + `config/index.ts`.
- No controller changes needed anywhere - every existing upload endpoint
  (`upload.controller.ts`) already only talks to the `StorageProvider`
  interface, exactly as that file's original design comment intended.

#### 2. Swagger/OpenAPI API documentation
- **New file** `backend/src/docs/swagger.ts` - builds the OpenAPI spec via
  `swagger-jsdoc`, reading `@swagger` JSDoc comments directly above route
  definitions (kept next to the code they describe, not a separate giant
  YAML file) plus shared schemas merged in from `docs/schemas/`.
- **New files** `backend/src/docs/schemas/common.schemas.ts` (SuccessResponse/
  ErrorResponse/PaginatedResponse - the three response envelope shapes every
  endpoint in this API actually uses) and `auth.schemas.ts` (Login/ChangePassword/
  SwitchBranch/UserSummary request+response shapes).
- Fully documented `auth.routes.ts` end-to-end (login, profile, switch-branch,
  change-password, avatar upload) as the first complete example module -
  other route files can follow the same `@swagger` JSDoc pattern incrementally.
- Mounted in `app.ts`: `GET /api/docs` (Swagger UI) and `GET /api/docs.json`
  (raw spec, importable into Postman/Insomnia). Gated by `isDocsEnabled()` -
  **on by default outside production, off by default in production**
  (an API surface map is itself information a public deployment may not
  want to expose), overridable via `DOCS_ENABLED=true`/`false`.

### Verification performed (real, not just unit tests):
- `npx tsc --noEmit` / `npm test` (**59 suites / 508 tests**, up from 56/485
  - zero regressions) / `npm run build` - all clean
- **Real running server test**: started the actual compiled `dist/server.js`
  and hit it with `curl` - confirmed `GET /api/docs.json` returns a valid
  OpenAPI document, `GET /api/docs/` returns real Swagger UI HTML
  (`<title>Swagger UI</title>`, the actual bundle scripts), and
  `GET /api/health` still works unaffected. Repeated with `NODE_ENV=production`
  - confirmed `/api/docs.json` now 404s (disabled by default) while
  `/api/health` continues to work normally.

### Deliverables:
- ✅ S3 storage provider implemented and unit-tested (mocked AWS SDK - no
  real AWS account needed for this repo's test suite)
- ✅ API docs live at `/api/docs`, verified against a real running server
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Execution Flow

### Jab aap kehte ho "Phase 1 build karo":
1. ✅ Main Phase 1 ke saare files create/update karunga
2. ✅ Code implement karunga
3. ✅ Tests likhunga
4. ✅ `npm test` chalaunga
5. ✅ `npm run build` chalaunga
6. ✅ Git branch banaunga
7. ✅ Ready for PR bolke rukunga

### Jab aap kehte ho "next phase" ya "build":
1. ✅ Current phase commit karunga
2. ✅ Next phase start karunga
3. ✅ Same steps repeat

### Jab aap kehte ho "PR ready" ya "merge":
1. ✅ Git add + commit karunga
2. ✅ Branch push karunga
3. ✅ PR create karunga (via GitHub API)
4. ✅ PR link dunga

---

## Current Phase: READY TO START

**Boliye:** "Phase 1 build karo" ya "Phase 1 start karo"

Main shuru karunga! 🚀

---

## Notes

- Har phase independent hai (koi dependency nahi)
- Phase 1-4 are CRITICAL (production ke liye zaruri)
- Phase 5-6 are HIGH PRIORITY (performance ke liye)
- Phase 7 is BONUS (nice to have)

**Estimated Total Time:** 11 days (2 weeks with buffer)

