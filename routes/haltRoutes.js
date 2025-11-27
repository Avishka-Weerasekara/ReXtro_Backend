import express from "express";
import {
  getHalts,
  createHalt,
  updateHalt,
  deleteHalt,
} from "../controllers/haltController.js";

const router = express.Router();

router.get("/", getHalts);         // GET all halts
router.post("/", createHalt);      // POST new halt
router.put("/:id", updateHalt);    // UPDATE halt by ID
router.delete("/:id", deleteHalt); // DELETE halt by ID

export default router;
