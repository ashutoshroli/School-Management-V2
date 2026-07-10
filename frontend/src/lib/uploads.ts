const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

// The backend serves uploaded files (avatars, student/staff documents)
// as static files at `{backendOrigin}/uploads/...`, which is one level
// up from the `/api` prefix used for JSON endpoints.
const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

/**
 * Uploaded-file URLs stored in the DB are relative (e.g. "/uploads/...")
 * since the backend doesn't know its own public origin at write time.
 * The frontend runs on a different origin/port, so a relative URL used
 * directly in an <img src> or <a href> would 404 - this resolves it
 * against the backend's origin instead.
 */
export const resolveUploadUrl = (relativeOrAbsoluteUrl: string): string => {
  if (!relativeOrAbsoluteUrl) return relativeOrAbsoluteUrl;
  if (/^https?:\/\//i.test(relativeOrAbsoluteUrl)) return relativeOrAbsoluteUrl;
  return `${BACKEND_ORIGIN}${relativeOrAbsoluteUrl}`;
};
