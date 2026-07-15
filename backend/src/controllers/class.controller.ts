import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";
import { cached, CacheKeys, CacheTTL, invalidateClassesCache } from "../services/cache.service";

// ==================== CLASS ====================

export const createClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, numericOrder } = req.body;
    // BUG FIX: the "Add Class" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment. Also adds the
    // canAccessBranch check this endpoint was previously missing
    // entirely (a Branch Admin could otherwise have created a class in
    // another branch by just sending that branch's real id).
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.class.findUnique({
      where: { branchId_name: { branchId, name } },
    });
    if (existing) {
      sendError(res, "Class with this name already exists in this branch", 400);
      return;
    }

    // Guard against NaN: the frontend does `parseInt(e.target.value)`
    // on the numericOrder field with no fallback - if that input is
    // ever cleared, `parseInt("")` is NaN, which Prisma rejects for an
    // Int column with a raw type error (generic 500 "Failed to create
    // class"). Default to 0 instead of trusting an unparseable value.
    const safeNumericOrder = Number.isFinite(Number(numericOrder)) ? Number(numericOrder) : 0;

    const cls = await prisma.class.create({
      data: { branchId, name, numericOrder: safeNumericOrder },
    });
    await invalidateClassesCache(branchId);

    sendSuccess(res, cls, "Class created", 201);
  } catch (error) {
    sendError(res, "Failed to create class", 500, (error as Error).message);
  }
};

export const getClasses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) {
      sendError(res, "Branch ID required", 400);
      return;
    }

    // Cached (Phase 4) - classes/sections change occasionally, not on
    // every request, and this list is read on nearly every "pick a
    // class" dropdown across the app. 1 hour TTL, invalidated
    // explicitly on any Class/Section create/update/delete for this
    // branch (see invalidateClassesCache calls below and in
    // createSection/updateSection/deleteSection).
    const classes = await cached(CacheKeys.classesByBranch(branchId), CacheTTL.CLASSES, () =>
      prisma.class.findMany({
        where: { branchId },
        orderBy: { numericOrder: "asc" },
        include: {
          sections: { orderBy: { name: "asc" }, include: { room: { select: { id: true, roomNo: true, name: true } }, _count: { select: { students: true } } } },
          _count: { select: { students: true } },
        },
      })
    );

    sendSuccess(res, classes, "Classes fetched");
  } catch (error) {
    sendError(res, "Failed to fetch classes", 500, (error as Error).message);
  }
};

export const updateClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, numericOrder } = req.body;

    const updated = await prisma.class.update({
      where: { id },
      data: { ...(name && { name }), ...(numericOrder !== undefined && { numericOrder }) },
    });
    await invalidateClassesCache(updated.branchId);

    sendSuccess(res, updated, "Class updated");
  } catch (error) {
    sendError(res, "Failed to update class", 500, (error as Error).message);
  }
};

export const deleteClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if class has students
    const count = await prisma.student.count({ where: { classId: id } });
    if (count > 0) {
      sendError(res, `Cannot delete: ${count} students are assigned to this class`, 400);
      return;
    }

    const deleted = await prisma.class.delete({ where: { id } });
    await invalidateClassesCache(deleted.branchId);
    sendSuccess(res, null, "Class deleted");
  } catch (error) {
    sendError(res, "Failed to delete class", 500, (error as Error).message);
  }
};

// ==================== SECTION ====================

