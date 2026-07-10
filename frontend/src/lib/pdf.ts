import api from "./api";

/**
 * PDF-streaming backend endpoints (fee receipt, ID card, report card)
 * need the Authorization header to be attached, which a plain
 * `<a href>`/`window.open(url)` navigation cannot do. Instead, we fetch
 * the PDF as a blob through the authenticated axios client, then open
 * it via a short-lived object URL. This avoids ever putting the JWT in
 * a URL (query strings end up in browser history/server access logs,
 * which is a real leak vector for auth tokens).
 */
export const openPdfInNewTab = async (path: string): Promise<void> => {
  try {
    const res = await api.get(path, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data);
    const win = window.open(blobUrl, "_blank");
    if (!win) {
      alert("Please allow pop-ups to view this document.");
    }
    // Revoke after a delay long enough for the new tab to load the blob.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err: any) {
    alert(err.response?.data?.message || "Failed to load document");
  }
};
