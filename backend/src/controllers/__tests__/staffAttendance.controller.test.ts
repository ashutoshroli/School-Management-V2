jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn(), findMany: jest.fn() },
    // Phase 5: late-entry/early-exit penalty rule - applyLateEarlyPenalty
    // reads Branch's penalty-config fields and counts prior
    // isLateEntry/isEarlyExit occurrences within a rolling window.
    // branch.findUnique defaults to null (-> applyLateEarlyPenalty's own
    // fallback defaults, e.g. threshold 5) and staffAttendance.count
    // defaults to 0 (no prior occurrences), so any test that happens to
    // trigger this path (including the real-`new Date()`-based ones
    // below, whose LATE/early-exit outcome depends on the actual time a
    // test run executes) resolves safely instead of throwing on an
    // unmocked function.
    branch: { findUnique: jest.fn().mockResolvedValue(null) },
    staffAttendance: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    holiday: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import {
  cardTapAttendance,
  markAttendance,
  bulkMarkAttendance,
  getAttendanceCalendar,
  selfMarkAttendance,
  getStaffAttendanceReport,
  exportStaffAttendanceReportCsv,
} from "../staffAttendance.controller";
import { AuthRequest } from "../../types";
import { UserRole } from "@prisma/client";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (body: any, headers: Record<string, string> = {}): AuthRequest =>
  ({ body, headers, params: {}, query: {} } as any);

const DEVICE = { id: "device-1", branchId: "branch-1", deviceId: "device-uuid-1", apiKey: "secret-key-abc123", isActive: true };
const STAFF = { id: "staff-1", branchId: "branch-1", cardId: "CARD-STAFF-001" };

describe("staffAttendance.controller - cardTapAttendance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects a tap with no apiKey at all (regression guard for the pre-fix behavior)", async () => {
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1" });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prisma.attendanceDevice.findUnique).not.toHaveBeenCalled();
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a tap with the wrong apiKey even for a real deviceId", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: "wrong-key" });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a tap for staff in a different branch than the device", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ ...STAFF, branchId: "branch-OTHER" });
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.staffAttendance.create).not.toHaveBeenCalled();
  });

  it("records an IN tap with valid device credentials and matching branch", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey, timestamp: "2024-03-15T03:00:00.000Z" }); // 08:30 IST-ish/before cutoff regardless of TZ math, just needs to be a normal morning time
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.staffAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "CARD_TAP" }) })
    );
  });

  // New Features Phase 5: auto-flag LATE instead of PRESENT when the
  // tap time is past the day-start cutoff (09:15), instead of requiring
  // an admin to fix it up manually afterwards.
  it("BUG FIX: auto-flags a card-tap IN as LATE when past the day-start cutoff", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const lateTime = new Date();
    lateTime.setHours(10, 30, 0, 0); // well past 09:15 in local time
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey, timestamp: lateTime.toISOString() });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(prisma.staffAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "LATE" }) })
    );
  });

  it("still marks PRESENT for a card-tap IN before the day-start cutoff", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const onTimeTap = new Date();
    onTimeTap.setHours(8, 0, 0, 0); // well before 09:15
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey, timestamp: onTimeTap.toISOString() });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(prisma.staffAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PRESENT" }) })
    );
  });

  it("accepts the apiKey via the X-Device-Api-Key header", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1" }, { "x-device-api-key": DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 403 for a deactivated device even with the correct apiKey", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue({ ...DEVICE, isActive: false });
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 404 for an unregistered card even with valid device credentials", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ cardId: "CARD-UNKNOWN", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("staffAttendance.controller - markAttendance", () => {
  const makeMarkReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: { staffId: "staff-1", date: "2024-03-15", status: "PRESENT" },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1", organizationId: "org-1" },
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.upsert as jest.Mock).mockResolvedValue({ id: "att-1", status: "PRESENT" });
  });

  it("returns 400 when staffId, date, or status is missing", async () => {
    const req = makeMarkReq({ body: { staffId: "staff-1", date: "2024-03-15" } });
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the staff record does not exist", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects marking attendance for staff in a different branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  // BUG FIX regression guard: uses a single atomic upsert instead of
  // the old find-then-create/update pattern, which could throw on a
  // unique-constraint violation if the same request was retried.
  it("BUG FIX: uses a single atomic upsert instead of find-then-create/update", async () => {
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.staffAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { staffId_date: { staffId: "staff-1", date: new Date("2024-03-15") } },
        create: expect.objectContaining({ staffId: "staff-1", status: "PRESENT", source: "MANUAL" }),
      })
    );
    expect(prisma.staffAttendance.create).not.toHaveBeenCalled();
    expect(prisma.staffAttendance.update).not.toHaveBeenCalled();
  });

  it("returns 200 'Attendance updated' when a record already exists for that staff+date", async () => {
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue({ id: "att-existing" });
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Attendance updated" }));
  });

  // New Features Phase 5: auto-upgrade a manually-picked PRESENT to
  // LATE based on inTime, instead of requiring the admin to remember
  // to pick LATE themselves.
  it("BUG FIX: auto-upgrades PRESENT to LATE when inTime is past the day-start cutoff", async () => {
    const req = makeMarkReq({ body: { staffId: "staff-1", date: "2024-03-15", status: "PRESENT", inTime: "2024-03-15T10:30:00" } });
    const res = makeMockRes();

    await markAttendance(req, res);

    expect((prisma.staffAttendance.upsert as jest.Mock).mock.calls[0][0].create.status).toBe("LATE");
  });

  it("does NOT upgrade an explicitly-picked ABSENT/HALF_DAY/ON_LEAVE status even with a late inTime", async () => {
    const req = makeMarkReq({ body: { staffId: "staff-1", date: "2024-03-15", status: "HALF_DAY", inTime: "2024-03-15T10:30:00" } });
    const res = makeMockRes();

    await markAttendance(req, res);

    expect((prisma.staffAttendance.upsert as jest.Mock).mock.calls[0][0].create.status).toBe("HALF_DAY");
  });

  it("keeps PRESENT as-is when inTime is before the day-start cutoff", async () => {
    const req = makeMarkReq({ body: { staffId: "staff-1", date: "2024-03-15", status: "PRESENT", inTime: "2024-03-15T08:00:00" } });
    const res = makeMockRes();

    await markAttendance(req, res);

    expect((prisma.staffAttendance.upsert as jest.Mock).mock.calls[0][0].create.status).toBe("PRESENT");
  });

  it("keeps PRESENT as-is when no inTime is provided at all", async () => {
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect((prisma.staffAttendance.upsert as jest.Mock).mock.calls[0][0].create.status).toBe("PRESENT");
  });
});

