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

## Phase 2: Single-Record "View Details" Endpoints 🟢

**Priority:** HIGH - several modules only support list/create/update, with
no way to drill into one record's full detail (the way `getStudentById`/
`getStaffById`/`getBranchById` already do). Following that existing
pattern:

### Scope (new `getXById` + minimal detail-view UI for each):
1. `getExamById` (with subject-wise marks summary)
2. `getHomeworkById` (with submission list)
3. `getBookById` (library - with current/past issue history)
4. `getInventoryItemById` (with purchase/issue history)
5. `getFeeStructureById` (with installments + assigned-student count)
6. `getFeeCategoryById`
7. `getNoticeById`
8. `getLeaveTypeById`
9. `getVehicleById` (with assigned routes - depends on Phase 1's model use)
10. `getAdmissionInquiryById` (JSON detail, not just the existing PDF)
11. `getSubjectById` (with classes/teachers currently using it)
12. `getStudentDiscountById`

---

## Phase 3: List/Search Filter Gaps (class / section / session / category) 🟢

**Priority:** HIGH - this was the user's explicit example ("sabhi search
wala section ke paas class/section/session ka filter"). Add the missing
filters to each list endpoint below (all confirmed missing by reading the
controller code):

### Scope:
- `getStaffList` - add `designation` filter
- `getPayslips` - add `department`/`designation`/staff-name search
- `getLeaveApplications` - add `leaveTypeId` filter + date range
- `getBooks` (library) - add `category` filter
- `getIssuedBooks` - add `classId`/`studentId` filter + "overdue only" toggle
- `getItems` (inventory) - add `category` filter (currently has none at all)
- `getAllDiscounts` - add `classId`/`sectionId` filter
- `getGeneratedCertificates` - add `classId`, certificate-type, date-range filters
- `getNotices` - add search + date-range filter
- `getSubjectTeachers` - add `staffId`/`subjectId` filter
- `getAdmissionInquiries` - add `classAppliedFor` filter + date range
- `getFeeStructures` - add `feeCategoryId` filter

---

## Phase 4: Bulk Operation Gaps 🟢

**Priority:** MEDIUM-HIGH - continuing the "bulk + solo + multi-filter"
pattern already established (bulk salary assignment, bulk hostel
allocation, bulk promotion). These are the confirmed-missing bulk paths:

### Scope:
1. **Bulk discount assignment** - `assignDiscount` is solo-only; add
   `bulkAssignDiscount` (e.g. "give this scholarship to all Class 10 students")
2. **Bulk leave approval** - add `bulkUpdateLeaveStatus` (multi-select
   approve/reject instead of one at a time)
3. **Bulk library issue** - add `bulkIssueBook` (issue copies to a whole
   class/list of students at once)
4. **Bulk subject-to-class assignment** - add `bulkAssignSubjectToClass`
   (assign one subject to multiple classes in one call)
5. **Bulk fee structure creation** - add `bulkCreateFeeStructure` (same
   category/amounts across multiple classes for a session)
6. **Bulk certificate generation** - add `bulkGenerateCertificates` for
   Transfer/Bonafide/Character (class-wise), matching the ID-card batch
   pattern that already exists

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
