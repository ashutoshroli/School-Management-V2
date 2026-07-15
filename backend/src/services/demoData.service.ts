import { Prisma, PaymentMode, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { seedDefaultAccountsForBranch, DEFAULT_CHART_OF_ACCOUNTS } from "./defaultChartOfAccounts";
import { recordFeePayment } from "./feePayment.service";

/**
 * Bulk realistic demo-data generator for a single branch, used by the
 * admin-only "Generate Demo Data" action (Settings page). Everything
 * created here goes through the SAME tables/shapes real usage would
 * produce (no special "isDemo" flag exists anywhere in the schema) -
 * this is meant to make an otherwise-empty branch look and behave like
 * a real, lived-in school for demoing/testing every module at once,
 * not a separate sandboxed dataset.
 *
 * Deliberately does NOT touch Organization/Branch/AcademicYear/Class/
 * Section/Subject/FeeCategory/Chart-of-Accounts/LeaveType - those are
 * structural setup the branch is expected to already have (either from
 * db/prisma/seed.ts, seedDemoData below, or normal admin usage); this
 * only fills in the *transactional* data that's tedious to create by
 * hand one at a time.
 *
 * seedDemoData/getDemoDataStatus/removeDemoData further down this file
 * are the STRUCTURAL counterpart: they create/remove the demo
 * Organization/Branch/AcademicYear/Class/Section/Subject/FeeCategory/
 * Chart-of-Accounts/Permissions/LeaveTypes a branch needs to exist at
 * all, entirely from the server (Settings > Demo Data) - no local
 * machine or Shell access required, unlike db/prisma/seed.ts (see
 * DEPLOY.md's Step 4). Use that first on a brand-new/empty deployment,
 * then generateDemoDataForBranch (above) to fill it with realistic
 * transactional records.
 */

const FIRST_NAMES_MALE = [
  "Aarav", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan",
  "Aditya", "Vivaan", "Kabir", "Ayaan", "Dhruv", "Karan", "Aryan", "Yash",
  "Shaurya", "Advait", "Rudra", "Om", "Harsh", "Pranav", "Nikhil", "Rahul",
  "Amit", "Vikram", "Manish", "Suresh", "Rajesh", "Anil",
];
const FIRST_NAMES_FEMALE = [
  "Ananya", "Diya", "Saanvi", "Aadhya", "Kiara", "Myra", "Sara", "Ira",
  "Anika", "Navya", "Riya", "Ishita", "Pari", "Aarohi", "Kavya", "Prisha",
  "Meera", "Zara", "Avni", "Siya", "Priya", "Neha", "Pooja", "Sneha",
  "Divya", "Anjali", "Kavita", "Sunita", "Deepika", "Swati",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Reddy", "Nair",
  "Iyer", "Menon", "Rao", "Joshi", "Mehta", "Chopra", "Kapoor", "Malhotra",
  "Bhatt", "Desai", "Agarwal", "Bansal", "Chauhan", "Yadav", "Pandey", "Mishra",
  "Tiwari", "Saxena", "Bose", "Chatterjee", "Das", "Ghosh",
];
const CITIES = ["New Delhi", "Mumbai", "Bengaluru", "Pune", "Hyderabad", "Chennai", "Kolkata", "Jaipur", "Lucknow", "Ahmedabad"];
const STATES: Record<string, string> = {
  "New Delhi": "Delhi", Mumbai: "Maharashtra", Bengaluru: "Karnataka", Pune: "Maharashtra",
  Hyderabad: "Telangana", Chennai: "Tamil Nadu", Kolkata: "West Bengal", Jaipur: "Rajasthan",
  Lucknow: "Uttar Pradesh", Ahmedabad: "Gujarat",
};
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const CATEGORIES = ["General", "OBC", "SC", "ST"];
const DESIGNATIONS_TEACHING = ["PGT", "TGT", "PRT", "Senior Teacher", "Subject Teacher"];
const DESIGNATIONS_NON_TEACHING = ["Accountant", "Librarian", "Office Assistant", "Lab Assistant", "Receptionist"];

let seq = 0;
/** Monotonic-per-run counter mixed into email/phone generation, so two
 * demo people who happen to roll the same name still get distinct,
 * valid-looking contact info instead of colliding on email uniqueness. */
const nextSeq = () => ++seq;

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const shuffle = <T>(arr: T[]): T[] => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const makePerson = (gender: "MALE" | "FEMALE" | "OTHER" = pick(["MALE", "FEMALE"] as const)) => {
  const first = gender === "FEMALE" ? pick(FIRST_NAMES_FEMALE) : pick(FIRST_NAMES_MALE);
  const last = pick(LAST_NAMES);
  const city = pick(CITIES);
  return {
    name: `${first} ${last}`,
    firstName: first,
    lastName: last,
    gender,
    city,
    state: STATES[city],
    phone: `+91-9${randomInt(100000000, 999999999)}`,
  };
};

const emailFor = (name: string, domainTag: string) => {
  const slug = name.toLowerCase().replace(/[^a-z]/g, ".");
  return `${slug}.${nextSeq()}@${domainTag}.demo`;
};

export interface DemoDataOptions {
  studentsPerSection?: number; // default 15, capped at 40 for safety
  staffCount?: number; // default 20, capped at 100
  attendanceDays?: number; // trailing weekdays to backfill, default 20, capped at 60
  includeFeesAndPayments?: boolean; // default true
  includeExamsAndMarks?: boolean; // default true
  includeAttendance?: boolean; // default true
  includeHomeworkAndNotices?: boolean; // default true
  includeTransportAndLibrary?: boolean; // default true
}

export interface DemoDataResult {
  studentsCreated: number;
  parentsCreated: number;
  staffCreated: number;
  feeStructuresCreated: number;
  feeAssignmentsCreated: number;
  paymentsCreated: number;
  attendanceRecordsCreated: number;
  examsCreated: number;
  marksCreated: number;
  homeworkCreated: number;
  noticesCreated: number;
  transportRoutesCreated: number;
  transportAllocationsCreated: number;
  libraryBooksCreated: number;
  libraryIssuesCreated: number;
}

/** Small helper: creates N items sequentially (not Promise.all) so we
 * never fire hundreds of concurrent writes at the pooled DB connection
 * - bulk demo generation is a background admin action, not a
 * latency-sensitive request, so trading some wall-clock time for a
 * predictable, low connection-pressure write pattern is the right
 * tradeoff here. */
async function sequentially<T>(count: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < count; i++) {
    results.push(await fn(i));
  }
  return results;
}

