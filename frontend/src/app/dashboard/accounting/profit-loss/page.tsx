"use client";

import { useState, useEffect } from "react";
import { TrendingUp } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function ProfitLossPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/accounting/profit-loss").then(r => setData(r.data.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;
  if (!data) return <p>No data</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><TrendingUp className="h-6 w-6 text-primary-600" /> Profit & Loss</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold text-green-700 mb-3">Income</h3>
          {data.incomeItems.map((i: any) => (
            <div key={i.code} className="flex justify-between py-2 border-b last:border-0">
              <span>{i.name}</span><span className="font-medium">{formatCurrency(i.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-2 border-t-2 font-bold text-green-700">
            <span>Total Income</span><span>{formatCurrency(data.totalIncome)}</span>
          </div>
        </div>
        <div className="card">
          <h3 className="font-semibold text-red-700 mb-3">Expenses</h3>
          {data.expenseItems.map((i: any) => (
            <div key={i.code} className="flex justify-between py-2 border-b last:border-0">
              <span>{i.name}</span><span className="font-medium">{formatCurrency(i.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-2 border-t-2 font-bold text-red-700">
            <span>Total Expenses</span><span>{formatCurrency(data.totalExpense)}</span>
          </div>
        </div>
      </div>
      <div className={`card mt-6 text-center ${data.netProfit >= 0 ? "border-green-300" : "border-red-300"} border-2`}>
        <p className="text-sm text-gray-500">Net {data.netProfit >= 0 ? "Profit" : "Loss"}</p>
        <p className={`text-3xl font-bold ${data.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>{formatCurrency(Math.abs(data.netProfit))}</p>
      </div>
    </div>
  );
}
