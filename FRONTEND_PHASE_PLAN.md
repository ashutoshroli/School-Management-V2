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

## Phase 3: Attendance Devices + In-App Notifications 🟡 (Items #2, #3)

**Priority:** HIGH (security-relevant device management + cross-cutting UX gap)
**Backend:** Fully ready for both

### Scope:
- New page `/dashboard/attendance-devices` - list, add device, reveal/regenerate API key, toggle active, delete
- Notification bell in `dashboard/layout.tsx` header - unread badge, dropdown panel, calls `GET /communication/notifications`

---

## Phase 4: Fee Module Enhancements 🟡 (Items #4, #6, #12)

**Priority:** MEDIUM-HIGH (finance-critical gaps: refunds unreachable via UI, no discount oversight)
**Backend:** Refund + payment-mode-breakdown fully ready; branch-wide discounts needs a small backend addition (new list endpoint reusing existing discount data)

### Scope:
- Refund button + modal on student payment history rows (`students/[id]`)
- Payment Mode Breakdown tab on Fee Reports page
- New `/dashboard/fees/discounts` branch-wide discount list page (small backend: a `getAllDiscounts`-style endpoint)

---

## Phase 5: Facility + Reporting Polish 🟢 (Items #7, #8, #10, #11, #13)

**Priority:** MEDIUM (independent small items, each quick to ship)
**Backend:** Fully ready for all

### Scope:
- Transport: "+ Add Stop" within route management modal
- Inventory: Low Stock alert banner/tab
- Timetable: read-only "Full Class Timetable" consolidated print view
- Reports: comparison charts on Multi-Branch tab
- Admissions: "Convert to Student" button pre-filling the New Student form

---

## Phase 6: Grade System + Leave Types (new backend + UI) 🟢 (Items #5/#17, #15/#18)

**Priority:** MEDIUM (only phase needing new backend controllers)
**Backend:** Needs 2 new small controllers (`gradeSystem.controller.ts`; additions to `leave.controller.ts`)

### Scope:
- Backend: `gradeSystem.controller.ts` (create/list/update/delete grade bands per branch) + routes + validator
- Backend: `createLeaveType`/`updateLeaveType`/`deleteLeaveType` added to `leave.controller.ts` + routes + validator
- Frontend: Settings-page cards (or dedicated tabs) to manage both
- Optional stretch: wire `enterMarks`/`getExamResults` to auto-lookup grade from the applicable band

---

## Phase 7: Advanced/Deferred Items 🔵 (Items #14, #16)

**Priority:** LOW (higher effort, lower urgency - can be deferred indefinitely)

### Scope:
- Certificate CUSTOM-type generic renderer (needs a field-mapping UI + different generation flow - meaningfully bigger than other items)
- Academic Year rollover wizard (pure UX sequencing/convenience, links Phases 1 + existing pages together)

---

## Execution Flow (same as before)

1. Say **"Phase 1 build karo"** → I implement + test + build-verify + branch + PR, then stop.
2. Say **"next phase"** (after you merge the PR) → I move to Phase 2, and so on.
3. Say **"PR banao"** at any point if you want the current work pushed early.

**Ready to start with Phase 1 (Student Promotion)?**
