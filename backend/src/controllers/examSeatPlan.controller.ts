import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { startPdfResponse, drawHeader, drawFooter, drawKeyValueRow, drawQrCode, formatDate } from "../services/pdf.service";
import { config } from "../config";

/**
 * Exam Seat Plan generator - fills a set of rooms with every active
 * student in the exam's class (optionally narrowed by section/gender/
 * roll-no range), in either plain roll-no order or an alternating
 * boy/girl arrangement (a common anti-cheating seating convention).
 * One row per seated student is stored in `ExamSeatAllocation`
 * (declared already in Phase 1's migration).
 */

/**
 * Roll numbers are free-text (`Student.rollNo String?`), but almost
 * always numeric in practice - sort numerically when every value looks
 * like a plain integer, falling back to a locale-aware string compare
 * otherwise (so a roll no of "5A" or a missing roll no doesn't crash
 * the sort, just sorts lexically instead).
 */
const compareRollNo = (a: string | null, b: string | null): number => {
  const an = a ?? "";
  const bn = b ?? "";
  const aNum = /^\d+$/.test(an) ? Number(an) : null;
  const bNum = /^\d+$/.test(bn) ? Number(bn) : null;
  if (aNum !== null && bNum !== null) return aNum - bNum;
  return an.localeCompare(bn);
};

/**
 * POST /api/academics/exams/schedule/:examScheduleId/seat-plan
 * body: { roomIds: string[], arrangement: "ROLL_NO_ORDER" | "ALTERNATE_GENDER",
 *         sectionIds?: string[], gender?: "MALE"|"FEMALE"|"OTHER", rollNoFrom?: string, rollNoTo?: string }
 *
 * Destructive-with-confirmation: any existing seat allocation for this
 * schedule entry is replaced (deleted + recreated) - seat plans are
 * normally finalized once, close to the exam date, so regeneration is
 * an intentional "start over" action rather than an incremental edit.
 */
