import { NavItem, UserRole } from "@/types";

const ALL_ROLES: UserRole[] = [
  "SUPER_ADMIN", "BRANCH_ADMIN", "TEACHER", "ACCOUNTANT",
  "LIBRARIAN", "TRANSPORT_MANAGER", "WARDEN", "STAFF", "STUDENT", "PARENT",
];

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "BRANCH_ADMIN"];
const STAFF_ROLES: UserRole[] = ["SUPER_ADMIN", "BRANCH_ADMIN", "TEACHER", "ACCOUNTANT", "LIBRARIAN", "TRANSPORT_MANAGER", "WARDEN", "STAFF"];

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
    label: "Academic Years",
    href: "/dashboard/academic-years",
    icon: "Calendar",
    roles: ["SUPER_ADMIN", "BRANCH_ADMIN"],
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
    label: "Attendance",
    href: "/dashboard/attendance",
    icon: "ClipboardCheck",
    roles: [...ADMIN_ROLES, "TEACHER", "STUDENT", "PARENT"],
  },
  {
    label: "Fees",
    href: "/dashboard/fees",
    icon: "IndianRupee",
    roles: [...ADMIN_ROLES, "ACCOUNTANT", "STUDENT", "PARENT"],
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
    roles: [...ADMIN_ROLES, "TEACHER", "STUDENT", "PARENT"],
  },
  {
    label: "Timetable",
    href: "/dashboard/timetable",
    icon: "Calendar",
    roles: [...ADMIN_ROLES, "TEACHER", "STUDENT", "PARENT"],
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
    label: "Inventory",
    href: "/dashboard/inventory",
    icon: "Package",
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
    label: "Reports",
    href: "/dashboard/reports",
    icon: "BarChart3",
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