export const createSection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, name, capacity, classTeacherId, roomId } = req.body;
    // BUG FIX + SECURITY: same as createClass above - no branch-picker
    // in the "Add Section" form (branchId always ""), and this
    // endpoint had no canAccessBranch check at all.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.section.findUnique({
      where: { classId_name: { classId, name } },
    });
    if (existing) {
      sendError(res, "Section with this name already exists in this class", 400);
      return;
    }

    // SECURITY: a Branch Admin could otherwise link their section to a
    // classroom (SchoolRoom) belonging to a different branch entirely,
    // by supplying that branch's real roomId - same IDOR class as
    // every other cross-entity FK in this codebase.
    if (roomId) {
      const room = await prisma.schoolRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } } } });
      if (!room || room.floor.building.branchId !== branchId) {
        sendError(res, "Room not found in this branch", 404);
        return;
      }
    }

    // RULE (Point 3b): a staff member may be the class teacher of AT
    // MOST ONE section at a time (also enforced at the DB level via
    // Section.classTeacherId's @unique) - checked here first so the
    // caller gets a clear, actionable message naming the conflicting
    // class/section instead of a raw unique-constraint error.
    if (classTeacherId) {
      const conflict = await prisma.section.findUnique({
        where: { classTeacherId },
        include: { class: { select: { name: true } } },
      });
      if (conflict) {
        sendError(res, `This staff member is already the class teacher of ${conflict.class.name} - Section ${conflict.name}. Unassign them there first.`, 400);
        return;
      }
    }

    const section = await prisma.section.create({
      data: { branchId, classId, name, capacity: capacity || 40, classTeacherId, roomId },
    });
    // The cached class list (getClasses) embeds each class's sections,
    // so any section change must invalidate it too, not just the
    // class-level create/update/delete above.
    await invalidateClassesCache(branchId);

    sendSuccess(res, section, "Section created", 201);
  } catch (error) {
    sendError(res, "Failed to create section", 500, (error as Error).message);
  }
};

export const getSections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = req.query.classId as string;
    const branchId = resolveBranchId(req);

    const where: any = {};
    if (classId) where.classId = classId;
    if (branchId) where.branchId = branchId;

    const sections = await prisma.section.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        class: { select: { name: true } },
        classTeacher: { select: { user: { select: { name: true } } } },
        room: { select: { id: true, roomNo: true, name: true } },
        _count: { select: { students: true } },
      },
    });

    sendSuccess(res, sections, "Sections fetched");
  } catch (error) {
    sendError(res, "Failed to fetch sections", 500, (error as Error).message);
  }
};

export const updateSection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, capacity, classTeacherId, roomId } = req.body;

    if (roomId) {
      const existingSection = await prisma.section.findUnique({ where: { id } });
      if (!existingSection) { sendError(res, "Section not found", 404); return; }
      const room = await prisma.schoolRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } } } });
      if (!room || room.floor.building.branchId !== existingSection.branchId) {
        sendError(res, "Room not found in this branch", 404);
        return;
      }
    }

    // RULE (Point 3b): same one-section-per-class-teacher rule as
    // createSection above - exclude THIS section itself from the
    // conflict search (re-saving the same section with its own current
    // class teacher, or simply re-submitting the form, must not fail).
    if (classTeacherId) {
      const conflict = await prisma.section.findFirst({
        where: { classTeacherId, id: { not: id } },
        include: { class: { select: { name: true } } },
      });
      if (conflict) {
        sendError(res, `This staff member is already the class teacher of ${conflict.class.name} - Section ${conflict.name}. Unassign them there first.`, 400);
        return;
      }
    }

    const updated = await prisma.section.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(capacity && { capacity }),
        ...(classTeacherId !== undefined && { classTeacherId }),
        ...(roomId !== undefined && { roomId: roomId || null }),
      },
    });
    await invalidateClassesCache(updated.branchId);

    sendSuccess(res, updated, "Section updated");
  } catch (error) {
    sendError(res, "Failed to update section", 500, (error as Error).message);
  }
};

export const deleteSection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const count = await prisma.student.count({ where: { sectionId: id } });
    if (count > 0) {
      sendError(res, `Cannot delete: ${count} students are assigned to this section`, 400);
      return;
    }

    const deletedSection = await prisma.section.delete({ where: { id } });
    await invalidateClassesCache(deletedSection.branchId);
    sendSuccess(res, null, "Section deleted");
  } catch (error) {
    sendError(res, "Failed to delete section", 500, (error as Error).message);
  }
};

