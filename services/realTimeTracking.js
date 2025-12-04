// backend/services/realTimeTracking.js
import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 1;

// ------------------------------
// PARSE SCHEDULE TIME → Date Today
// ------------------------------
function parseScheduleToDate(timeStr) {
  if (!timeStr) return null;

  const now = new Date();
  const [hm, ap] = timeStr.split(" ");
  let [h, m] = hm.split(":").map(Number);

  const ampm = ap?.toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

// ------------------------------
// SIMPLE HAVERSINE FALLBACK
// ------------------------------
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ------------------------------
// OSRM (Better distance)
// ------------------------------
async function getRoadKm(lat1, lng1, lat2, lng2) {
  try {
    const URL = `http://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;

    const res = await axios.get(URL);

    if (res.data?.routes?.[0]?.distance) {
      return res.data.routes[0].distance / 1000;
    }
  } catch (err) {
    console.log("OSRM error:", err.message);
  }

  // fallback
  return haversine(lat1, lng1, lat2, lng2);
}

// ------------------------------
// REALTIME ENGINE
// ------------------------------
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
      // 1. Read GPS
      // ------------------------------
      let gps;
      try {
        gps = (await axios.get(FIREBASE_GPS_URL)).data;
      } catch {
        return;
      }

      if (!gps || gps.latitude === undefined) return;

      const busLat = Number(gps.latitude);
      const busLng = Number(gps.longitude);
      const busSpeed = Math.max(Number(gps.speed) || 0, MIN_SPEED);

      // ------------------------------
      // 2. Distance
      // ------------------------------
      const roadKm = await getRoadKm(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      // ------------------------------
      // 3. ETA
      // ------------------------------
      const etaMin = Math.max(1, Math.round(roadKm / (busSpeed / 60)));

      const actualArrival = new Date(Date.now() + etaMin * 60000);
      const expectedTimeFormatted = actualArrival.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      // ------------------------------
      // 4. Load Schedule for STOP
      // ------------------------------
      const halt = await BusSchedule.findOne({
        haltName: { $regex: new RegExp(`^${socket.data.stop.stopName}$`, "i") },
      }).lean();

      if (!halt) {
        socket.emit("timetableUpdate", [
          {
            route: "—",
            scheduled: "--:--",
            actual: expectedTimeFormatted,
            status: "No Schedule Found",
          },
        ]);
        return;
      }

      // get first bus only (later: route filtering)
      const bus = halt.buses[0];

      const scheduledDate = parseScheduleToDate(bus.expectedTime);
      const now = new Date();

      // ------------------------------
      // 5. Delay Calculation
      // ------------------------------
      const delayMin = Math.round((actualArrival - scheduledDate) / 60000);

      let status =
        delayMin > 1
          ? `${delayMin} Min Delay`
          : delayMin < -1
          ? `${Math.abs(delayMin)} Min Early`
          : "On Time";

      // ------------------------------
      // 6. Emit Result
      // ------------------------------
      socket.emit("timetableUpdate", [
        {
          route: bus.busNumber,
          scheduled: bus.expectedTime,
          actual: expectedTimeFormatted,
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
