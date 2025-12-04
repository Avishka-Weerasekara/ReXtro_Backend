// backend/services/realTimeTracking.js
import axios from "axios";
import BusSchedule from "../models/BusSchedule.js";

const FIREBASE_GPS_URL =
  "https://bustracker-4624a-default-rtdb.asia-southeast1.firebasedatabase.app/bus1.json";

const POLL_MS = 3000;
const MIN_SPEED = 1; // km/h used as fallback so ETA is finite
const NOT_COMING_THRESHOLD_MIN = 60; // >60 minutes => "Bus is not coming"

// ---------- helpers ----------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Try OSRM route distance; fallback to straight-line (haversine)
async function getRoadDistanceKm(busLat, busLng, stopLat, stopLng) {
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${busLng},${busLat};${stopLng},${stopLat}?overview=false`;
    const res = await axios.get(url, { timeout: 4000 });
    if (res?.data?.routes && res.data.routes.length) {
      return res.data.routes[0].distance / 1000;
    }
  } catch (err) {
    // ignore and fallback
  }
  // fallback
  return haversineKm(busLat, busLng, stopLat, stopLng);
}

function parseExpectedToDate(timeStr, referenceDate = new Date()) {
  if (!timeStr) return null;
  const t = String(timeStr).trim();
  // support formats: "HH:MM", "H:MM AM/PM", "HH:MM AM/PM"
  const ampmMatch = t.match(/(AM|PM|am|pm)$/);
  const d = new Date(referenceDate.getTime());
  let timePart = t;
  let ampm = null;
  if (ampmMatch) {
    ampm = ampmMatch[0].toUpperCase();
    timePart = t.replace(/\s*(AM|PM|am|pm)$/, "").trim();
  }
  const parts = timePart.split(":");
  let hh = Number(parts[0]) || 0;
  const mm = Number(parts[1]) || 0;
  if (ampm) {
    if (ampm === "PM" && hh !== 12) hh += 12;
    if (ampm === "AM" && hh === 12) hh = 0;
  }
  d.setHours(hh, mm, 0, 0);
  d.setSeconds(0, 0);
  return d;
}

function fmt24(date) {
  if (!date) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDelay(mins) {
  if (!Number.isFinite(mins)) return "--";
  const abs = Math.abs(Math.round(mins));
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${h}h ${m}m`;
  }
  return `${abs} Min`;
}

// Normalize halt name for case-insensitive lookup
function normalize(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------- realtime service ----------
export function startRealTimeTracking(io) {
  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);
    socket.data.stop = null;

    socket.on("requestTimetable", (payload) => {
      if (!payload || !payload.stopName) return;
      socket.data.stop = {
        stopName: String(payload.stopName),
        lat: Number(payload.lat) || 0,
        lng: Number(payload.lng) || 0,
      };
      console.log("📍 Passenger selected stop:", socket.data.stop.stopName);
    });

    const timer = setInterval(async () => {
      try {
        if (!socket.data.stop) return;

        // 1) read GPS
        let gps;
        try {
          const res = await axios.get(FIREBASE_GPS_URL, { timeout: 4000 });
          gps = res.data;
        } catch (err) {
          // transient error; skip tick
          // console.warn("firebase read err", err.message);
          return;
        }
        if (!gps || gps.latitude === undefined || gps.longitude === undefined) return;

        const busLat = Number(gps.latitude);
        const busLng = Number(gps.longitude);
        let speed = Number(gps.speed) || 0; // km/h
        if (speed < 0) speed = 0;

        // 2) distance (road preferred)
        const roadKm = await getRoadDistanceKm(busLat, busLng, socket.data.stop.lat, socket.data.stop.lng);

        // 3) ETA using current time + speed
        const usedSpeed = speed <= 0 ? MIN_SPEED : Math.max(speed, MIN_SPEED);
        // travel time in minutes = (distance km) / (km per minute)
        const etaMin = Math.max(1, Math.round((roadKm / (usedSpeed / 60)))); // at least 1 minute

        const actualArrival = new Date(Date.now() + etaMin * 60000);

        // 4) get halt schedule
        const halt = await BusSchedule.findOne({
          haltName: { $regex: new RegExp("^" + normalize(socket.data.stop.stopName) + "$", "i") },
        }).lean();

        if (!halt || !Array.isArray(halt.buses) || halt.buses.length === 0) {
          socket.emit("timetableUpdate", [
            {
              route: "—",
              from: "Wakwella",
              to: socket.data.stop.stopName,
              scheduled: "--:--",
              actual: fmt24(actualArrival),
              status: "No schedule",
              etaMin,
              speed: speed.toFixed(1),
            },
          ]);
          return;
        }

        // 5) build candidate scheduled datetimes (today & next day) and pick scheduled closest to actualArrival
        const now = new Date();
        const candidates = [];
        for (const b of halt.buses) {
          const tToday = parseExpectedToDate(b.expectedTime, now);
          const tNext = new Date(tToday.getTime() + 24 * 60 * 60000);
          candidates.push({
            busNumber: b.busNumber,
            expectedTime: b.expectedTime,
            scheduledDate: tToday,
          });
          candidates.push({
            busNumber: b.busNumber,
            expectedTime: b.expectedTime,
            scheduledDate: tNext,
          });
        }

        // find candidate with minimal absolute difference (closest scheduled time to actualArrival)
        let chosen = candidates[0];
        let minDiff = Math.abs((actualArrival.getTime() - chosen.scheduledDate.getTime()) / 60000);
        for (let c of candidates) {
          const diff = Math.abs((actualArrival.getTime() - c.scheduledDate.getTime()) / 60000);
          if (diff < minDiff) {
            minDiff = diff;
            chosen = c;
          }
        }

        // 6) compute delay = actualArrival - chosen.scheduledDate (in minutes)
        const delayMin = Math.round((actualArrival.getTime() - chosen.scheduledDate.getTime()) / 60000);

        // 7) build status
        let status = "Ontime";
        if (delayMin > 1 && delayMin <= NOT_COMING_THRESHOLD_MIN) {
          status = `${delayMin} Min Delay`;
        } else if (delayMin <= -1) {
          status = `${Math.abs(delayMin)} Min Early`;
        } else if (delayMin > NOT_COMING_THRESHOLD_MIN) {
          status = `Bus is not coming`;
        }

        // 8) emit to that socket only
        socket.emit("timetableUpdate", [
          {
            route: String(chosen.busNumber ?? "—"),
            from: "Wakwella", // per request keep constant
            to: socket.data.stop.stopName,
            scheduled: String(chosen.expectedTime ?? "--:--"), // original string from DB
            actual: fmt24(actualArrival),
            status,
            etaMin,
            distanceKm: roadKm.toFixed(2),
            speed: Number(speed).toFixed(1),
            delay: formatDelay(delayMin),
          },
        ]);
      } catch (err) {
        console.error("❌ realtime error:", err?.message || err);
      }
    }, POLL_MS);

    socket.on("disconnect", () => {
      clearInterval(timer);
      console.log("❌ Client disconnected:", socket.id);
    });
  });
}
