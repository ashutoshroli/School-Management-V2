"use client";

import { useState, useEffect } from "react";
import { Fuel, ArrowRight } from "lucide-react";
import api from "@/lib/api";

/**
 * Diesel Request approval chain (spec Section 11) - Driver raises ->
 * Transport Manager -> Accounts -> Director payment approval.
 */
export default function DieselRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get("/diesel-requests");
      setRequests(res.data.data || []);
    } catch { setRequests([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const advance = async (id: string, stage: string) => {
    const paymentMode = stage === "ACCOUNTS_APPROVED" ? (confirm("OK = Online Transfer, Cancel = Cash") ? "ONLINE_TRANSFER" : "CASH") : undefined;
    try {
      await api.patch(`/diesel-requests/${id}/advance`, { decision: "APPROVE", paymentMode });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const reject = async (id: string) => {
    const rejectionReason = prompt("Rejection reason?") || "";
    try {
      await api.patch(`/diesel-requests/${id}/advance`, { decision: "REJECT", rejectionReason });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Fuel className="h-6 w-6 text-primary-600" /> Diesel Requests
        </h1>
        <p className="text-gray-500 mt-1">Driver -&gt; Transport Manager -&gt; Accounts -&gt; Director payment approval (max 3 re-requests/week)</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : requests.length === 0 ? (
        <div className="card text-center py-12"><p className="text-gray-500">No diesel requests yet.</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Vehicle</th>
                <th className="px-4 py-3 text-left">Driver</th>
                <th className="px-4 py-3 text-left">Amount / Litres</th>
                <th className="px-4 py-3 text-left">Stage</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-3">{r.vehicle?.vehicleNo}</td>
                  <td className="px-4 py-3">{r.driver?.user?.name}</td>
                  <td className="px-4 py-3">Rs {Number(r.amount).toLocaleString()} / {r.litres}L</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{r.stage}</span></td>
                  <td className="px-4 py-3 space-x-3">
                    {r.stage !== "PAID" && r.stage !== "REJECTED" && (
                      <>
                        <button onClick={() => advance(r.id, r.stage)} className="text-primary-600 hover:underline text-xs font-medium inline-flex items-center gap-1">
                          Advance <ArrowRight className="h-3 w-3" />
                        </button>
                        <button onClick={() => reject(r.id)} className="text-red-600 hover:underline text-xs font-medium">Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