// ==================== SUBJECT ====================

export const createSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, type } = req.body;
    // BUG FIX + SECURITY: same as createClass above - no branch-picker
    // in the "Add Subject" form (branchId always ""), and this
    // endpoint had no canAccessBranch check at all.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.subject.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing) {
      sendError(res, "Subject code already exists in this branch", 400);
      return;
    }

    const subject = await prisma.subject.create({
      data: { branchId, name, code, type: type || "THEORY" },
    });

    sendSuccess(res, subject, "Subject created", 201);
  } catch (error) {
    sendError(res, "Failed to create subject", 500, (error as Error).message);
  }
};

/**
 * Get single subject detail, with the classes it's assigned to
 * (ClassSubject) and the teachers currently teaching it
 * (SubjectTeacher) - useful before editing/deleting a subject (mirrors
 * the same counts deleteSubject already checks, but as browsable
 * detail rather than just a delete-time error message).
 */
export const getSubjectById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const subject = await prisma.subject.findUnique({
      where: { id },
      include: {
        classSubjects: { include: { class: { select: { id: true, name: true } } } },
        subjectTeachers: {
          include: {
            staff: { include: { user: { select: { name: true } } } },
            class: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!subject) { sendError(res, "Subject not found", 404); return; }
    if (!canAccessBranch(req, subject.branchId)) { sendError(res, "Subject not found", 404); return; }

    sendSuccess(res, subject, "Subject fetched");
  } catch (error) {
    sendError(res, "Failed to fetch subject", 500, (error as Error).message);
  }
};

export const getSubjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) {
      sendError(res, "Branch ID required", 400);
      return;
    }

    const subjects = await prisma.subject.findMany({
      where: { branchId },
      orderBy: { name: "asc" },
    });

    sendSuccess(res, subjects, "Subjects fetched");
  } catch (error) {
    sendError(res, "Failed to fetch subjects", 500, (error as Error).message);
  }
};

export const updateSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, code, type } = req.body;

    const updated = await prisma.subject.update({
      where: { id },
      data: { ...(name && { name }), ...(code && { code }), ...(type && { type }) },
    });

    sendSuccess(res, updated, "Subject updated");
  } catch (error) {
    sendError(res, "Failed to update subject", 500, (error as Error).message);
  }
};

export const deleteSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Safety guard (matching deleteClass/deleteSection's pattern): a
    // subject with real academic history (marks recorded, homework
    // assigned) or active teaching assignments must not disappear -
    // Prisma would reject the delete anyway via FK constraints, but
    // this gives a clear, actionable message instead of a raw DB error.
    const [markCount, homeworkCount, classSubjectCount, teacherCount] = await Promise.all([
      prisma.mark.count({ where: { subjectId: id } }),
      prisma.homework.count({ where: { subjectId: id } }),
      prisma.classSubject.count({ where: { subjectId: id } }),
      prisma.subjectTeacher.count({ where: { subjectId: id } }),
    ]);
    if (markCount > 0 || homeworkCount > 0) {
      sendError(res, `Cannot delete: this subject has ${markCount} recorded mark(s) and ${homeworkCount} homework assignment(s). Historical academic records cannot be removed.`, 400);
      return;
    }
    if (classSubjectCount > 0 || teacherCount > 0) {
      // These are just mapping/assignment rows (no historical data loss
      // risk), so clear them automatically rather than forcing the
      // admin to unassign every class/teacher one at a time first.
      await prisma.$transaction([
        prisma.classSubject.deleteMany({ where: { subjectId: id } }),
        prisma.subjectTeacher.deleteMany({ where: { subjectId: id } }),
        prisma.subject.delete({ where: { id } }),
      ]);
      sendSuccess(res, null, "Subject deleted");
      return;
    }

    await prisma.subject.delete({ where: { id } });
    sendSuccess(res, null, "Subject deleted");
  } catch (error) {
    sendError(res, "Failed to delete subject", 500, (error as Error).message);
  }
};

