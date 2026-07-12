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
    label: "My Fees",
    href: "/dashboard/my-fees",
    icon: "IndianRupee",
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
  {
    label: "Exams",
    href: "/dashboard/exams",
    icon: "FileText",
    roles: [...ADMIN_ROLES, "TEACHER"],
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
];

export const getNavForRole = (role: UserRole): NavItem[] => {
  return navigation.filter((item) => item.roles.includes(role));
};