export const generateDemoDataForBranch = async (
  branchId: string,
  actingUserId: string,
  options: DemoDataOptions = {}
): Promise<DemoDataResult> => {
  const studentsPerSection = Math.min(Math.max(options.studentsPerSection ?? 15, 1), 40);
  const staffCount = Math.min(Math.max(options.staffCount ?? 20, 1), 100);
  const attendanceDays = Math.min(Math.max(options.attendanceDays ?? 20, 1), 60);

  const result: DemoDataResult = {
    studentsCreated: 0, parentsCreated: 0, staffCreated: 0,
    feeStructuresCreated: 0, feeAssignmentsCreated: 0, paymentsCreated: 0,
    attendanceRecordsCreated: 0, examsCreated: 0, marksCreated: 0,
    homeworkCreated: 0, noticesCreated: 0,
    transportRoutesCreated: 0, transportAllocationsCreated: 0,
    libraryBooksCreated: 0, libraryIssuesCreated: 0,
  };

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new Error("Branch not found");

  const organizationId = (await prisma.user.findUnique({ where: { id: actingUserId } }))?.organizationId || undefined;

  let academicYear = await prisma.academicYear.findFirst({ where: { branchId, isActive: true } });
  if (!academicYear) academicYear = await prisma.academicYear.findFirst({ where: { branchId }, orderBy: { startDate: "desc" } });
  if (!academicYear) throw new Error("No academic year found for this branch - create one first (Academic Years page)");

  const classes = await prisma.class.findMany({
    where: { branchId },
    include: { sections: true },
    orderBy: { numericOrder: "asc" },
  });
  if (classes.length === 0) throw new Error("No classes found for this branch - create classes/sections first");

  const subjects = await prisma.subject.findMany({ where: { branchId } });
  const feeCategories = await prisma.feeCategory.findMany({ where: { branchId, isActive: true } });

  // ---- 1. STUDENTS + PARENTS ----
  const createdStudentIds: { id: string; classId: string; sectionId: string }[] = [];
  for (const cls of classes) {
    for (const section of cls.sections) {
      const existingCount = await prisma.student.count({ where: { sectionId: section.id } });
      const toCreate = Math.max(0, studentsPerSection - existingCount);
      await sequentially(toCreate, async () => {
        const person = makePerson();
        const admissionCount = await prisma.student.count({ where: { branchId } });
        const admissionNo = `${branch.code}-${String(admissionCount + 1).padStart(5, "0")}`;

        const studentUser = await prisma.user.create({
          data: {
            email: emailFor(person.name, "student"),
            name: person.name,
            phone: person.phone,
            role: UserRole.STUDENT,
            organizationId,
            isActive: true,
          },
        });

        const dob = new Date(
          new Date().getFullYear() - (18 - cls.numericOrder > 0 ? 18 - cls.numericOrder : 5),
          randomInt(0, 11),
          randomInt(1, 28)
        );

        const student = await prisma.student.create({
          data: {
            userId: studentUser.id,
            branchId,
            admissionNo,
            rollNo: String(existingCount + 1),
            classId: cls.id,
            sectionId: section.id,
            dateOfBirth: dob,
            gender: person.gender,
            bloodGroup: pick(BLOOD_GROUPS),
            category: pick(CATEGORIES),
            nationality: "Indian",
            address: `${randomInt(1, 200)}, ${pick(["MG Road", "Park Street", "Civil Lines", "Model Town", "Sector 12"])}`,
            city: person.city,
            state: person.state,
            pincode: String(randomInt(110001, 700099)),
            admissionDate: new Date(academicYear!.startDate),
            isActive: true,
          },
        });
        createdStudentIds.push({ id: student.id, classId: cls.id, sectionId: section.id });
        result.studentsCreated++;

        // One father + one mother per student, realistic and linked.
        const father = makePerson("MALE");
        const fatherUser = await prisma.user.create({
          data: { email: emailFor(father.name, "parent"), name: father.name, phone: father.phone, role: UserRole.PARENT, organizationId, isActive: true },
        });
        const fatherParent = await prisma.parent.create({ data: { userId: fatherUser.id, relation: "FATHER", occupation: pick(["Business", "Engineer", "Doctor", "Government Employee", "Teacher", "Farmer"]) } });
        await prisma.studentParent.create({ data: { studentId: student.id, parentId: fatherParent.id } });
        result.parentsCreated++;

        const mother = makePerson("FEMALE");
        const motherUser = await prisma.user.create({
          data: { email: emailFor(mother.name, "parent"), name: mother.name, phone: mother.phone, role: UserRole.PARENT, organizationId, isActive: true },
        });
        const motherParent = await prisma.parent.create({ data: { userId: motherUser.id, relation: "MOTHER", occupation: pick(["Homemaker", "Teacher", "Business", "Nurse", "Government Employee"]) } });
        await prisma.studentParent.create({ data: { studentId: student.id, parentId: motherParent.id } });
        result.parentsCreated++;
      });
    }
  }

  // ---- 2. STAFF ----
  const teachingCount = Math.round(staffCount * 0.7);
  const createdStaffIds: string[] = [];
  await sequentially(staffCount, async (i) => {
    const isTeaching = i < teachingCount;
    const person = makePerson();
    const employeeCount = await prisma.staff.count({ where: { branchId } });
    const employeeId = `EMP-${branch.code}-${String(employeeCount + 1).padStart(4, "0")}`;
    const hashedPassword = await bcrypt.hash("Staff@123", 12);

    const user = await prisma.user.create({
      data: {
        email: emailFor(person.name, "staff"),
        name: person.name,
        phone: person.phone,
        password: hashedPassword,
        role: isTeaching ? UserRole.TEACHER : UserRole.STAFF,
        organizationId,
        isActive: true,
      },
    });

    const staff = await prisma.staff.create({
      data: {
        userId: user.id,
        branchId,
        employeeId,
        designation: isTeaching ? pick(DESIGNATIONS_TEACHING) : pick(DESIGNATIONS_NON_TEACHING),
        department: isTeaching ? "Academics" : pick(["Administration", "Accounts", "Library", "Operations"]),
        type: isTeaching ? "TEACHING" : "NON_TEACHING",
        qualification: isTeaching ? pick(["B.Ed, M.A.", "B.Ed, M.Sc.", "B.Ed, B.A.", "M.Ed"]) : pick(["B.Com", "B.A.", "Diploma"]),
        experience: `${randomInt(1, 20)} years`,
        joiningDate: new Date(new Date().getFullYear() - randomInt(0, 8), randomInt(0, 11), randomInt(1, 28)),
        address: `${randomInt(1, 200)}, ${pick(["MG Road", "Park Street", "Civil Lines"])}`,
        city: person.city,
        state: person.state,
        pincode: String(randomInt(110001, 700099)),
        isActive: true,
      },
    });
    createdStaffIds.push(staff.id);
    result.staffCreated++;
  });

  // Assign class teachers (one teacher per section that doesn't have one yet).
  const teacherStaffIds = createdStaffIds.length > 0 ? createdStaffIds : (await prisma.staff.findMany({ where: { branchId, type: "TEACHING" }, select: { id: true } })).map((s) => s.id);
  if (teacherStaffIds.length > 0) {
    const sectionsNeedingTeacher = await prisma.section.findMany({ where: { branchId, classTeacherId: null } });
    // BUG FIX: a staff member can be the class teacher of AT MOST ONE
    // section (Section.classTeacherId is now @unique) - the old
    // pick(teacherStaffIds) sampled WITH replacement, so two sections
    // could randomly get the SAME teacher and crash the whole demo
    // data generation on a unique-constraint violation. Shuffle once
    // and hand out teachers WITHOUT replacement instead; if there are
    // more sections than available teachers, the excess sections
    // simply stay unassigned (no class teacher) rather than erroring.
    const availableTeachers = shuffle(teacherStaffIds);
    await sequentially(Math.min(sectionsNeedingTeacher.length, availableTeachers.length), async (i) => {
      await prisma.section.update({ where: { id: sectionsNeedingTeacher[i].id }, data: { classTeacherId: availableTeachers[i] } });
    });

    // Subject-teacher assignments for a handful of subjects per class.
    if (subjects.length > 0) {
      for (const cls of classes) {
        const subjectSample = shuffle(subjects).slice(0, Math.min(5, subjects.length));
        await sequentially(subjectSample.length, async (i) => {
          const subject = subjectSample[i];
          const existing = await prisma.subjectTeacher.findUnique({
            where: { staffId_subjectId_classId: { staffId: pick(teacherStaffIds), subjectId: subject.id, classId: cls.id } },
          }).catch(() => null);
          if (existing) return;
          await prisma.subjectTeacher.create({ data: { staffId: pick(teacherStaffIds), subjectId: subject.id, classId: cls.id } }).catch(() => {});
        });
      }
    }
  }

  // ---- 3. FEES: structures, assignments, payments ----
  if (options.includeFeesAndPayments !== false && feeCategories.length > 0) {
    await seedDefaultAccountsForBranch(branchId);
    const tuitionCategory = feeCategories.find((c) => c.code === "TUITION") || feeCategories[0];

    for (const cls of classes) {
      let structure = await prisma.feeStructure.findUnique({
        where: { branchId_academicYearId_classId_feeCategoryId: { branchId, academicYearId: academicYear!.id, classId: cls.id, feeCategoryId: tuitionCategory.id } },
      });
      if (!structure) {
        structure = await prisma.feeStructure.create({
          data: {
            branchId, academicYearId: academicYear!.id, classId: cls.id, feeCategoryId: tuitionCategory.id,
            amount: 1000 + cls.numericOrder * 150,
            frequency: "MONTHLY", dueDay: 10, lateFeeType: "FIXED", lateFeeValue: 10, isActive: true,
          },
        });
        result.feeStructuresCreated++;
      }

      const studentsInClass = createdStudentIds.filter((s) => s.classId === cls.id);
      await sequentially(studentsInClass.length, async (i) => {
        const student = studentsInClass[i];
        const existingAssignment = await prisma.feeAssignment.findUnique({
          where: { studentId_feeStructureId: { studentId: student.id, feeStructureId: structure!.id } },
        });
        if (existingAssignment) return;

        const assignment = await prisma.feeAssignment.create({
          data: { studentId: student.id, feeStructureId: structure!.id, totalAmount: structure!.amount, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
        });
        result.feeAssignmentsCreated++;

        // ~70% of students have paid at least one installment - gives
        // Fee Reports/Collection/Accounting something realistic to show
        // (a mix of PAID/PARTIAL/PENDING) instead of everything pending.
        if (Math.random() < 0.7) {
          const fullAssignment = await prisma.feeAssignment.findUnique({
            where: { id: assignment.id },
            include: { feeStructure: true, student: { select: { branchId: true } } },
          });
          if (fullAssignment) {
            try {
              await prisma.$transaction((tx) =>
                recordFeePayment(tx, fullAssignment, {
                  branchId,
                  studentId: student.id,
                  feeAssignmentId: assignment.id,
                  amount: Number(structure!.amount),
                  paymentMode: pick(["CASH", "UPI", "ONLINE_RAZORPAY", "BANK_TRANSFER"] as PaymentMode[]),
                  remarks: "Demo data - monthly fee payment",
                })
              );
              result.paymentsCreated++;
            } catch {
              // Chart of accounts race/edge case - skip this one payment
              // rather than failing the entire generation run.
            }
          }
        }
      });
    }
  }

  // ---- 4. ATTENDANCE (students + staff, trailing weekdays) ----
  if (options.includeAttendance !== false) {
    const weekdays: Date[] = [];
    let cursor = new Date();
    while (weekdays.length < attendanceDays) {
      cursor.setDate(cursor.getDate() - 1);
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) weekdays.push(new Date(cursor));
    }

    for (const day of weekdays) {
      const dateOnly = new Date(day.getFullYear(), day.getMonth(), day.getDate());

      const studentRows = createdStudentIds.map((s) => {
        const roll = Math.random();
        const status = roll < 0.88 ? "PRESENT" : roll < 0.94 ? "ABSENT" : roll < 0.98 ? "LATE" : "HALF_DAY";
        return { studentId: s.id, sectionId: s.sectionId, date: dateOnly, status: status as any, source: "MANUAL" as const };
      });
      if (studentRows.length > 0) {
        const created = await prisma.studentAttendance.createMany({ data: studentRows, skipDuplicates: true });
        result.attendanceRecordsCreated += created.count;
      }

      if (createdStaffIds.length > 0) {
        const staffRows = createdStaffIds.map((staffId) => {
          const roll = Math.random();
          const status = roll < 0.92 ? "PRESENT" : roll < 0.97 ? "ABSENT" : "LATE";
          return { staffId, date: dateOnly, status: status as any, source: "MANUAL" as const };
        });
        const created = await prisma.staffAttendance.createMany({ data: staffRows, skipDuplicates: true });
        result.attendanceRecordsCreated += created.count;
      }
    }
  }

  // ---- 5. EXAMS + MARKS ----
  if (options.includeExamsAndMarks !== false && subjects.length > 0) {
    for (const cls of classes) {
      const examName = `Unit Test 1 - ${academicYear!.name}`;
      let exam = await prisma.exam.findFirst({ where: { academicYearId: academicYear!.id, classId: cls.id, name: examName } });
      if (!exam) {
        exam = await prisma.exam.create({
          data: { academicYearId: academicYear!.id, classId: cls.id, name: examName, type: "UNIT_TEST", startDate: new Date(), endDate: new Date(), isPublished: true },
        });
        result.examsCreated++;
      }

      const studentsInClass = createdStudentIds.filter((s) => s.classId === cls.id);
      const subjectSample = shuffle(subjects).slice(0, Math.min(4, subjects.length));
      for (const student of studentsInClass) {
        await sequentially(subjectSample.length, async (i) => {
          const subject = subjectSample[i];
          const existing = await prisma.mark.findUnique({ where: { examId_studentId_subjectId: { examId: exam!.id, studentId: student.id, subjectId: subject.id } } });
          if (existing) return;
          const obtained = randomInt(28, 50);
          await prisma.mark.create({
            data: { examId: exam!.id, studentId: student.id, subjectId: subject.id, maxMarks: 50, obtainedMarks: obtained, grade: obtained >= 45 ? "A+" : obtained >= 40 ? "A" : obtained >= 33 ? "B" : "C" },
          });
          result.marksCreated++;
        });
      }
    }
  }

  // ---- 6. HOMEWORK + NOTICES ----
  if (options.includeHomeworkAndNotices !== false) {
    if (subjects.length > 0) {
      await sequentially(Math.min(classes.length, 10), async (i) => {
        const cls = classes[i];
        const subject = pick(subjects);
        await prisma.homework.create({
          data: {
            subjectId: subject.id, classId: cls.id, title: `${subject.name} Assignment - Chapter ${randomInt(1, 10)}`,
            description: "Complete the exercises and submit by the due date.",
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            assignedBy: actingUserId,
          },
        });
        result.homeworkCreated++;
      });
    }

    const noticeTitles = [
      { title: "Annual Sports Day", body: "Annual Sports Day will be held next month. All students are encouraged to participate." },
      { title: "Parent-Teacher Meeting", body: "PTM is scheduled for this Saturday. Parents are requested to attend." },
      { title: "Holiday Notice", body: "The school will remain closed on account of a public holiday." },
      { title: "Fee Payment Reminder", body: "Parents are requested to clear pending fee dues at the earliest." },
      { title: "Examination Schedule Released", body: "The examination schedule has been published. Please check with your class teacher." },
    ];
    await sequentially(noticeTitles.length, async (i) => {
      await prisma.notice.create({
        data: { branchId, title: noticeTitles[i].title, body: noticeTitles[i].body, type: "ALL", isPinned: i === 0, publishedBy: actingUserId },
      });
      result.noticesCreated++;
    });
  }

  // ---- 7. TRANSPORT + LIBRARY ----
  if (options.includeTransportAndLibrary !== false) {
    const routeNames = [
      { name: "Route 1 - City Center", startPoint: "City Center", endPoint: "School Campus", fee: 1200 },
      { name: "Route 2 - Green Park", startPoint: "Green Park", endPoint: "School Campus", fee: 1000 },
      { name: "Route 3 - Riverside", startPoint: "Riverside Colony", endPoint: "School Campus", fee: 1100 },
    ];
    const routeIds: string[] = [];
    for (const r of routeNames) {
      const existing = await prisma.transportRoute.findFirst({ where: { branchId, name: r.name } });
      if (existing) { routeIds.push(existing.id); continue; }
      const route = await prisma.transportRoute.create({
        data: { branchId, name: r.name, startPoint: r.startPoint, endPoint: r.endPoint, monthlyFee: r.fee, isActive: true },
      });
      routeIds.push(route.id);
      result.transportRoutesCreated++;
    }
    if (routeIds.length > 0) {
      const ridersSample = shuffle(createdStudentIds).slice(0, Math.ceil(createdStudentIds.length * 0.3));
      await sequentially(ridersSample.length, async (i) => {
        const existing = await prisma.transportAllocation.findUnique({ where: { studentId: ridersSample[i].id } });
        if (existing) return;
        await prisma.transportAllocation.create({ data: { studentId: ridersSample[i].id, routeId: pick(routeIds), stopName: `Stop ${randomInt(1, 5)}` } });
        result.transportAllocationsCreated++;
      });
    }

    const bookTitles = [
      { title: "Wings of Fire", author: "A.P.J. Abdul Kalam", category: "Biography" },
      { title: "The Discovery of India", author: "Jawaharlal Nehru", category: "History" },
      { title: "Malgudi Days", author: "R.K. Narayan", category: "Fiction" },
      { title: "NCERT Mathematics", author: "NCERT", category: "Textbook" },
      { title: "NCERT Science", author: "NCERT", category: "Textbook" },
      { title: "Panchatantra Tales", author: "Vishnu Sharma", category: "Fiction" },
      { title: "A Brief History of Time", author: "Stephen Hawking", category: "Science" },
      { title: "The Jungle Book", author: "Rudyard Kipling", category: "Fiction" },
    ];
    const bookIds: string[] = [];
    for (const b of bookTitles) {
      const existing = await prisma.libraryBook.findFirst({ where: { branchId, title: b.title } });
      if (existing) { bookIds.push(existing.id); continue; }
      const book = await prisma.libraryBook.create({
        data: { branchId, title: b.title, author: b.author, category: b.category, totalCopies: randomInt(3, 10), availableCopies: randomInt(1, 8) },
      });
      bookIds.push(book.id);
      result.libraryBooksCreated++;
    }
    if (bookIds.length > 0) {
      const readersSample = shuffle(createdStudentIds).slice(0, Math.ceil(createdStudentIds.length * 0.2));
      await sequentially(readersSample.length, async (i) => {
        const issueDate = new Date(Date.now() - randomInt(1, 20) * 24 * 60 * 60 * 1000);
        const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        const isReturned = Math.random() < 0.5;
        await prisma.libraryIssue.create({
          data: {
            bookId: pick(bookIds), studentId: readersSample[i].id, issueDate, dueDate,
            returnDate: isReturned ? new Date(issueDate.getTime() + randomInt(5, 13) * 24 * 60 * 60 * 1000) : null,
            status: isReturned ? "RETURNED" : "ISSUED",
          },
        });
        result.libraryIssuesCreated++;
      });
    }
  }

  return result;
};