// ==================== SUBJECT-TEACHER ASSIGNMENT ====================
// (Section.classTeacherId above already covers "who is the class
// teacher for this section" - createSection/updateSection handle that.
// This block covers the separate, subject-wise question: "who teaches
// Subject X to Class Y" - the SubjectTeacher model, with no endpoints
// of its own until now.)

/**
 * Assigns a teacher to teach a subject for a class (optionally
 * section-specific in the future via classId being nullable, though
 * this form only ever sends a classId today). Idempotent on the
 * @@unique([staffId, subjectId, classId]) constraint - re-assigning
 * the same teacher/subject/class combo is a no-op rather than an
 * error, since re-submitting the same assignment isn't a mistake worth
 * blocking on.
 */
export const assignSubjectTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, subjectId, classId } = req.body;

    if (!staffId) { sendError(res, "staffId is required", 400); return; }
    if (!subjectId) { sendError(res, "subjectId is required", 400); return; }

    const [staff, subject, cls] = await Promise.all([
      prisma.staff.findUnique({ where: { id: staffId }, include: { user: { select: { role: true } } } }),
      prisma.subject.findUnique({ where: { id: subjectId } }),
      classId ? prisma.class.findUnique({ where: { id: classId } }) : Promise.resolve(null),
    ]);
    if (!staff) { sendError(res, "Staff member not found", 404); return; }
    if (!subject) { sendError(res, "Subject not found", 404); return; }
    if (classId && !cls) { sendError(res, "Class not found", 404); return; }

    // SECURITY: every one of these belongs to a branch - without this
    // check, a Branch Admin could wire up a teacher/subject/class
    // combination that spans branches they don't own (e.g. assigning
    // their own teacher to another branch's class, or vice versa).
    const branchIds = new Set([staff.branchId, subject.branchId, ...(cls ? [cls.branchId] : [])]);
    if (branchIds.size > 1 || !canAccessBranch(req, staff.branchId)) {
      sendError(res, "Staff, subject, and class must all belong to the same branch you have access to", 403);
      return;
    }

    const existing = await prisma.subjectTeacher.findUnique({
      where: { staffId_subjectId_classId: { staffId, subjectId, classId: classId || null } },
    });
    if (existing) {
      sendSuccess(res, existing, "This teacher is already assigned to this subject/class");
      return;
    }

    const assignment = await prisma.subjectTeacher.create({
      data: { staffId, subjectId, classId: classId || null },
    });

    sendSuccess(res, assignment, "Teacher assigned to subject", 201);
  } catch (error) {
    sendError(res, "Failed to assign subject teacher", 500, (error as Error).message);
  }
};

/**
 * Lists subject-teacher assignments, optionally filtered to a single
 * class (the "Teacher Assign" page's Subject Teacher tab always passes
 * one) - branch-scoped via the subject's branchId, matching every
 * other list endpoint in this file.
 */
export const getSubjectTeachers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const classId = req.query.classId as string;
    const staffId = req.query.staffId as string | undefined;
    const subjectId = req.query.subjectId as string | undefined;

    const where: any = {};
    if (classId) where.classId = classId;
    if (staffId) where.staffId = staffId;
    if (subjectId) where.subjectId = subjectId;
    if (branchId) where.subject = { branchId };

    const assignments = await prisma.subjectTeacher.findMany({
      where,
      include: {
        staff: { select: { id: true, user: { select: { name: true } } } },
        subject: { select: { id: true, name: true, code: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: { subject: { name: "asc" } },
    });

    sendSuccess(res, assignments, "Subject teachers fetched");
  } catch (error) {
    sendError(res, "Failed to fetch subject teachers", 500, (error as Error).message);
  }
};

/**
 * Removes a single subject-teacher assignment (unassign) - no
 * historical data hangs off SubjectTeacher itself (Marks/Homework
 * reference the subject directly, not this mapping), so a plain
 * delete is safe with no dependent-record checks needed.
 */
export const removeSubjectTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const assignment = await prisma.subjectTeacher.findUnique({
      where: { id },
      include: { subject: { select: { branchId: true } } },
    });
    if (!assignment) { sendError(res, "Assignment not found", 404); return; }
    if (!canAccessBranch(req, assignment.subject.branchId)) { sendError(res, "Assignment not found", 404); return; }

    await prisma.subjectTeacher.delete({ where: { id } });
    sendSuccess(res, null, "Teacher unassigned from subject");
  } catch (error) {
    sendError(res, "Failed to remove subject teacher", 500, (error as Error).message);
  }
};