// New Features Phase 5: self check-in/out - a staff member punches
// their OWN attendance, restricted to their own staffId and today's date.
describe("staffAttendance.controller - selfMarkAttendance", () => {
  const makeSelfReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({ body: {}, params: {}, query: {}, user: { userId: "user-1", email: "s@test.com", role: UserRole.TEACHER, branchId: "branch-1" }, ...overrides } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the user has no linked staff record", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeSelfReq();
    const res = makeMockRes();

    await selfMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("creates an IN record on the first call of the day", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1", status: "PRESENT" });
    const req = makeSelfReq();
    const res = makeMockRes();

    await selfMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.action).toBe("IN");
    expect(prisma.staffAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ staffId: "staff-1", source: "MANUAL" }) })
    );
  });

  it("records the OUT time on a second call the same day (no outTime yet)", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue({ id: "att-1", outTime: null });
    (prisma.staffAttendance.update as jest.Mock).mockResolvedValue({ id: "att-1" });
    const req = makeSelfReq();
    const res = makeMockRes();

    await selfMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.action).toBe("OUT");
  });

  it("rejects a third call the same day (already checked in AND out)", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue({ id: "att-1", outTime: new Date() });
    const req = makeSelfReq();
    const res = makeMockRes();

    await selfMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staffAttendance.update).not.toHaveBeenCalled();
  });
});

