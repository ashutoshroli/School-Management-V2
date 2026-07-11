"use client";

import Link from "next/link";
import { IndianRupee, Tag, FileText, Receipt, BarChart3, UserCheck } from "lucide-react";

const modules = [
  { label: "Fee Categories", href: "/dashboard/fees/categories", icon: Tag, desc: "Manage system + custom fee categories" },
  { label: "Fee Structures", href: "/dashboard/fees/structures", icon: FileText, desc: "Class-wise fee configuration, installments, late fee rules" },
  { label: "Assign Fees", href: "/dashboard/fees/assign", icon: UserCheck, desc: "Assign a fee structure to an entire class or specific students" },
  { label: "Collect Fees", href: "/dashboard/fees/collect", icon: Receipt, desc: "Search student, view pending, collect payment" },
  { label: "Fee Reports", href: "/dashboard/fees/reports", icon: BarChart3, desc: "Class-wise summary, defaulters list" },
];

export default function FeesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IndianRupee className="h-6 w-6 text-primary-600" /> Fees Management
        </h1>
        <p className="text-gray-500 mt-1">Fee collection, structures, and reports</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.href} href={m.href} className="card hover:shadow-md transition-shadow group">
              <Icon className="h-8 w-8 text-primary-600 mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-semibold text-gray-900 mb-1">{m.label}</h3>
              <p className="text-sm text-gray-500">{m.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
