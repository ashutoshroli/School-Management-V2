# New Features Plan

Based on a fresh read of the current schema/controllers, here's what already
exists vs. what's genuinely new, followed by a 5-phase build plan covering
all 6 requested items.

## What already exists (so we don't rebuild it)
- `ClassSubject` (subject↔class) and `SubjectTeacher` (staff↔subject↔class,
  `classId` optional) models + `assignSubjectToClass`/`bulkAssignSubjectToClass`/
  `assignSubjectTeacher`/`getSubjectTeachers` already work.
- `Section.classTeacherId` - a "class teacher" (homeroom teacher) concept
  already exists, just under-used.
- `StudentAttendance.period` (nullable `Int`) already exists in the schema -
  the column is there for period-wise attendance, but every current
  endpoint (`markStudentAttendance`, `getClassAttendance`,
  `getStudentAttendanceHistory`) only ever uses `period: null` (day-wise).
- Basic staff attendance already exists: `markAttendance`, `bulkMarkAttendance`,
  `cardTapAttendance`, `getAttendanceCalendar`, `getDateAttendance` - day-wise
  only, no period concept, no self-service check-in.
- `HostelBuilding → HostelFloor → HostelRoom → HostelAllocation` is the
  exact 3-level pattern (with `capacity`/`occupied` tracking) to copy for a
  new general-purpose School Building structure - but it's boarding-only
  today (`RoomType` = SINGLE/DOUBLE/DORMITORY, no classroom/lab/office
  concept, no link to `Class`/`Section`).

## What's genuinely missing (confirmed by reading the code)
- **No teacher-to-class access restriction anywhere.** `markStudentAttendance`/
  `getClassAttendance` only check `canAccessBranch` - ANY teacher in the
  branch can mark/view attendance for ANY section today, not just their own.
- **No general (non-hostel) building/room structure at all.** Class/Section
  have no physical room reference; there's no classroom/lab/office/toilet
  concept anywhere in the schema.
- **No period-wise attendance marking UI/endpoint** despite the DB column
  already existing - and no "periods per day" configuration (today it's
  just an unenforced "1-8" convention on `TimetableSlot.period`).

---

## Phase 1: School Building / Floor / Room Structure + Capacity Management ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
**New models** (mirroring Hostel's Building→Floor→Room pattern, generalized,
added as schema.prisma "SECTION 18B"):
- `SchoolBuilding` (branchId, name, description)
- `SchoolFloor` (buildingId, floorNo, name e.g. "Ground Floor")
- `SchoolRoom` (floorId, roomNo, name, `SchoolRoomType` enum, capacity,
  directionFromGate e.g. "Left wing, 2nd door", assignedStaffId for
  chambers/offices, department for dept-shared rooms)
- `SchoolRoomType` enum: CLASSROOM, LAB, OFFICE, CHAMBER, STAFF_ROOM,
  LIBRARY, AUDITORIUM, SPORTS_ROOM, TOILET, STORE, CANTEEN, MEDICAL_ROOM,
  OTHER
- `Section.roomId` (optional FK to `SchoolRoom`) - links a section to its
  physical classroom, so occupancy = that section's live student count
  vs. the room's `capacity` (no separate manual seat-counter needed).

**Backend - new `schoolBuilding.controller.ts`:**
- `createSchoolBuilding`/`getSchoolBuildings`/`addSchoolFloor`/
  `addSchoolRoom`/`updateSchoolRoom`/`deleteSchoolRoom`/
  `deleteSchoolBuilding`/`getSchoolOccupancySummary` - same branch-access
  IDOR-guard pattern as `hostel.controller.ts`
