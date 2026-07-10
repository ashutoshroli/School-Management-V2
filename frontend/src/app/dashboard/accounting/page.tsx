"use client";

import Link from "next/link";
import { Calculator, BookOpen, FileText, BarChart3, TrendingUp, Landmark } from "lucide-react";

const modules = [
  { label: "Chart of Accounts", href: "/dashboard/accounting/accounts", icon: BookOpen, desc: "Manage account heads (Assets, Liabilities, Income, Expense, Capital)" },
  { label: "Voucher Entry", href: "/dashboard/accounting/vouchers", icon: FileText, desc: "Create Payment, Receipt, Journal, Contra vouchers" },
  { label: "Ledger", href: "/dashboard/accounting/ledger", icon: Calculator, desc: "View any account's detailed ledger with running balance" },
  { label: "Trial Balance", href: "/dashboard/accounting/trial-balance", icon: BarChart3, desc: "Auto-generated trial balance from all ledgers" },
  { label: "Profit & Loss", href: "/dashboard/accounting/profit-loss", icon: TrendingUp, desc: "Income vs Expense statement" },
  { label: "Balance Sheet", href: "/dashboard/accounting/balance-sheet", icon: Landmark, desc: "Assets = Liabilities + Capital" },
];

export default function AccountingPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Calculator className="h-6 w-6 text-primary-600" /> Accounting
        </h1>
        <p className="text-gray-500 mt-1">Double-entry ledger system</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
