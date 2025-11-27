import express from "express";
import {
  getSchedules,
  createOrUpdateSchedule,
  editBus,
  deleteBus,
} from "../controllers/busScheduleController.js";

const router = express.Router();

router.get("/", getSchedules);
router.post("/", createOrUpdateSchedule);
router.put("/:haltId/:busId", editBus);
router.delete("/:haltId/:busId", deleteBus);

export default router;
