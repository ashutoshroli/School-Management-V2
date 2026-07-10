"use client";

import { useState, useEffect } from "react";
import { Calculator } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/accounting/accounts").then(r => setAccounts(r.data.data || []));
  }, []);

  const fetchLedger = async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const r = await api.get(`/accounting/ledger/${selectedAccount}`);
      setLedger(r.data.data);
    } catch {} finally { setLoading(false); }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Calculator className="h-6 w-6 text-primary-600" /> Ledger
      </h1>
      <div className="card mb-6 flex gap-4">
        <select className="input-field flex-1" value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}>
          <option value="">Select Account</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
        </select>
        <button onClick={fetchLedger} disabled={!selectedAccount} className="btn-primary">View</button>
      </div>


      {loading && <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>}
      {ledger && !loading && (
        <div className="card overflow-x-auto">
          <div className="flex justify-between mb-3 text-sm">
            <span>Total Debit: <b className="text-blue-700">{formatCurrency(ledger.totalDebit)}</b></span>
            <span>Total Credit: <b className="text-red-600">{formatCurrency(ledger.totalCredit)}</b></span>
            <span>Closing: <b>{formatCurrency(ledger.closingBalance)}</b></span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Voucher</th>
              <th className="px-4 py-3 text-left">Narration</th>
              <th className="px-4 py-3 text-right">Debit</th>
              <th className="px-4 py-3 text-right">Credit</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr></thead>
            <tbody>
              {ledger.ledger.map((l: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="px-4 py-3">{formatDate(l.date)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.voucherNo}</td>
                  <td className="px-4 py-3 text-gray-600">{l.narration || "-"}</td>
                  <td className="px-4 py-3 text-right">{l.debit > 0 ? formatCurrency(l.debit) : ""}</td>
                  <td className="px-4 py-3 text-right">{l.credit > 0 ? formatCurrency(l.credit) : ""}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
