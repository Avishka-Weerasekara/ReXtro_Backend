// backend/controllers/busScheduleController.js
import BusSchedule from "../models/BusSchedule.js";

// ------------------------
// Helpers
// ------------------------

// Convert HH:MM → minutes for sorting
function toMinutes(time) {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Normalize halt names for consistent search
function normalizeName(name) {
  if (!name) return "";
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// ------------------------
// GET ALL BUS SCHEDULES
// ------------------------
export const getSchedules = async (req, res) => {
  try {
    const schedules = await BusSchedule.find();
    res.status(200).json(schedules);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ------------------------
// ADD OR UPDATE HALT
// ------------------------
export const createOrUpdateSchedule = async (req, res) => {
  try {
    const { haltName, busNumber, expectedTime } = req.body;
    if (!haltName || !busNumber || !expectedTime) {
      return res.status(400).json({ message: "haltName, busNumber, and expectedTime are required" });
    }

    const normalizedHaltName = normalizeName(haltName);

    let halt = await BusSchedule.findOne({ haltName: normalizedHaltName });

    if (halt) {
      // Add new bus entry to existing halt
      halt.buses.push({ busNumber, expectedTime });

      // Sort buses by time
      halt.buses.sort((a, b) => toMinutes(a.expectedTime) - toMinutes(b.expectedTime));

      await halt.save();
      return res.status(200).json(halt);
    }

    // Create new halt if not exists
    const newHalt = await BusSchedule.create({
      haltName: normalizedHaltName, // for searching
      displayName: haltName,        // optional: original name for frontend
      buses: [{ busNumber, expectedTime }],
    });

    res.status(201).json(newHalt);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ------------------------
// EDIT SINGLE BUS INSIDE HALT
// ------------------------
export const editBus = async (req, res) => {
  try {
    const { haltId, busId } = req.params;
    const { busNumber, expectedTime } = req.body;

    const halt = await BusSchedule.findById(haltId);
    if (!halt) return res.status(404).json({ message: "Halt not found" });

    const bus = halt.buses.id(busId);
    if (!bus) return res.status(404).json({ message: "Bus not found" });

    // Update fields
    bus.busNumber = busNumber;
    bus.expectedTime = expectedTime;

    // Resort by time
    halt.buses.sort((a, b) => toMinutes(a.expectedTime) - toMinutes(b.expectedTime));

    await halt.save();
    res.status(200).json(halt);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ------------------------
// DELETE SINGLE BUS INSIDE HALT
// ------------------------
export const deleteBus = async (req, res) => {
  try {
    const { haltId, busId } = req.params;

    const halt = await BusSchedule.findById(haltId);
    if (!halt) return res.status(404).json({ message: "Halt not found" });

    halt.buses = halt.buses.filter((b) => b._id.toString() !== busId);

    await halt.save();
    res.status(200).json(halt);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
