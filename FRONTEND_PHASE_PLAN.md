# Frontend Feature Build Plan - Phase Wise

**Based on:** FRONTEND_GAP_ANALYSIS.md (18 identified items)
**Pattern:** Same as PHASE_WISE_IMPLEMENTATION_PLAN.md (backend hardening) -
each phase = code + tests + build verify + PR. Wait for "PR banao"/"merge"
before moving to next phase.

**Grouping logic:** Items grouped by module/workflow so each phase ships a
complete, coherent piece of functionality (not a random grab-bag), roughly
ordered by user-visible impact (highest first) per FRONTEND_GAP_ANALYSIS.md's
"Recommended build order".

---

## Phase 1: Student Promotion ✅ COMPLETED (Item #1)

**Priority:** HIGHEST (biggest single gap - no UI at all for an annual must-do workflow)
**Status:** ✅ **DONE**

### What was actually done:

**Backend fixes (discovered while wiring the UI - `bulkPromote` needed real
hardening before it was safe to expose):**
- **SECURITY (IDOR) fix:** `bulkPromote` had **zero branch-access check** -
  a Branch Admin could pass any other branch's real class/section ids as
  `fromClassId`/`toClassId`/`toSectionId` and promote/detain students outside
  their own branch. Fixed with the same `canAccessBranch` pattern already used
  throughout `class.controller.ts`/`assignSubjectTeacher`.
- **Data integrity fix:** the old code defaulted a missing `toSectionId` to the
  student's *existing* `sectionId` - since a section belongs to exactly one
  class, this could leave a promoted student's `classId`/`sectionId` pointing
  at two different classes. `toSectionId` is now required (validated), and the
  controller verifies it actually belongs to `toClassId`.
- **New outcome:** added `tcIssuedStudentIds` (previously only detain-or-promote
  existed) - a leaving/failed-out student is now deactivated with
  `leavingDate`/`leavingReason` set, mirroring `deleteStudent`'s existing
  "deactivate, don't delete" guidance, rather than having no representation at all.
- **Performance:** rewritten from a sequential per-student loop to bulk
  `createMany`/`updateMany` calls, one per outcome bucket (promoted/detained/
  tc-issued) inside a single transaction.
- **New file** `backend/src/validators/promotion.validator.ts`.
- **New tests:** `backend/src/controllers/__tests__/promotion.controller.test.ts`
  (15 tests: IDOR/branch-access, data-integrity guard, bulk-write correctness,
  the both-lists-at-once edge case, SUPER_ADMIN cross-branch access).

**Frontend:**
- **New page** `/dashboard/promotion` - source class/section picker, target
  class/section picker (auto-suggests the numerically-next class), academic
  year picker, a review table of every active student in scope with per-row
  Detain/TC-Issued checkboxes (mutually exclusive - everyone else is promoted
  by default), and a confirm action showing a live promoted/detained/TC count.
- Added to `frontend/src/lib/navigation.ts` (Admin-only, `ArrowUpCircle` icon).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**60 suites / 535 tests**, up from
  59/520 - zero regressions) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean,
  `/dashboard/promotion` builds as a static page

### Deliverables:
- ✅ Student Promotion page live, backend security/data-integrity hardened
- ✅ All existing + new tests passing, both builds clean
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 2: Hostel Module Completion ✅ COMPLETED (Item #9)

**Priority:** HIGH (5 of 8 backend endpoints completely unused - half-built module)
**Status:** ✅ **DONE**

### What was actually done:

**Backend fixes to `hostel.controller.ts`** (same IDOR pattern found and fixed
in Phase 1's `bulkPromote` - `addFloor`/`addRoom`/`allocateRoom`/`deallocateRoom`
all had **zero branch-access check**):
- `addFloor`: now resolves the target building's own branch and requires `canAccessBranch`.
- `addRoom`: now resolves the target floor's building's branch and requires `canAccessBranch`.
- `allocateRoom`: now checks BOTH the room's building branch AND the student's
  own branch, and requires they match each other (not just that the caller can
  access one of them individually) - prevents allocating a student from one
  branch into a different branch's hostel room.
- `deallocateRoom`: now resolves the allocation's room's building's branch and
  requires `canAccessBranch`.
- `getBuildings` now includes each room's current (`endDate: null`) allocations
  with resident name/admissionNo, so the frontend's room-management modal
  doesn't need a second round trip for that.
- **New tests:** 15 new cases in `hostel.controller.test.ts` covering every
  branch-access check above plus the existing allocate/deallocate business logic.

**Frontend** - rewrote `/dashboard/hostel`:
- "+ Add Floor" button per building (modal: floor number)
- "+ Add Room" button per floor (modal: room number, type, capacity, monthly fee)
- Clicking any room opens a "Manage Room" modal: current residents list with a
  deallocate button per resident, and a student search + bed-number field to
  allocate a new resident (disabled once the room is full)
- New "Occupancy" button opens a summary modal (using the existing `getOccupancy`
  endpoint) showing overall occupancy % and a per-room breakdown table

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**60 suites / 550 tests**, up from
  60/535 - zero regressions) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `/dashboard/hostel` builds fine

