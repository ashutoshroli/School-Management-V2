"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { GraduationCap, CreditCard, Users, ArrowLeft, Edit } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function StudentProfilePage() {
  const params = useParams();
  const router = useRouter();
  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
  }, [params.id, router]);

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
        <button className="btn-primary flex items-center gap-2">
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
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Discounts / Scholarships</h3>
            {student.discounts?.length > 0 ? (
              <div className="space-y-2">
                {student.discounts.map((d: any) => (
                  <div key={d.id} className="text-sm bg-purple-50 p-2 rounded">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-purple-700 ml-2">
                      {d.isPercent ? `${d.value}%` : `Rs ${d.value}`}
                    </span>
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
    </div>
  );
}
