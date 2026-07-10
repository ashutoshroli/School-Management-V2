export type UserRole =
  | "SUPER_ADMIN"
  | "BRANCH_ADMIN"
  | "TEACHER"
  | "ACCOUNTANT"
  | "LIBRARIAN"
  | "TRANSPORT_MANAGER"
  | "WARDEN"
  | "STAFF"
  | "STUDENT"
  | "PARENT";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  organizationId?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => void;
  logout: () => void;
  setAuth: (user: User, token: string) => void;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: UserRole[]; // which roles can see this item
  children?: NavItem[];
}
