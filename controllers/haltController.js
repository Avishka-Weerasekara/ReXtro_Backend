import Halt from "../models/Halt.js";

// ✅ Get all halts
export const getHalts = async (req, res) => {
  try {
    const halts = await Halt.find();
    res.status(200).json(halts);
  } catch (error) {
    res.status(500).json({ message: "Error fetching halts", error });
  }
};

// ✅ Create a new halt
export const createHalt = async (req, res) => {
  try {
    const { name, latitude, longtitude } = req.body;

    if (!name || !latitude || !longtitude) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const newHalt = await Halt.create({ name, latitude, longtitude });
    res.status(201).json({ message: "Halt added successfully", halt: newHalt });
  } catch (error) {
    res.status(500).json({ message: "Error creating halt", error });
  }
};

// ✅ Update an existing halt
export const updateHalt = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, latitude, longtitude } = req.body;

    const updated = await Halt.findByIdAndUpdate(
      id,
      { name, latitude, longtitude },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Halt not found" });

    res.status(200).json({ message: "Halt updated successfully", halt: updated });
  } catch (error) {
    res.status(500).json({ message: "Error updating halt", error });
  }
};

// ✅ Delete a halt
export const deleteHalt = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Halt.findByIdAndDelete(id);

    if (!deleted) return res.status(404).json({ message: "Halt not found" });

    res.status(200).json({ message: "Halt deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting halt", error });
  }
};
