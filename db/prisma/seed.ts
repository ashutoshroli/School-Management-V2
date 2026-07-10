import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...\n");

  // 1. Create Organization
  const org = await prisma.organization.upsert({
    where: { id: "org-main" },
    update: {},
    create: {
      id: "org-main",
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
  console.log("Organization created:", org.name);

  // 2. Create Super Admin User
  const hashedPassword = await bcrypt.hash("Admin@123", 12);
  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@abcschool.edu.in" },
    update: {},
    create: {
      email: "superadmin@abcschool.edu.in",
      password: hashedPassword,
      name: "Super Administrator",
      phone: "+91-9876543210",
      role: UserRole.SUPER_ADMIN,
      organizationId: org.id,
      isActive: true,
    },
  });
  console.log("Super Admin created:", superAdmin.email);

  // 3. Create Main Branch
  const branch = await prisma.branch.upsert({
    where: { code: "MAIN-001" },
    update: {},
    create: {
      id: "branch-main",
      organizationId: org.id,
      name: "ABC Public School - Main Campus",
      code: "MAIN-001",
      address: "123 Education Lane",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110001",
      phone: "+91-11-23456789",
      email: "main@abcschool.edu.in",
      isActive: true,
    },
  });
  console.log("Branch created:", branch.name);


  // 4. Create Branch Admin
  const branchAdmin = await prisma.user.upsert({
    where: { email: "branchadmin@abcschool.edu.in" },
    update: {},
    create: {
      email: "branchadmin@abcschool.edu.in",
      password: hashedPassword,
      name: "Branch Administrator",
      phone: "+91-9876543211",
      role: UserRole.BRANCH_ADMIN,
      organizationId: org.id,
      isActive: true,
    },
  });

  // Create staff record for branch admin
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
  console.log("Branch Admin created:", branchAdmin.email);

  // 5. Create Academic Year
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
  console.log("Academic Year created:", academicYear.name);

  // 6. Create Classes (Nursery to 12th)
  const classNames = [
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

  for (const cls of classNames) {
    await prisma.class.upsert({
      where: { branchId_name: { branchId: branch.id, name: cls.name } },
      update: {},
      create: {
        branchId: branch.id,
        name: cls.name,
        numericOrder: cls.order,
      },
    });
  }
  console.log("Classes created: Nursery to Class 12");


  // 7. Create Sections for each class (A, B, C)
  const classes = await prisma.class.findMany({ where: { branchId: branch.id } });
  const sectionNames = ["A", "B", "C"];

  for (const cls of classes) {
    for (const secName of sectionNames) {
      await prisma.section.upsert({
        where: { classId_name: { classId: cls.id, name: secName } },
        update: {},
        create: {
          branchId: branch.id,
          classId: cls.id,
          name: secName,
          capacity: 50,
        },
      });
    }
  }
  console.log("Sections created: A, B, C for each class");

  // 8. Create common Subjects
  const subjects = [
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

  for (const sub of subjects) {
    await prisma.subject.upsert({
      where: { branchId_code: { branchId: branch.id, code: sub.code } },
      update: {},
      create: {
        branchId: branch.id,
        name: sub.name,
        code: sub.code,
        type: "THEORY",
      },
    });
  }
  console.log("Subjects created:", subjects.length, "subjects");

  // 9. Create default Fee Categories
  const feeCategories = [
    { name: "Tuition Fee", code: "TUITION", isSystem: true },
    { name: "Transport Fee", code: "TRANSPORT", isSystem: true },
    { name: "Hostel Fee", code: "HOSTEL", isSystem: true },
    { name: "Exam Fee", code: "EXAM", isSystem: true },
    { name: "Uniform Fee", code: "UNIFORM", isSystem: true },
    { name: "Library Fee", code: "LIBRARY", isSystem: true },
    { name: "Lab Fee", code: "LAB", isSystem: true },
    { name: "Sports Fee", code: "SPORTS", isSystem: true },
    { name: "Computer Fee", code: "COMPUTER", isSystem: true },
    { name: "Admission Fee", code: "ADMISSION", isSystem: true },
    { name: "Development Fee", code: "DEVELOPMENT", isSystem: true },
  ];

  for (const cat of feeCategories) {
    await prisma.feeCategory.upsert({
      where: { branchId_code: { branchId: branch.id, code: cat.code } },
      update: {},
      create: {
        branchId: branch.id,
        name: cat.name,
        code: cat.code,
        isSystem: cat.isSystem,
        isActive: true,
      },
    });
  }
  console.log("Fee Categories created:", feeCategories.length, "categories");

  // 10. Create Leave Types
  const leaveTypes = [
    { name: "Casual Leave", code: "CL", maxDays: 12 },
    { name: "Sick Leave", code: "SL", maxDays: 12 },
    { name: "Earned Leave", code: "EL", maxDays: 15, carryForward: true },
    { name: "Maternity Leave", code: "ML", maxDays: 180 },
    { name: "Paternity Leave", code: "PL", maxDays: 15 },
    { name: "Compensatory Off", code: "CO", maxDays: 5 },
  ];

  for (const lt of leaveTypes) {
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
  console.log("Leave Types created:", leaveTypes.length, "types");


  // 11. Create default Chart of Accounts (basic)
  const accounts = [
    { name: "Cash", code: "1001", type: "ASSET" as const },
    { name: "Bank Account", code: "1002", type: "ASSET" as const },
    { name: "Accounts Receivable", code: "1003", type: "ASSET" as const },
    { name: "Fixed Assets", code: "1004", type: "ASSET" as const },
    { name: "Accounts Payable", code: "2001", type: "LIABILITY" as const },
    { name: "Salary Payable", code: "2002", type: "LIABILITY" as const },
    { name: "PF Payable", code: "2003", type: "LIABILITY" as const },
    { name: "ESI Payable", code: "2004", type: "LIABILITY" as const },
    { name: "TDS Payable", code: "2005", type: "LIABILITY" as const },
    { name: "Fee Income", code: "3001", type: "INCOME" as const },
    { name: "Transport Income", code: "3002", type: "INCOME" as const },
    { name: "Hostel Income", code: "3003", type: "INCOME" as const },
    { name: "Other Income", code: "3004", type: "INCOME" as const },
    { name: "Salary Expense", code: "4001", type: "EXPENSE" as const },
    { name: "Electricity", code: "4002", type: "EXPENSE" as const },
    { name: "Maintenance", code: "4003", type: "EXPENSE" as const },
    { name: "Stationery", code: "4004", type: "EXPENSE" as const },
    { name: "Miscellaneous Expense", code: "4005", type: "EXPENSE" as const },
    { name: "Owner Capital", code: "5001", type: "CAPITAL" as const },
  ];

  for (const acc of accounts) {
    await prisma.account.upsert({
      where: { branchId_code: { branchId: branch.id, code: acc.code } },
      update: {},
      create: {
        branchId: branch.id,
        name: acc.name,
        code: acc.code,
        type: acc.type,
        isSystem: true,
        isActive: true,
      },
    });
  }
  console.log("Chart of Accounts created:", accounts.length, "accounts");

  // 12. Create Permissions
  const modules = [
    "dashboard", "branches", "students", "staff", "classes",
    "attendance", "fees", "accounting", "payroll", "exams",
    "timetable", "library", "transport", "hostel", "inventory",
    "notices", "messages", "certificates", "reports", "settings",
  ];
  const actions = ["create", "read", "update", "delete"];

  for (const mod of modules) {
    for (const action of actions) {
      await prisma.permission.upsert({
        where: { module_action: { module: mod, action } },
        update: {},
        create: {
          module: mod,
          action,
          description: `${action} ${mod}`,
        },
      });
    }
  }
  console.log("Permissions created:", modules.length * actions.length, "permissions");

  console.log("\n=== Seed Complete ===");
  console.log("\nLogin Credentials:");
  console.log("  Super Admin: superadmin@abcschool.edu.in / Admin@123");
  console.log("  Branch Admin: branchadmin@abcschool.edu.in / Admin@123");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
