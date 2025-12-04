// backend/services/realTimeTracking.js
import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 1; // avoid infinite ETA

// ----------------------------------------------------------
// Convert "1:51 AM" → Date object (TODAY) without day rollover
// ----------------------------------------------------------
function parseExpectedToDate(time) {
  if (!time) return null;

  const [clock, ap] = time.split(" ");
  let [h, m] = clock.split(":").map(Number);
  const ampm = ap?.toUpperCase();

  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  const d = new Date();
  d.setHours(h, m, 0, 0); // NO shifting to next day
  return d;
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// ----------------------------------------------------------
// OSRM — Road distance
// ----------------------------------------------------------
async function getRoadDistance(busLat, busLng, stopLat, stopLng) {
  try {
    const URL = `http://router.project-osrm.org/route/v1/driving/${busLng},${busLat};${stopLng},${stopLat}?overview=false`;

    const res = await axios.get(URL);
    if (!res.data.routes) return null;

    const distanceKm = res.data.routes[0].distance / 1000;
    return distanceKm;
  } catch (err) {
    console.log("OSRM error:", err.message);
    return null;
  }
}

// ----------------------------------------------------------
// REALTIME TRACKING ENGINE
// ----------------------------------------------------------
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);

    socket.data.stop = null;

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

      // ------------------------------
      // 1. Read GPS from Firebase
      // ------------------------------
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
      const busSpeed = Math.max(Number(gps.speed) || 0, MIN_SPEED);

      // ------------------------------
      // 2. Road distance
      // ------------------------------
      const roadKm = await getRoadDistance(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      if (!roadKm) return;

      // ------------------------------
      // 3. ETA from real-time speed
      // ------------------------------
      let etaMin = Math.round(roadKm / (busSpeed / 60));
      if (etaMin < 1) etaMin = 1;

      const actualArrival = new Date(Date.now() + etaMin * 60000);
      const actualFormatted = actualArrival.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      // ------------------------------
      // 4. Get scheduled times
      // ------------------------------
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

      // Convert each schedule to a date TODAY
      const buses = halt.buses.map((b) => ({
        busNumber: b.busNumber,
        expectedTime: b.expectedTime,
        expectedDate: parseExpectedToDate(b.expectedTime),
      }));

      const now = new Date();

      // ------------------------------
      // 5. Select bus closest to NOW (late or early)
      // ------------------------------
      const nextBus = buses
        .map((b) => ({
          ...b,
          diff: Math.abs(b.expectedDate - now),
        }))
        .sort((a, b) => a.diff - b.diff)[0]; // closest schedule

      // ------------------------------
      // 6. Compute delay
      // ------------------------------
      const scheduledMin =
        nextBus.expectedDate.getHours() * 60 + nextBus.expectedDate.getMinutes();

      const expectedMin =
        actualArrival.getHours() * 60 + actualArrival.getMinutes();

      const diff = expectedMin - scheduledMin;

      let status = "On Time";
      if (diff > 1) status = `${diff} Min Delay`;
      else if (diff < -1) status = `${Math.abs(diff)} Min Early`;

      // ------------------------------
      // 7. Send result
      // ------------------------------
      socket.emit("timetableUpdate", [
        {
          route: nextBus.busNumber,
          from: "Wakwella",
          to: "Galle",
          scheduled: nextBus.expectedTime,
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
