# Exam Management + Public Portal + Facility Enhancements Plan

Based on a fresh read of `exam.controller.ts`, `certificate.controller.ts`
(the public-verify pattern), `admission.controller.ts` (the public-inquiry
pattern), `schoolBuilding.controller.ts`, and the `Staff`/schema models -
here's what already exists vs. what's genuinely new, followed by a
phase-wise build plan covering all 8 requested items.

## What already exists (so we don't rebuild it)
- `Exam` (name/type/classId/academicYearId/startDate/endDate - ONE date
  range for the whole exam, no per-subject schedule), `Mark` (per
  student+subject), `GradeSystem`, exam create/update/delete/publish,
  `enterMarks` (bulk upsert), `getExamResults` (ranked), report-card PDF.
- Public (no-auth) lookup pattern already established twice:
  `verifyCertificate` (serialNo -> minimal non-sensitive fields) and
  `createAdmissionInquiry`/`getPublicBranchList` (rate-limited, 10/hr/IP).
  New public lookups (result, fee status) will follow this exact shape.
- `SchoolBuilding -> SchoolFloor -> SchoolRoom` (general rooms: CLASSROOM/
  LAB/OFFICE/CHAMBER/STAFF_ROOM/etc, capacity, directionFromGate,
  `assignedStaffId` - single staff per room). Multiple buildings per
  branch is **already fully supported today** - `getSchoolBuildings` lists
  every building for the branch, no limit. Occupancy summary already
  computes vacant/filled classroom seats.
- `Notice` model (branch-scoped, targeted by role/class) - staff-only
  today, no public feed.
- `AdmissionInquiry` - public submit, staff-only review pipeline.

## What's genuinely missing (confirmed by reading the code)
- **No exam timetable at all** - `Exam` has one startDate/endDate for the
  whole exam; no per-subject date+time+room+duration.
- **No exam seating plan** - nothing generates a room-wise seat chart
  from class/section/gender/roll-no.
- **No question paper upload** tied to exams - no model, no teacher-scoped
  upload restricted to their own class/section/subject.
- **No exam-specific attendance** - only daily `StudentAttendance` exists;
  no "present for THIS exam sitting" concept.
- **No public marketing landing page** - root `/` just redirects into the
  dashboard or login; no public result lookup, fee-status lookup, notices
  feed, or job vacancy listing exists anywhere.
- **No `JobVacancy`/recruitment model** at all - confirmed zero matches.
- **No multi-cabin chamber** - `SchoolRoom.assignedStaffId` is a single
  scalar FK; one CHAMBER room = one teacher today, not several sharing one
  room.
- **No bulk floor/room creation** - `addSchoolFloor`/`addSchoolRoom` are
  strictly one-at-a-time today.

---

## Phase 1: Exam Timetable + Question Paper Upload ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
**Exam timetable (new `ExamSchedule` model):**
- `examId + subjectId` unique row: `examDate`, `startTime`, `endTime`,
  `durationMinutes`, optional `roomId` (link to `SchoolRoom`), `maxMarks`.
- `bulkSetExamSchedule` (`PUT /academics/exams/schedule`, admin) - replaces
  the whole exam's subject-wise date sheet in one call (same "edit the
  whole list at once" convention as `upsertPeriodConfigs`); validates every
  subject is assigned to the exam's class, no two subjects overlap in time
  on the same date, and any given room belongs to the exam's branch.
- `getExamSchedule` (`GET /academics/exams/:examId/schedule`) - the
  printable date sheet, chronologically ordered.