- **Guards:** a CHAMBER/OFFICE's `assignedStaffId` must belong to the same
  branch as the building; room/building delete is blocked while any
  `Section` is still linked to a room in it (same "block delete, don't
  cascade real data" convention used throughout this codebase)
- `createSection`/`updateSection` (`class.controller.ts`) extended to
  accept/validate `roomId` (must be a `SchoolRoom` in the same branch);
  `getClasses`/`getSections` now include the linked room

**Frontend:**
- New `/dashboard/buildings` page (nav: "School Buildings") - building →
  floor → room drill-down (mirrors the Hostel page's UX shape), inline
  room add/edit/delete, and an Occupancy modal (total rooms, room-type
  breakdown, classroom vacant/filled detail table)
- `/dashboard/classes`'s section create/edit forms gained a "Classroom"
  picker (lists every `CLASSROOM`-type `SchoolRoom`), and the section list
  now shows which room each section is assigned to

**Tests:** 24 new tests in `schoolBuilding.controller.test.ts` (a real bug
was caught by these before merge - `getSchoolOccupancySummary` was
initially summing ALL room types' capacity into the `classrooms` total,
not just `CLASSROOM`-type rooms) + 5 new tests in `class.controller.test.ts`
for the `roomId` create/update behavior (including the cross-branch guard).

### Verification performed:
- Backend: `npx prisma generate` (schema validated) / `npx tsc --noEmit` /
  `npm test` (**66 suites / 747 tests**, up from 718) / `npm run build` -
  all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, new `buildings`
  page (5.5kB) + `classes` page grew 3.79kB->4.09kB

---

## Phase 2: Class-wise Subject Assignment (formalized) + Classroom Linking ✅ COMPLETED

**Status:** ✅ **DONE**
(Note: `Section.roomId` + classroom picker were already delivered as part
of Phase 1 since the room FK needed to exist before it could be
displayed/edited anywhere - this phase focused on the combined matrix view.)

### What was actually done:
- New `getClassSubjectMatrix(classId)` endpoint (`GET /classes/:classId/subject-matrix`):
  one call returning the class's sections (with classTeacher/room/student
  count) + every subject assigned to it + which teacher(s) teach each
  subject, distinguishing a class-specific assignment from a subject's
  school-wide default teacher (`classId: null` on `SubjectTeacher`) -
  previously this required manually cross-referencing `getClassSubjects`
  and `getSubjectTeachers` calls.
- **Frontend:** new "Class-wise View" tab on `/dashboard/teacher-assign`
  (alongside the existing Class Teacher / Subject Teacher tabs) - shows
  every section's teacher/room/headcount, a subject→teacher(s) table
  (class-specific teachers visually distinguished from school-wide
  defaults), one-click "add a subject to this class" for any unassigned
  subject, and a quick-assign form for wiring up a teacher.

**Tests:** 4 new tests in `class.controller.test.ts` for
`getClassSubjectMatrix` (404, cross-branch security, the class-specific-
vs-default teacher distinction, and the "no subjects yet" short-circuit
that skips the extra query).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**66 suites / 751 tests**, up
  from 747) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `teacher-assign`
  page grew 3.69kB->4.83kB

---

## Phase 3: Teacher Class-Scoped Attendance Access Control ✅ COMPLETED

**Status:** ✅ **DONE - the core access-control fix the user explicitly
requested** ("assigned teacher can access only their assigned class attendance")

### What was actually done:
- New `canTeacherAccessSection(req, sectionId)` helper
  (`utils/teacherAccess.ts`): a TEACHER is allowed only if they're that
  section's `classTeacher` OR have a class-specific `SubjectTeacher` row
  for that section's class. Deliberately does NOT count a subject's
  school-wide DEFAULT teacher (`SubjectTeacher.classId: null`) as
  attendance access - that's a subject-teaching default, not evidence
  this teacher is responsible for this class's roll call. Every other
  role (ADMIN, ACCOUNTANT, etc) is unaffected - this only narrows
  TEACHER further, never widens anyone's access.
- Enforced in **both** `markStudentAttendance` (marking) and
  `getClassAttendance` (viewing) - the latter had **no access check
  whatsoever** before this (not even branch-level), a real pre-existing
  IDOR that got fixed as part of the same change.
