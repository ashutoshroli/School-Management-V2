import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";

/**
 * SECURITY: previously, ANY authenticated TEACHER could mark/view
 * attendance for ANY section in their branch - `markStudentAttendance`/
 * `getClassAttendance` only ever checked `canAccessBranch` (branch-level),
 * never whether that specific teacher actually teaches that specific
 * class. This restricts a TEACHER to only the sections they're actually
 * assigned to:
 *   - the section's homeroom/class teacher (`Section.classTeacherId`), OR
 *   - a teacher with a `SubjectTeacher` row for that section's CLASS
 *     (class-specific assignment - see class.controller.ts's
 *     `assignSubjectTeacher`).
 *
 * Deliberately does NOT count a subject's school-wide DEFAULT teacher
 * (`SubjectTeacher.classId: null`, meaning "teaches this subject to
 * whichever class doesn't have a more specific override" - see
 * `getClassSubjectMatrix`'s `classSpecific` flag) as attendance access -
 * that's a subject-teaching default, not evidence this particular
 * teacher is actually responsible for this particular class's roll call.
 *
 * Every OTHER role (ADMIN roles, ACCOUNTANT, etc) is governed by
 * `canAccessBranch` alone, unchanged - this function only narrows
 * TEACHER further, it never widens anyone's access.
 */
export const canTeacherAccessSection = async (
  req: AuthRequest,
  sectionId: string
): Promise<boolean> => {
  if (req.user?.role !== UserRole.TEACHER) return true;

  const userId = req.user.userId;
  if (!userId) return false;

  const staff = await prisma.staff.findUnique({ where: { userId }, select: { id: true } });
  if (!staff) return false;

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { classId: true, classTeacherId: true },
  });
  if (!section) return false;

  if (section.classTeacherId === staff.id) return true;

  const assignmentCount = await prisma.subjectTeacher.count({
    where: { staffId: staff.id, classId: section.classId },
  });
  return assignmentCount > 0;
};

/**
 * Exam question paper upload access: a TEACHER may only upload a paper
 * for a subject+class they actually teach. Unlike
 * `canTeacherAccessSection` above (attendance access, which explicitly
 * excludes a subject's school-wide DEFAULT teacher), this DOES count a
 * `SubjectTeacher` row with `classId: null` as sufficient - the
 * school-wide default teacher for a subject genuinely IS "the teacher
 * who teaches this subject", which is exactly what matters for "who
 * may set this subject's exam paper for this class" (as opposed to
 * "who is responsible for this class's daily roll call").
 *
 * Every other role (ADMIN roles, exam coordinators, etc) is
 * unrestricted here, same convention as `canTeacherAccessSection`.
 */
export const canTeacherTeachSubjectForClass = async (
  req: AuthRequest,
  subjectId: string,
  classId: string
): Promise<boolean> => {
  if (req.user?.role !== UserRole.TEACHER) return true;

  const userId = req.user.userId;
  if (!userId) return false;

  const staff = await prisma.staff.findUnique({ where: { userId }, select: { id: true } });
  if (!staff) return false;

  const assignmentCount = await prisma.subjectTeacher.count({
    where: { staffId: staff.id, subjectId, OR: [{ classId }, { classId: null }] },
  });
  return assignmentCount > 0;
};

/**
 * Every section a TEACHER is actually assigned to (as homeroom/class
 * teacher, or via a class-specific SubjectTeacher row) - for a
 * teacher's own "which classes can I act on" section-picker, so the
 * UI never even offers a section `canTeacherAccessSection` would
 * reject. Not role-restricted here (any staff-linked user can call
 * it) since admins have their own unrestricted `/classes` listing for
 * a full picker; this is specifically useful for TEACHER's narrower view.
 */
export const getOwnAssignedSectionIds = async (req: AuthRequest): Promise<string[]> => {
  const userId = req.user?.userId;
  if (!userId) return [];

  const staff = await prisma.staff.findUnique({ where: { userId }, select: { id: true } });
  if (!staff) return [];

  const [classTeacherSections, subjectAssignments] = await Promise.all([
    prisma.section.findMany({ where: { classTeacherId: staff.id }, select: { id: true } }),
    prisma.subjectTeacher.findMany({ where: { staffId: staff.id, classId: { not: null } }, select: { classId: true } }),
  ]);

  const assignedClassIds = [...new Set(subjectAssignments.map((a) => a.classId as string))];
  const subjectSections = assignedClassIds.length > 0
    ? await prisma.section.findMany({ where: { classId: { in: assignedClassIds } }, select: { id: true } })
    : [];

  return [...new Set([...classTeacherSections.map((s) => s.id), ...subjectSections.map((s) => s.id)])];
};