// ==================== CLASS-SUBJECT MAPPING ====================

export const assignSubjectToClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, subjectId } = req.body;

    const existing = await prisma.classSubject.findUnique({
      where: { classId_subjectId: { classId, subjectId } },
    });
    if (existing) {
      sendError(res, "Subject already assigned to this class", 400);
      return;
    }

    const mapping = await prisma.classSubject.create({
      data: { classId, subjectId },
    });

    sendSuccess(res, mapping, "Subject assigned to class", 201);
  } catch (error) {
    sendError(res, "Failed to assign subject", 500, (error as Error).message);
  }
};

/**
 * Assign one subject to multiple classes at once (e.g. "Science" for
 * Classes 6 through 10 in one call) - the bulk counterpart to
 * assignSubjectToClass above. Classes already having this subject are
 * silently skipped (matching assignSubjectToClass's own "already
 * assigned" no-op, just without needing per-class round trips to
 * discover that).
 */
export const bulkAssignSubjectToClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectId, classIds } = req.body;

    if (!Array.isArray(classIds) || classIds.length === 0) {
      sendError(res, "classIds must be a non-empty array", 400);
      return;
    }

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) { sendError(res, "Subject not found", 404); return; }
    if (!canAccessBranch(req, subject.branchId)) { sendError(res, "Subject not found", 404); return; }

    // SECURITY: every target class must belong to the SAME branch as
    // the subject (and one the caller can access) - otherwise a Branch
    // Admin could wire up a subject to a class in a different branch
    // by just supplying that branch's real classId (IDOR), the same
    // class of bug already fixed on assignSubjectTeacher/bulkPromote
    // elsewhere in this codebase.
    const classes = await prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true, branchId: true } });
    const foundIds = new Set(classes.map((c) => c.id));
    const notFound = classIds.filter((id: string) => !foundIds.has(id));
    const wrongBranch = classes.filter((c) => c.branchId !== subject.branchId);
    if (wrongBranch.length > 0) {
      sendError(res, `${wrongBranch.length} of the target classes do not belong to this subject's branch`, 400);
      return;
    }

    const validClassIds = classes.map((c) => c.id);
    const existing = await prisma.classSubject.findMany({
      where: { subjectId, classId: { in: validClassIds } },
      select: { classId: true },
    });
    const existingSet = new Set(existing.map((e) => e.classId));
    const newClassIds = validClassIds.filter((id) => !existingSet.has(id));

    if (newClassIds.length > 0) {
      await prisma.classSubject.createMany({
        data: newClassIds.map((classId) => ({ classId, subjectId })),
      });
    }

    const skipped = existingSet.size;
    sendSuccess(
      res,
      { assigned: newClassIds.length, skipped, notFound: notFound.length, total: classIds.length },
      `Subject assigned to ${newClassIds.length} class(es)` +
        (skipped > 0 ? ` (${skipped} already had this subject)` : "")
    );
  } catch (error) {
    sendError(res, "Failed to bulk-assign subject to classes", 500, (error as Error).message);
  }
};