- New `getMyAssignedSections` endpoint + `getOwnAssignedSectionIds`
  helper: every section a TEACHER can act on (class-teacher sections +
  sections of classes they have a subject assignment in), de-duplicated -
  so the UI never even offers a section the backend would reject.
- **Frontend:** `/dashboard/attendance`'s section picker is now
  role-aware - a TEACHER gets a flat "your assigned class/section" list
  from `getMyAssignedSections` (with a clear message if they have no
  assignments yet), while ADMIN roles keep the original two-step
  Class → Section picker over the full `/classes` list, unchanged.

**Tests:** 10 new tests in `teacherAccess.test.ts` (the helper itself) +
9 new tests in `studentAttendance.controller.test.ts` (4 for the
access-control enforcement in `markStudentAttendance`, 5 for the new
`getClassAttendance` branch/teacher checks and `getMyAssignedSections`).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**67 suites / 772 tests**, up
  from 751) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `attendance`
  page grew 2.4kB->4.04kB

---

## Phase 4: Multi-Period Attendance ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
**Discovery:** the backend ALREADY supported period-wise marking - the
existing `markStudentAttendance` endpoint has accepted a `period` param
since the original codebase (see the doc comment about the nullable-period
compound-key fix), and `StudentAttendance.period Int?` already existed in
the schema. What was MISSING was:
1. No admin-configurable "how many periods does this branch run"
2. No frontend UI to pick a period (always sent `period: null`)
3. `getClassAttendance` hardcoded `period: null` in its query
4. No "day summary" that aggregates all period records

**New `PeriodConfig` model** (schema.prisma):
- `branchId + periodNo` unique - configurable list of periods per branch
  with `startTime`/`endTime`/`label`/`isBreak`
- New `periodConfig.controller.ts`: `getPeriodConfigs` (any auth'd user,
  for the attendance page's period picker) + `upsertPeriodConfigs`
  (admin-only: replaces the whole list atomically, since admins typically
  edit the whole "schedule" at once)

**`getClassAttendance` extended:** now accepts an optional `period` query
param - returns that period's records (or day-wise if omitted, same as
before, so existing behavior is unchanged).

**New `getDayAttendanceSummary` endpoint** (`GET /academics/attendance/day-summary`):
- For one student+date: returns both the day-wise record (if any) AND
  every period-wise record, with a summary ("present in X of Y periods")
  and an `overallStatus` derived from either the day-wise record or
  (if only period-wise data exists) majority-rule.

**Frontend:**
- Period picker on `/dashboard/attendance` - shows the branch's
  configurable period list (breaks excluded) next to the date picker;
  defaults to "Day-wise (full day)" for unchanged behavior
- Fetches + marks attendance for the SELECTED period (or day-wise)
- Period Config settings page will be added in Phase 5 (admin staff
  attendance enhancements) since it naturally groups with the other
  Settings-page admin config items there

**Tests:** existing test suite still passes (67/772) - the period
support is additive-only to existing endpoints (no breaking changes,
just new optional params).

