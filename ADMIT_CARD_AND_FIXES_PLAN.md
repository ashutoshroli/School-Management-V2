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

## Phase 2: Admit Card Generation - single + templates

- New `AdmitCardTemplate` reuse of the existing `DocumentTemplate`
  model's `ADMISSION_FORM`-style pattern - a new `DocTemplateType`
  value `ADMIT_CARD` (separate from `ID_CARD`/`REPORT_CARD` which
  already exist) so admit cards get their own uploadable .docx template,
  independent of the exam **result**/report-card template (which
  already exists as its own type) - "separate templates for each exam
  result and admit card" is already half-true today (report card has
  its own template type) - this phase adds the missing admit-card-
  specific type.
- New `AdmitCard` model: one row per (examId, studentId) - `serialNo`,
  `pdfUrl`, `status` (ELIGIBLE / PROVISIONAL / DENIED), `remarks`,
  `allowedSubjectIds` (nullable - null means "all scheduled subjects",
  a non-null list means "only sit for these specific subjects", for the
  "sirf is exam ke is subject ko appear karne ki anumati hai" case),
  `generatedAt`, `generatedBy`.
- `POST /academics/exams/:examId/admit-cards/generate` (single student) +
  `GET .../admit-cards/:studentId/pdf` (download, using the new template).

## Phase 3: Admit Card eligibility rules + bulk generation

- New `AdmitCardRule` config per exam (or reusable rule sets): a
  **checklist of independently toggleable rules** (multiple-choice
  checkboxes, exactly as requested):
  - ☑ Minimum attendance % (default 75%, editable) - computed from
    `StudentAttendance` over a configurable date range (defaults to the
    academic year so far).
  - ☑ Fees cleared through a specific month (admin picks "cleared till
    month X" from a dropdown - checks `FeeAssignment`/`Payment` status
    for monthly-frequency fee structures up to and including that month).
  - Both rules can be enabled together, either alone, or neither
    (in which case every enrolled student is simply eligible).
- `POST /academics/exams/:examId/admit-cards/bulk-generate` `{ruleConfig}` -
  evaluates every active student in the exam's class against the
  enabled rules:
  - **Passes all enabled rules** → full `ELIGIBLE` admit card, every
    scheduled subject allowed.
  - **Fails one or more rules** → admin's choice (a second checklist,
    same request): either (a) `DENIED` (no admit card at all, with a
    `remarks` string explaining which rule(s) failed - e.g. "Attendance
    68% - below 75% requirement"), or (b) `PROVISIONAL` - a limited
    admit card restricted to only the subjects **already sat/scheduled
    before the failure was detected** ("kewal is exam ke is subject ko
    appear karne ki anumati" - i.e. `allowedSubjectIds` is the subset
    already eligible, and after that the student needs a **fresh
    generation cycle** re-run once they've fixed the issue - e.g. paid
    the outstanding fee - to be re-evaluated and get a new/updated
    admit card, rather than the system auto-updating them silently).
  - Returns a per-student outcome list (eligible/denied/provisional +
    the specific reason), same "show what happened to each one"
    convention as `bulkAllocateRoom`/`bulkGenerateCertificates`.
- Regeneration is idempotent per (examId, studentId) - re-running bulk
  generation after a student's situation changes (fee paid, attendance
  corrected) produces an updated admit card reflecting the new
  evaluation, rather than requiring a delete-first step.

## Phase 4: Frontend - Admit Card UI

- New tab/section on the Exam Timetable page (or a new
  `/dashboard/exams/[id]/admit-cards` page) - admin picks which rules to
  enable (checklist), the attendance % threshold, the "fees cleared
  till" month, and the ineligible-student policy (deny vs. provisional),
  then runs bulk generation - shows the resulting eligible/provisional/
  denied breakdown with remarks, single-student regenerate, and a bulk
  PDF download.
- Admit Card template upload UI alongside the existing Certificate/
  Document Templates page.

## Workflow
Same as every prior phase: implement backend -> tests -> typecheck+build
backend -> frontend wiring -> typecheck+build frontend -> commit ->
branch -> PR -> wait for merge/"next" before continuing.
