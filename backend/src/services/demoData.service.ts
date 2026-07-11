import { Prisma, PaymentMode, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { seedDefaultAccountsForBranch } from "./defaultChartOfAccounts";
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
 * db/prisma/seed.ts or normal admin usage); this only fills in the
 * *transactional* data that's tedious to create by hand one at a time.
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
    await sequentially(sectionsNeedingTeacher.length, async (i) => {
      await prisma.section.update({ where: { id: sectionsNeedingTeacher[i].id }, data: { classTeacherId: pick(teacherStaffIds) } });
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
