# Admit Card System + Bug Fixes + UX Additions Plan

## Root cause analysis (done before writing this plan)

### Bug 1: Admission inquiry submitted from the landing page doesn't show in the dashboard
`getAdmissionInquiries` calls `resolveBranchId(req)`, which for a SUPER_ADMIN
**always** resolves to their session's "active branch" (set at login to the
first active branch, or whatever they last switched to via
`POST /auth/switch-branch`) - it is NEVER `undefined` in practice once at
least one branch exists. The public admission form lets a visitor pick
**any** active branch from a dropdown. If that visitor's chosen branch
differs from whichever branch happens to be the Super Admin's current
session default, the inquiry is silently filtered out of the list - not
missing from the database, just invisible to that specific admin session.
Confirmed by reading `resolveEffectiveBranchId`'s actual behavior (always
falls back to `req.user.branchId`, contradicting its own doc comment's
"caller decides how to treat all branches" intent) against
`admission.controller.ts`'s `getAdmissionInquiries`.

**Fix:** For SUPER_ADMIN specifically, admission inquiries are an
org-wide lead-capture feed - default to showing inquiries **across every
branch** unless the Super Admin explicitly filters to one (via a new
branch filter dropdown on the page, using the existing
`GET /admission/branches` list). BRANCH_ADMIN keeps today's behavior
(always locked to their own branch - unaffected, unambiguous, no
behavior change for them).

### Bug 2: Exam Timetable still shows "Exam not found"
The Timetable/Marks pages fetch the **entire unscoped exam list**
(`GET /academics/exams`, no branch filter at all today) and do a
client-side `.find(e => e.id === examId)` instead of fetching that one
exam directly. `getExamById` already exists, is properly branch-scoped,
and is the correct endpoint for this - the "list then find" pattern is
fragile (any transient inconsistency between the list result and the
specific ID shows as a false "not found") and unnecessarily slow (fetches
every exam in the branch just to find one). Also, `getExams` itself has
**zero branch scoping** - a real cross-branch data-leak bug in its own
right, independent of the "missing exam" symptom.

**Fix:** (a) add branch scoping to `getExams` (security fix), (b) switch
the Timetable and Enter Marks pages to call `GET /academics/exams/:id`
directly instead of list+find.

---

## Phase 1: Bug fixes + Sidebar nav + Hostel bulk floor/room UI ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
**Bug 1 fix (admission inquiry visibility):**
`getAdmissionInquiries` now shows inquiries across **every branch** for
a SUPER_ADMIN by default (no branch filter applied unless they
explicitly pass `?branchId=`) - a BRANCH_ADMIN is completely unaffected,
still always locked to their own branch server-side. Frontend: the
Admissions page gained a branch-filter dropdown (Super Admin only,
populated from `GET /branches`) and a "Branch" column in the table so
it's clear which branch each inquiry belongs to when viewing across all
of them.

**Bug 2 fix (exam timetable "not found" + a real security bug found
along the way):**
`getExams` had **zero branch scoping** - confirmed as a genuine
cross-branch data-leak bug independent of the reported symptom, now
fixed (scoped through `Exam -> Class -> branchId`, same convention as
`getExamById`). The Timetable and Enter Marks pages were also switched
from "fetch the entire exam list, find by id client-side" to calling
`GET /academics/exams/:id` directly - the list+find pattern was
fragile (any transient inconsistency showed as a false "not found")
and unnecessarily slow.

**Sidebar navigation additions:**
- "Staff Attendance" (links to the existing, already-working
  `/dashboard/staff/attendance` page - self check-in, monthly report,
  CSV export - previously only reachable via a direct URL).
- "Exam Attendance" (links to the Exams list, where "Timetable" ->
  the per-subject "Exam Attendance" panel is reached - exam attendance
  has no single dedicated page of its own since it's inherently
  per-subject-sitting, so this is the correct entry point rather than a
  new standalone page).

**Hostel bulk floor/room creation:**
- New `bulkAddFloors`/`bulkAddRooms` controller functions
  (`POST /facilities/hostel/floors/bulk` / `/rooms/bulk`), mirroring
  `bulkAddSchoolFloors`/`bulkAddSchoolRooms` exactly (same validation,
  same branch-ownership guards, same `createMany` pattern) - `HostelFloor`
  has no `name` field (unlike `SchoolFloor`), so no name-prefix option
  here, just sequential floor numbers.
- Frontend: "Add Multiple Floors" and "Add Multiple Rooms" buttons/
  modals on `/dashboard/hostel`, in the exact same layout already
  shipped for School Buildings (repeatable row editor for rooms,
  count/starting-number form for floors) - both existing single-add
  flows are kept, not replaced.

**Tests:** 6 new tests in `exam.controller.test.ts` (branch-scoping
across TEACHER/BRANCH_ADMIN/SUPER_ADMIN, explicit classId bypass, no
session branchId edge case), 3 new tests in `admission.controller.test.ts`
(Super-Admin-sees-all default, explicit branchId narrowing, Branch-Admin
still locked), 8 new tests in `hostel.controller.test.ts` (bulk floor
numbering/prefix, bulk room creation, cross-branch guards on both).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**74 suites / 954 tests**,
  up from 938) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `admissions`
  page grew to 6.47kB, `hostel` page grew to 7.94kB

