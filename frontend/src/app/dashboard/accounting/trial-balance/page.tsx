"use client";

import { useState, useEffect } from "react";
import { BarChart3 } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function TrialBalancePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/accounting/trial-balance")
      .then(r => setData(r.data.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;
  if (!data) return <p>No data</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary-600" /> Trial Balance</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left">Account</th><th className="px-4 py-3 text-left">Code</th>
            <th className="px-4 py-3 text-left">Type</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th>
          </tr></thead>
          <tbody>
            {data.trialBalance.map((r: any) => (
              <tr key={r.accountId} className="border-b">
                <td className="px-4 py-3 font-medium">{r.accountName}</td><td className="px-4 py-3 font-mono text-xs">{r.accountCode}</td>
                <td className="px-4 py-3 text-xs">{r.accountType}</td>
                <td className="px-4 py-3 text-right">{r.debit > 0 ? formatCurrency(r.debit) : ""}</td>
                <td className="px-4 py-3 text-right">{r.credit > 0 ? formatCurrency(r.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 font-bold">
            <td className="px-4 py-3" colSpan={3}>Total</td>
            <td className="px-4 py-3 text-right">{formatCurrency(data.totalDebit)}</td>
            <td className="px-4 py-3 text-right">{formatCurrency(data.totalCredit)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}
