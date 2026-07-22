import { NavItem, UserRole } from "@/types";

const ALL_ROLES: UserRole[] = [
  "SUPER_ADMIN", "BRANCH_ADMIN", "TEACHER", "ACCOUNTANT",
  "LIBRARIAN", "TRANSPORT_MANAGER", "WARDEN", "STAFF", "STUDENT", "PARENT",
];

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "BRANCH_ADMIN"];
const STAFF_ROLES: UserRole[] = ["SUPER_ADMIN", "BRANCH_ADMIN", "TEACHER", "ACCOUNTANT", "LIBRARIAN", "TRANSPORT_MANAGER", "WARDEN", "STAFF"];
const PARENT_PORTAL_ROLES: UserRole[] = ["STUDENT", "PARENT"];

export const navigation: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard",
    roles: ALL_ROLES,
  },
  {
    label: "Branches",
    href: "/dashboard/branches",
    icon: "Building2",
    roles: ["SUPER_ADMIN"],
  },
  {
    label: "Branch Admins",
    href: "/dashboard/branch-admins",
    icon: "ShieldCheck",
    roles: ["SUPER_ADMIN"],
  },
  {
    label: "Academic Years",
    href: "/dashboard/academic-years",
    icon: "Calendar",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN"],
  },
  {
    label: "Admissions",
    href: "/dashboard/admissions",
    icon: "Inbox",
    roles: ADMIN_ROLES,
  },
  {
    label: "Students",
    href: "/dashboard/students",
    icon: "GraduationCap",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "Staff / HR",
    href: "/dashboard/staff",
    icon: "Users",
    roles: ADMIN_ROLES,
  },
  {
    label: "Classes",
    href: "/dashboard/classes",
    icon: "School",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "Teacher Assign",
    href: "/dashboard/teacher-assign",
    icon: "UserCog",
    roles: ADMIN_ROLES,
  },
  {
    label: "Promotion",
    href: "/dashboard/promotion",
    icon: "ArrowUpCircle",
    roles: ADMIN_ROLES,
  },
  {
    label: "Subjects",
    href: "/dashboard/subjects",
    icon: "BookOpen",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "Attendance",
    href: "/dashboard/attendance",
    icon: "ClipboardCheck",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  // Staff Attendance already had its own working page/feature
  // (self check-in, monthly report, CSV export) but was never linked
  // from the sidebar - only reachable via a direct URL.
  {
    label: "Staff Attendance",
    href: "/dashboard/staff/attendance",
    icon: "UserCheck",
    roles: STAFF_ROLES,
  },
  // The parent-portal ("My ...") pages below are deliberately separate
  // routes rather than role-branching inside the existing admin pages -
  // the admin pages (attendance/fees/exams/homework) manage ALL
  // students/classes and assume staff-level query params (sectionId,
  // classId, etc), whereas these are self-service, single-child-scoped
  // views with a completely different UI (child switcher, pay/download
  // buttons instead of data-entry forms).
  {
    label: "My Attendance",
    href: "/dashboard/my-attendance",
    icon: "ClipboardCheck",
    roles: PARENT_PORTAL_ROLES,
  },
  {
    label: "Fees",
    href: "/dashboard/fees",
    icon: "IndianRupee",
    roles: [...ADMIN_ROLES, "ACCOUNTANT"],
  },
  {
    label: "Assign Fees",
    href: "/dashboard/fees/assign",
    icon: "UserCheck",
    roles: [...ADMIN_ROLES, "ACCOUNTANT"],
  },
  {
    label: "Fee Discounts",
    href: "/dashboard/fees/discounts",
    icon: "Percent",
    roles: [...ADMIN_ROLES, "ACCOUNTANT"],
  },
  {
    label: "Fee Reminders",
    href: "/dashboard/fees/reminders",
    icon: "Send",
    roles: [...ADMIN_ROLES, "ACCOUNTANT"],
  },
  {
    label: "Fee Refunds",
    href: "/dashboard/fees/refunds",
    icon: "RotateCcw",
    roles: ADMIN_ROLES,
  },
  {
    label: "Waive Late Fee",
    href: "/dashboard/fees/waive-late-fee",
    icon: "MinusCircle",
    roles: ADMIN_ROLES,
  },
  {
    label: "My Fees",
    href: "/dashboard/my-fees",
    icon: "IndianRupee",
    roles: PARENT_PORTAL_ROLES,
  },
  {
    label: "My Children",
    href: "/dashboard/my-children",
    icon: "Users",
    roles: PARENT_PORTAL_ROLES,
  },
  {
    label: "Accounting",
    href: "/dashboard/accounting",
    icon: "Calculator",
    roles: [...ADMIN_ROLES, "ACCOUNTANT"],
  },
  {
    label: "Payroll",
    href: "/dashboard/payroll",
    icon: "Wallet",
    roles: ADMIN_ROLES,
  },
  // Leave Management page already existed (pending/all applications,
  // leave balance, leave types config) but had no sidebar entry at all
  // - only reachable via a "Manage Leave ->" link buried on a staff
  // member's own profile page. Visible to every staff role (not just
  // admins) since a Teacher/Accountant/etc. needs this page to apply
  // for their own leave and check their balance, same as Staff
  // Attendance above.
  {
    label: "Leaves",
    href: "/dashboard/leaves",
    icon: "CalendarDays",
    roles: STAFF_ROLES,
  },
  {
    label: "Exams",
    href: "/dashboard/exams",
    icon: "FileText",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "Question Papers",
    href: "/dashboard/exams/question-papers",
    icon: "FileUp",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "Exam Seat Plan",
    href: "/dashboard/exams/seat-plan",
    icon: "LayoutGrid",
    roles: ADMIN_ROLES,
  },
  {
    label: "Admit Cards",
    href: "/dashboard/exams/admit-cards",
    icon: "CreditCard",
    roles: ADMIN_ROLES,
  },
  // Exam Attendance (per-sitting, room-wise) - dedicated page with
  // multi-filter (exam → subject) attendance marking grid.
  {
    label: "Exam Attendance",
    href: "/dashboard/exam-attendance",
    icon: "ClipboardList",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "My Exams",
    href: "/dashboard/my-exams",
    icon: "FileText",
    roles: PARENT_PORTAL_ROLES,
  },
  {
    label: "Timetable",
    href: "/dashboard/timetable",
    icon: "Calendar",
    roles: [...ADMIN_ROLES, "TEACHER", "STUDENT", "PARENT"],
  },
  {
    label: "Homework",
    href: "/dashboard/homework",
    icon: "BookOpen",
    roles: [...ADMIN_ROLES, "TEACHER"],
  },
  {
    label: "My Homework",
    href: "/dashboard/my-homework",
    icon: "BookOpen",
    roles: PARENT_PORTAL_ROLES,
  },
  {
    label: "Library",
    href: "/dashboard/library",
    icon: "BookOpen",
    roles: [...ADMIN_ROLES, "LIBRARIAN", "TEACHER", "STUDENT"],
  },
  {
    label: "Transport",
    href: "/dashboard/transport",
    icon: "Bus",
    roles: [...ADMIN_ROLES, "TRANSPORT_MANAGER", "STUDENT", "PARENT"],
  },
  {
    label: "Hostel",
    href: "/dashboard/hostel",
    icon: "Home",
    roles: [...ADMIN_ROLES, "WARDEN", "STUDENT", "PARENT"],
  },
  {
    label: "School Buildings",
    href: "/dashboard/buildings",
    icon: "Building",
    roles: ADMIN_ROLES,
  },
  {
    label: "Inventory",
    href: "/dashboard/inventory",
    icon: "Package",
    roles: ADMIN_ROLES,
  },
  {
    label: "Attendance Devices",
    href: "/dashboard/attendance-devices",
    icon: "Radio",
    roles: ADMIN_ROLES,
  },
  {
    label: "Careers / Jobs",
    href: "/dashboard/careers",
    icon: "Briefcase",
    roles: ADMIN_ROLES,
  },
  {
    label: "Notices",
    href: "/dashboard/notices",
    icon: "Bell",
    roles: ALL_ROLES,
  },
  {
    label: "Notifications",
    href: "/dashboard/notifications",
    icon: "BellRing",
    roles: ALL_ROLES,
  },
  {
    label: "Messages",
    href: "/dashboard/messages",
    icon: "MessageSquare",
    roles: [...STAFF_ROLES, "PARENT"],
  },
  {
    label: "Certificates",
    href: "/dashboard/certificates",
    icon: "Award",
    roles: ADMIN_ROLES,
  },
  {
    label: "Bulk Certificates",
    href: "/dashboard/certificates/bulk",
    icon: "Award",
    roles: ADMIN_ROLES,
  },
  {
    label: "Templates",
    href: "/dashboard/templates",
    icon: "FileStack",
    roles: ADMIN_ROLES,
  },
  {
    label: "Reports",
    href: "/dashboard/reports",
    icon: "BarChart3",
    roles: ADMIN_ROLES,
  },
  {
    label: "Multi-Branch",
    href: "/dashboard/reports/multi-branch",
    icon: "Building2",
    roles: ["SUPER_ADMIN"],
  },
  {
    label: "Audit Log",
    href: "/dashboard/audit-log",
    icon: "History",
    roles: ADMIN_ROLES,
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: "Settings",
    roles: ADMIN_ROLES,
  },
  {
    label: "Period Config",
    href: "/dashboard/period-config",
    icon: "Clock",
    roles: ADMIN_ROLES,
  },
  {
    label: "Grade System",
    href: "/dashboard/grade-system",
    icon: "Award",
    roles: ADMIN_ROLES,
  },
  {
    label: "Holidays",
    href: "/dashboard/holidays",
    icon: "CalendarDays",
    roles: ADMIN_ROLES,
  },
  {
    label: "Demo Data",
    href: "/dashboard/demo-data",
    icon: "Database",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN"],
  },
  // --- New modules added per school-erp-final-spec gap analysis ---
  {
    label: "Branch Transfer",
    href: "/dashboard/branch-transfer",
    icon: "ArrowRightLeft",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"],
  },
  {
    label: "Room Bookings",
    href: "/dashboard/room-bookings",
    icon: "CalendarCheck",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "TEACHER", "STAFF", "WARDEN", "LIBRARIAN", "TRANSPORT_MANAGER", "ACCOUNTANT"],
  },
  {
    label: "Mess",
    href: "/dashboard/mess",
    icon: "UtensilsCrossed",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "WARDEN", "PRINCIPAL", "VICE_PRINCIPAL"],
  },
  {
    label: "Canteen",
    href: "/dashboard/canteen",
    icon: "Coffee",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "ACCOUNTANT", "STAFF"],
  },
  {
    label: "Lab Management",
    href: "/dashboard/lab",
    icon: "FlaskConical",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "TEACHER", "STAFF", "PRINCIPAL", "VICE_PRINCIPAL"],
  },
  {
    label: "Diesel Requests",
    href: "/dashboard/diesel-requests",
    icon: "Fuel",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "TRANSPORT_MANAGER", "ACCOUNTANT"],
  },
  {
    label: "Appraisal & Increment",
    href: "/dashboard/appraisal",
    icon: "TrendingUp",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"],
  },
  {
    label: "Public Content",
    href: "/dashboard/public-content",
    icon: "Globe",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN"],
  },
];

export const getNavForRole = (role: UserRole): NavItem[] => {
  return navigation.filter((item) => item.roles.includes(role));
};
