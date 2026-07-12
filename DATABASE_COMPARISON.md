# Phase 3: Database Comparison & Migration Plan

## Current Schema Analysis (School-Management-V2)

### Existing Models (60+ total):

| Section | Models | Status |
|---------|--------|--------|
| Organization & Branch | Organization, Branch | ✅ Complete |
| Users & Permissions | User, Permission, UserPermission | ✅ Complete |
| Staff (HR) | Staff, StaffDocument, SalaryStructure, Payslip | ✅ Complete |
| Students & Parents | Student, StudentDocument, Parent, StudentParent | ✅ Complete |
| Academics | Class, Section, Subject, ClassSubject, SubjectTeacher | ✅ Complete |
| Academic Year | AcademicYear | ✅ Complete |
| Fees | FeeCategory, FeeStructure, FeeInstallment, FeeAssignment, Payment, Refund, StudentDiscount | ✅ Complete |
| Accounting | Account, Voucher, VoucherEntry | ✅ Complete |
| Payroll | SalaryStructure, Payslip | ✅ Complete |
| Attendance (Staff) | StaffAttendance, Holiday, LeaveType, LeaveApplication | ✅ Complete |
| Attendance (Student) | StudentAttendance, AttendanceDevice, PeriodConfig | ✅ Complete |
| Exams | Exam, Mark, GradeSystem, Promotion, ExamSchedule, ExamQuestionPaper, ExamSeatAllocation, ExamAttendance | ✅ Complete |
| Timetable | Timetable, TimetableSlot | ✅ Complete |
| Homework | Homework, HomeworkSubmission | ✅ Complete |
| Library | LibraryBook, LibraryIssue | ✅ Complete |
| Inventory | InventoryItem, InventoryPurchase, InventoryIssue | ✅ Complete |
| Transport | TransportRoute, TransportStop, Vehicle, VehicleRoute, TransportAllocation | ✅ Complete |
| Hostel | HostelBuilding, HostelFloor, HostelRoom, HostelAllocation | ✅ Complete |
| School Building | SchoolBuilding, SchoolFloor, SchoolRoom, RoomCabin | ✅ Complete |
| Communication | Notice, Message, Notification, DeviceToken | ✅ Complete |
| Certificates | CertificateTemplate, GeneratedCertificate, DocumentTemplate | ✅ Complete |
| Audit | AuditLog | ✅ Complete |
| Admission | AdmissionInquiry | ✅ Complete |
| Careers | JobVacancy, JobApplication | ✅ Complete |

---

## Missing Models (Required for Feature Parity with OpenEduCat)

Based on the feature inventory, the following new models are needed:


### NEW MODELS REQUIRED:

| # | Model | Module | Purpose |
|---|-------|--------|---------|
| 1 | StudentHealth | Student Health | Medical records, allergies, immunizations |
| 2 | DisciplineIncident | Discipline | Behavior incidents, warnings, actions |
| 3 | Event | Calendar/Events | School events, meetings, PTMs |
| 4 | EventAttendee | Calendar/Events | Event RSVP/attendance |
| 5 | Syllabus | Syllabus | Subject-wise syllabus chapters |
| 6 | LessonPlan | Lesson Planning | Teacher's daily/weekly lesson plans |
| 7 | StudyMaterial | Content | Shared files/resources per subject |
| 8 | Visitor | Visitor Mgmt | Gate pass/visitor log |
| 9 | Alumni | Alumni | Graduate tracking |
| 10 | Scholarship | Scholarship | Application, approval, disbursement |
| 11 | Grievance | Grievance | Complaint tracking & resolution |
| 12 | FacilityBooking | Facility | Room/lab/auditorium reservation |
| 13 | Feedback | Survey | Teacher/course feedback |
| 14 | FeedbackQuestion | Survey | Question templates |
| 15 | FeedbackResponse | Survey | Student responses |
| 16 | PasswordResetToken | Auth | Email-based password reset |
| 17 | SystemSetting | Settings | Key-value config store |
| 18 | QuestionBank | Online Exam | Question repository |
| 19 | Quiz | Online Exam | Online quiz/test |
| 20 | QuizQuestion | Online Exam | Quiz-question junction |
| 21 | QuizAttempt | Online Exam | Student quiz submission |
| 22 | QuizAnswer | Online Exam | Individual answers |
| 23 | SubjectGroup | Academics | Stream grouping (Sci/Com/Arts) |
| 24 | LeaveBalance | HR | Annual leave balance tracking |
| 25 | LibraryReservation | Library | Book hold/reservation |

