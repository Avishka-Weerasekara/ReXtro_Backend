import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 5; // Prevent insane delays when GPS speed = 0

// Normalize halt name
function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// ✅ OSRM ROAD DISTANCE (km)
async function getRoadDistance(busLat, busLng, stopLat, stopLng) {
  try {
    const URL = `https://router.project-osrm.org/route/v1/driving/${busLng},${busLat};${stopLng},${stopLat}?overview=false`;
    const res = await axios.get(URL);

    if (!res.data.routes?.length) return 1;

    return res.data.routes[0].distance / 1000;
  } catch (err) {
    console.log("OSRM error:", err.message);
    return 1; // ✅ fallback so system NEVER breaks
  }
}

// ✅ Convert "HH:MM" → Date(today)
function timeStringToDate(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;

  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

// ✅ REALTIME TRACKING ENGINE
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);

    socket.data.stop = null;

    // ✅ Passenger selects halt
    socket.on("requestTimetable", (data) => {
      socket.data.stop = {
        stopName: data.stopName,
        lat: Number(data.lat),
        lng: Number(data.lng),
      };

      console.log("📍 Passenger selected stop:", data.stopName);
    });

    const timer = setInterval(async () => {
      if (!socket.data.stop) return;

      // ----------------------
      // 1️⃣ Read Firebase GPS
      // ----------------------
      let gps;
      try {
        const res = await axios.get(FIREBASE_GPS_URL);
        gps = res.data;
      } catch {
        return;
      }

      if (!gps?.latitude) return;

      const busLat = Number(gps.latitude);
      const busLng = Number(gps.longitude);
      const busSpeed = Math.max(Number(gps.speed) || 0, MIN_SPEED);

      // ----------------------
      // 2️⃣ Road Distance
      // ----------------------
      let roadKm = await getRoadDistance(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      // ----------------------
      // 3️⃣ REAL ETA FROM NOW
      // ----------------------
      let etaMin = Math.round(roadKm / (busSpeed / 60));
      if (etaMin < 1) etaMin = 1;

      const actualArrival = new Date(Date.now() + etaMin * 60000);
      const actualFormatted = actualArrival.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      // ----------------------
      // 4️⃣ Get Schedule
      // ----------------------
      const haltName = normalizeName(socket.data.stop.stopName);

      const halt = await BusSchedule.findOne({
        haltName: { $regex: new RegExp(`^${haltName}$`, "i") },
      }).lean();

      if (!halt || !halt.buses?.length) {
        socket.emit("timetableUpdate", [
          {
            route: "—",
            from: "Wakwella",
            to: "Galle",
            scheduled: "--",
            actual: actualFormatted,
            status: "No Schedule Found",
          },
        ]);
        return;
      }

      // ✅ USE FIRST BUS ONLY (REAL TRACKED BUS)
      const scheduledTime = halt.buses[0].expectedTime;
      const scheduledDate = timeStringToDate(scheduledTime);

      // ----------------------
      // 5️⃣ REAL DELAY LOGIC
      // ----------------------
      let status = "On Time";

      if (scheduledDate) {
        const diffMin = Math.round(
          (actualArrival - scheduledDate) / 60000
        );

        if (diffMin > 1) status = `${diffMin} Min Delay`;
        else if (diffMin < -1) status = `${Math.abs(diffMin)} Min Early`;
      }

      console.log("✅ Emitting:", {
        stop: socket.data.stop.stopName,
        speed: busSpeed,
        roadKm,
        etaMin,
        scheduledTime,
        actualFormatted,
        status,
      });

      // ----------------------
      // 6️⃣ SEND TO FRONTEND
      // ----------------------
      socket.emit("timetableUpdate", [
        {
          route: halt.buses[0].busNumber,
          from: "Wakwella",
          to: "Galle",
          scheduled: scheduledTime,
          actual: actualFormatted,
          status,
          roadKm: roadKm.toFixed(2),
          speed: busSpeed.toFixed(1),
        },
      ]);
    }, POLL_MS);

    socket.on("disconnect", () => {
      clearInterval(timer);
      console.log("❌ Client disconnected:", socket.id);
    });
  });
}