// ============================================================
// STRUCTURAL demo data: seedDemoData / getDemoDataStatus / removeDemoData
// ============================================================
//
// Server-side "one click" demo data seed/remove, so a Super Admin can
// populate/clear a trial deployment's structural setup (organization,
// branch, classes, subjects, fee categories, chart of accounts, leave
// types, permissions) entirely from the Admin Portal (Settings > Demo
// Data) - no local machine, `npm run seed`, or shell access required.
// This matters specifically for Render's free tier, which does not
// provide Shell/SSH access at all (see DEPLOY.md's Step 4, which
// previously required running db/prisma/seed.ts from a developer's own
// machine against the deployed DATABASE_URL).
//
// The IDs/codes/emails below are deliberately identical to
// db/prisma/seed.ts's hardcoded values, so:
//  - seeding via this API and seeding via the CLI script are 100%
//    interchangeable / idempotent with each other (running one after
//    the other just upserts, never duplicates), and
//  - removeDemoData below can safely recognize "the demo org/branch"
//    by a well-known id instead of guessing.
export const DEMO_ORG_ID = "org-main";
export const DEMO_BRANCH_ID = "branch-main";
export const DEMO_BRANCH_CODE = "MAIN-001";
export const DEMO_SUPER_ADMIN_EMAIL = "superadmin@abcschool.edu.in";
export const DEMO_BRANCH_ADMIN_EMAIL = "branchadmin@abcschool.edu.in";
const DEMO_PASSWORD = "Admin@123";

