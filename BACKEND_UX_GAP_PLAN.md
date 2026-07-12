# Backend + DB UX Gap Plan

Analysis performed by reading **only** the backend controllers/routes and
`db/prisma/schema.prisma` (no frontend code read for this audit) to find
user-friendly features missing purely at the data/API level: search/filter
gaps, missing single-record detail views, missing bulk operations, and
docx-template placeholder bugs.

Each phase below: implement backend → write/update tests → typecheck+build
backend → wire the minimal frontend needed to actually use the new
capability (these are inherently UI-facing gaps, so a phase isn't "done"
until there's a way to use it) → typecheck+build frontend → commit → PR →
wait for merge before the next phase (same workflow as the earlier 6
backend-hardening + 7 frontend phases).

---

## Phase 1: Vehicle ↔ Route Assignment ✅ COMPLETED (Item A - total gap)

**Priority:** HIGHEST - this is not a missing filter or a nice-to-have, it's
a completely unusable relation. `VehicleRoute` exists as a DB model and is
referenced in delete-cleanup code (`transport.controller.ts`), but **no
endpoint anywhere assigns a vehicle to a route** - there was no way, via the
API, to ever create a `VehicleRoute` row.
**Status:** ✅ **DONE**

### What was actually done:
- Backend: `assignVehicleToRoute` / `unassignVehicleFromRoute` added to
  `transport.controller.ts`. `getVehicles` now includes each vehicle's
  assigned routes (`routes: { include: { route } } }`).
  - New routes: `POST /facilities/transport/vehicle-routes`,
    `DELETE /facilities/transport/vehicle-routes/:vehicleId/:routeId`
  - **Security/data-integrity guards:** both vehicle and route must belong to
    a branch the caller can access; vehicle and route must belong to the
    *same* branch as each other (even for SUPER_ADMIN); duplicate
    assignments are rejected.
- Frontend: new "Manage Routes" button per vehicle card on
  `/dashboard/transport` opens a modal listing currently-assigned routes
  (with unassign) plus a dropdown to assign a new one (already-assigned
  routes filtered out of the dropdown).
- Tests: 11 new tests in `transport.controller.test.ts` covering both
  functions (happy path, 404s, branch-mismatch, cross-branch pairing,
  duplicate rejection).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**63 suites / 617 tests**, up
  from 606) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `transport` page
  5.89kB->6.49kB

---

## Phase 2: Single-Record "View Details" Endpoints ✅ COMPLETED

**Priority:** HIGH - several modules only supported list/create/update, with
no way to drill into one record's full detail (the way `getStudentById`/
`getStaffById`/`getBranchById` already do). Followed that existing pattern.
**Status:** ✅ **DONE**