describe("staffAttendance.controller - getStaffAttendanceReport / exportStaffAttendanceReportCsv", () => {
  const makeReportReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({ body: {}, params: {}, query: { month: "3", year: "2024" }, user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" }, ...overrides } as any);

  const STAFF_WITH_ATTENDANCE = [
    {
      employeeId: "EMP-001", designation: "PGT", department: "Science",
      user: { name: "Jane Teacher" },
      attendances: [
        { status: "PRESENT" }, { status: "PRESENT" }, { status: "ABSENT" }, { status: "LATE" }, { status: "HALF_DAY" },
      ],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.staff.findMany as jest.Mock).mockResolvedValue(STAFF_WITH_ATTENDANCE);
    (prisma.holiday.count as jest.Mock).mockResolvedValue(0);
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReportReq({ user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined } });
    const res = makeMockRes();

    await getStaffAttendanceReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("computes present/absent/late/halfDay counts and an attendance percentage per staff member", async () => {
    const req = makeReportReq();
    const res = makeMockRes();

    await getStaffAttendanceReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]).toEqual(
      expect.objectContaining({ employeeId: "EMP-001", present: 2, absent: 1, late: 1, halfDay: 1, onLeave: 0 })
    );
  });

  it("DATA INTEGRITY: excludes declared holidays from the working-days denominator", async () => {
    (prisma.holiday.count as jest.Mock).mockResolvedValue(4); // 4 holidays in March
    const req = makeReportReq();
    const res = makeMockRes();

    await getStaffAttendanceReport(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    // March has 31 days; 31 - 4 holidays = 27 working days
    expect(payload.rows[0].workingDays).toBe(27);
  });

  it("exportStaffAttendanceReportCsv sends a CSV attachment with the same computed rows", async () => {
    const req = makeReportReq();
    const res: any = { setHeader: jest.fn(), send: jest.fn() };

    await exportStaffAttendanceReportCsv(req, res);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("EMP-001"));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Jane Teacher"));
  });
});

describe("staffAttendance.controller - bulkMarkAttendance", () => {
  const makeBulkReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: {
        date: "2024-03-15",
        records: [
          { staffId: "staff-1", status: "PRESENT" },
          { staffId: "staff-2", status: "ABSENT" },
        ],
      },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1", organizationId: "org-1" },
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "staff-1", branchId: "branch-1" },
      { id: "staff-2", branchId: "branch-1" },
    ]);
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (ops: any[]) => Promise.all(ops));
    (prisma.staffAttendance.upsert as jest.Mock).mockResolvedValue({ id: "att-1" });
  });

  it("returns 400 when date is missing", async () => {
    const req = makeBulkReq({ body: { records: [{ staffId: "staff-1", status: "PRESENT" }] } });
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when records is empty", async () => {
    const req = makeBulkReq({ body: { date: "2024-03-15", records: [] } });
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when a staffId in the batch does not exist", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "staff-1", branchId: "branch-1" }]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a batch containing staff from a different branch", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "staff-1", branchId: "branch-1" },
      { id: "staff-2", branchId: "branch-OTHER" },
    ]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // BUG FIX regression guard: this is the exact scenario that used to
  // produce "unable to save attendance" - a batch save request being
  // effectively re-processed (e.g. after a slow network response made
  // the admin click "Save All" again) must succeed cleanly via upsert,
  // not throw a unique-constraint error from a duplicate create().
  it("BUG FIX: saves every record via upsert inside a single transaction, succeeding even if all records already exist", async () => {
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([
      { staffId: "staff-1" },
      { staffId: "staff-2" },
    ]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.staffAttendance.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.staffAttendance.create).not.toHaveBeenCalled();
    expect(prisma.staffAttendance.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { created: 0, updated: 2 } }));
  });

  it("reports accurate created/updated counts for a mixed batch", async () => {
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([{ staffId: "staff-1" }]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, updated: 1 }, message: "Attendance saved: 1 new, 1 updated" })
    );
  });
});

// SECURITY: getAttendanceCalendar previously had NO access check at
// all beyond `authenticate` - any logged-in user could pull ANY other
// staff member's attendance calendar just by supplying their staffId,
// including staff in a different branch (IDOR). Regression guards for
// the fix (canAccessStaffRecord).
describe("staffAttendance.controller - getAttendanceCalendar (IDOR fix)", () => {
  const makeCalendarReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: {},
      params: { staffId: "staff-victim" },
      query: {},
      user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" },
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects a Teacher reading another staff member's calendar in a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "other-user" });
    const req = makeCalendarReq();
    const res = makeMockRes();

    await getAttendanceCalendar(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.staffAttendance.findMany).not.toHaveBeenCalled();
  });

  it("allows a staff member within the SAME branch to read a colleague's calendar", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", userId: "other-user" });
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeCalendarReq();
    const res = makeMockRes();

    await getAttendanceCalendar(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("allows a staff member to read their OWN calendar", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "teacher-1" });
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeCalendarReq({ params: { staffId: "staff-self" } });
    const res = makeMockRes();

    await getAttendanceCalendar(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