// Mirrors db/prisma/seed.ts's demo data lists. Duplicated rather than
// imported (like DEFAULT_CHART_OF_ACCOUNTS is imported here) because
// db/prisma/seed.ts lives in a separate `db` package with no dependency
// relationship to `backend` - see defaultChartOfAccounts.ts's own doc
// comment for the same tradeoff. Keep these in sync by hand if the
// seed script's demo content changes.
const DEMO_CLASSES: { name: string; order: number }[] = [
  { name: "Nursery", order: 0 },
  { name: "LKG", order: 1 },
  { name: "UKG", order: 2 },
  { name: "Class 1", order: 3 },
  { name: "Class 2", order: 4 },
  { name: "Class 3", order: 5 },
  { name: "Class 4", order: 6 },
  { name: "Class 5", order: 7 },
  { name: "Class 6", order: 8 },
  { name: "Class 7", order: 9 },
  { name: "Class 8", order: 10 },
  { name: "Class 9", order: 11 },
  { name: "Class 10", order: 12 },
  { name: "Class 11", order: 13 },
  { name: "Class 12", order: 14 },
];
const DEMO_SECTION_NAMES = ["A", "B", "C"];

const DEMO_SUBJECTS: { name: string; code: string }[] = [
  { name: "English", code: "ENG" },
  { name: "Hindi", code: "HIN" },
  { name: "Mathematics", code: "MAT" },
  { name: "Science", code: "SCI" },
  { name: "Social Studies", code: "SST" },
  { name: "Computer Science", code: "CS" },
  { name: "Physical Education", code: "PE" },
  { name: "Art & Craft", code: "ART" },
  { name: "Music", code: "MUS" },
  { name: "Sanskrit", code: "SKT" },
  { name: "Physics", code: "PHY" },
  { name: "Chemistry", code: "CHE" },
  { name: "Biology", code: "BIO" },
  { name: "Accountancy", code: "ACC" },
  { name: "Business Studies", code: "BST" },
  { name: "Economics", code: "ECO" },
];

