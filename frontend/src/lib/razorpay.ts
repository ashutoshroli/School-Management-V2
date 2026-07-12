import api from "./api";

declare global {
  interface Window {
    Razorpay: any;
  }
}

/**
 * Lazily loads the Razorpay Checkout script (only once, even if called
 * multiple times across the app).
 */
let scriptPromise: Promise<void> | null = null;

const loadRazorpayScript = (): Promise<void> => {
  if (typeof window !== "undefined" && window.Razorpay) {
    return Promise.resolve();
  }
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Razorpay checkout script"));
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
};

export interface RazorpayPayParams {
  branchId: string;
  studentId: string;
  feeAssignmentId: string;
  studentName: string;
  studentEmail?: string;
  studentPhone?: string;
}

export interface RazorpayPayResult {
  payment: any;
  newStatus: string;
}

/**
 * Kicks off the full online-payment flow for a single fee assignment:
 * 1. Ask our backend to create a Razorpay order for the pending amount.
 * 2. Open Razorpay's checkout modal.
 * 3. On success, ask our backend to verify + record the payment
 *    (server-side signature verification - never trust the client here).
 *
 * Resolves with the recorded payment on success, rejects on failure or
 * if the user closes/cancels the checkout modal.
 */
export const payFeeWithRazorpay = async (params: RazorpayPayParams): Promise<RazorpayPayResult> => {
  const { branchId, studentId, feeAssignmentId, studentName, studentEmail, studentPhone } = params;

  await loadRazorpayScript();

  const orderRes = await api.post("/fees/razorpay/order", { branchId, studentId, feeAssignmentId });
  const { orderId, amount, currency, keyId } = orderRes.data.data;

  if (!keyId) {
    throw new Error("Online payments are not configured on the server yet.");
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: keyId,
      amount,
      currency,
      order_id: orderId,
      name: "School Fee Payment",
      description: "Fee payment",
      prefill: {
        name: studentName,
        email: studentEmail,
        contact: studentPhone,
      },
      theme: { color: "#4f46e5" },
      handler: async (response: any) => {
        try {
          const verifyRes = await api.post("/fees/razorpay/verify", {
            branchId,
            studentId,
            feeAssignmentId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          resolve(verifyRes.data.data);
        } catch (err) {
          reject(err);
        }
      },
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled")),
      },
    });

    rzp.open();
  });
};

export interface PublicRazorpayPayParams {
  admissionNo: string;
  dateOfBirth: string; // "YYYY-MM-DD"
  feeAssignmentId: string;
  studentName: string;
}

/**
 * Public-portal counterpart to payFeeWithRazorpay above - same 3-step
 * flow (create order -> open checkout -> server-verify), but hits the
 * public /public/fees/pay and /public/fees/verify endpoints (no auth
 * token, re-verified server-side against admissionNo+dateOfBirth
 * instead of an authenticated req.user) for the "check my dues, then
 * pay" public landing-page flow.
 */
export const payPublicFeeWithRazorpay = async (params: PublicRazorpayPayParams): Promise<RazorpayPayResult> => {
  const { admissionNo, dateOfBirth, feeAssignmentId, studentName } = params;

  await loadRazorpayScript();

  const orderRes = await api.post("/public/fees/pay", { admissionNo, dateOfBirth, feeAssignmentId });
  const { orderId, amount, currency, keyId } = orderRes.data.data;

  if (!keyId) {
    throw new Error("Online payments are not configured on the server yet.");
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: keyId,
      amount,
      currency,
      order_id: orderId,
      name: "School Fee Payment",
      description: "Fee payment",
      prefill: { name: studentName },
      theme: { color: "#4f46e5" },
      handler: async (response: any) => {
        try {
          const verifyRes = await api.post("/public/fees/verify", {
            admissionNo,
            dateOfBirth,
            feeAssignmentId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          resolve(verifyRes.data.data);
        } catch (err) {
          reject(err);
        }
      },
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled")),
      },
    });

    rzp.open();
  });
};