/**
 * Combined "Class-wise Assignment" view: every subject assigned to a
 * class (ClassSubject), each with the teacher(s) currently assigned to
 * teach it for that class (SubjectTeacher) - previously only
 * obtainable via two separate calls (getClassSubjects +
 * getSubjectTeachers) that the caller had to join client-side. Also
 * includes the class's sections (with their classTeacher/room) for a
 * full one-screen picture, since "who teaches what, in which room, in
 * which section" is really one combined admin workflow.
 */
export const getClassSubjectMatrix = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId } = req.params;

    const cls = await prisma.class.findUnique({
      where: { id: classId },
      include: {
        sections: {
          orderBy: { name: "asc" },
          include: {
            classTeacher: { select: { id: true, user: { select: { name: true } } } },
            room: { select: { id: true, roomNo: true, name: true } },
            _count: { select: { students: true } },
          },
        },
      },
    });
    if (!cls) { sendError(res, "Class not found", 404); return; }
    if (!canAccessBranch(req, cls.branchId)) { sendError(res, "Class not found", 404); return; }

    const classSubjects = await prisma.classSubject.findMany({ where: { classId }, include: { subject: true } });
    const subjectIds = classSubjects.map((cs) => cs.subjectId);

    // Includes classId: null rows too (a subject's school-wide default
    // teacher, if this class hasn't been given its own override) - the
    // frontend groups these separately per subject via `classSpecific`.
    const teacherAssignments = subjectIds.length > 0
      ? await prisma.subjectTeacher.findMany({
          where: { subjectId: { in: subjectIds }, OR: [{ classId }, { classId: null }] },
          include: { staff: { select: { id: true, user: { select: { name: true } } } } },
        })
      : [];

    const matrix = classSubjects.map((cs) => ({
      subject: cs.subject,
      teachers: teacherAssignments
        .filter((t) => t.subjectId === cs.subjectId)
        .map((t) => ({ assignmentId: t.id, staffId: t.staffId, staffName: t.staff.user.name, classSpecific: t.classId !== null })),
    }));

    sendSuccess(
      res,
      { class: { id: cls.id, name: cls.name }, sections: cls.sections, subjects: matrix },
      "Class subject matrix fetched"
    );
  } catch (error) {
    sendError(res, "Failed to fetch class subject matrix", 500, (error as Error).message);
  }
};

export const getClassSubjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId } = req.params;

    const subjects = await prisma.classSubject.findMany({
      where: { classId },
      include: { subject: true },
    });

    sendSuccess(res, subjects, "Class subjects fetched");
  } catch (error) {
    sendError(res, "Failed to fetch class subjects", 500, (error as Error).message);
  }
};

export const removeSubjectFromClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.classSubject.delete({ where: { id } });
    sendSuccess(res, null, "Subject removed from class");
  } catch (error) {
    sendError(res, "Failed to remove subject", 500, (error as Error).message);
  }
};

// ==================== MULTI ROOM / MULTI CLASS ASSIGN (Point 7) ====================
// The "Class Assign" module's bulk multi-select workflow: assign
// several rooms to several sections at once via the SectionRoom
// many-to-many join table. Section.roomId (the single "primary
// classroom") is untouched by this - these are ADDITIONAL rooms a
// section also uses (e.g. a shared Lab/Library slot), and one room can
// likewise be linked to several different sections.

/**
 * POST /classes/section-rooms/bulk
 * body: { sectionIds: string[], roomIds: string[] }
 * Links every sectionId to every roomId (the full cross-product) in
 * one call - e.g. "Sections A, B, C all also use Lab 1 and Library
 * Hall". Already-existing links are silently skipped (idempotent),
 * matching bulkAssignSubjectToClass's own "skip what's already there"
 * convention above.
 */