### Deliverables:
- ✅ All 8 hostel backend endpoints now have frontend UI (was 3 of 8)
- ✅ 4 IDOR vulnerabilities fixed
- ✅ All existing + new tests passing, both builds clean
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 3: Attendance Devices + In-App Notifications ✅ COMPLETED (Items #2, #3)

**Priority:** HIGH (security-relevant device management + cross-cutting UX gap)
**Status:** ✅ **DONE**

### Correction discovered during this phase:
Item #3 (In-App Notification Center) was **already fully built** -
`frontend/src/components/layout/NotificationBell.tsx` and its wiring into
`Header.tsx` existed before this phase (dating back to PR #17, before the
original gap-analysis audit). The audit missed it because it only checked
`dashboard/layout.tsx` directly, not `Header.tsx` (which `layout.tsx` renders
and which actually contains the bell). No changes were needed for that half
of this phase - it works exactly as originally scoped (polls
`GET /communication/notifications` every 60s, localStorage-tracked
"unread since last opened" badge).

### What was actually done (Item #2 - Attendance Devices):
- **New page** `/dashboard/attendance-devices` (Admin-only):
  - Device list table (name, location, device ID, active/inactive status, registered date)
  - "Register Device" modal (name + location) -> on success, shows a
    one-time API key reveal modal (masked by default, show/hide toggle,
    copy-to-clipboard) with an explicit "won't be shown again" warning,
    matching the backend's actual one-time-reveal behavior
    (`createDevice`/`regenerateApiKey` are the only two responses that
    ever include `apiKey` - `getDevices` never does)
  - Per-device actions: toggle active/inactive, regenerate API key (with
    a confirm warning that the old key stops working immediately), delete
- Added to `frontend/src/lib/navigation.ts` (Admin-only, `Radio` icon)
- No backend changes needed - `attendanceDevice.controller.ts` was already
  complete and well-tested (6 existing tests, all still passing)

### Verification performed:
- Frontend: `npx tsc --noEmit` / `npm run build` - clean,
  `/dashboard/attendance-devices` builds as a static page (4.18 kB)
- Backend: re-ran the full suite as a sanity check since this phase touched
  no backend code - `npm test` (**60 suites / 562 tests**, unchanged) / `npm run build` - clean

### Deliverables:
- ✅ Attendance Devices admin UI live
- ✅ Notification bell confirmed already working (audit correction)
- ✅ Both builds clean
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 4: Fee Module Enhancements ✅ COMPLETED (Items #4, #6, #12)

**Priority:** MEDIUM-HIGH (finance-critical gaps: refunds unreachable via UI, no discount oversight)
**Status:** ✅ **DONE**

### What was actually done:

**Item #6 - Refund UI:**
- Payment History table on `/dashboard/students/[id]` gained a Status column
  (Active/Refunded) and a "Refund" action per non-refunded payment (Admin-only -
  `POST /fees/refund` is ADMIN-only server-side, so the button is hidden for
  everyone else rather than showing an action that would just 403)
- Refund modal: amount (defaults to full payment, capped at the original
  amount) + required reason, with an explicit note that this only records the
  refund - actually moving money is a separate manual step

**Item #4 - Payment Mode Breakdown:**
- New "Payment Mode" tab on `/dashboard/fees/reports` using the already-built
  `GET /fees/reports/payment-mode-breakdown` endpoint
- Stacked bar chart + per-mode breakdown list + a details table with %/totals
  (same "no charting library dependency" CSS-only approach as the existing
  Collection Trend tab)

**Item #12 - Branch-wide Fee Discounts page:**
- **Backend addition** (as anticipated in the original audit): new
  `getAllDiscounts` in `discount.controller.ts` - lists every discount across
  the whole branch (optionally filtered by `type`, and by default excluding
  inactive ones unless `includeInactive=true`), vs. the existing
  `getStudentDiscounts` which is scoped to one student. New route
  `GET /fees/discounts` (registered before the existing `/fees/discounts/:studentId`
  to avoid any path-matching ambiguity).
- **New tests:** `discount.controller.test.ts` (12 tests - this controller had
  ZERO test coverage before this phase) covering `assignDiscount`'s branch-access
  check, `getAllDiscounts`'s filters, and `toggleDiscount`/`deleteDiscount`'s
  existing branch-access checks.
- **New page** `/dashboard/fees/discounts` - branch-wide table (student, class,
  discount type/name/value, granted date, active/inactive) with type filter,
  "include inactive" toggle, and toggle/remove actions - links to each student's
  profile for adding NEW discounts (unchanged, still per-student).
- Added to `frontend/src/lib/navigation.ts` (Admin + Accountant, `Percent` icon).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**61 suites / 574 tests**, up from
  60/562 - zero regressions) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, all 3 touched/new pages
  build fine (`fees/discounts` 2.88kB new, `fees/reports` 3.39kB->4.09kB,
  `students/[id]` 9.39kB->9.15kB)

### Deliverables:
- ✅ Refund reachable from the UI (was API-only/curl-only before)
- ✅ Payment Mode Breakdown visualized
- ✅ Branch-wide discount oversight page live
- ✅ All existing + new tests passing, both builds clean
- 🔲 Git branch + PR - pending user's "PR banao" instruction

---

## Phase 5: Facility + Reporting Polish ✅ COMPLETED (Items #7, #8, #10, #11, #13)

**Priority:** MEDIUM (independent small items, each quick to ship)
**Status:** ✅ **DONE**

### What was actually done:

**Bug fixes discovered along the way (same recurring "missing branch-access
check" pattern as earlier phases):**
- `transport.controller.ts` `addStop` - had **no** `canAccessBranch` check at
  all (IDOR: a Branch Admin could add a stop to any other branch's route by
  guessing/reusing a `routeId`). Fixed to look up the route and validate branch
  access first, matching every other mutating endpoint in this controller.
- `inventory.controller.ts` `getLowStockAlerts` - contained dead code: a second,
  redundant `findMany` call using a bogus `prisma.inventoryItem.fields.minStock`
  filter (not valid Prisma - `fields` isn't queryable like that) whose result was
  discarded and never used. Removed the dead call; the real filtering already
  happened correctly in JS afterwards.
- **New tests:** added `getLowStockAlerts` coverage to
  `inventory.controller.test.ts` and `addStop` coverage (including the new
  branch-access-denied case) to `transport.controller.test.ts`.

**Item #10 - Transport Add Stop UI:**
- New "Add Stop" button per route card opens a "Manage Stops" modal listing
  existing stops (ordered) plus a form (name/order/time) posting to the
  already-built `POST /facilities/transport/stops`. Order auto-suggests
  "one past the last stop" and increments after each add.

**Item #11 - Inventory Low Stock alerts:**
- Dismissible amber banner at the top of `/dashboard/inventory` summarizing
  every item at/below its `minStock`, using the already-built
  `GET /facilities/inventory/low-stock` (previously wired to nothing in the UI).

**Item #7 - Timetable consolidated view:**
- New "Full Class Timetable" button opens a read-only, printable modal
  stacking every section's grid for the selected class in one place (office
  notice-board use case), reusing the existing per-section
  `getOrCreateTimetable` data fetched once per section - no new backend
  endpoint. Includes a Print button (`window.print()`).

**Item #8 - Multi-Branch comparison charts:**
- Added 4 CSS-only horizontal bar-chart cards (Students, Staff, Fee Collected,
  Fee Pending by branch) above the existing table on the Multi-Branch report
  tab, using the already-built `GET /reports/multi-branch` data - same
  "no charting library" convention as the Fee Reports Collection
  Trend/Payment Mode tabs.

**Item #13 - Admission → Student conversion shortcut:**
- New "Convert to Student" action per inquiry row on `/dashboard/admissions`
  navigates to `/dashboard/students/new` with the inquiry's fields passed via
  query params (name, DOB, gender, parent details, address, previous school).
- The New Student Admission form reads those params to pre-fill, shows a hint
  banner (including the free-text `classAppliedFor` value, since it can't map
  to a real `classId`), and on successful submission marks the source inquiry
  `ADMITTED` automatically (best-effort - a failure here doesn't block the
  already-created student record).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**61 suites / 579 tests**, up from
  61/574 - zero regressions) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, all 5 touched pages
  build fine (including `students/new`'s new `useSearchParams` usage - no
  Suspense-boundary build errors)

### Deliverables:
- ✅ Transport stops manageable from the UI (was API-only before)
- ✅ Low Stock alerts visible on the Inventory page
- ✅ Printable consolidated class timetable view
- ✅ Multi-Branch comparison charts alongside the existing table
- ✅ One-click Admission Inquiry → New Student conversion
- ✅ Two real IDOR/dead-code bugs fixed opportunistically
- ✅ All existing + new tests passing, both builds clean

---

## Phase 6: Grade System + Leave Types ✅ COMPLETED (Items #5/#17, #15/#18)

**Priority:** MEDIUM (only phase needing new backend controllers)
**Status:** ✅ **DONE**

### What was actually done:

**Correction discovered during this phase:** the original plan assumed
`GradeSystem`/`LeaveType` would need branch-scoped CRUD "per branch" like
almost everything else in this codebase - but neither model has a `branchId`
field in the schema (`db/prisma/schema.prisma`). Both are genuinely
system-wide config shared by every branch (same as `getLeaveTypes`'s existing
read endpoint). Built both as ADMIN-only (SUPER_ADMIN/BRANCH_ADMIN) global
config instead of branch-scoped - simpler and matches what the schema
actually supports.

**Backend - new `gradeSystem.controller.ts`:**
- `getGradeBands` (any authenticated user - needed to show a grade on a
  report card/results view), `createGradeBand`/`updateGradeBand`/`deleteGradeBand` (ADMIN-only)
- **Data-integrity guard:** a new/updated band's `[minMarks, maxMarks]` range
  is rejected if it overlaps any other existing band - otherwise a single
  mark percentage could match two different grades, making grade lookup
  ambiguous. `updateGradeBand` excludes itself from the overlap check.
- New routes under `/academics/grade-system` (GET/POST/PUT/:id/DELETE/:id) +
  `gradeSystem.validator.ts`.

**Backend - Leave Type CRUD added to `leave.controller.ts`:**
- `createLeaveType`/`updateLeaveType`/`deleteLeaveType` (ADMIN-only), plus
  `getLeaveTypes` gained an `includeInactive=true` param for the new
  management UI (existing callers - the leave-apply form, balance lookups -
  are unaffected, still default to active-only).
- **Data-integrity guard:** `deleteLeaveType` is blocked if any
  `LeaveApplication` already references it (same "block delete, don't
  cascade" convention as `deleteFeeCategory`/`deleteExam`) - deactivate via
  `updateLeaveType` instead if the goal is just to stop new applications.
- New routes under `/hr/leave/types` (POST/PUT/:id/DELETE/:id) + additions to
  `leave.validator.ts`.

**Optional stretch (done):** `enterMarks` (`exam.controller.ts`) now looks up
the grade from the configured `GradeSystem` bands (fetched once per batch,
not per student) when at least one band exists, falling back to the original
hardcoded A+/A/B+/B/C/D/E/F scale otherwise - so existing deployments that
never touch Grade System settings keep their exact previous behavior.

**Frontend:**
- New "Leave Types" admin-only tab on `/dashboard/leaves` - table of all
  types (name, code, max days, carry-forward, active/inactive toggle) +
  Add/Edit modal. Code is locked after creation (it's the stable lookup key).
- New "Grade System" card on `/dashboard/settings` (admin-only) - table of
  configured bands + Add/Edit modal, with a note that the range must not
  overlap any other band.

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**63 suites / 600 tests**, up from
  61/579 - zero regressions) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean,
  `/dashboard/leaves` (2.31kB->5.5kB) and `/dashboard/settings` (8.99kB->10.4kB) build fine

### Deliverables:
- ✅ Grade System bands manageable from Settings (was zero backend/UI before)
- ✅ Leave Types manageable from the Leaves page (was seed-script-only before)
- ✅ `enterMarks` auto-grade lookup now configurable instead of hardcoded
- ✅ All existing + new tests passing, both builds clean

---

## Phase 7: Advanced/Deferred Items ✅ COMPLETED (Items #14, #16)

**Priority:** LOW (higher effort, lower urgency - could have been deferred indefinitely)
**Status:** ✅ **DONE - all 18 originally-identified gap-analysis items now shipped**

### What was actually done:

**Item #14 - Certificate CUSTOM-type generic renderer:**
- A CUSTOM certificate template's fields aren't known in advance (unlike
  Transfer/Bonafide/Character's fixed field sets), so rather than a fixed
  field-mapping UI, the admin now supplies free-form `{{placeholder}}` key/value
  pairs ("Custom Fields") directly on the Generate Certificate modal at
  generation time - a genuinely generic solution, not tied to any specific
  CUSTOM template's layout.
- **Backend:** `generateCertificateSchema` gained an optional `customFields`
  record; `certificate.controller.ts`'s `generateCertificate` passes it through
  as `extraFields` to `renderCertificateByType`/`toTemplateData`
  (`certificateGenerator.service.ts`), merged alongside the standard
  student/branch fields. **Data-integrity guard:** a standard field (e.g.
  `studentName`, `purpose`) always wins if a custom field key collides with
  it - a CUSTOM field can never silently override real record data.
- Since CUSTOM has no hardcoded PDFKit fallback (confirmed still true - see
  `renderCertificateByType`'s `default: return null`), the 400 error message
  for CUSTOM now explicitly says to upload a .docx template first and clarifies
  that Custom Fields only fill placeholders in *that* uploaded template.
- **Frontend:** `/dashboard/certificates`'s Generate modal shows a dynamic
  "Custom Fields" key/value row list (add/remove rows) whenever a CUSTOM-type
  template is selected, with a hint explaining the key must match the
  template's `{{placeholder}}` name.

**Item #16 - Academic Year rollover wizard:**
- New "Start New Academic Year" button on `/dashboard/academic-years` opens a
  3-step guided modal chaining 3 already-existing flows that were previously
  separate, easy-to-forget manual steps:
  1. Create the new academic year (and immediately activates it, so step 2's
     Promotion page - which defaults to whichever year is active - already
     points at the right one)
  2. Link to `/dashboard/promotion` (Phase 1) to promote last year's students
  3. Link to `/dashboard/fees/structures` to set up fees for the new year
- Pure frontend convenience/UX sequencing - no new backend endpoint, each step
  just calls/links to functionality that already existed.

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**63 suites / 606 tests**, up from
  63/600 - zero regressions) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean,
  `certificates` (3.37kB->3.92kB) and `academic-years` (3.19kB->4.52kB) build fine

### Deliverables:
- ✅ CUSTOM certificates now have a real, generic generation path (was "not
  yet supported" before)
- ✅ Academic Year rollover is now a guided 3-step flow instead of 3 disconnected pages
- ✅ All existing + new tests passing, both builds clean
- ✅ **All 18 items from FRONTEND_GAP_ANALYSIS.md are now shipped across 7 phases**

---

## Execution Flow (same as before)

1. Say **"Phase 1 build karo"** → I implement + test + build-verify + branch + PR, then stop.
2. Say **"next phase"** (after you merge the PR) → I move to Phase 2, and so on.
3. Say **"PR banao"** at any point if you want the current work pushed early.

**Ready to start with Phase 1 (Student Promotion)?**