---

### COLUMN ADDITIONS TO EXISTING MODELS:

| Model | New Column | Type | Purpose |
|-------|-----------|------|---------|
| Student | emergencyContact | String? | Emergency contact number |
| Student | emergencyPhone | String? | Emergency phone |
| Student | medicalNotes | String? | Quick medical reference |
| Student | transportMode | TransportMode? | How student commutes |
| Student | photoUrl | String? | Profile photo URL |
| Staff | photoUrl | String? | Profile photo URL |
| Staff | emergencyContact | String? | Emergency contact |
| Staff | emergencyPhone | String? | Emergency phone |
| Organization | timezone | String? | Default timezone |
| Organization | currency | String? | Default currency code |
| Organization | locale | String? | Default locale |
| Organization | financialYearStart | Int? | Month (1-12) FY starts |
| Branch | principalId | String? | Principal staff ref |
| Branch | affiliation | String? | Board (CBSE/ICSE/State) |
| Branch | affiliationNo | String? | Affiliation number |
| User | passwordResetAt | DateTime? | Last password reset |
| User | failedLoginAttempts | Int | Brute-force counter |
| User | lockedUntil | DateTime? | Account lockout timestamp |
| Notification | readAt | DateTime? | Read timestamp |
| Notice | readCount | Int | Read tracking counter |
| LibraryBook | edition | String? | Book edition |
| LibraryBook | year | Int? | Publication year |
| LibraryBook | language | String? | Book language |
| HostelBuilding | contactPhone | String? | Warden phone |
| Section | strengthBoys | Int? | Male student count cache |
| Section | strengthGirls | Int? | Female student count cache |

---

### NEW ENUMS REQUIRED:

| Enum | Values | Module |
|------|--------|--------|
| TransportMode | SCHOOL_BUS, PRIVATE_VEHICLE, WALK, BICYCLE, PUBLIC_TRANSPORT | Student |
| IncidentSeverity | LOW, MEDIUM, HIGH, CRITICAL | Discipline |
| IncidentAction | WARNING, DETENTION, SUSPENSION, EXPULSION, COUNSELING | Discipline |
| EventType | ACADEMIC, CULTURAL, SPORTS, MEETING, PTM, HOLIDAY, OTHER | Events |
| GrievanceStatus | OPEN, IN_PROGRESS, RESOLVED, CLOSED, ESCALATED | Grievance |
| GrievancePriority | LOW, MEDIUM, HIGH, URGENT | Grievance |
| BookingStatus | PENDING, APPROVED, REJECTED, CANCELLED, COMPLETED | Facility |
| QuizStatus | DRAFT, PUBLISHED, CLOSED, ARCHIVED | Online Exam |
| QuestionType | MCQ, TRUE_FALSE, SHORT_ANSWER, LONG_ANSWER, FILL_BLANK | Quiz |
| MaterialType | PDF, VIDEO, LINK, DOCUMENT, IMAGE, AUDIO | Study Material |
| ScholarshipStatus | APPLIED, APPROVED, REJECTED, DISBURSED, REVOKED | Scholarship |
| VisitorPurpose | PARENT_MEETING, OFFICIAL, DELIVERY, INTERVIEW, OTHER | Visitor |
| AlumniStatus | ACTIVE, INACTIVE | Alumni |

---


## Migration Script Plan

### File: `db/prisma/schema-additions.prisma`
Contains all new models, enums, and column additions needed for feature parity.

### Migration Steps:

