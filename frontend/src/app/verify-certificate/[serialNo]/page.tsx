"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import api from "@/lib/api";

interface VerificationResult {
  valid: boolean;
  serialNo?: string;
  certificateType?: string;
  certificateName?: string;
  studentName?: string;
  admissionNo?: string;
  branchName?: string;
  issuedOn?: string;
}

/**
 * Public, unauthenticated certificate verification page - the target
 * of the `verifyUrl` printed on every generated TC/Bonafide/Character
 * certificate PDF (see backend/src/services/certificateGenerator.service.ts).
 * Anyone holding a printed certificate (a bank, employer, another
 * school) can confirm it was genuinely issued, without needing a
 * school-portal login. Calls the equally-public
 * GET /api/communication/certificates/verify/:serialNo, which returns
 * only the same minimal info already printed on the certificate - no
 * PDF, no sensitive student data beyond name/admission number.
 */
export default function VerifyCertificatePage() {
  const params = useParams();
  const serialNo = params.serialNo as string;
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/communication/certificates/verify/${serialNo}`)
      .then((res) => setResult(res.data.data))
      .catch(() => setResult({ valid: false }))
      .finally(() => setLoading(false));
  }, [serialNo]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="flex items-center justify-center gap-2 mb-6">
          <ShieldCheck className="h-7 w-7 text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Certificate Verification</h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : result?.valid ? (
            <div>
              <div className="flex items-center gap-2 text-green-700 mb-4">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-semibold">This certificate is genuine</span>
              </div>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-gray-500">Serial No.</dt>
                  <dd className="font-mono font-medium">{result.serialNo}</dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-gray-500">Certificate</dt>
                  <dd className="font-medium">{result.certificateName}</dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-gray-500">Student Name</dt>
                  <dd className="font-medium">{result.studentName}</dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-gray-500">Admission No.</dt>
                  <dd className="font-medium">{result.admissionNo}</dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-gray-500">Issued By</dt>
                  <dd className="font-medium">{result.branchName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Issued On</dt>
                  <dd className="font-medium">{result.issuedOn}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <XCircle className="h-10 w-10 text-red-500" />
              <p className="font-semibold text-red-700">No certificate found</p>
              <p className="text-sm text-gray-500">
                No certificate with serial number <span className="font-mono">{serialNo}</span> exists in our records.
                This document may be invalid or altered.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
