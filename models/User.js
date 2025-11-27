import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // optional for Google users
  role: { type: String, default: "user" }, // user or admin
  isGoogleUser: { type: Boolean, default: false },
  photo: { type: String },
});

export default mongoose.model("User", userSchema);