```bash
# Step 1: Merge schema-additions.prisma into schema.prisma
# (manual merge - add enums, models, and relation fields)

# Step 2: Add new relation fields to existing models
# See "SECTION R" in schema-additions.prisma for exact fields

# Step 3: Generate and apply migration
cd db
npx prisma migrate dev --name feature_parity_v1

# Step 4: Update seed data for new models
# Add default system settings, sample data for new modules
```

---

## Index Strategy for New Models

| Model | Index | Columns | Purpose |
|-------|-------|---------|---------|
| DisciplineIncident | composite | branchId, studentId | Student incident lookup |
| DisciplineIncident | composite | branchId, incidentDate | Date-range reports |
| Event | composite | branchId, startDate | Upcoming events query |
| Event | composite | branchId, type | Type filtering |
| Syllabus | composite | branchId, classId, subjectId | Syllabus lookup |
| Visitor | composite | branchId, inTime | Daily visitor log |
| Alumni | composite | branchId, batchYear | Batch-wise alumni |
| Scholarship | composite | branchId, academicYearId | Year-wise scholarship |
| Grievance | composite | branchId, status | Open grievances |
| FacilityBooking | composite | branchId, roomId, date | Room availability |
| QuestionBank | composite | branchId, subjectId, classId | Question search |
| Quiz | composite | branchId, classId, subjectId | Quiz lookup |
| QuizAttempt | single | studentId | Student's quiz history |
| SystemSetting | single | category | Settings by category |
| LeaveBalance | composite | staffId, academicYear | Staff leave lookup |
| LibraryReservation | composite | bookId, status | Active reservations |

---

## Foreign Key Relationships Summary (New Models)

```
StudentHealth ──── Student (1:1)
Immunization ──── StudentHealth (N:1)
HealthVisit ──── StudentHealth (N:1)
DisciplineIncident ──── Student (N:1)
Event ──── Branch (via branchId, no FK enforced - matches existing pattern)
EventAttendee ──── Event (N:1)
Syllabus ──── Branch, Subject, Class (N:1 each)
LessonPlan ──── Syllabus (N:1, optional)
StudyMaterial ──── Branch, Subject, Class (N:1 each)
Visitor ──── Branch (via branchId)
Alumni ──── Branch (via branchId), Student (optional)
Scholarship ──── Branch (via branchId)
ScholarshipApplication ──── Scholarship, Student (N:1 each)
Grievance ──── Branch (via branchId)
GrievanceResponse ──── Grievance (N:1)
FacilityBooking ──── Branch, SchoolRoom (via IDs)
FeedbackForm ──── Branch (via branchId)
FeedbackQuestion ──── FeedbackForm (N:1)
FeedbackResponse ──── FeedbackForm (N:1)
FeedbackAnswer ──── FeedbackResponse, FeedbackQuestion (N:1 each)
QuestionBank ──── Branch, Subject, Class (via IDs)
Quiz ──── Branch, Class, Subject (via IDs)
QuizQuestion ──── Quiz, QuestionBank (N:1 each)
QuizAttempt ──── Quiz, Student (N:1 each - Student via studentId)
QuizAnswer ──── QuizAttempt (N:1)
PasswordResetToken ──── User (via userId)
LeaveBalance ──── Staff, LeaveType (via IDs)
LibraryReservation ──── LibraryBook, User (via IDs)
SubjectGroup ──── Branch, Class (via IDs)
SubjectGroupMapping ──── SubjectGroup, Subject (N:1 each)
```

---

## Breaking Changes: NONE

All additions are:
- New models (no modification to existing tables)
- New optional columns on existing models (nullable, won't break existing data)
- New indexes (improve performance, no breaking change)
- New enums (purely additive)

**Zero downtime migration possible** - all changes are additive.

---

## Data Compatibility Notes

1. **Existing seed data** remains fully valid
2. **No column renames or type changes** on existing models
3. **New required fields** (on new models only) have defaults or are set at creation time
4. **SystemSetting** model replaces hardcoded .env values for runtime-configurable settings
5. **LeaveBalance** must be initialized for existing staff records (migration script needed)

---

*Generated: July 12, 2026*
*Schema additions file: `db/prisma/schema-additions.prisma`*
*Total new models: 25 | Total new enums: 13 | Total new indexes: 16*