const DEMO_FEE_CATEGORIES: { name: string; code: string }[] = [
  { name: "Tuition Fee", code: "TUITION" },
  { name: "Transport Fee", code: "TRANSPORT" },
  { name: "Hostel Fee", code: "HOSTEL" },
  { name: "Exam Fee", code: "EXAM" },
  { name: "Uniform Fee", code: "UNIFORM" },
  { name: "Library Fee", code: "LIBRARY" },
  { name: "Lab Fee", code: "LAB" },
  { name: "Sports Fee", code: "SPORTS" },
  { name: "Computer Fee", code: "COMPUTER" },
  { name: "Admission Fee", code: "ADMISSION" },
  { name: "Development Fee", code: "DEVELOPMENT" },
];

const DEMO_LEAVE_TYPES: { name: string; code: string; maxDays: number; carryForward?: boolean }[] = [
  { name: "Casual Leave", code: "CL", maxDays: 12 },
  { name: "Sick Leave", code: "SL", maxDays: 12 },
  { name: "Earned Leave", code: "EL", maxDays: 15, carryForward: true },
  { name: "Maternity Leave", code: "ML", maxDays: 180 },
  { name: "Paternity Leave", code: "PL", maxDays: 15 },
  { name: "Compensatory Off", code: "CO", maxDays: 5 },
];

