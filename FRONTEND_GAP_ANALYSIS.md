# Frontend Capability Gap Analysis

**Purpose:** Har backend controller export (147 functions, 37 controllers) aur
database model (65 Prisma models) ko frontend ke actual API calls (grep se
verify kiya, ~55 pages) ke against cross-check karke, **exactly kitne naye
pages/tabs/features** bana sakte hain uski complete, prioritized list.

**Method:** Backend routes files se har endpoint nikala, phir
`frontend/src/app/**/*.tsx` mein `api.get/post/put/patch/delete(...)` calls
grep karke match kiya. Jo endpoint kahin call nahi hota, wahi gap hai.

---

## Summary

| Category | Count |
|----------|-------|
| Backend endpoints with ZERO frontend UI (net-new pages needed) | **8** |
| Existing pages missing sub-features (tabs/buttons/forms to add) | **8** |
| Backend gaps (DB model exists, no controller at all) | **2** |
| **Total buildable items** | **18** |

Sab kuch backend/DB already support karta hai (ya bahut chhota backend addition
chahiye) — koi bhi item "naya backend banao" jaisa bada kaam nahi hai, sab
existing infrastructure use karta hai.

---

## TIER 1: Net-New Pages (backend fully ready, zero frontend UI exists)

### 1. Student Promotion / Result Processing — `/dashboard/promotion`
- **Backend:** `POST /academics/promote` (`bulkPromote` in `promotion.controller.ts`) ✅ ready
- **DB:** `Promotion` model (studentId, fromClassId, toClassId, status: PROMOTED/DETAINED/TC_ISSUED) ✅ ready
- **Why needed:** End-of-year workflow — pick a class+section, review each student's
  annual result, bulk-promote everyone to next class (or mark detained/TC-issued).
  Currently there is **no way to do this at all** in the UI — a huge annual
  operational gap for any real school.
- **Suggested UI:** Class/section picker → student list with exam-result summary →
  checkbox "promote to [next class]" per student (or bulk-select) → confirm.

### 2. Attendance Devices (RFID Reader Management) — `/dashboard/attendance-devices`
- **Backend:** Full CRUD ready — `createDevice`, `getDevices`, `updateDevice`,
  `regenerateApiKey`, `deleteDevice` (`attendanceDevice.controller.ts`)
- **DB:** `AttendanceDevice` model (deviceId, name, location, apiKey, isActive) ✅ ready
- **Why needed:** School has RFID card-tap attendance (`studentCardTap`/`cardTapAttendance`
  endpoints already used by physical readers), but there's **no admin UI to
  register a new reader, see its API key, or regenerate/revoke it** if compromised.
- **Suggested UI:** Simple list + "Add Device" modal, an eye-icon to reveal API key,
  regenerate-key button (with confirm), toggle active/inactive.

### 3. In-App Notification Center (bell icon) — dashboard layout addition
- **Backend:** `GET /communication/notifications` (`getMyNotifications`) ✅ ready
- **DB:** `Notification` model (title, body, type, channel, status) ✅ ready
- **Why needed:** The backend tracks FEE_DUE/FEE_PAID/ATTENDANCE/EXAM_RESULT/
  LEAVE_STATUS/NOTICE/HOMEWORK notifications per user, but there is **no bell
  icon or notification list anywhere in the UI** — every user-facing notification
  today only ever goes out via SMS/WhatsApp/Email/Push, never shown in-app.
- **Suggested UI:** Bell icon in `dashboard/layout.tsx` header with unread badge,
  dropdown/panel listing recent notifications.

### 4. Payment Mode Breakdown Report — new tab on Fee Reports
- **Backend:** `GET /fees/reports/payment-mode-breakdown` (`getPaymentModeBreakdown`) ✅ ready
- **Why needed:** Backend computes CASH vs CHEQUE vs UPI vs ONLINE_RAZORPAY vs
  BANK_TRANSFER totals, useful for accountants reconciling cash-in-hand vs bank,
  but the Fee Reports page has no tab for it.
- **Suggested UI:** Pie/bar chart or simple table, new tab alongside existing
  Day Book / Defaulters / Collection Trend / Class Summary tabs.

