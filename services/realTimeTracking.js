import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

process.env.TZ = "Asia/Colombo";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 5000; // ✅ 5 second updates
const MIN_SPEED = 0.5;

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

// ✅ Convert "HH:MM" → Date(TODAY)
function timeStringToDate(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
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

// ✅ ✅ ✅ FINAL REALTIME TRACKING ENGINE (YOUR NEW LOGIC)
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);

    socket.data.stop = null;

    socket.data.lastStatus = "On Time";
    socket.data.lastActualTime = "--";
    socket.data.lastDelayMin = 0;

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

      const isLowSpeed = rawSpeed < MIN_SPEED;

      // ----------------------
      // 2️⃣ ROAD DISTANCE
      // ----------------------
      const roadKm = await getRoadDistance(
        busLat,
        busLng,
        socket.data.stop.lat,
        socket.data.stop.lng
      );

      // ----------------------
      // 3️⃣ ETA (ONLY IF MOVING)
      // ----------------------
      let actualArrival = null;
      let actualFormatted = socket.data.lastActualTime;

      if (!isLowSpeed) {
        const safeSpeed = Math.max(rawSpeed, MIN_SPEED);
        let etaMin = Math.round(roadKm / (safeSpeed / 60));
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
      // 4️⃣ GET SCHEDULE
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
      // ✅✅✅ 5️⃣ FINAL STATUS LOGIC (YOUR EXACT RULES)
      // ----------------------
      let status = socket.data.lastStatus;

      if (scheduledDate && actualArrival) {
        const diffMin = Math.round(
          (actualArrival - scheduledDate) / 60000
        );

        const isLate = diffMin > 0;
        const absDelay = Math.abs(diffMin);

        // ✅ BUS MOVING → RECALCULATE EVERYTHING
        if (!isLowSpeed) {
          if (absDelay > 60) {
            status = "❌ Bus is not coming";
          } 
          else if (isLate && absDelay > 2) {
            status = `${absDelay} Min Late`;
          } 
          else {
            status = "On Time";
          }

          socket.data.lastStatus = status;
          socket.data.lastDelayMin = absDelay;
        }
      }

      // ✅ BUS STOPPED LOGIC
      if (isLowSpeed) {
        // ✅ If stopped AND delay > 60 min → Bus not coming
        if (socket.data.lastDelayMin > 60) {
          status = "❌ Bus is not coming";
        }
        // ✅ If stopped AND delay > 10 min → KEEP PREVIOUS DELAY
        else if (socket.data.lastDelayMin > 10) {
          status = socket.data.lastStatus;
        }
        // ✅ Otherwise normal freeze
        else {
          status = socket.data.lastStatus;
        }

        actualFormatted = socket.data.lastActualTime;
      }

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