const DEMO_PERMISSION_MODULES = [
  "dashboard", "branches", "students", "staff", "classes",
  "attendance", "fees", "accounting", "payroll", "exams",
  "timetable", "library", "transport", "hostel", "inventory",
  "notices", "messages", "certificates", "reports", "settings",
];
const DEMO_PERMISSION_ACTIONS = ["create", "read", "update", "delete"];

export interface DemoDataSummary {
  organization: string;
  branch: string;
  superAdminEmail: string;
  branchAdminEmail: string;
  classes: number;
  sections: number;
  subjects: number;
  feeCategories: number;
  leaveTypes: number;
  accounts: number;
  permissions: number;
}

/**
 * Idempotently creates the demo organization/branch/admins/academic
 * structure - safe to call repeatedly (every step is an upsert), so
 * clicking "Add Demo Data" again after it's already been seeded just
 * fills in anything missing rather than erroring or duplicating.
 */
export const seedDemoData = async (): Promise<DemoDataSummary> => {
  const org = await prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    update: {},
    create: {
      id: DEMO_ORG_ID,
      name: "ABC Public School Group",
      email: "admin@abcschool.edu.in",
      phone: "+91-9876543210",
      website: "https://abcschool.edu.in",
      address: "123 Education Lane",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110001",
    },
  });

  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: DEMO_SUPER_ADMIN_EMAIL },
    update: {},
    create: {
      email: DEMO_SUPER_ADMIN_EMAIL,
      password: hashedPassword,
      name: "Super Administrator",
      phone: "+91-9876543210",
      role: UserRole.SUPER_ADMIN,
      organizationId: org.id,
      isActive: true,
    },
  });
  void superAdmin;

  const branch = await prisma.branch.upsert({
    where: { code: DEMO_BRANCH_CODE },
    update: {},
    create: {
      id: DEMO_BRANCH_ID,
      organizationId: org.id,
      name: "ABC Public School - Main Campus",
      code: DEMO_BRANCH_CODE,
      address: "123 Education Lane",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110001",
      phone: "+91-11-23456789",
      email: "main@abcschool.edu.in",
      isActive: true,
    },
  });

  const branchAdmin = await prisma.user.upsert({
    where: { email: DEMO_BRANCH_ADMIN_EMAIL },
    update: {},
    create: {
      email: DEMO_BRANCH_ADMIN_EMAIL,
      password: hashedPassword,
      name: "Branch Administrator",
      phone: "+91-9876543211",
      role: UserRole.BRANCH_ADMIN,
      organizationId: org.id,
      isActive: true,
    },
  });

  await prisma.staff.upsert({
    where: { userId: branchAdmin.id },
    update: {},
    create: {
      userId: branchAdmin.id,
      branchId: branch.id,
      employeeId: "EMP-001",
      designation: "Principal",
      department: "Administration",
      type: "NON_TEACHING",
      joiningDate: new Date("2020-04-01"),
    },
  });

  const academicYear = await prisma.academicYear.upsert({
    where: { branchId_name: { branchId: branch.id, name: "2025-26" } },
    update: {},
    create: {
      branchId: branch.id,
      name: "2025-26",
      startDate: new Date("2025-04-01"),
      endDate: new Date("2026-03-31"),
      isActive: true,
    },
  });
  void academicYear;

  for (const cls of DEMO_CLASSES) {
    await prisma.class.upsert({
      where: { branchId_name: { branchId: branch.id, name: cls.name } },
      update: {},
      create: { branchId: branch.id, name: cls.name, numericOrder: cls.order },
    });
  }

  const classes = await prisma.class.findMany({ where: { branchId: branch.id } });
  for (const cls of classes) {
    for (const secName of DEMO_SECTION_NAMES) {
      await prisma.section.upsert({
        where: { classId_name: { classId: cls.id, name: secName } },
        update: {},
        create: { branchId: branch.id, classId: cls.id, name: secName, capacity: 50 },
      });
    }
  }

  for (const sub of DEMO_SUBJECTS) {
    await prisma.subject.upsert({
      where: { branchId_code: { branchId: branch.id, code: sub.code } },
      update: {},
      create: { branchId: branch.id, name: sub.name, code: sub.code, type: "THEORY" },
    });
  }

  for (const cat of DEMO_FEE_CATEGORIES) {
    await prisma.feeCategory.upsert({
      where: { branchId_code: { branchId: branch.id, code: cat.code } },
      update: {},
      create: { branchId: branch.id, name: cat.name, code: cat.code, isSystem: true, isActive: true },
    });
  }

  for (const lt of DEMO_LEAVE_TYPES) {
    await prisma.leaveType.upsert({
      where: { code: lt.code },
      update: {},
      create: {
        name: lt.name,
        code: lt.code,
        maxDays: lt.maxDays,
        carryForward: lt.carryForward || false,
        isActive: true,
      },
    });
  }

  // Reuses the SAME source-of-truth as createBranch's auto-seeding and
  // the setup-defaults backfill endpoint (see defaultChartOfAccounts.ts) -
  // rather than duplicating the account list a third time.
  await seedDefaultAccountsForBranch(branch.id);

  for (const mod of DEMO_PERMISSION_MODULES) {
    for (const action of DEMO_PERMISSION_ACTIONS) {
      await prisma.permission.upsert({
        where: { module_action: { module: mod, action } },
        update: {},
        create: { module: mod, action, description: `${action} ${mod}` },
      });
    }
  }

  return {
    organization: org.name,
    branch: branch.name,
    superAdminEmail: DEMO_SUPER_ADMIN_EMAIL,
    branchAdminEmail: DEMO_BRANCH_ADMIN_EMAIL,
    classes: DEMO_CLASSES.length,
    sections: DEMO_CLASSES.length * DEMO_SECTION_NAMES.length,
    subjects: DEMO_SUBJECTS.length,
    feeCategories: DEMO_FEE_CATEGORIES.length,
    leaveTypes: DEMO_LEAVE_TYPES.length,
    accounts: DEFAULT_CHART_OF_ACCOUNTS.length,
    permissions: DEMO_PERMISSION_MODULES.length * DEMO_PERMISSION_ACTIONS.length,
  };
};