### 5. Grade System Configuration — `/dashboard/settings` addition or new page
- **DB:** `GradeSystem` model exists (name, minMarks, maxMarks, grade, gradePoint)
- **Backend:** ❌ **No controller/routes exist at all** — this is the one item
  in this whole audit that needs actual new backend code, not just a frontend page.
- **Why needed:** Report cards currently store a free-text `grade` string per Mark
  with no system-wide grading scale (e.g. CBSE's A1/A2/B1... bands) to auto-assign
  it from marks. Right now grade assignment (if any) must be manual.
  **Recommend:** Small backend controller (create/list/delete grade bands per branch)
  + a settings-page card to manage bands, THEN wire `enterMarks`/`getExamResults`
  to auto-lookup a grade from the applicable band.

### 6. Refund Processing UI
- **Backend:** `POST /fees/refund` (`createRefund`) ✅ ready
- **DB:** `Refund` model (paymentId, amount, reason, approvedBy) ✅ ready
- **Why needed:** A refund can technically be created via the API, but there's
  **no form anywhere** to do it — refunds only ever show up read-only in the
  audit log after the fact (meaning today, someone would have to script/curl it).
- **Suggested UI:** On the student's fee/payment history (in `students/[id]`),
  add a "Refund" button per payment row opening a small modal (amount + reason).

### 7. Class-wise Timetable Overview (admin view) — enhancement to `/dashboard/timetable`
- **Backend:** `getOrCreateTimetable` + full slot data already fetched per section
- **Why needed:** The existing timetable page only shows one section's grid at a
  time and a per-teacher view (`getTeacherTimetable`). There's no "print/view all
  sections for a class" consolidated view useful for the office notice board.
- **Suggested UI:** A read-only "Full Class Timetable" print view, reusing existing
  data with a different layout (no new backend needed).

### 8. Multi-Branch Comparison Enhancements
- **Backend:** `getMultiBranchSummary` already returns per-branch fee/student/staff
  totals; the report page shows a flat table
- **Why needed:** Not a *missing* endpoint, but the data already supports simple
  visual comparisons (bar charts per branch) that the current table format doesn't
  surface well for a SUPER_ADMIN making cross-branch decisions.
- **Suggested UI:** Add bar/comparison charts alongside the existing table on the
  Multi-Branch tab of Reports.

---

## TIER 2: Existing Pages Missing Sub-Features (add tabs/buttons/forms)

### 9. Hostel — Add Floor / Add Room / Allocate / Deallocate / Occupancy
- **Backend ready, zero UI:** `addFloor`, `addRoom`, `allocateRoom`, `deallocateRoom`,
  `getOccupancy` — **5 of 8 hostel endpoints are completely unused**.
- **Current state:** `/dashboard/hostel` only supports Add Building / Delete
  Building. Floors/rooms are shown read-only if they happen to exist (they never
  will, since there's no way to create one).
- **Fix:** Add "+ Floor" and "+ Room" buttons per building, a "Allocate Student"
  flow (search student → pick room → allocate), and an Occupancy summary tab/card
  (`getOccupancy` gives per-building/room-type occupancy %).

### 10. Transport — Add Stop
- **Backend ready, zero UI:** `addStop` (`POST /facilities/transport/stops`)
- **Current state:** Routes/vehicles CRUD exists; stops (with sequence + pickup
  time) cannot be added from the UI at all.
- **Fix:** Within the route management modal, add a "Stops" sub-section listing
  stops in order with an "+ Add Stop" (name, order, time) form.

### 11. Inventory — Low Stock Alerts
- **Backend ready, zero UI:** `getLowStockAlerts` (`GET /facilities/inventory/low-stock`)
- **Current state:** Items list shows current stock but no alert/badge for items
  below `minStock`.
- **Fix:** A small "Low Stock" banner/tab at the top of the Inventory page listing
  items needing reorder, using the existing endpoint.

### 12. Fee Discounts — Standalone Management Page
- **Current state:** Discounts can only be added/toggled/removed from within a
  single student's profile page (`students/[id]`) — there's no branch-wide view
  of "which students have Sibling/RTE/Merit/Staff-Ward discounts active" for an
  accountant auditing concessions.
- **Backend ready:** `getStudentDiscounts` already exists per-student; a
  branch-wide list would need a small new query (or reuse `discount.controller.ts`'s
  existing Prisma model directly) — this is a light backend addition, not a big one.
- **Fix:** New `/dashboard/fees/discounts` page listing all active discounts
  branch-wide with student name, type, value, and a toggle/remove action.

### 13. Admission Inquiry → Student Conversion Shortcut
- **Current state:** `/dashboard/admissions` lets staff review/status-update/delete
  inquiries and download the inquiry as a PDF, but converting an "ADMITTED" inquiry
  into an actual Student record still requires manually re-typing everything into
  `/dashboard/students/new`.
- **Fix:** Add a "Convert to Student" button on ADMITTED inquiries that
  pre-fills the New Student form (name, DOB, gender, class, parent contact) from
  the inquiry data — pure frontend convenience, no backend change needed (just
  passing inquiry data via query params/state into the existing new-student form).

### 14. Certificate Templates — CUSTOM Type Generic Renderer
- **Verified:** `/dashboard/certificates` deliberately supports only
  `TRANSFER_CERTIFICATE`/`BONAFIDE`/`CHARACTER` (documented in-code) — `ID_CARD`
  already has its own dedicated flow (student profile page), and `CUSTOM` has
  **no generic renderer yet** since a free-form template needs a different
  data-binding approach than the other three's fixed field sets.
- **Fix (real gap, not a bug):** Build a generic CUSTOM-type renderer - e.g. let
  the admin define which student/branch fields map to which template placeholders
  at generation time, since a CUSTOM template's fields aren't known in advance.
  Medium-effort item since it needs a bit of new UI + a slightly different
  generation flow, not just wiring an existing endpoint.

### 15. Leave Types Management
- **Backend:** `getLeaveTypes` exists (read); leave TYPES themselves (CL/SL/EL/etc,
  with `maxDays`/`carryForward`) are currently only seeded via demo-data/seed
  script — **no admin CRUD UI or backend endpoint to create a new leave type**
  (e.g. a school wanting to add "Sabbatical Leave").
- **Backend gap:** Needs `createLeaveType`/`updateLeaveType` added to
  `leave.controller.ts` (small addition, same pattern as everything else).
- **Fix:** Settings-page card or `/dashboard/leaves` admin tab to manage leave types.

### 16. Academic Year — Bulk Rollover Helper
- **Current state:** Creating a new academic year, then bulk-promoting students,
  then re-assigning fee structures for the new year are 3 separate manual flows
  today (`academic-years`, new Tier-1 Promotion page, `fees/structures`).
- **Fix (frontend-only convenience):** A guided "Start New Academic Year" wizard
  that chains: create year → (link to) promotion → (link to) fee structure setup,
  reusing all 3 existing/new endpoints — pure UX sequencing, no new backend.

---

## TIER 3: Backend Additions Needed (small, but not zero)

### 17. Grade System CRUD (see Tier 1 #5 for detail)
Needs: `gradeSystem.controller.ts` (create/list/update/delete per branch) +
routes + validator. ~1-2 hours of backend work following the exact pattern of
every other simple CRUD controller in this codebase (e.g. `feeCategory.controller.ts`).

### 18. Leave Type CRUD (see Tier 2 #15 for detail)
Needs: `createLeaveType`/`updateLeaveType`/`deleteLeaveType` added to the
existing `leave.controller.ts` + 2-3 new routes + a validator. Same small scope
as #17.

---

## What This Means

- **No hard technical limit** on how many of these can be built — every item
  above is additive (new pages/routes/controllers), doesn't require rearchitecting
  anything, and follows patterns already established elsewhere in this codebase.
- **Recommended build order** (highest user-visible value first):
  1. Student Promotion (annual workflow gap — most impactful missing feature)
  2. Hostel floors/rooms/allocation (5 unused endpoints, currently a half-built module)
  3. Attendance Devices admin UI (security-relevant — API keys currently unmanageable)
  4. In-app Notification bell (cross-cutting UX improvement)
  5. Refund UI, Transport stops, Low Stock alerts, Payment Mode Breakdown (each small/independent)
  6. Fee Discounts branch-wide page, Admission→Student conversion shortcut
  7. Grade System + Leave Type CRUD (the only two needing backend additions first)

**Bottom line: 18 concrete, independently-shippable items identified.** Bolo
kaunse se shuru karna hai (ek-ek karke, ya kisi tier se), aur main wahi phase-wise
pattern follow karunga (code + tests + build verify + PR).
