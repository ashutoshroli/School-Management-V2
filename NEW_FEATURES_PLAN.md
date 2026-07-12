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

## Phase 3: Teacher Class-Scoped Attendance Access Control

**The core access-control change** ("assigned teacher can access only
their assigned class attendance"):
- New helper `canTeacherAccessSection(req, sectionId)` in a shared
  utils file: TEACHER role is allowed only if they are that section's
  `classTeacher` OR have a `SubjectTeacher` row for that section's class.
  ADMIN roles remain unrestricted (existing `canAccessBranch` behavior
  unchanged for them).
- Enforce this in `markStudentAttendance`, `getClassAttendance`, and add
  a new `getMyAssignedSections` endpoint (for a teacher's own dashboard/
  section-picker, so they only ever see sections they can act on).
- **Frontend:** the attendance-marking page's section dropdown is
  filtered to `getMyAssignedSections` for TEACHER role (unchanged for
  admins, who still see everything).

---

## Phase 4: Multi-Period Attendance

- New `PeriodConfig` model (branchId, periodNo, startTime, endTime,
  label) - replaces the unenforced "1-8" convention with a real,
  admin-configurable periods-per-day list (e.g. a branch could run 6 or
  9 periods).
- New `markPeriodAttendance` endpoint: marks attendance for one
  section+subject+period+date combo (already supported by the existing
  nullable `period` column - just never exercised for anything but
  `null` today). Subject comes from that slot's `TimetableSlot` so a
  teacher marking period 3 automatically tags it with whatever subject
  they teach then.
- New `getDayAttendanceSummary(studentId, date)` - rolls up every period
  that day into one row (e.g. "Present in 5 of 6 periods") for a
  parent/admin view, since day-wise (`period: null`) and period-wise
  records will now coexist.
- **Frontend:** new "Period-wise" toggle on the attendance page; a
  Periods config screen under Settings (admin-only) to define
  branch's period list.

---

## Phase 5: Staff Attendance System Enhancements

- **Self check-in/out**: new `selfMarkAttendance` endpoint - a logged-in
  staff member punches their own IN/OUT (source `MANUAL`, restricted to
  today's date, one's own `staffId` only) - today only an admin can mark
  anyone's attendance manually.
- **Holiday-aware**: new `Holiday` model (branchId, date, name) so
  absence isn't wrongly implied on a declared holiday; attendance
  reports exclude holiday dates from the denominator.
- **Late-arrival rule**: `PeriodConfig`/branch setting for a "day start
  time" - `markAttendance`/`cardTapAttendance` auto-flag `LATE` instead
  of `PRESENT` if `inTime` is past that threshold, instead of requiring
  the admin to pick LATE manually every time.
- **Monthly report/export**: `getStaffAttendanceReport` (branch-wide,
  one row per staff, month totals: present/absent/late/leave days,
  attendance %) + CSV export, matching the existing CSV-export
  convention (`csvExport.service.ts`) used for fee/attendance-defaulter
  reports elsewhere.
- **Frontend:** "My Attendance" self check-in widget on the staff
  dashboard; Holiday calendar management page (admin); monthly report
  page with CSV export button.

---

## Workflow
Same as all prior phases: implement backend → tests → typecheck+build
backend → frontend wiring → typecheck+build frontend → commit → branch →
PR → wait for merge/"next" before continuing.
