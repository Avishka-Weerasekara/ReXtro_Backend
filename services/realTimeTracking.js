import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 1;

// ------------------ TIME PARSER ------------------
function parseExpectedToDate(time) {
  if (!time) return null;

  const d = new Date();
  const parts = time.trim().split(" ");

  let [h, m] = parts[0].split(":").map(Number);
  const ampm = parts[1]?.toUpperCase();

  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  d.setHours(h, m, 0, 0);
  return d;
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// ------------------ ROAD DISTANCE ------------------
async function getRoadDistance(busLat, busLng, stopLat, stopLng) {
  try {
    const URL = `https://router.project-osrm.org/route/v1/driving/${busLng},${busLat};${stopLng},${stopLat}?overview=false`;
    const res = await axios.get(URL);
    return res.data.routes?.[0]?.distance / 1000 || null;
  } catch {
    return null;
  }
}

// ------------------ REALTIME ENGINE ------------------
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);
    socket.data.stop = null;

    // ✅ RECEIVE STOP FROM FRONTEND
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

      // ✅ FETCH GPS
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

      // ✅ GET ROAD DISTANCE
      let roadKm = await getRoadDistance(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      // ✅ SAFETY FALLBACK
      if (!roadKm) roadKm = 1;

      // ✅ ETA CALCULATION
      let etaMin = Math.round(roadKm / (busSpeed / 60));
      if (etaMin < 1) etaMin = 1;

      const actualArrival = new Date(Date.now() + etaMin * 60000);
      const actualFormatted = actualArrival.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });

      // ✅ GET SCHEDULE
      const haltName = normalizeName(socket.data.stop.stopName);

      const halt = await BusSchedule.findOne({
        haltName: { $regex: new RegExp(`^${haltName}$`, "i") },
      }).lean();

      if (!halt || halt.buses.length === 0) {
        socket.emit("timetableUpdate", [
          {
            route: "—",
            from: "Wakwella",
            to: socket.data.stop.stopName,
            scheduled: "--",
            actual: "--",
            status: "No Schedule Found",
          },
        ]);
        return;
      }

      // ✅ USE FIRST BUS ONLY
      const bus = halt.buses[0];

      const scheduledDate = parseExpectedToDate(bus.expectedTime);
      const scheduledMin =
        scheduledDate.getHours() * 60 + scheduledDate.getMinutes();

      const actualMin =
        actualArrival.getHours() * 60 + actualArrival.getMinutes();

      const diff = actualMin - scheduledMin;

      let status =
        diff > 60
          ? "Bus Not Coming"
          : diff > 1
          ? `${diff} Min Delay`
          : diff < -1
          ? `${Math.abs(diff)} Min Early`
          : "On Time";

      // ✅ ALWAYS EMIT DATA
      socket.emit("timetableUpdate", [
        {
          route: bus.busNumber,
          from: "Wakwella",
          to: "Galle",
          scheduled: bus.expectedTime,
          actual: actualFormatted,
          status,
        },
      ]);
    }, POLL_MS);

    socket.on("disconnect", () => {
      clearInterval(timer);
      console.log("❌ Client disconnected:", socket.id);
    });
  });
}
