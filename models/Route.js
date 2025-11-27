import mongoose from "mongoose";

const routeSchema = new mongoose.Schema({
  routeNo: { type: String, required: true, unique: true },
  routeName: { type: String, required: true },
  startingHalt: { type: String, required: true },
  endingHalt: { type: String, required: true },
});

export default mongoose.model("Route", routeSchema);