export interface DemoDataStatus {
  seeded: boolean;
  branchId: string | null;
  counts: {
    classes: number;
    sections: number;
    subjects: number;
    feeCategories: number;
    accounts: number;
    students: number;
    staff: number;
  };
  canRemove: boolean;
  blockedReasons: string[];
}

/**
 * Reports whether the demo branch currently exists, some headline
 * counts for the Settings UI, and whether removeDemoData would
 * currently be blocked (and why) - so the frontend can show a useful
 * message instead of just letting the user click "Remove" and get an
 * error.
 */
export const getDemoDataStatus = async (): Promise<DemoDataStatus> => {
  const branch = await prisma.branch.findUnique({ where: { id: DEMO_BRANCH_ID } });

  if (!branch) {
    return {
      seeded: false,
      branchId: null,
      counts: { classes: 0, sections: 0, subjects: 0, feeCategories: 0, accounts: 0, students: 0, staff: 0 },
      canRemove: false,
      blockedReasons: [],
    };
  }

  const [classes, sections, subjects, feeCategories, accounts, students, staff, blockedReasons] = await Promise.all([
    prisma.class.count({ where: { branchId: branch.id } }),
    prisma.section.count({ where: { branchId: branch.id } }),
    prisma.subject.count({ where: { branchId: branch.id } }),
    prisma.feeCategory.count({ where: { branchId: branch.id } }),
    prisma.account.count({ where: { branchId: branch.id } }),
    prisma.student.count({ where: { branchId: branch.id } }),
    prisma.staff.count({ where: { branchId: branch.id } }),
    getRemovalBlockers(branch.id),
  ]);

  return {
    seeded: true,
    branchId: branch.id,
    counts: { classes, sections, subjects, feeCategories, accounts, students, staff },
    canRemove: blockedReasons.length === 0,
    blockedReasons,
  };
};

/**
 * Everything the demo seed itself creates ZERO of - if any of these
 * are non-zero, real usage (or generateDemoDataForBranch above) has
 * happened on top of the demo data (a real/generated admission, a real
 * fee structure/payment, a real staff member beyond the seeded branch
 * admin, etc), and removal must be blocked rather than silently
 * deleting someone's real records along with the demo scaffolding.
 */
const getRemovalBlockers = async (branchId: string): Promise<string[]> => {
  const [
    students,
    extraStaff,
    payments,
    vouchers,
    feeStructures,
    exams,
    timetables,
    promotions,
    notices,
    libraryBooks,
    inventoryItems,
    transportRoutes,
    hostelBuildings,
    admissionInquiries,
    devices,
  ] = await Promise.all([
    prisma.student.count({ where: { branchId } }),
    // The seed creates exactly one Staff record (the demo Branch
    // Admin) - anything beyond that is a real (or generated) staff member.
    prisma.staff.count({ where: { branchId } }).then((n) => Math.max(0, n - 1)),
    prisma.payment.count({ where: { branchId } }),
    prisma.voucher.count({ where: { branchId } }),
    prisma.feeStructure.count({ where: { branchId } }),
    prisma.exam.count({ where: { academicYear: { branchId } } }),
    prisma.timetable.count({ where: { academicYear: { branchId } } }),
    prisma.promotion.count({ where: { academicYear: { branchId } } }),
    prisma.notice.count({ where: { branchId } }),
    prisma.libraryBook.count({ where: { branchId } }),
    prisma.inventoryItem.count({ where: { branchId } }),
    prisma.transportRoute.count({ where: { branchId } }),
    prisma.hostelBuilding.count({ where: { branchId } }),
    prisma.admissionInquiry.count({ where: { branchId } }),
    prisma.attendanceDevice.count({ where: { branchId } }),
  ]);

  const reasons: string[] = [];
  if (students > 0) reasons.push(`${students} student(s)`);
  if (extraStaff > 0) reasons.push(`${extraStaff} staff member(s) beyond the demo Branch Admin`);
  if (payments > 0) reasons.push(`${payments} fee payment(s)`);
  if (vouchers > 0) reasons.push(`${vouchers} accounting voucher(s)`);
  if (feeStructures > 0) reasons.push(`${feeStructures} fee structure(s)`);
  if (exams > 0) reasons.push(`${exams} exam(s)`);
  if (timetables > 0) reasons.push(`${timetables} timetable(s)`);
  if (promotions > 0) reasons.push(`${promotions} student promotion record(s)`);
  if (notices > 0) reasons.push(`${notices} notice(s)`);
  if (libraryBooks > 0) reasons.push(`${libraryBooks} library book(s)`);
  if (inventoryItems > 0) reasons.push(`${inventoryItems} inventory item(s)`);
  if (transportRoutes > 0) reasons.push(`${transportRoutes} transport route(s)`);
  if (hostelBuildings > 0) reasons.push(`${hostelBuildings} hostel building(s)`);
  if (admissionInquiries > 0) reasons.push(`${admissionInquiries} admission inquiry/inquiries`);
  if (devices > 0) reasons.push(`${devices} attendance device(s)`);

  return reasons;
};

export interface RemoveDemoDataResult {
  removed: boolean;
  message: string;
  blockedReasons?: string[];
}

