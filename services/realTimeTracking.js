// backend/services/realTimeTracking.js
import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 1; // avoid infinite ETA

// -----------------------------------------------------
// Parse schedule time into a REAL date (today/tomorrow)
// -----------------------------------------------------
function parseScheduleToDate(timeStr) {
  if (!timeStr) return null;

  const now = new Date();
  const parts = timeStr.trim().split(" ");
  if (parts.length < 2) return null;

  let [h, m] = parts[0].split(":").map(Number);
  const ap = parts[1].toUpperCase();

  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;

  const d = new Date();
  d.setHours(h, m, 0, 0);

  // If scheduled time already passed → choose next day
  if (d < now) {
    d.setDate(d.getDate() + 1);
  }

  return d;
}

// -----------------------------------------------------
// Normalize halt name
// -----------------------------------------------------
function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// -----------------------------------------------------
// OSRM distance
// -----------------------------------------------------
async function getRoadDistance(busLat, busLng, stopLat, stopLng) {
  try {
    const URL = `http://router.project-osrm.org/route/v1/driving/${busLng},${busLat};${stopLng},${stopLat}?overview=false`;

    const res = await axios.get(URL);
    if (!res.data.routes) return null;

    return res.data.routes[0].distance / 1000; // metres → km
  } catch (err) {
    console.log("OSRM error:", err.message);
    return null;
  }
}

// -----------------------------------------------------
// REALTIME ENGINE
// -----------------------------------------------------
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);
    socket.data.stop = null;

    // Frontend selected a halt
    socket.on("requestTimetable", (data) => {
      socket.data.stop = {
        stopName: data.stopName,
        lat: Number(data.lat),
        lng: Number(data.lng),
      };
      console.log("📍 Passenger selected stop:", data.stopName);
    });

    // Loop every few seconds
    const timer = setInterval(async () => {
      if (!socket.data.stop) return;

      // 1️⃣ Read GPS from Firebase
      let gps;
      try {
        const res = await axios.get(FIREBASE_GPS_URL);
        gps = res.data;
      } catch {
        return;
      }

      if (!gps || gps.latitude === undefined) return;

      const busLat = Number(gps.latitude);
      const busLng = Number(gps.longitude);
      const busSpeed = Math.max(Number(gps.speed) || 0, MIN_SPEED); // km/h

      // 2️⃣ Calculate road distance
      const roadKm = await getRoadDistance(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      if (!roadKm) return;

      // 3️⃣ ETA based on speed + distance
      let etaMin = Math.round((roadKm / busSpeed) * 60);
      if (etaMin < 1) etaMin = 1;

      // Build actual arrival time using TODAY’S date
      const now = new Date();
      const actualArrival = new Date();

      actualArrival.setHours(now.getHours());
      actualArrival.setMinutes(now.getMinutes() + etaMin);
      actualArrival.setSeconds(0);
      actualArrival.setMilliseconds(0);

      const actualFormatted = actualArrival
        .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

      // 4️⃣ Load schedule from DB
      const haltName = normalizeName(socket.data.stop.stopName);

      const halt = await BusSchedule.findOne({
        haltName: { $regex: new RegExp(`^${haltName}$`, "i") },
      }).lean();

      if (!halt) {
        socket.emit("timetableUpdate", [
          {
            route: "—",
            from: "—",
            to: socket.data.stop.stopName,
            scheduled: "--:--",
            actual: "--",
            status: "No Schedule Found",
          },
        ]);
        return;
      }

      const buses = halt.buses.map((b) => ({
        busNumber: b.busNumber,
        scheduledTime: b.expectedTime,
        scheduleDate: parseScheduleToDate(b.expectedTime),
      }));

      // Sort by next closest bus
      const nextBus = buses
        .filter((b) => b.scheduleDate)
        .sort((a, b) => a.scheduleDate - b.scheduleDate)[0];

      if (!nextBus) return;

      // 5️⃣ Determine Status
      const diffMin = Math.round((actualArrival - nextBus.scheduleDate) / 60000);

      let status = "On Time";
      if (diffMin > 1) status = `${diffMin} Min Delay`;
      if (diffMin < -1) status = `${Math.abs(diffMin)} Min Early`;

      // 6️⃣ Send result back to user
      socket.emit("timetableUpdate", [
        {
          route: nextBus.busNumber,
          from: "Wakwella",
          to: "Galle",
          scheduled: nextBus.scheduledTime,
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
