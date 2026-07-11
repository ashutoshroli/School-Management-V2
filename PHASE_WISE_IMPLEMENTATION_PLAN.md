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

## Phase 5: Background Jobs + Performance (Day 10-11) 🟡

**Priority:** HIGH  
**Duration:** 2 days  
**Status:** 🔴 Not Started

### Tasks:

#### 1. Setup Bull Queue System
**New Files:**
```
backend/src/queues/
├── index.ts
├── notification.queue.ts
├── report.queue.ts
└── email.queue.ts
```

**Will Queue:**
- Bulk SMS sending
- Bulk email sending
- PDF report generation
- Data exports

#### 2. Create Queue Workers
**New Files:**
```
backend/src/workers/
├── notificationWorker.ts
├── reportWorker.ts
└── emailWorker.ts
```

#### 3. Update Controllers for Async Operations
**Files to Update:**
- `feeReports.controller.ts`
- `notification.controller.ts`
- `certificate.controller.ts`

**Change:**
```typescript
// Before: Synchronous
const pdf = await generateReport();
res.send(pdf);

// After: Async with job queue
const job = await reportQueue.add({ reportId });
res.json({ jobId: job.id, status: 'processing' });
```

#### 4. Add Database Indexes
**New File:** `db/prisma/indexes.sql`

**Will Add:**
```sql
CREATE INDEX idx_payment_paid_at ON "Payment"("paidAt");
CREATE INDEX idx_payment_status ON "Payment"("status");
CREATE INDEX idx_student_attendance_date ON "StudentAttendance"("date");
CREATE INDEX idx_fee_assignment_status ON "FeeAssignment"("status");
```

#### 5. Optimize Prisma Queries
**Files to Update (~20 files):**
- Add `select` for specific fields
- Use `include` judiciously
- Implement cursor pagination

### Deliverables:
- ✅ Background jobs working
- ✅ No request timeouts
- ✅ Database optimized
- ✅ Git branch: `feat/phase-6-background-jobs`

---

## Phase 6: S3 Storage + API Docs (BONUS - if time)

**Priority:** MEDIUM  
**Duration:** 2 days  
**Status:** 🔴 Not Started

### Tasks:

#### 1. Implement S3 Storage Provider
**New File:** `backend/src/services/storage/s3Provider.ts`

**Will Support:**
- AWS S3 upload
- Signed URLs
- File deletion
- CloudFront integration

#### 2. Add Swagger API Documentation
**New Files:**
- `backend/src/docs/swagger.ts`
- `backend/src/docs/schemas/*.yaml`

**Will Document:**
- All endpoints
- Request/response schemas
- Authentication
- Error codes

### Deliverables:
- ✅ S3 storage working
- ✅ API docs at /api/docs
- ✅ Git branch: `feat/phase-7-s3-swagger`

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

