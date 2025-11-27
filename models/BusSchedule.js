import mongoose from "mongoose";

const BusSchema = new mongoose.Schema({
  busNumber: { type: Number, required: true },
  expectedTime: { type: String, required: true }
});

const BusScheduleSchema = new mongoose.Schema({
  haltName: { type: String, required: true, unique: true },
  buses: [BusSchema]
});

export default mongoose.model("BusSchedule", BusScheduleSchema);
