"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GraduationCap } from "lucide-react";
import api from "@/lib/api";

export default function NewAdmissionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);

  // Pre-fill from an Admission Inquiry via the "Convert to Student"
  // shortcut on the Admissions page (query params only - no shared
  // backend endpoint needed since the field sets don't line up 1:1,
  // e.g. `classAppliedFor` is free text, not a real classId).
  const fromInquiryId = searchParams.get("fromInquiryId");
  const classAppliedFor = searchParams.get("classAppliedFor") || "";

  const [form, setForm] = useState({
    name: searchParams.get("name") || "",
    email: "", phone: "",
    dateOfBirth: searchParams.get("dateOfBirth") || "",
    gender: searchParams.get("gender") || "MALE",
    bloodGroup: "", religion: "", caste: "", category: "General",
    nationality: "Indian", motherTongue: "",
    address: searchParams.get("address") || "", city: "",
    state: "", pincode: "",
    previousSchool: searchParams.get("previousSchool") || "", cardId: "",
    classId: "", sectionId: "", rollNo: "",
    fatherName: searchParams.get("fatherName") || "",
    fatherEmail: searchParams.get("fatherEmail") || "",
    fatherPhone: searchParams.get("fatherPhone") || "",
    fatherOccupation: "",
    motherName: "", motherEmail: "", motherPhone: "", motherOccupation: "",
  });

  useEffect(() => {
    api.get("/classes").then((res) => setClasses(res.data.data || []));
  }, []);

  useEffect(() => {
    if (form.classId) {
      const cls = classes.find((c) => c.id === form.classId);
      setSections(cls?.sections || []);
    }
  }, [form.classId, classes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Point 6: only send rollNo when the admin actually chose Manual
      // entry AND typed something - "Auto" mode always sends a blank
      // value so the backend auto-generates the next roll number for
      // this section.
      const payload = { ...form, rollNo: rollNoMode === "manual" ? form.rollNo.trim() : "" };
      await api.post("/students", payload);
      // If this admission was converted from an inquiry, mark the
      // inquiry ADMITTED so it drops off the "New"/"Contacted"
      // worklist on the Admissions page. Best-effort - the student
      // record is already created either way, so a failure here
      // shouldn't block the success message.
      if (fromInquiryId) {
        try { await api.patch(`/admission/inquiries/${fromInquiryId}/status`, { status: "ADMITTED" }); } catch {}
      }
      alert("Student admitted successfully!");
      router.push("/dashboard/students");
    } catch (err: any) {
      alert(err.response?.data?.message || "Admission failed");
    } finally {
      setLoading(false);
    }
  };

  const setField = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  // Point 6 (Manual Roll No. Generation): "Auto-generate" (the
  // default, and pre-existing behavior) leaves rollNo blank so the
  // backend picks the next available number in that section;
  // switching to "Manual" reveals a text input so the admin can set
  // their own value. Purely a UI convenience - the backend already
  // accepts either an explicit rollNo or none at all.
  const [rollNoMode, setRollNoMode] = useState<"auto" | "manual">("auto");

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary-600" /> New Student Admission
        </h1>
        <p className="text-gray-500 mt-1">Fill all required details for admission</p>
      </div>

      {fromInquiryId && (
        <div className="mb-6 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-4 py-3">
          Pre-filled from an admission inquiry. Please review the details below, and don&apos;t forget to pick the actual Class/Section
          {classAppliedFor && <> (inquiry requested: <span className="font-medium">{classAppliedFor}</span>)</>} and enter a login email for the student.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Student Info */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Student Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input className="input-field" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input type="email" className="input-field" value={form.email} onChange={(e) => setField("email", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input className="input-field" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
              <input type="date" className="input-field" value={form.dateOfBirth} onChange={(e) => setField("dateOfBirth", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
              <select className="input-field" value={form.gender} onChange={(e) => setField("gender", e.target.value)} required>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Blood Group</label>
              <select className="input-field" value={form.bloodGroup} onChange={(e) => setField("bloodGroup", e.target.value)}>
                <option value="">Select</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => (
                  <option key={bg} value={bg}>{bg}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select className="input-field" value={form.category} onChange={(e) => setField("category", e.target.value)}>
                {["General", "OBC", "SC", "ST", "EWS"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Religion</label>
              <input className="input-field" value={form.religion} onChange={(e) => setField("religion", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RFID Card ID</label>
              <input className="input-field" placeholder="Scan or enter card UID" value={form.cardId} onChange={(e) => setField("cardId", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Class Assignment */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Class Assignment</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
              <select className="input-field" value={form.classId} onChange={(e) => setField("classId", e.target.value)} required>
                <option value="">Select Class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section *</label>
              <select className="input-field" value={form.sectionId} onChange={(e) => setField("sectionId", e.target.value)} required>
                <option value="">Select Section</option>
                {sections.map((s: any) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
              </select>
            </div>
            {/* Point 6: Auto-generate (default) vs Manual roll number entry */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Roll No.</label>
              <div className="flex items-center gap-2">
                <select
                  className="input-field w-auto"
                  value={rollNoMode}
                  onChange={(e) => {
                    const mode = e.target.value as "auto" | "manual";
                    setRollNoMode(mode);
                    if (mode === "auto") setField("rollNo", "");
                  }}
                >
                  <option value="auto">Auto-generate</option>
                  <option value="manual">Manual</option>
                </select>
                {rollNoMode === "manual" && (
                  <input
                    className="input-field flex-1"
                    placeholder="Enter roll number"
                    value={form.rollNo}
                    onChange={(e) => setField("rollNo", e.target.value)}
                  />
                )}
              </div>
              {rollNoMode === "auto" && (
                <p className="text-xs text-gray-400 mt-1">Next available roll number in this section will be assigned automatically.</p>
              )}
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Address</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea className="input-field" rows={2} value={form.address} onChange={(e) => setField("address", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input className="input-field" value={form.city} onChange={(e) => setField("city", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input className="input-field" value={form.state} onChange={(e) => setField("state", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
              <input className="input-field" value={form.pincode} onChange={(e) => setField("pincode", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Parent Info */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Parent / Guardian Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Father */}
            <div className="space-y-3">
              <h4 className="font-medium text-gray-700 border-b pb-1">Father</h4>
              <input className="input-field" placeholder="Father's Name" value={form.fatherName} onChange={(e) => setField("fatherName", e.target.value)} />
              <input className="input-field" type="email" placeholder="Father's Email (Google Login)" value={form.fatherEmail} onChange={(e) => setField("fatherEmail", e.target.value)} />
              <input className="input-field" placeholder="Phone" value={form.fatherPhone} onChange={(e) => setField("fatherPhone", e.target.value)} />
              <input className="input-field" placeholder="Occupation" value={form.fatherOccupation} onChange={(e) => setField("fatherOccupation", e.target.value)} />
            </div>
            {/* Mother */}
            <div className="space-y-3">
              <h4 className="font-medium text-gray-700 border-b pb-1">Mother</h4>
              <input className="input-field" placeholder="Mother's Name" value={form.motherName} onChange={(e) => setField("motherName", e.target.value)} />
              <input className="input-field" type="email" placeholder="Mother's Email (Google Login)" value={form.motherEmail} onChange={(e) => setField("motherEmail", e.target.value)} />
              <input className="input-field" placeholder="Phone" value={form.motherPhone} onChange={(e) => setField("motherPhone", e.target.value)} />
              <input className="input-field" placeholder="Occupation" value={form.motherOccupation} onChange={(e) => setField("motherOccupation", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => router.back()} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Admitting..." : "Submit Admission"}
          </button>
        </div>
      </form>
    </div>
  );
}
