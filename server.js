import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import http from "node:http";
import { Server } from "socket.io";

import connectDB from "./config/db.js";

// Routes
import userRoutes from "./routes/userRoutes.js";
import haltRoutes from "./routes/haltRoutes.js";
import busRoutes from "./routes/busRoutes.js";
import routeRoutes from "./routes/routeRoutes.js";
import busScheduleRoutes from "./routes/busScheduleRoutes.js";

// Real-time tracking
import { startRealTimeTracking } from "./services/realTimeTracking.js";

dotenv.config();

const FRONTEND_URL = "https://rextro-bus-stop.vercel.app";

const app = express();
const server = http.createServer(app);

// ----------------------------
// SOCKET.IO CONFIG
// ----------------------------
const io = new Server(server, {
  cors: {
    origin: [FRONTEND_URL, "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// ----------------------------
// MIDDLEWARE
// ----------------------------
app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:5173"],
    credentials: true,
  })
);

app.use(express.json());

// ----------------------------
// CONNECT DATABASE
// ----------------------------
connectDB();

// ----------------------------
// TEST ROUTE
// ----------------------------
app.get("/", (req, res) => {
  res.send("Backend connected successfully");
});

// ----------------------------
// API ROUTES
// ----------------------------
app.use("/api/users", userRoutes);
app.use("/api/halts", haltRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/bus-schedules", busScheduleRoutes);

// ----------------------------
// START REAL-TIME TRACKING ENGINE
// ----------------------------
startRealTimeTracking(io);

// ----------------------------
// START SERVER
// ----------------------------
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