- `updateExamScheduleEntry`/`deleteExamScheduleEntry` for single-row edits -
  delete is blocked once a question paper, seat allocation, or attendance
  record already references that entry (real workflow state that must
  not silently disappear, same convention as `deleteExam`'s mark-count guard).
- Also declared (this migration only, endpoints deferred to their own
  phases) the `ExamSeatAllocation` and `ExamAttendance` models + the
  `ExamAttendanceStatus` enum, so `ExamSchedule`'s relations are complete
  in one migration rather than needing an ALTER later.

**Question paper upload (new `ExamQuestionPaper` model):**
- `examScheduleId` + optional `sectionId` (defaults to whole-class),
  `fileUrl`, `fileName`, `uploadedBy`.
- **Teacher-scoped upload** via new `canTeacherTeachSubjectForClass` helper
  (`utils/teacherAccess.ts`) - a TEACHER may only upload for a subject they
  actually teach (class-specific `SubjectTeacher` row OR the subject's
  school-wide default teacher). Deliberately DOES count the school-wide
  default here (unlike `canTeacherAccessSection`'s attendance-access rule) -
  "who teaches this subject" is exactly what should gate "who may set this
  subject's paper." ADMIN roles are unrestricted.
- Accepts PDF or DOCX (new `uploadExamPaper` multer middleware + its own
  `EXAM_PAPER_MIME_TYPES` allowlist in `middleware/upload.ts` - the union of
  the existing image+PDF and DOCX-only allowlists, since a question paper
  is either a scanned/typed PDF or a native Word file, never a photo).
  `POST/GET/DELETE /academics/exams/question-papers`.
- A TEACHER only sees/deletes their OWN uploads via `getExamQuestionPapers`/
  `deleteExamQuestionPaper`; ADMIN roles see and can delete every paper.

**Frontend:** new `/dashboard/exams/[id]/schedule` page (linked from the
Exams list as "Timetable") - admin-only editable date-sheet table
(add/remove subject rows, date/time/duration/marks/room picker sourced
from `/facilities/school-buildings`) plus a per-subject question-paper
upload/list/delete widget available to any teacher, shown once that
subject's row has been saved.

**Tests:** 57 new tests total - `teacherAccess.test.ts` (+5, the new
helper), `examSchedule.controller.test.ts` (new, 20 tests: overlap
detection across/within dates, class-subject validation, room
branch-guard, delete-blocked-by-dependent-record guard), 
`examQuestionPaper.controller.test.ts` (new, 15 tests: teacher-scoping
enforcement, own-upload-only delete/list restriction, admin bypass,
cross-branch guards).

### Verification performed:
- Backend: `npx prisma generate` (schema valid) / `npx tsc --noEmit` /
  `npm test` (**70 suites / 841 tests**, up from 794) / `npm run build` -
  all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, new
  `exams/[id]/schedule` route (6.23kB)

---

## Phase 2: Exam Seat Plan Generator ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
(`ExamSeatAllocation` model itself was already declared in Phase 1's
migration so `ExamSchedule`'s relations would be complete in one pass -
this phase adds the actual generator/viewer endpoints.)

- `generateSeatPlan` (`POST /academics/exams/schedule/:examScheduleId/seat-plan`,
  admin) - pulls every active student in the exam's class, optionally
  narrowed by **sectionIds, gender, rollNoFrom/rollNoTo** (roll no is a
  free-text field; the range filter only applies to numeric-looking
  values, non-numeric roll numbers are simply excluded from a range
  filter rather than crashing it), then fills the given rooms (in the
  caller's own room order) either in plain roll-no order or via an
  `ALTERNATE_GENDER` arrangement (interleaves boys/girls sorted
  separately by roll no - a common anti-cheating seating convention).
  Rejects up front if the selected rooms' total capacity is less than
  the matched student count, or if a room doesn't belong to the exam's
  branch. Regeneration is destructive (delete + recreate) since a seat
  plan is normally finalized once, close to the exam date.
- `getSeatPlan` (`GET .../seat-plan`) - room-wise breakdown (roll no,
  name, seat no, section, gender per seat) plus a male/female/other
  count per room, for printing or a quick sanity-check of an
  alternate-gender arrangement.
- `clearSeatPlan` (`DELETE .../seat-plan`, admin) - wipes the plan
  entirely (e.g. before regenerating with different filters).
- `getStudentSeatSlipPdf` (`GET .../seat-plan/student/:studentId/slip`) -
  single-student printable PDF slip (room/floor/building/seat/date/time),
  built with the same PDFKit helper convention as fee receipts/ID cards.

**Frontend:** the exam schedule page (`/dashboard/exams/[id]/schedule`)
gained, per scheduled subject: a "Seat Plan" button (admin) opening a
modal to pick rooms/arrangement/section/gender/roll-no-range filters,
and a "View Seating" button (any role) showing the room-wise seat table
inline with a per-student "Slip" download link (authenticated blob
download, matching the CSV-export pattern from the staff attendance
report).

**Tests:** 18 new tests in `examSeatPlan.controller.test.ts` - capacity-
shortfall rejection, ALTERNATE_GENDER interleaving correctness,
roll-no-range filtering, cross-branch room guard, destructive-
regeneration behavior, and the seat-slip PDF's access control.

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**71 suites / 859 tests**, up
  from 841) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `exams/[id]/schedule`
  page grew 6.23kB->8.38kB

---

## Phase 3: Exam Attendance ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
(`ExamAttendance` model + `ExamAttendanceStatus` enum were already
declared in Phase 1's migration - this phase adds the actual marking/
viewing/summary endpoints and the marks-entry cross-check.)

- `markExamAttendance` (`POST /academics/exams/schedule/:examScheduleId/attendance`,
  teacher+admin) - bulk upsert, room-wise. When a `roomId` is supplied,
  every `studentId` in the batch MUST actually be seated in that room
  for this schedule entry (via `ExamSeatAllocation`) - stops an
  invigilator for Room A from marking (accidentally or otherwise)
  students seated in Room B. When `roomId` is omitted, any student
  enrolled in the exam's class may be marked (covers a class with no
  seat plan generated yet).
- `getExamAttendance` (`GET .../attendance`) - room-wise roster,
  pre-filled from `ExamSeatAllocation` if a seat plan exists
  (`source: "SEAT_PLAN"`) so every seated student shows up even before
  being marked; falls back to the whole active class roster, unroomed,
  when no seat plan has been generated yet (`source: "CLASS_ROSTER"`).
- `getExamAttendanceSummary` (`GET /academics/exams/:examId/attendance-summary`) -
  present/absent/unfair-means/late counts per subject sitting across
  the WHOLE exam, so attendance can be reviewed exam-wide rather than
  one subject at a time.
- `enterMarks` (exam.controller.ts) now cross-checks this subject's
  `ExamSchedule`/`ExamAttendance` (if any exist - never blocks marks
  entry for an exam that has no schedule/attendance data at all) and
  returns a non-blocking `warnings` array for any student marked
  ABSENT or UNFAIR_MEANS for the exam but still given marks - a real
  edge case (e.g. a supplementary/makeup exam) surfaced to whoever
  entered the marks without silently hiding it OR blocking a
  legitimate override.

**Frontend:** the exam schedule page gained an "Exam Attendance" button
per scheduled subject - an inline room-wise (or whole-roster) marking
panel with a per-student status dropdown and a "Mark all Present"
shortcut. The Exams list's existing "View Details" modal gained an
Exam Attendance-by-subject summary table (present/absent/late/unfair-
means counts) alongside its existing marks-recorded summary.

**Tests:** 15 new tests in `examAttendance.controller.test.ts`
(room-scoped invigilator access enforcement, class-membership guard
when unroomed, SEAT_PLAN vs CLASS_ROSTER fallback, attendance
pre-fill, summary aggregation) + 4 new tests in
`exam.controller.test.ts` for the `enterMarks` cross-check (no-schedule
no-op, PRESENT = no warning, ABSENT/UNFAIR_MEANS = warning without
blocking the save).

### Verification performed:
- Backend: `npx tsc --noEmit` / `npm test` (**72 suites / 878 tests**, up
  from 859) / `npm run build` - all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `exams` page
  grew 3.89kB->4.09kB, `exams/[id]/schedule` grew 8.38kB->9.21kB

---

## Phase 4: Public Landing Page + Result/Fee Status Portals ✅ COMPLETED

**Status:** ✅ **DONE**

### What was actually done:
**Backend (public, rate-limited, following the `verifyCertificate`/
`admission` pattern exactly - new `middleware/rateLimiter.ts`
centralizes the limiter shape that admission.routes.ts previously
declared inline, plus a stricter `publicLookupLimiter`):**
- `Notice.isPublic Boolean @default(false)` (new field) - admin opts in
  per-notice via `PATCH /communication/notices/:id/public`
  (`togglePublicVisibility`). `GET /public/notices` returns only
  `isPublic: true`, non-expired notices - a school announcement board
  visible to anyone.
- New `JobVacancy`/`JobApplication` models + `JobApplicationStatus` enum.
  `GET /public/jobs` (public list, active+not-yet-closed only) +
  `POST /public/jobs/:id/apply` (public submit) mirror
  `AdmissionInquiry`'s "public submit, staff reviews" shape exactly;
  staff-only CRUD/review lives under `/hr/jobs` (`createJobVacancy`/
  `getJobVacancies`/`updateJobVacancy`/`deleteJobVacancy`/
  `getJobApplications`/`updateJobApplicationStatus`). Vacancy delete is
  blocked once any application exists (close it instead, same "block
  delete, don't cascade real data" convention as everywhere else).
- `POST /public/results/lookup` `{admissionNo, dateOfBirth}` - verifies
  both match one ACTIVE student via a shared `findStudentByAdmissionAndDob`
  helper (calendar-day DOB comparison, immune to time-of-day mismatches),
  then returns ONLY **published** exam results, grouped by exam with a
  computed percentage - never an unpublished exam's marks.
- `POST /public/fees/lookup` `{admissionNo, dateOfBirth}` - returns an
  outstanding-dues SUMMARY (category, pending amount, status - no full
  ledger/payment history) using the exact same pending-amount formula as
  `getStudentPendingFees`.
- `POST /public/fees/pay` + `POST /public/fees/verify` - a public,
  no-`req.user` counterpart to `createRazorpayOrder`/`verifyRazorpayPayment`
  (payment.controller.ts): re-verifies admissionNo+dateOfBirth (never
  trusts a bare `feeAssignmentId` from an anonymous caller), reuses
  `getValidatedFeeAssignment`/`recordFeePayment` from
  `feePayment.service.ts` so the public and authenticated payment flows
  can never drift apart.
- Every lookup/payment endpoint uses the new `publicLookupLimiter`
  (5/hour/IP - stricter than admission's 10/hour since DOB+admissionNo
  guessing is a real enumeration risk against academic/financial data);
  jobs/notices use the more generous `publicSubmitLimiter` (10/hour/IP).
  Failure messaging is always generic ("no matching record found"),
  never confirming which of admissionNo/dateOfBirth was wrong.

**Frontend:**
- `/` rebuilt from a bare redirect into an actual public landing page
  (still redirects an already-logged-in visitor straight to
  `/dashboard`, unchanged) - hero + quick-link cards to Admission
  Inquiry, Check Result, Pay Fees, Careers, Notices, and Login.
- `/results` - admissionNo + DOB form → published results table
  (per-exam subject breakdown + percentage).
- `/pay-fees` - admissionNo + DOB form → dues summary with a "Pay Now"
  button per outstanding fee, wired to a new `payPublicFeeWithRazorpay`
  helper (`lib/razorpay.ts`) mirroring the existing authenticated
  `payFeeWithRazorpay` but hitting the public endpoints.
- `/careers` - public job list + an apply-modal form.
- `/notices` - public notice board.
- `/dashboard/careers` (new, admin-only, linked from the sidebar) -
  post/close/delete vacancies, view + triage applications
  (NEW→SHORTLISTED/REJECTED→HIRED).
- `/dashboard/notices` - existing page gained a "Public" toggle (globe
  icon) per notice, plus a checkbox on the create form.

**Tests:** 63 new tests - `publicPortal.controller.test.ts` (new, 25:
generic-failure DOB/admissionNo mismatch, published-only results,
pending-amount computation, Razorpay order/verify happy+failure paths,
public-notice filtering), `jobVacancy.controller.test.ts` (new, 17:
public list/apply, closing-date rejection, staff CRUD, cross-branch
guards, delete-blocked-by-applications guard), `notice.controller.test.ts`
(+3, `togglePublicVisibility`).

### Verification performed:
- Backend: `npx prisma generate` (schema valid) / `npx tsc --noEmit` /
  `npm test` (**74 suites / 916 tests**, up from 878) / `npm run build` -
  all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, all 64 routes
  build including 5 new public pages + 1 new admin page

---

## Phase 5: Multi-Cabin Chambers + Bulk Floor/Room Creation ✅ COMPLETED

**Status:** ✅ **DONE - final phase of this plan**

### What was actually done:
**Multi-cabin chambers:**
- New `RoomCabin` model: `roomId`, `cabinNo`, `staffId` (nullable - a
  vacant/reserved cabin), `@@unique([roomId, cabinNo])`. Deliberately
  opt-in and separate from `SchoolRoom.assignedStaffId` - the existing
  field is left completely untouched for the common "one room = one
  occupant" case (e.g. the Principal's own chamber); cabins are only
  added for rooms that actually need several named seats tracked
  individually (e.g. a shared staff room with 6 desks).
- `addRoomCabin`/`getRoomCabins`/`updateRoomCabin`/`deleteRoomCabin` -
  same branch-scoping guard convention (resolve the cabin's own room's
  branch from the DB, `canAccessBranch`) as every other facilities
  endpoint, plus the same staff-cross-branch check `addSchoolRoom`
  already applies to `assignedStaffId`.
- Frontend: a new "Cabins" button on CHAMBER/OFFICE/STAFF_ROOM-type
  room cards opens a modal listing that room's cabins - add a cabin
  (number + optional staff), reassign/unassign staff per cabin inline,
  delete a cabin.

**Bulk floor/room creation:**
- `bulkAddSchoolFloors` (`POST /facilities/school-buildings/floors/bulk`) -
  creates N sequential floors on one building in a single `createMany`
  call, auto-numbered from an optional `startingFloorNo` (default 0)
  with an optional `namePrefix` (e.g. "Wing A" → "Wing A Floor 1", "Wing
  A Floor 2", ...).
- `bulkAddSchoolRooms` (`POST /facilities/school-buildings/rooms/bulk`) -
  creates a whole list of rooms on one floor in one call. Any
  `assignedStaffId` cross-branch violations anywhere in the batch fail
  the WHOLE call before anything is written (checked once up front for
  every room in the list, not one lookup per room) - a partial bulk
  result (7 of 8 rooms created) would be a confusing outcome for what's
  meant to be one atomic "set up this floor" action.
- Frontend: "Add Multiple Floors" (count/starting-number/name-prefix
  form) and "Add Multiple Rooms" (repeatable row editor) buttons
  alongside the existing single-add forms - both single-add flows are
  kept, not replaced, for the common one-off case.

**Multiple buildings:** verified already fully supported (no code
change needed) - `getSchoolBuildings` lists every building for the
branch with no limit, confirmed during this session's initial codebase
read.

**Tests:** 22 new tests in `schoolBuilding.controller.test.ts` -
sequential floor numbering + custom starting-number/prefix, whole-batch
rejection on a bad cross-branch `assignedStaffId` in bulk room creation,
full cabin CRUD, cabin staff cross-branch guard, cross-branch guards on
both bulk endpoints.

### Verification performed:
- Backend: `npx prisma generate` (schema valid) / `npx tsc --noEmit` /
  `npm test` (**74 suites / 938 tests**, up from 916) / `npm run build` -
  all clean
- Frontend: `npx tsc --noEmit` / `npm run build` - clean, `buildings`
  page grew 5.5kB->7.18kB

---

## This plan is now fully complete
All 5 phases have shipped, been tested, and merged: exam timetable +
teacher-scoped question paper upload, exam seat plan generator
(gender/section/roll-no filters, alternate-gender seating), per-sitting
room-wise exam attendance, a public landing page with result/fee
lookup + online payment + careers + a public notice board, and
multi-cabin teacher chambers + bulk floor/room creation.

---

## Workflow
Same as every prior phase in this project: implement backend -> tests ->
typecheck+build backend -> frontend wiring -> typecheck+build frontend ->
commit -> branch -> PR -> wait for merge/"next" before continuing.
