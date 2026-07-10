import { Router } from "express";
import authRoutes from "./auth.routes";
import branchRoutes from "./branch.routes";
import academicYearRoutes from "./academicYear.routes";
import classRoutes from "./class.routes";
import studentRoutes from "./student.routes";
import staffRoutes from "./staff.routes";
import feeRoutes from "./fee.routes";
import accountingRoutes from "./accounting.routes";
import hrRoutes from "./hr.routes";
import academicsRoutes from "./academics.routes";
import facilitiesRoutes from "./facilities.routes";
import communicationRoutes from "./communication.routes";
import reportsRoutes from "./reports.routes";

const router = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "School ERP API is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Mount routes
router.use("/auth", authRoutes);
router.use("/branches", branchRoutes);
router.use("/academic-years", academicYearRoutes);
router.use("/classes", classRoutes);
router.use("/students", studentRoutes);
router.use("/staff", staffRoutes);
router.use("/fees", feeRoutes);
router.use("/accounting", accountingRoutes);
router.use("/hr", hrRoutes);
router.use("/academics", academicsRoutes);
router.use("/facilities", facilitiesRoutes);
router.use("/communication", communicationRoutes);
router.use("/reports", reportsRoutes);

// router.use("/attendance", attendanceRoutes); // Phase 4
// router.use("/exams", examRoutes);            // Phase 4
// router.use("/library", libraryRoutes);       // Phase 5
// router.use("/transport", transportRoutes);   // Phase 5
// router.use("/hostel", hostelRoutes);         // Phase 5
// router.use("/inventory", inventoryRoutes);   // Phase 5
// router.use("/notices", noticeRoutes);        // Phase 6
// router.use("/messages", messageRoutes);      // Phase 6
// router.use("/certificates", certRoutes);     // Phase 6
// router.use("/reports", reportRoutes);        // Phase 7

export default router;