/**
 * Removes everything seedDemoData creates - but ONLY if nothing real
 * (or generated via generateDemoDataForBranch above) has been layered
 * on top of it (see getRemovalBlockers). Deliberately conservative
 * about what it touches:
 *  - NEVER deletes the calling Super Admin's own account, and never
 *    deletes the demo Super Admin login unless at least one OTHER
 *    Super Admin account will still exist afterwards (so this can
 *    never lock every admin out of the app).
 *  - NEVER deletes global Permission/LeaveType rows - these back every
 *    branch's RBAC and HR leave features, not just the demo branch, so
 *    a real deployment still needs them even after "demo" data is gone.
 *  - Only deletes the Organization/demo-branch-admin login if nothing
 *    else in the system still depends on them.
 */
export const removeDemoData = async (callerUserId: string): Promise<RemoveDemoDataResult> => {
  const branch = await prisma.branch.findUnique({ where: { id: DEMO_BRANCH_ID } });
  if (!branch) {
    return { removed: false, message: "No demo data found - nothing to remove." };
  }

  const blockedReasons = await getRemovalBlockers(branch.id);
  if (blockedReasons.length > 0) {
    return {
      removed: false,
      message: "Cannot remove demo data - real records exist on top of it. Remove/reassign those first, or keep the demo data.",
      blockedReasons,
    };
  }

  const demoBranchAdminStaff = await prisma.staff.findFirst({
    where: { branchId: branch.id },
    select: { id: true, userId: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      if (demoBranchAdminStaff) {
        await tx.staffDocument.deleteMany({ where: { staffId: demoBranchAdminStaff.id } });
        await tx.subjectTeacher.deleteMany({ where: { staffId: demoBranchAdminStaff.id } });
        await tx.staffAttendance.deleteMany({ where: { staffId: demoBranchAdminStaff.id } });
        await tx.leaveApplication.deleteMany({ where: { staffId: demoBranchAdminStaff.id } });
        await tx.salaryStructure.deleteMany({ where: { staffId: demoBranchAdminStaff.id } });
        await tx.section.updateMany({ where: { classTeacherId: demoBranchAdminStaff.id }, data: { classTeacherId: null } });
        await tx.staff.delete({ where: { id: demoBranchAdminStaff.id } });
        await tx.user.delete({ where: { id: demoBranchAdminStaff.userId } });
      }

      const classIds = (await tx.class.findMany({ where: { branchId: branch.id }, select: { id: true } })).map((c) => c.id);
      const subjectIds = (await tx.subject.findMany({ where: { branchId: branch.id }, select: { id: true } })).map((s) => s.id);
      const academicYearIds = (await tx.academicYear.findMany({ where: { branchId: branch.id }, select: { id: true } })).map((a) => a.id);
      const examIds = (await tx.exam.findMany({ where: { academicYearId: { in: academicYearIds } }, select: { id: true } })).map((e) => e.id);
      const timetableIds = (await tx.timetable.findMany({ where: { academicYearId: { in: academicYearIds } }, select: { id: true } })).map((t) => t.id);

      // IMPORTANT: children before parents, since neither the DB nor
      // Prisma cascades deletes here. Timetable/TimetableSlot and
      // Mark/Exam reference Section/Class/Subject respectively, so
      // they must go first, or deleting Section/Class/Subject below
      // would fail on a foreign-key violation.
      await tx.timetableSlot.deleteMany({ where: { timetableId: { in: timetableIds } } });
      await tx.timetable.deleteMany({ where: { id: { in: timetableIds } } });
      await tx.mark.deleteMany({ where: { examId: { in: examIds } } });
      await tx.exam.deleteMany({ where: { id: { in: examIds } } });
      await tx.promotion.deleteMany({ where: { academicYearId: { in: academicYearIds } } });

      await tx.classSubject.deleteMany({ where: { classId: { in: classIds } } });
      await tx.subjectTeacher.deleteMany({ where: { OR: [{ classId: { in: classIds } }, { subjectId: { in: subjectIds } }] } });
      await tx.feeInstallment.deleteMany({ where: { feeStructure: { branchId: branch.id } } });
      await tx.feeStructure.deleteMany({ where: { branchId: branch.id } });
      await tx.feeCategory.deleteMany({ where: { branchId: branch.id } });
      await tx.section.deleteMany({ where: { branchId: branch.id } });
      await tx.class.deleteMany({ where: { branchId: branch.id } });
      await tx.subject.deleteMany({ where: { branchId: branch.id } });
      await tx.account.deleteMany({ where: { branchId: branch.id } });
      await tx.academicYear.deleteMany({ where: { branchId: branch.id } });

      await tx.branch.delete({ where: { id: branch.id } });

      // Only remove the demo Super Admin login if it's not the account
      // making this request, and at least one OTHER Super Admin will
      // still be able to log in afterwards.
      const demoSuperAdmin = await tx.user.findUnique({ where: { email: DEMO_SUPER_ADMIN_EMAIL } });
      if (demoSuperAdmin && demoSuperAdmin.id !== callerUserId) {
        const otherSuperAdmins = await tx.user.count({
          where: { role: UserRole.SUPER_ADMIN, id: { not: demoSuperAdmin.id } },
        });
        if (otherSuperAdmins > 0) {
          await tx.user.delete({ where: { id: demoSuperAdmin.id } });
        }
      }

      // Only remove the demo Organization if nothing else still
      // references it (no remaining branches or users under it).
      const remainingBranches = await tx.branch.count({ where: { organizationId: DEMO_ORG_ID } });
      const remainingUsers = await tx.user.count({ where: { organizationId: DEMO_ORG_ID } });
      if (remainingBranches === 0 && remainingUsers === 0) {
        await tx.organization.deleteMany({ where: { id: DEMO_ORG_ID } });
      }
    });
  } catch (error) {
    return {
      removed: false,
      message:
        "Failed to remove demo data - it may still have unexpected records attached to it. " +
        (error as Error).message,
    };
  }

  return { removed: true, message: "Demo data removed successfully." };
};
