---
inclusion: always
---

# Database Data Changes - Use API, Not Direct DB/Prisma Scripts

**Rule:** Whenever data needs to be added, changed, or seeded in the database (demo data, test fixtures, sample records, fixing bad data, etc.), always go through the existing backend REST API endpoints — never write/run raw Prisma scripts or direct SQL/DB inserts to mutate data.

## Why

- This app runs on hosting platforms (e.g. Render free tier) with **no Shell/SSH access**, so any data change must be reachable purely over HTTP.
- Going through the API guarantees the same validation, multi-tenant branch scoping (`branchScope.ts`), audit logging (`auditLog.service.ts`), and business rules (e.g. `recordFeePayment`, chart-of-accounts posting) that real usage would trigger. Raw DB writes bypass all of this and can easily produce inconsistent/invalid state.
- The project already follows this pattern deliberately — see `backend/src/services/demoData.service.ts` and its endpoints:
  - `POST /api/demo-data/seed` — idempotently creates the structural demo org/branch/classes/subjects/fee categories/chart of accounts/leave types/permissions (server-side equivalent of running `db/prisma/seed.ts` locally).
  - `POST /api/demo-data/generate` — bulk-fills an existing branch with realistic transactional demo data (students, staff, fees, payments, attendance, exams, homework, notices, transport, library) by calling the same service functions/business logic real requests use.
  - `GET /api/demo-data/status` / `POST /api/demo-data/remove` — status check and safe teardown.
- `db/prisma/seed.ts` still exists for local-only development bootstrapping, but it is NOT the mechanism to use for any new data changes going forward — treat it as legacy/reference only, kept in sync by hand with `demoData.service.ts`'s structural seed lists.

## What this means in practice

- Need new demo/sample data for a phase (e.g. sample attendance devices, sample vouchers)? Either use the existing `/api/demo-data/*` endpoints, or add a new authenticated controller endpoint that does the creation (with proper validation + branch scoping), then call it — do not write a one-off script that talks to Prisma directly.
- Need to backfill/fix existing rows (e.g. default chart of accounts for a branch missing one)? Follow the existing pattern from `POST /accounting/accounts/setup-defaults` — a real authenticated endpoint — not a manual `prisma.account.updateMany(...)` script.
- Automated tests are the one exception: unit/integration tests may mock or seed a test DB directly, since that's test-only ephemeral state, not real application data.
