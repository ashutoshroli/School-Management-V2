"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { GraduationCap, CreditCard, Users, ArrowLeft, Edit, BadgeCheck, FileText, Trash2, Award, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { openPdfInNewTab } from "@/lib/pdf";
import { resolveUploadUrl } from "@/lib/uploads";
import FileUploadButton from "@/components/ui/FileUploadButton";
import Modal from "@/components/ui/Modal";

// yyyy-mm-dd for an HTML date input, from either an ISO string or a Date.
const toDateInputValue = (value: string | Date | null | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

const GENDERS = ["MALE", "FEMALE", "OTHER"];
const DISCOUNT_TYPES = ["SIBLING", "MERIT_SCHOLARSHIP", "RTE", "STAFF_WARD", "CUSTOM"];

export default function StudentProfilePage() {
  const params = useParams();
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", phone: "", classId: "", sectionId: "", rollNo: "",
    dateOfBirth: "", gender: "MALE", bloodGroup: "", religion: "", caste: "",
    category: "", nationality: "", motherTongue: "",
    address: "", city: "", state: "", pincode: "", cardId: "", isActive: true,
  });

  useEffect(() => {
    const fetchStudent = async () => {
      try {
        const res = await api.get(`/students/${params.id}`);
        setStudent(res.data.data);
      } catch (err) {
        alert("Student not found");
        router.push("/dashboard/students");
      } finally {
        setLoading(false);
      }
    };
    fetchStudent();
    api.get("/classes").then((r) => setClasses(r.data.data || [])).catch(() => {});
  }, [params.id, router]);

  const refetchStudent = async () => {
    const res = await api.get(`/students/${params.id}`);
    setStudent(res.data.data);
  };

  const openEditModal = () => {
    setEditForm({
      name: student.user.name || "",
      phone: student.user.phone || "",
      classId: student.class?.id || "",
      sectionId: student.section?.id || "",
      rollNo: student.rollNo || "",
      dateOfBirth: toDateInputValue(student.dateOfBirth),
      gender: student.gender || "MALE",
      bloodGroup: student.bloodGroup || "",
      religion: student.religion || "",
      caste: student.caste || "",
      category: student.category || "",
      nationality: student.nationality || "",
      motherTongue: student.motherTongue || "",
      address: student.address || "",
      city: student.city || "",
      state: student.state || "",
      pincode: student.pincode || "",
      cardId: student.cardId || "",
      isActive: student.isActive,
    });
    setShowEditModal(true);
  };

  const selectedClass = classes.find((c) => c.id === editForm.classId);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/students/${params.id}`, editForm);
      setShowEditModal(false);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update student");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    try {
      await api.delete(`/students/${params.id}/documents/${docId}`);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete document");
    }
  };

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountForm, setDiscountForm] = useState({ type: "SIBLING", name: "Sibling Discount", value: "", isPercent: false });

  const handleAddDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/fees/discounts", {
        studentId: params.id,
        type: discountForm.type,
        name: discountForm.name,
        value: parseFloat(discountForm.value),
        isPercent: discountForm.isPercent,
      });
      setShowDiscountModal(false);
      setDiscountForm({ type: "SIBLING", name: "Sibling Discount", value: "", isPercent: false });
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add discount");
    }
  };

  const toggleDiscount = async (id: string) => {
    try {
      await api.patch(`/fees/discounts/${id}/toggle`);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to toggle discount");
    }
  };

  const deleteDiscount = async (id: string) => {
    if (!confirm("Remove this discount?")) return;
    try {
      await api.delete(`/fees/discounts/${id}`);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove discount");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!student) return null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{student.user.name}</h1>
          <p className="text-gray-500">Admission No: {student.admissionNo}</p>
        </div>
        <button
          onClick={() => openPdfInNewTab(`/students/${params.id}/id-card`)}
          className="btn-secondary flex items-center gap-2"
        >
          <BadgeCheck className="h-4 w-4" /> ID Card
        </button>
        <Link href="/dashboard/certificates" className="btn-secondary flex items-center gap-2">
          <Award className="h-4 w-4" /> Certificates
        </Link>
        <button onClick={openEditModal} className="btn-primary flex items-center gap-2">
          <Edit className="h-4 w-4" /> Edit
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary-600" /> Student Details
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Class:</span> <span className="font-medium ml-2">{student.class?.name} - {student.section?.name}</span></div>
              <div><span className="text-gray-500">Roll No:</span> <span className="font-medium ml-2">{student.rollNo || "Not assigned"}</span></div>
              <div><span className="text-gray-500">DOB:</span> <span className="font-medium ml-2">{formatDate(student.dateOfBirth)}</span></div>
              <div><span className="text-gray-500">Gender:</span> <span className="font-medium ml-2">{student.gender}</span></div>
              <div><span className="text-gray-500">Blood Group:</span> <span className="font-medium ml-2">{student.bloodGroup || "-"}</span></div>
              <div><span className="text-gray-500">Category:</span> <span className="font-medium ml-2">{student.category || "-"}</span></div>
              <div><span className="text-gray-500">Religion:</span> <span className="font-medium ml-2">{student.religion || "-"}</span></div>
              <div><span className="text-gray-500">Nationality:</span> <span className="font-medium ml-2">{student.nationality}</span></div>
              <div><span className="text-gray-500">Email:</span> <span className="font-medium ml-2">{student.user.email}</span></div>
              <div><span className="text-gray-500">Phone:</span> <span className="font-medium ml-2">{student.user.phone || "-"}</span></div>
              <div><span className="text-gray-500">Admission Date:</span> <span className="font-medium ml-2">{formatDate(student.admissionDate)}</span></div>
              <div><span className="text-gray-500">Previous School:</span> <span className="font-medium ml-2">{student.previousSchool || "-"}</span></div>
            </div>
          </div>

          {/* Address */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Address</h3>
            <p className="text-sm text-gray-700">
              {student.address || "-"}, {student.city} {student.state} {student.pincode}
            </p>
          </div>

          {/* Parents */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-green-600" /> Parents / Guardians
            </h3>
            <div className="space-y-3">
              {student.parents?.map((link: any) => (
                <div key={link.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{link.parent.user.name}</p>
                    <p className="text-sm text-gray-500">{link.parent.relation} &bull; {link.parent.user.email}</p>
                  </div>
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                    {link.parent.user.phone || "No phone"}
                  </span>
                </div>
              ))}
              {(!student.parents || student.parents.length === 0) && (
                <p className="text-sm text-gray-400">No parents linked</p>
              )}
            </div>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" /> Documents
              </h3>
              <div className="flex gap-2">
                {["photo", "birth_cert", "aadhar", "tc", "marksheet"].map((docType) => (
                  <FileUploadButton
                    key={docType}
                    uploadPath={`/students/${params.id}/documents`}
                    extraFields={{ type: docType }}
                    label={docType.replace("_", " ")}
                    onUploaded={refetchStudent}
                    className="text-xs px-2 py-1"
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {student.documents?.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <div>
                    <a href={resolveUploadUrl(doc.fileUrl)} target="_blank" rel="noreferrer" className="font-medium text-primary-600 hover:underline">
                      {doc.name}
                    </a>
                    <p className="text-xs text-gray-500">{doc.type.replace("_", " ")} &bull; {formatDate(doc.createdAt)}</p>
                  </div>
                  <button onClick={() => handleDeleteDocument(doc.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {(!student.documents || student.documents.length === 0) && (
                <p className="text-sm text-gray-400">No documents uploaded yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="space-y-6">
          {/* RFID Card */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> RFID Card
            </h3>
            {student.cardId ? (
              <div className="bg-green-50 text-green-700 text-sm font-mono p-3 rounded-lg">
                {student.cardId}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Not assigned</p>
            )}
          </div>

          {/* Discounts */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-600">Discounts / Scholarships</h3>
              <button onClick={() => setShowDiscountModal(true)} className="text-primary-600 hover:text-primary-700" title="Add discount">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {student.discounts?.length > 0 ? (
              <div className="space-y-2">
                {student.discounts.map((d: any) => (
                  <div key={d.id} className={`text-sm p-2 rounded flex items-center justify-between ${d.isActive ? "bg-purple-50" : "bg-gray-50 opacity-60"}`}>
                    <div>
                      <span className="font-medium">{d.name}</span>
                      <span className="text-purple-700 ml-2">
                        {d.isPercent ? `${d.value}%` : `Rs ${d.value}`}
                      </span>
                      {!d.isActive && <span className="text-xs text-gray-400 ml-2">(inactive)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleDiscount(d.id)} title={d.isActive ? "Deactivate" : "Activate"} className="text-gray-500 hover:text-gray-700">
                        {d.isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4" />}
                      </button>
                      <button onClick={() => deleteDiscount(d.id)} title="Remove" className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">None</p>
            )}
          </div>

          {/* Status */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Status</h3>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${student.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {student.isActive ? "Active" : "Left / Inactive"}
            </span>
          </div>
        </div>
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Student" size="lg">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input className="input-field" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input className="input-field" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Class</label>
              <select
                className="input-field"
                value={editForm.classId}
                onChange={(e) => setEditForm({ ...editForm, classId: e.target.value, sectionId: "" })}
              >
                <option value="">Select</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Section</label>
              <select className="input-field" value={editForm.sectionId} onChange={(e) => setEditForm({ ...editForm, sectionId: e.target.value })}>
                <option value="">Select</option>
                {(selectedClass?.sections || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Roll No</label>
              <input className="input-field" value={editForm.rollNo} onChange={(e) => setEditForm({ ...editForm, rollNo: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date of Birth</label>
              <input type="date" className="input-field" value={editForm.dateOfBirth} onChange={(e) => setEditForm({ ...editForm, dateOfBirth: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Gender</label>
              <select className="input-field" value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Blood Group</label>
              <input className="input-field" value={editForm.bloodGroup} onChange={(e) => setEditForm({ ...editForm, bloodGroup: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Religion</label>
              <input className="input-field" value={editForm.religion} onChange={(e) => setEditForm({ ...editForm, religion: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Caste</label>
              <input className="input-field" value={editForm.caste} onChange={(e) => setEditForm({ ...editForm, caste: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <input className="input-field" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Nationality</label>
              <input className="input-field" value={editForm.nationality} onChange={(e) => setEditForm({ ...editForm, nationality: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mother Tongue</label>
              <input className="input-field" value={editForm.motherTongue} onChange={(e) => setEditForm({ ...editForm, motherTongue: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">RFID Card ID</label>
              <input className="input-field" value={editForm.cardId} onChange={(e) => setEditForm({ ...editForm, cardId: e.target.value })} placeholder="Leave blank if none" />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                id="isActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
              />
              <label htmlFor="isActive" className="text-sm font-medium">Active</label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input className="input-field" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input className="input-field" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input className="input-field" value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pincode</label>
              <input className="input-field" value={editForm.pincode} onChange={(e) => setEditForm({ ...editForm, pincode: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowEditModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Saving..." : "Save Changes"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showDiscountModal} onClose={() => setShowDiscountModal(false)} title="Add Discount / Scholarship">
        <form onSubmit={handleAddDiscount} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Type *</label>
            <select
              className="input-field"
              value={discountForm.type}
              onChange={(e) => setDiscountForm({ ...discountForm, type: e.target.value })}
            >
              {DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name *</label>
            <input className="input-field" value={discountForm.name} onChange={(e) => setDiscountForm({ ...discountForm, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Value *</label>
              <input type="number" className="input-field" value={discountForm.value} onChange={(e) => setDiscountForm({ ...discountForm, value: e.target.value })} required />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                id="isPercent"
                checked={discountForm.isPercent}
                onChange={(e) => setDiscountForm({ ...discountForm, isPercent: e.target.checked })}
              />
              <label htmlFor="isPercent" className="text-sm font-medium">Value is a percentage (%)</label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowDiscountModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Add Discount</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