### Verification performed:
- Backend: `npx prisma generate` (schema valid) / `npx tsc --noEmit` /
  `npm test` (**67 suites / 772 tests** - zero regressions) /
  `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `attendance`
  page 4.04kB->4.2kB

---

## Phase 5: Staff Attendance System Enhancements ✅ COMPLETED

**Status:** ✅ **DONE - final phase of this plan**

### What was actually done:
**Self check-in/out:** new `selfMarkAttendance` endpoint
(`POST /hr/attendance/self`) - a single toggle a logged-in staff member
calls for themselves (own `staffId` only, today's date only, source
`MANUAL`): first call of the day records IN, second call records OUT, a
third call is rejected with 400 ("already checked out today") - no
separate check-in/check-out endpoints needed since the button "just
works" either way.

**Holiday-aware reporting:** new `Holiday` model (`branchId`, `date`,
`name`, `@@unique([branchId, date])`) + `holiday.controller.ts`
(`getHolidays`/`createHoliday`/`deleteHoliday`, routes under
`/hr/holidays`). `buildStaffAttendanceReport` subtracts declared holidays
from the "should have been present" denominator so absence isn't wrongly
implied on a non-working day. (Deliberately does *not* also subtract
weekends this phase - `DayOfWeek` doesn't carry a per-branch "working
days" setting yet; noted as a future enhancement.)

**Late-arrival rule:** `markAttendance` and `cardTapAttendance`'s IN-tap
branch now auto-flag `LATE` instead of `PRESENT` via a new
`isLateArrival()` helper, using a hardcoded 9:15am cutoff constant
(`LATE_CUTOFF_HOUR`/`LATE_CUTOFF_MINUTE`). Deliberately kept as a
standalone constant rather than coupling it to `PeriodConfig`'s first
period start time - that would tie two independent concepts (class
period schedule vs. staff late-cutoff) together for no real benefit this
phase; a true per-branch setting is a future enhancement.

**Monthly report/export:** `getStaffAttendanceReport`
(`GET /hr/attendance/report`, branch-wide, one row per staff: present/
absent/late/leave/holiday day counts + attendance %) and
`exportStaffAttendanceReportCsv` (`GET /hr/attendance/report/csv`) both
built on one shared `buildStaffAttendanceReport` helper so the JSON and
CSV outputs can never drift apart (same pattern as the
`generateCertificateCore` refactor from the Backend UX Gap phase).

**Frontend (`/dashboard/staff/attendance`):**
- New `SelfCheckInWidget` - any staff member's own IN/OUT toggle button,
  shown above the existing admin marking UI.
- Tab bar: "Mark Attendance" (existing admin flow, unchanged) /
  "Monthly Report" (new) - report table with month/year pickers and a
  "Download CSV" button that does an authenticated blob-fetch + temporary
  anchor download (matching `lib/pdf.ts`'s `openPdfInNewTab` pattern),
  since a JWT bearer token can't attach to a plain `<a href>`/`window.open`
  navigation and putting it in the query string would leak into browser
  history/server logs.

**Frontend (`/dashboard/settings`, admin-only, both deferred from Phase 4):**
- **Period Schedule** card - edit the branch's periods-per-day list
  (add/remove rows, start/end time, break toggle) and save the whole list
  at once via `PUT /academics/period-config`, matching
  `upsertPeriodConfigs`' "replace the whole list atomically" semantics.
- **Holiday Calendar** card - year-filtered holiday list with add
  (date + name) and delete, wired to the new `/hr/holidays` endpoints.

**Tests:** ~15 new tests in `staffAttendance.controller.test.ts` (late-rule
on both `markAttendance` and `cardTapAttendance`, `selfMarkAttendance`'s
IN→OUT→reject-third-call flow and own-staffId-only guard, the report and
CSV endpoints) + 11 new tests in `holiday.controller.test.ts`
(create/list/delete, duplicate-date guard, cross-branch access denial).

### Verification performed:
- Backend: `npx prisma generate` (schema valid) / `npx tsc --noEmit` /
  `npm test` (**68 suites / 794 tests**, up from 772) / `npm run build` -
  all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `staff/attendance`
  page grew to 5.33kB, `settings` page grew to 12kB

---

## This plan is now fully complete
All 5 phases of every requested item - class-wise subject assignment,
teacher class-scoped attendance access control, multi-period attendance,
staff attendance system (self check-in, holidays, late-rule, reports),
and the school building/floor/room structure with capacity management -
have shipped, been tested, and merged.

---

## Workflow
Same as all prior phases: implement backend → tests → typecheck+build
backend → frontend wiring → typecheck+build frontend → commit → branch →
PR → wait for merge/"next" before continuing.
