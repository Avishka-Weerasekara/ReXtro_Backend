import express from "express";
import {
  registerUser,
  loginUser,
  googleLogin,
  getAllUsers,
  getUserById,
} from "../controllers/userController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/google-login", googleLogin);

// Admin-only
router.get("/", protect, admin, getAllUsers);

// Any logged-in user
router.get("/:id", protect, getUserById);

export default router;