export const generateSeatPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId } = req.params;
    const { roomIds, arrangement, sectionIds, gender, rollNoFrom, rollNoTo } = req.body;

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { id: true, branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    if (!Array.isArray(roomIds) || roomIds.length === 0) {
      sendError(res, "roomIds must be a non-empty array", 400);
      return;
    }

    const rooms = await prisma.schoolRoom.findMany({
      where: { id: { in: roomIds } },
      include: { floor: { include: { building: { select: { branchId: true, name: true } } } } },
    });
    const foundIds = new Set(rooms.map((r) => r.id));
    const notFound = roomIds.filter((id: string) => !foundIds.has(id));
    if (notFound.length > 0) { sendError(res, `Room(s) not found: ${notFound.join(", ")}`, 404); return; }
    const wrongBranch = rooms.filter((r) => r.floor.building.branchId !== schedule.exam.class.branchId);
    if (wrongBranch.length > 0) { sendError(res, "One or more rooms do not belong to this exam's branch", 400); return; }

    // Preserve the caller's given room order (fill room 1 first, then
    // room 2, etc) rather than whatever order Prisma happened to
    // return them in.
    const roomsById = new Map(rooms.map((r) => [r.id, r]));
    const orderedRooms = roomIds.map((id: string) => roomsById.get(id)!);

    const where: any = { classId: schedule.exam.classId, isActive: true };
    if (Array.isArray(sectionIds) && sectionIds.length > 0) where.sectionId = { in: sectionIds };
    if (gender) where.gender = gender;
    if (rollNoFrom || rollNoTo) {
      // rollNo is a free-text String? - filter numerically only when
      // both the student's rollNo AND the supplied bound look numeric,
      // via a raw numeric string comparison isn't possible in Prisma's
      // filter DSL for a String column, so this is applied in-memory
      // below after fetching, not in the `where` clause.
    }

    let students = await prisma.student.findMany({
      where,
      select: { id: true, rollNo: true, gender: true, sectionId: true, admissionNo: true, user: { select: { name: true } }, section: { select: { name: true } } },
    });

    if (rollNoFrom || rollNoTo) {
      const fromNum = rollNoFrom && /^\d+$/.test(rollNoFrom) ? Number(rollNoFrom) : null;
      const toNum = rollNoTo && /^\d+$/.test(rollNoTo) ? Number(rollNoTo) : null;
      students = students.filter((s) => {
        const rn = s.rollNo && /^\d+$/.test(s.rollNo) ? Number(s.rollNo) : null;
        if (rn === null) return false; // non-numeric/missing roll no can't be range-filtered
        if (fromNum !== null && rn < fromNum) return false;
        if (toNum !== null && rn > toNum) return false;
        return true;
      });
    }

    if (students.length === 0) {
      sendError(res, "No matching students found for the given filters", 400);
      return;
    }

    const totalCapacity = orderedRooms.reduce((sum, r) => sum + r.capacity, 0);
    if (totalCapacity < students.length) {
      sendError(res, `Selected rooms have ${totalCapacity} total seats but ${students.length} student(s) matched the filters. Select more/larger rooms.`, 400);
      return;
    }

    let ordered: typeof students;
    if (arrangement === "ALTERNATE_GENDER") {
      const males = students.filter((s) => s.gender === "MALE").sort((a, b) => compareRollNo(a.rollNo, b.rollNo));
      const females = students.filter((s) => s.gender !== "MALE").sort((a, b) => compareRollNo(a.rollNo, b.rollNo));
      ordered = [];
      let mi = 0, fi = 0;
      while (mi < males.length || fi < females.length) {
        if (mi < males.length) ordered.push(males[mi++]);
        if (fi < females.length) ordered.push(females[fi++]);
      }
    } else {
      ordered = [...students].sort((a, b) => a.sectionId === b.sectionId ? compareRollNo(a.rollNo, b.rollNo) : (a.section?.name || "").localeCompare(b.section?.name || ""));
    }

    // Fill rooms in the given order, respecting each room's capacity.
    const allocations: { roomId: string; studentId: string; seatNo: number }[] = [];
    let cursor = 0;
    for (const room of orderedRooms) {
      let seatNo = 1;
      while (seatNo <= room.capacity && cursor < ordered.length) {
        allocations.push({ roomId: room.id, studentId: ordered[cursor].id, seatNo });
        seatNo++;
        cursor++;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.examSeatAllocation.deleteMany({ where: { examScheduleId } });
      await tx.examSeatAllocation.createMany({
        data: allocations.map((a) => ({ examScheduleId, roomId: a.roomId, studentId: a.studentId, seatNo: a.seatNo })),
      });
    });

    sendSuccess(res, { allocated: allocations.length, totalStudents: students.length, roomsUsed: orderedRooms.length }, "Seat plan generated");
  } catch (error) { sendError(res, "Failed to generate seat plan", 500, (error as Error).message); }
};

/**
 * GET /api/academics/exams/schedule/:examScheduleId/seat-plan
 * Room-wise breakdown for printing: roll no, name, seat no, room, plus
 * a gender count per room (useful to sanity-check an alternate-gender
 * arrangement at a glance).
 */
export const getSeatPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId } = req.params;

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    const allocations = await prisma.examSeatAllocation.findMany({
      where: { examScheduleId },
      include: {
        room: { select: { id: true, roomNo: true, name: true } },
        student: {
          select: { id: true, admissionNo: true, rollNo: true, gender: true, user: { select: { name: true } }, section: { select: { name: true } } },
        },
      },
      orderBy: [{ roomId: "asc" }, { seatNo: "asc" }],
    });

    const byRoom: Record<string, any> = {};
    for (const a of allocations) {
      const key = a.roomId;
      if (!byRoom[key]) {
        byRoom[key] = { roomId: a.roomId, roomNo: a.room.roomNo, roomName: a.room.name, seats: [], maleCount: 0, femaleCount: 0, otherCount: 0 };
      }
      byRoom[key].seats.push({
        seatNo: a.seatNo,
        studentId: a.studentId,
        studentName: a.student.user.name,
        admissionNo: a.student.admissionNo,
        rollNo: a.student.rollNo,
        gender: a.student.gender,
        sectionName: a.student.section?.name,
      });
      if (a.student.gender === "MALE") byRoom[key].maleCount++;
      else if (a.student.gender === "FEMALE") byRoom[key].femaleCount++;
      else byRoom[key].otherCount++;
    }

    sendSuccess(res, { totalSeated: allocations.length, rooms: Object.values(byRoom) }, "Seat plan fetched");
  } catch (error) { sendError(res, "Failed to fetch seat plan", 500, (error as Error).message); }
};