## Phase 2-4: Admit Card Generation + Eligibility Rules + Frontend ✅ COMPLETED

**Status:** ✅ **DONE - shipped as one combined PR since the pieces are
tightly interdependent (schema/controller/frontend all reference the
same rule config shape).**

### What was actually done:

**Separate admit-card template (Phase 2):**
- New `DocTemplateType` value `ADMIT_CARD` - now genuinely separate from
  `REPORT_CARD` (results). Templates page gained a new "Admit Card" slot
  with its own placeholder guide (`{{studentName}}`, `{{examName}}`,
  `{{status}}`, `{{remarks}}`, plus a `{#subjects}...{/subjects}` loop
  for the per-subject date/time/room table) and a hand-built sample
  `ADMIT_CARD.docx` (verified to render correctly via docxtemplater).

**AdmitCard model + single generation (Phase 2):**
- New `AdmitCard` model: one row per `(examId, studentId)` -
  `serialNo` (unique), `pdfUrl`, `status` (`ELIGIBLE`/`PROVISIONAL`/
  `DENIED`), `remarks`, `allowedSubjectIds` (empty array = every
  scheduled subject allowed; a non-empty list restricts to only those
  subjects), `generatedAt`/`generatedBy`.
- `POST /academics/exams/:examId/admit-cards/generate` (single student) -
  admin-driven; defaults to `ELIGIBLE` with no rules unless explicitly
  passed a `ruleConfig`.
- `GET .../admit-cards/:studentId/pdf` - template-first/PDFKit-fallback
  PDF (same convention as every other document generator), showing only
  `allowedSubjectIds`' schedule rows for a `PROVISIONAL` card, and a
  visible reason banner. A `DENIED` card returns 403 (nothing to
  download).

**Eligibility rule engine + bulk generation (Phase 3):**
- New `admitCardEligibility.service.ts` - a checklist of two
  independently toggleable rules:
  - Minimum attendance % (default 75%, editable) - counts PRESENT+LATE
    as present, over a configurable date range (defaults to the exam's
    academic year start through today).
  - Monthly fees cleared through a chosen `YYYY-MM` - pro-rates each
    MONTHLY-frequency `FeeAssignment` (monthly rate x months elapsed
    since the academic year start through the target month inclusive)
    against `paidAmount + discount`; a student with no MONTHLY fee
    assignments passes trivially.
  - Both/either/neither can be enabled - a student passes only if every
    enabled rule passes.
- `POST /academics/exams/:examId/admit-cards/bulk-generate` -
  evaluates every active student in the class:
  - Passes all enabled rules → `ELIGIBLE`, every scheduled subject
    allowed.
  - Fails → admin's choice: `DENY` (no card, `remarks` explains which
    rule(s) failed) or `PROVISIONAL` (restricted to every subject
    already scheduled for the exam - "kewal is exam ke jo subject
    schedule ho chuke hain unhi ko appear karne ki anumati" - a fresh
    generation run after the issue is fixed is required to get an
    updated card; nothing auto-upgrades).
  - Returns a per-student outcome + totals (eligible/provisional/denied
    counts), same "show what happened to each one" convention as
    `bulkAllocateRoom`.
- Regeneration is idempotent via `upsert` on `(examId, studentId)` - a
  student's situation changing (fee paid, attendance corrected) and
  re-running bulk generation produces an updated card, no delete-first
  step needed.

**Frontend (Phase 4):**
- New "Admit Cards" section on the Exam Timetable page
  (`/dashboard/exams/[id]/schedule`) - admin-only "Bulk Generate" button
  opens a modal with the rules checklist (attendance % + month picker,
  each independently toggleable), a deny-vs-provisional radio choice,
  and a result summary after running. The list below shows every
  generated card's status/remarks with a PDF download (any role) and a
  delete action (admin).
- Templates page gained the "Admit Card" upload slot alongside the
  existing certificate/document slots.

**Tests:** 48 new tests - `admitCardEligibility.service.test.ts` (new,
14: both rules independently and together, edge cases like zero
attendance records and multiple fee assignments), `admitCard.controller.test.ts`
(new, 34: single/bulk generation for all three outcomes, cross-branch
guards, DENIED-blocks-PDF-download, PROVISIONAL-filters-schedule).

### Verification performed:
- Backend: `npx prisma generate` (schema valid) / `npx tsc --noEmit` /
  `npm test` (**76 suites / 988 tests**, up from 954) / `npm run build` -
  all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `exams/[id]/schedule`
  page grew to 11.2kB, `templates` page grew to 6.64kB

---

## This plan is now fully complete
Both bugs are fixed, the sidebar/hostel UX additions shipped, and the
full Admit Card system (separate template, single + bulk generation,
75% attendance rule, fees-cleared-till-month rule, deny/provisional
policy) is live.

## Workflow
Same as every prior phase: implement backend -> tests -> typecheck+build
backend -> frontend wiring -> typecheck+build frontend -> commit ->
branch -> PR -> wait for merge/"next" before continuing.
