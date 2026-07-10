"use client";

import { useState } from "react";
import { IndianRupee, Search, Save } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function SalaryStructurePage() {
  const [staff, setStaff] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [structure, setStructure] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    basic: "", da: "0", hra: "0", ta: "0",
    specialAllow: "0", medicalAllow: "0", otherAllow: "0",
    professionalTax: "200", otherDeduction: "0", taxRegime: "NEW",
  });

  const searchStaff = async () => {
    if (!search.trim()) return;
    const res = await api.get("/staff", { params: { search, limit: 10 } });
    setStaff(res.data.data || []);
  };

  const selectStaff = async (s: any) => {
    setSelected(s); setStaff([]); setSearch("");
    try {
      const res = await api.get(`/hr/salary-structure/${s.id}`);
      const d = res.data.data;
      if (d) {
        setForm({ basic: String(d.basic), da: String(d.da), hra: String(d.hra), ta: String(d.ta), specialAllow: String(d.specialAllow), medicalAllow: String(d.medicalAllow), otherAllow: String(d.otherAllow), professionalTax: String(d.professionalTax), otherDeduction: String(d.otherDeduction), taxRegime: d.taxRegime });
        setStructure(d);
      } else { setStructure(null); }
    } catch { setStructure(null); }
  };


  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const payload: any = { staffId: selected.id };
      Object.entries(form).forEach(([k, v]) => { payload[k] = k === "taxRegime" ? v : parseFloat(v) || 0; });
      const res = await api.post("/hr/salary-structure", payload);
      setStructure(res.data.data);
      alert("Saved! PF/ESI/TDS auto-calculated.");
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2"><IndianRupee className="h-6 w-6 text-primary-600" /> Salary Structure</h1>
      <div className="card mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input className="input-field pl-10" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && searchStaff()} /></div>
          <button onClick={searchStaff} className="btn-primary">Search</button>
        </div>
        {staff.length > 0 && (<div className="mt-2 border rounded-lg max-h-40 overflow-y-auto">
          {staff.map(s => (<button key={s.id} onClick={() => selectStaff(s)} className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b last:border-0">{s.user.name} ({s.employeeId})</button>))}
        </div>)}
      </div>


      {selected && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="card"><h3 className="font-semibold mb-4 text-green-700">Earnings - {selected.user.name}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {["basic","da","hra","ta","specialAllow","medicalAllow","otherAllow"].map(k => (
                <div key={k}><label className="block text-xs font-medium text-gray-600 mb-1">{k}</label>
                  <input type="number" className="input-field" value={(form as any)[k]} onChange={e => setForm({...form, [k]: e.target.value})} /></div>
              ))}
            </div></div>
          <div className="card"><h3 className="font-semibold mb-4 text-red-700">Deductions</h3>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-xs font-medium mb-1">Prof. Tax</label><input type="number" className="input-field" value={form.professionalTax} onChange={e => setForm({...form, professionalTax: e.target.value})} /></div>
              <div><label className="block text-xs font-medium mb-1">Other Ded.</label><input type="number" className="input-field" value={form.otherDeduction} onChange={e => setForm({...form, otherDeduction: e.target.value})} /></div>
              <div><label className="block text-xs font-medium mb-1">Tax Regime</label><select className="input-field" value={form.taxRegime} onChange={e => setForm({...form, taxRegime: e.target.value})}><option value="NEW">New</option><option value="OLD">Old</option></select></div>
            </div></div>
          {structure && (<div className="card bg-gray-50"><h3 className="font-semibold mb-3">Auto-Calculated</h3>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <p>PF: <b>{formatCurrency(structure.pfEmployee)}</b></p>
              <p>ESI: <b>{formatCurrency(structure.esiEmployee)}</b></p>
              <p>TDS: <b className="text-red-600">{formatCurrency(structure.tds)}</b></p>
              <p>Gross: <b className="text-green-700">{formatCurrency(structure.grossSalary)}</b></p>
              <p>Net: <b className="text-primary-700 text-lg">{formatCurrency(structure.netSalary)}</b></p>
            </div></div>)}
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save & Calculate"}</button>
        </form>
      )}
    </div>
  );
}