export const bulkAssignSectionRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sectionIds, roomIds } = req.body;

    if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
      sendError(res, "sectionIds must be a non-empty array", 400);
      return;
    }
    if (!Array.isArray(roomIds) || roomIds.length === 0) {
      sendError(res, "roomIds must be a non-empty array", 400);
      return;
    }

    const sections = await prisma.section.findMany({ where: { id: { in: sectionIds } }, select: { id: true, branchId: true } });
    const rooms = await prisma.schoolRoom.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, floor: { select: { building: { select: { branchId: true } } } } },
    });

    if (sections.length !== sectionIds.length) {
      sendError(res, "One or more sections were not found", 404);
      return;
    }
    if (rooms.length !== roomIds.length) {
      sendError(res, "One or more rooms were not found", 404);
      return;
    }

    // SECURITY: every section AND every room must belong to the SAME
    // branch as the caller can access - otherwise a Branch Admin could
    // link their sections to another branch's rooms (or vice versa),
    // the same IDOR class already guarded against elsewhere in this
    // file (createSection/updateSection's roomId branch check).
    const branchIds = new Set([
      ...sections.map((s) => s.branchId),
      ...rooms.map((r) => r.floor.building.branchId),
    ]);
    if (branchIds.size > 1 || !canAccessBranch(req, sections[0].branchId)) {
      sendError(res, "All sections and rooms must belong to the same branch you have access to", 403);
      return;
    }

    const existing = await prisma.sectionRoom.findMany({
      where: { sectionId: { in: sectionIds }, roomId: { in: roomIds } },
      select: { sectionId: true, roomId: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.sectionId}:${e.roomId}`));

    const toCreate: { sectionId: string; roomId: string }[] = [];
    for (const sectionId of sectionIds) {
      for (const roomId of roomIds) {
        if (!existingKeys.has(`${sectionId}:${roomId}`)) {
          toCreate.push({ sectionId, roomId });
        }
      }
    }

    if (toCreate.length > 0) {
      await prisma.sectionRoom.createMany({ data: toCreate });
    }

    await invalidateClassesCache(sections[0].branchId);

    sendSuccess(
      res,
      { created: toCreate.length, skipped: existingKeys.size, total: sectionIds.length * roomIds.length },
      `Linked ${toCreate.length} section-room pair(s)` + (existingKeys.size > 0 ? ` (${existingKeys.size} already linked)` : "")
    );
  } catch (error) {
    sendError(res, "Failed to bulk-assign rooms to sections", 500, (error as Error).message);
  }
};

/**
 * GET /classes/section-rooms?sectionId=... | ?roomId=...
 * Lists SectionRoom links, optionally filtered to one section or one
 * room - powers both "which extra rooms does this section use" and
 * "which sections share this room" views.
 */
export const getSectionRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectionId = req.query.sectionId as string | undefined;
    const roomId = req.query.roomId as string | undefined;

    const where: any = {};
    if (sectionId) where.sectionId = sectionId;
    if (roomId) where.roomId = roomId;

    const links = await prisma.sectionRoom.findMany({
      where,
      include: {
        section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        room: { select: { id: true, roomNo: true, name: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, links, "Section-room links fetched");
  } catch (error) {
    sendError(res, "Failed to fetch section-room links", 500, (error as Error).message);
  }
};

/**
 * DELETE /classes/section-rooms/:id
 * Removes a single section-room link (unassign one extra room from
 * one section) - no dependent data hangs off SectionRoom itself, so a
 * plain delete is safe.
 */
export const removeSectionRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const link = await prisma.sectionRoom.findUnique({
      where: { id },
      include: { section: { select: { branchId: true } } },
    });
    if (!link) { sendError(res, "Link not found", 404); return; }
    if (!canAccessBranch(req, link.section.branchId)) { sendError(res, "Link not found", 404); return; }

    await prisma.sectionRoom.delete({ where: { id } });
    sendSuccess(res, null, "Room unlinked from section");
  } catch (error) {
    sendError(res, "Failed to remove section-room link", 500, (error as Error).message);
  }
};
