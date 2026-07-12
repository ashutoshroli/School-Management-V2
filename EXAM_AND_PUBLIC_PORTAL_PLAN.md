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

## Phase 3: Exam Attendance

- New `ExamAttendance` model: `examScheduleId`, `studentId`, `status`
  (PRESENT/ABSENT/UNFAIR_MEANS/LATE), `markedBy`, `remarks` - deliberately
  separate from daily `StudentAttendance` (a student can be present for
  daily attendance but absent for one specific exam paper, or vice versa).
- `markExamAttendance` (bulk, room-wise - the invigilator marks everyone
  in their allocated room in one call, pre-filled from `ExamSeatAllocation`),
  `getExamAttendance` (by examScheduleId, room-wise), `getExamAttendanceSummary`
  (present/absent/unfair-means counts for the whole exam across all subjects).
- `enterMarks` gets an optional cross-check: warns (not blocks - a student
  marked absent for the exam attendance but somehow later given marks is a
  real edge case, e.g. supplementary) if marks are entered for a student
  marked ABSENT in `ExamAttendance` for that subject's sitting.

**Tests:** bulk marking, room-scoped invigilator access, the marks-entry
cross-check warning.

---

## Phase 4: Public Landing Page + Result/Fee Status Portals

**Backend (public, rate-limited, following the `verifyCertificate`/
`admission` pattern exactly):**
- `GET /public/notices` - notices explicitly flagged public
  (`Notice.isPublic Boolean @default(false)`, new field, admin opts in
  per-notice) - a school announcement board visible to anyone, not just
  logged-in users.
- `JobVacancy` model (new): title, department, description, qualifications,
  branchId, isActive, postedAt, closingDate. `GET /public/jobs` (public
  list) + `POST /jobs/:id/apply` (public, applicant name/email/phone/resume
  upload -> new `JobApplication` model) + staff-only CRUD/review, mirroring
  `AdmissionInquiry`'s "public submit, staff reviews" shape exactly.
- `POST /public/results/lookup` `{admissionNo, dateOfBirth}` - verifies
  both match one active student, then returns ONLY their **published**
  exam results (never unpublished ones) - same minimal-disclosure
  principle as `verifyCertificate`.
- `POST /public/fees/lookup` `{admissionNo, dateOfBirth}` - returns
  outstanding dues summary (no full ledger) + a "Pay Now" hand-off into
  the existing Razorpay payment flow (`config/razorpay.ts` already
  configured) scoped to that one student - reusing the existing payment
  creation logic, not rebuilding it.
- Both lookups rate-limited harder than admission (5/hour/IP) since
  DOB+admissionNo guessing is a real enumeration risk against real
  students' academic/financial data - lockout messaging is generic
  ("no matching record") either way, never confirming which field was wrong.

**Frontend:**
- New public landing page at `/` (replacing the current bare redirect) -
  hero, About/branches section, quick links: Notices, Admission Inquiry
  (existing form, now linked from here), Careers/Jobs, Check Result, Pay
  Fees, Login.
- `/results` - admissionNo + DOB form -> published results table.
- `/pay-fees` - admissionNo + DOB form -> dues summary + Razorpay checkout.
- `/careers` - public job list + apply form.
- `/notices` (public) - public notice board.

**Tests:** lookup rate-limiting, DOB-mismatch rejection, unpublished-result
exclusion, job application submission, cross-branch isolation on all new
public endpoints.

---

## Phase 5: Multi-Cabin Chambers + Bulk Floor/Room Creation

**Multi-cabin chambers:**
- New `RoomCabin` model: `roomId` (must be a CHAMBER/OFFICE-type
  `SchoolRoom`), `cabinNo`, `staffId` (nullable - a vacant cabin), so one
  physical room can hold several teachers' cabins (e.g. a shared staff
  room with 6 cabins). `SchoolRoom.assignedStaffId` stays as-is for
  single-occupant rooms (unaffected, fully backward compatible) - cabins
  are opt-in only for rooms that need them.
- `addRoomCabin`/`updateRoomCabin`/`deleteRoomCabin`/`getRoomCabins` -
  same branch-scoping guard convention as every other facilities endpoint.
- Frontend: a room card for CHAMBER-type rooms gains a "Cabins" expandable
  list (add/edit/remove cabin, assign/unassign staff per cabin) instead of
  the single staff picker.

**Bulk floor/room creation:**
- `bulkAddSchoolFloors(buildingId, { count, startingFloorNo, namePrefix })`
  - creates N floors at once (e.g. "Floor 1".."Floor 5").
- `bulkAddSchoolRooms(floorId, { rooms: [{roomNo, name, type, capacity, ...}] })`
  - creates a whole list of rooms on one floor in a single call, so
  setting up an entire new building (say, 4 floors x 8 rooms) takes 2
  calls instead of 32.
- Frontend: "Add Multiple Floors" and "Add Multiple Rooms" bulk modals
  alongside the existing single-add forms (both kept, not replaced).

**Multiple buildings:** already fully supported today - documented here
for completeness, no code change needed; this phase's write-up will note
it as "verified, not rebuilt."

**Tests:** bulk floor/room creation counts and validation, cabin CRUD,
cabin staff cross-branch guard, backward-compat check that existing
single-staff CHAMBER rooms are untouched.

---

## Workflow
Same as every prior phase in this project: implement backend -> tests ->
typecheck+build backend -> frontend wiring -> typecheck+build frontend ->
commit -> branch -> PR -> wait for merge/"next" before continuing.