### What was actually done (all 12, each with branch-access checks matching
the entity's existing mutation endpoints):
1. `getExamById` - subject-wise marks-recorded summary (Exam has no
   `branchId` of its own; scoped via its `Class` relation, same as #2)
2. `getHomeworkById` - full submission list (student name/submitted-at/grade)
3. `getBookById` - full issue history (current + past)
4. `getInventoryItemById` - full purchase + issue history
5. `getFeeStructureById` - installments + assigned-student count
6. `getFeeCategoryById` - structure-usage count
7. `getNoticeById`
8. `getLeaveTypeById` - application-usage count
9. `getVehicleById` - assigned routes (built on Phase 1's `VehicleRoute` use)
10. `getAdmissionInquiryById` - JSON detail (previously PDF-export-only)
11. `getSubjectById` - classes assigned to + teachers currently teaching it
12. `getDiscountById`

**Frontend:** a "View Details" (eye icon) action + modal added to each of
the 12 corresponding pages: `/dashboard/exams`, `/dashboard/homework`,
`/dashboard/library`, `/dashboard/inventory`, `/dashboard/fees/structures`,
`/dashboard/fees/categories`, `/dashboard/notices`, `/dashboard/leaves`
(Leave Types tab), `/dashboard/transport` (Vehicles section),
`/dashboard/admissions`, `/dashboard/subjects`, `/dashboard/fees/discounts`.

**Tests:** 46 new tests across `exam.controller.test.ts`,
`homework.controller.test.ts` (new file), `library.controller.test.ts`,
`inventory.controller.test.ts`, `feeStructure.controller.test.ts`,
`feeCategory.controller.test.ts`, `notice.controller.test.ts`,
`leave.controller.test.ts`, `transport.controller.test.ts`,
`admission.controller.test.ts` (new file), `class.controller.test.ts`,
`discount.controller.test.ts` - each covering the happy path, 404 (missing
record), and a SECURITY case (record belongs to a different branch).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**65 suites / 654 tests**, up
  from 617) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, all 12 touched
  pages build with an expected size increase (e.g. `transport`
  6.49kB->6.86kB, `fees/structures` 4.14kB->4.67kB, `inventory`
  3.51kB->4.06kB)

---

## Phase 3: List/Search Filter Gaps ✅ COMPLETED (class / section / session / category)

**Priority:** HIGH - this was the user's explicit example ("sabhi search
wala section ke paas class/section/session ka filter").
**Status:** ✅ **DONE**

### What was actually done (all 12 filters, each backend + minimal frontend UI):
- `getStaffList` - `designation` filter (`/dashboard/staff` search bar)
- `getPayslips` - `department`/`designation`/staff-name `search` (`/dashboard/payroll`)
- `getLeaveApplications` - `leaveTypeId` filter + `fromDate`/`toDate` range,
  overlap-aware (`/dashboard/leaves`'s "All Applications" tab)
- `getBooks` (library) - `category` filter (`/dashboard/library`'s Books Catalog tab)
- `getIssuedBooks` - `classId`/`studentId` filter + "overdue only" toggle
  (`/dashboard/library`'s Issued Books tab)
- `getItems` (inventory) - `category` filter, previously had none at all
  (`/dashboard/inventory`)
- `getAllDiscounts` - `classId`/`sectionId` filter, with a dependent
  section dropdown (`/dashboard/fees/discounts`)
- `getGeneratedCertificates` - `classId`, certificate-`type`, `fromDate`/
  `toDate` range (`/dashboard/certificates`)
- `getNotices` - title/body `search` + `fromDate`/`toDate` range (`/dashboard/notices`)
- `getSubjectTeachers` - `staffId`/`subjectId` filter
  (`/dashboard/teacher-assign`'s Subject Teacher tab)
- `getAdmissionInquiries` - `classAppliedFor` (partial match, it's free
  text not a real classId) + date range (`/dashboard/admissions`)
- `getFeeStructures` - `feeCategoryId` filter, also bypasses the
  branch-level cache (same as an existing `classId` filter already did)
  when set (`/dashboard/fees/structures`)

**Tests:** 30 new tests across 11 controller test files (each filter's
presence/absence and combination with existing filters, using the branch's
existing conventions).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**65 suites / 685 tests**, up
  from 654) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, all 12 touched
  pages build with an expected size increase

---

## Phase 4: Bulk Operation Gaps ✅ COMPLETED

**Priority:** MEDIUM-HIGH - continuing the "bulk + solo + multi-filter"
pattern already established (bulk salary assignment, bulk hostel
allocation, bulk promotion).
**Status:** ✅ **DONE**

### What was actually done (all 6, each backend + minimal frontend UI):
1. **`bulkAssignDiscount`** - grants the same discount to every ACTIVE
   student matching a classId/sectionId filter in one `createMany` call
   (e.g. "give this scholarship to all Class 10 students"). UI: "Bulk
   Assign Discount" button + modal on `/dashboard/fees/discounts`.
2. **`bulkUpdateLeaveStatus`** - multi-select approve/reject on a
   hand-picked list of PENDING applications; still loops per-application
   for the attendance-marking side effect (each approval needs its own
   ON_LEAVE days marked), but the update itself is one call. UI:
   checkboxes + "Approve/Reject Selected" bar on `/dashboard/leaves`'s
   Pending Approvals tab.
3. **`bulkIssueBook`** - issues one book to a hand-picked list of
   students at once, capped at whatever `availableCopies` actually
   allows (rest reported as skipped, not a hard error). UI: "Bulk Issue"
   (per-book) button + student-search modal on `/dashboard/library`.
4. **`bulkAssignSubjectToClass`** - assigns one subject to multiple
   classes in one call, skipping classes that already have it. UI:
   "Bulk Assign to Classes" button + checkbox-grid modal on
   `/dashboard/subjects`.
5. **`bulkCreateFeeStructure`** - creates the same fee-structure
   template across multiple classes for a session, cloning the same
   installments onto each. UI: "Bulk Create" button + modal on
   `/dashboard/fees/structures`.
6. **`bulkGenerateCertificates`** - generates Transfer/Bonafide/
   Character certificates for every active student in a class
   (CUSTOM/ID_CARD rejected up front). Refactored `generateCertificate`
   into a shared `generateCertificateCore` helper so single and bulk
   generation produce byte-identical results. UI: "Bulk Generate"
   button + modal on `/dashboard/certificates`.

Every bulk endpoint enforces the same branch-access/IDOR checks as its
single-item counterpart (a class/section/student/staff/book supplied in
bulk must belong to a branch the caller can access), and reports
`{created/assigned/issued/generated, skipped, total}`-shaped results so
partial success (e.g. "not enough copies", "already assigned") is visible
rather than silently swallowed or a hard all-or-nothing failure.

**Tests:** 45 new tests across 6 controller test files, covering the
happy path, security/cross-branch rejection, and each endpoint's specific
partial-success/skip logic.

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**65 suites / 713 tests**, up
  from 685) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, all 6 touched
  pages build with an expected size increase (e.g. `library`
  3.78kB->4.86kB, `fees/structures` 4.67kB->5.3kB)

---

## Phase 5: Template/Docx Placeholder Fixes 🟢

**Priority:** MEDIUM - real correctness bugs in the certificate/document
template system found while reading `document.controller.ts` /
`certificateGenerator.service.ts` / `templateRenderer.service.ts`:

### Scope:
1. **Fix ID Card render data** - `{{fatherName}}`, `{{motherName}}`,
   `{{dateOfBirth}}`, `{{photoUrl}}` are documented as available
   placeholders but the controller never actually includes them in the
   render data - they'd always come out blank in a real template
2. **Fix incorrect Templates-page documentation** - the "ID cards use a
   separate structured layout, not this DOCX" text contradicts the actual
   code path (it tries the uploaded .docx template first, structured
   layout is only the fallback)
3. **Document the `{#marks}...{/marks}` loop syntax** for Report Card
   templates on the Templates page - currently completely undocumented,
   so an admin has no way to know how to build a multi-subject marks table
4. **Verify/regenerate the sample .docx files** in
   `frontend/public/sample-templates/` against the corrected placeholder
   list, so downloading a "sample" actually matches what the renderer
   supports

---

## Workflow (same as before)
Implement → tests → typecheck+build backend → minimal frontend wiring →
typecheck+build frontend → commit (`.commit-msg-*.txt` + `git commit -F`) →
new branch → push → PR → wait for "next"/merge before continuing.
