import mongoose from "mongoose";

const busSchema = new mongoose.Schema({
  busNumber: { type: String, required: true, unique: true },
  routeNo: { type: String, required: true },
  ownerName: { type: String, required: true },
  ownerTel: { type: String, required: true },
});

export default mongoose.model("Bus", busSchema);
