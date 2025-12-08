import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

process.env.TZ = "Asia/Colombo";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 0.5;
const LOW_SPEED_LIMIT_MIN = 20; // ✅ 20 minutes

// ✅ Normalize halt name
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
  } catch {
    return 1;
  }
}

// ✅ Convert "HH:MM" → Date(TODAY in Sri Lanka)
function timeStringToDate(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;

  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    h,
    m,
    0,
    0
  );
}

// ✅ ✅ ✅ REALTIME TRACKING ENGINE — FINAL VERSION
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);

    socket.data.stop = null;
    socket.data.lowSpeedSince = null;
    socket.data.lastStatus = "On Time";
    socket.data.lastActualTime = "--";

    socket.on("requestTimetable", (data) => {
      socket.data.stop = {
        stopName: data.stopName,
        lat: Number(data.lat),
        lng: Number(data.lng),
      };
    });

    const timer = setInterval(async () => {
      if (!socket.data.stop) return;

      // ----------------------
      // 1️⃣ READ FIREBASE GPS
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
      const rawSpeed = Number(gps.speed) || 0;

      const now = new Date();

      // ----------------------
      // 2️⃣ LOW SPEED TIMER
      // ----------------------
      const isLowSpeed = rawSpeed < MIN_SPEED;

      if (isLowSpeed) {
        if (!socket.data.lowSpeedSince) {
          socket.data.lowSpeedSince = now;
        }
      } else {
        socket.data.lowSpeedSince = null;
      }

      const lowSpeedMinutes = socket.data.lowSpeedSince
        ? Math.round((now - socket.data.lowSpeedSince) / 60000)
        : 0;

      // ----------------------
      // 3️⃣ ROAD DISTANCE
      // ----------------------
      const roadKm = await getRoadDistance(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      // ----------------------
      // 4️⃣ ETA (ONLY IF SPEED NORMAL)
      // ----------------------
      let etaMin = null;
      let actualArrival = null;
      let actualFormatted = socket.data.lastActualTime;

      if (!isLowSpeed) {
        const safeSpeed = Math.max(rawSpeed, MIN_SPEED);

        etaMin = Math.round(roadKm / (safeSpeed / 60));
        if (etaMin < 1) etaMin = 1;

        actualArrival = new Date(now.getTime() + etaMin * 60000);

        actualFormatted = actualArrival.toLocaleTimeString("en-US", {
          timeZone: "Asia/Colombo",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        socket.data.lastActualTime = actualFormatted;
      }

      // ----------------------
      // 5️⃣ GET SCHEDULE
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

      const scheduledTime = halt.buses[0].expectedTime;
      const scheduledDate = timeStringToDate(scheduledTime);

      // ----------------------
      // 6️⃣ ✅ FINAL STATUS LOGIC (ALL RULES)
      // ----------------------
      let status = socket.data.lastStatus;

      if (scheduledDate && actualArrival) {
        const diffMs = actualArrival - scheduledDate;
        const diffMin = Math.round(diffMs / 60000);

        const isNextDay =
          actualArrival.getDate() !== scheduledDate.getDate();

        if (lowSpeedMinutes >= LOW_SPEED_LIMIT_MIN && diffMin > 120) {
          status = "❌ Bus is not coming";
        } 
        else if (isNextDay) {
          status = `${diffMin} Min Late`; // ✅ NEVER EARLY ON NEXT DAY
        } 
        else if (diffMin > 2) {
          status = `${diffMin} Min Late`;
        } 
        else if (diffMin < -2) {
          status = `${Math.abs(diffMin)} Min Early`;
        } 
        else {
          status = "On Time";
        }

        socket.data.lastStatus = status;
      }

      // ✅ When speed < 0.5 → show PREVIOUS delay & ETA
      if (isLowSpeed) {
        status = socket.data.lastStatus;
        actualFormatted = socket.data.lastActualTime;
      }

      // ----------------------
      // 7️⃣ SEND TO FRONTEND
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
          speed: rawSpeed.toFixed(2),
        },
      ]);
    }, POLL_MS);

    socket.on("disconnect", () => {
      clearInterval(timer);
      console.log("❌ Client disconnected:", socket.id);
    });
  });
}
