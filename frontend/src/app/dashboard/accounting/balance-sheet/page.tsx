"use client";

import { useState, useEffect } from "react";
import { Landmark } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function BalanceSheetPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/accounting/balance-sheet").then(r => setData(r.data.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;
  if (!data) return <p>No data</p>;

  const Section = ({ title, items, total, color }: any) => (
    <div className="card">
      <h3 className={`font-semibold mb-3 ${color}`}>{title}</h3>
      {items.map((i: any) => (
        <div key={i.code} className="flex justify-between py-2 border-b last:border-0 text-sm">
          <span>{i.name} <span className="text-gray-400 text-xs">({i.code})</span></span>
          <span className="font-medium">{formatCurrency(i.balance)}</span>
        </div>
      ))}
      <div className={`flex justify-between pt-3 mt-2 border-t-2 font-bold ${color}`}>
        <span>Total</span><span>{formatCurrency(total)}</span>
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><Landmark className="h-6 w-6 text-primary-600" /> Balance Sheet</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Assets" items={data.assets.items} total={data.assets.total} color="text-blue-700" />
        <div className="space-y-6">
          <Section title="Liabilities" items={data.liabilities.items} total={data.liabilities.total} color="text-red-700" />
          <Section title="Capital" items={data.capital.items} total={data.capital.total} color="text-purple-700" />
        </div>
      </div>
    </div>
  );
}