/**
 * DELETE /api/academics/exams/schedule/:examScheduleId/seat-plan
 * Clears the seat plan entirely (e.g. before regenerating with
 * different filters/rooms via a fresh `generateSeatPlan` call, or if
 * the exam is cancelled).
 */
export const clearSeatPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId } = req.params;

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    const { count } = await prisma.examSeatAllocation.deleteMany({ where: { examScheduleId } });
    sendSuccess(res, { cleared: count }, "Seat plan cleared");
  } catch (error) { sendError(res, "Failed to clear seat plan", 500, (error as Error).message); }
};

/**
 * GET /api/academics/exams/schedule/:examScheduleId/seat-plan/student/:studentId/slip
 * A single-student printable seat slip (room/seat/date/time) - the
 * physical card/paper a student is handed (or can self-download) to
 * know exactly where to sit for this exam.
 */
export const getStudentSeatSlipPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId, studentId } = req.params;

    const allocation = await prisma.examSeatAllocation.findUnique({
      where: { examScheduleId_studentId: { examScheduleId, studentId } },
      include: {
        room: { select: { roomNo: true, name: true, floor: { select: { name: true, building: { select: { name: true } } } } } },
        student: {
          select: {
            admissionNo: true, rollNo: true, branchId: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
        examSchedule: {
          include: { exam: { select: { name: true } }, subject: { select: { name: true } } },
        },
      },
    });
    if (!allocation) { sendError(res, "Seat allocation not found for this student and exam", 404); return; }
    if (!canAccessBranch(req, allocation.student.branchId)) { sendError(res, "Seat allocation not found for this student and exam", 404); return; }

    const filename = `seat-slip-${allocation.student.admissionNo}-${allocation.examSchedule.subject.name}.pdf`;
    const doc = startPdfResponse(res, filename);

    drawHeader(doc, allocation.student.branch.name, "Exam Seat Allocation Slip");

    const leftX = doc.page.margins.left;
    let y = doc.y;
    drawKeyValueRow(doc, "Student Name", allocation.student.user.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Admission No", allocation.student.admissionNo, leftX, y); y += 18;
    drawKeyValueRow(doc, "Class / Section", `${allocation.student.class?.name || "-"} / ${allocation.student.section?.name || "-"}`, leftX, y); y += 18;
    drawKeyValueRow(doc, "Roll No", allocation.student.rollNo || "-", leftX, y); y += 18;
    drawKeyValueRow(doc, "Exam", allocation.examSchedule.exam.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Subject", allocation.examSchedule.subject.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Date", formatDate(allocation.examSchedule.examDate), leftX, y); y += 18;
    drawKeyValueRow(doc, "Time", `${allocation.examSchedule.startTime} - ${allocation.examSchedule.endTime}`, leftX, y); y += 18;
    drawKeyValueRow(doc, "Building", allocation.room.floor.building.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Floor", allocation.room.floor.name || "-", leftX, y); y += 18;
    drawKeyValueRow(doc, "Room", `${allocation.room.roomNo}${allocation.room.name ? ` (${allocation.room.name})` : ""}`, leftX, y); y += 18;
    doc.y = y + 6;

    doc.fontSize(22).fillColor("#1e293b").text(`Seat No: ${allocation.seatNo}`, { align: "center" });
    doc.moveDown(1);

    const qrSize = 60;
    await drawQrCode(
      doc,
      `${config.frontendUrl}/dashboard/exams`,
      doc.page.width - doc.page.margins.right - qrSize,
      doc.page.height - doc.page.margins.bottom - qrSize - 26,
      qrSize,
      "Exam seat slip"
    );

    drawFooter(doc, `${allocation.student.branch.name} - Please arrive at least 15 minutes before the exam start time.`);

    doc.end();
  } catch (error) { sendError(res, "Failed to generate seat slip PDF", 500, (error as Error).message); }
};
