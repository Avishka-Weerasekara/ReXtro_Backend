import mongoose from "mongoose";

const haltSchema = new mongoose.Schema({
  name: { type: String, required: true },
  latitude: { type: String, required: true },
  longtitude: { type: String, required: true },
});

export default mongoose.model("Halt", haltSchema);
