import Bus from "../models/Bus.js";

// Create Bus
export const createBus = async (req, res) => {
  try {
    const { busNumber, routeNo, ownerName, ownerTel } = req.body;

    const exists = await Bus.findOne({ busNumber });
    if (exists) {
      return res.status(400).json({ message: "Bus already exists" });
    }

    const newBus = new Bus({ busNumber, routeNo, ownerName, ownerTel });
    await newBus.save();

    res.status(201).json({
      message: "Bus created successfully",
      bus: newBus,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get All Buses + Search by Route
export const getAllBuses = async (req, res) => {
  try {
    const { routeNo } = req.query;

    const filter = {};
    if (routeNo) {
      filter.routeNo = routeNo;
    }

    const buses = await Bus.find(filter);
    res.json(buses);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get Bus by ID
export const getBusById = async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ message: "Bus not found" });
    res.json(bus);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update Bus
export const updateBus = async (req, res) => {
  try {
    const updatedBus = await Bus.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updatedBus)
      return res.status(404).json({ message: "Bus not found" });

    res.json({
      message: "Bus updated successfully",
      bus: updatedBus,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete Bus
export const deleteBus = async (req, res) => {
  try {
    const deletedBus = await Bus.findByIdAndDelete(req.params.id);

    if (!deletedBus)
      return res.status(404).json({ message: "Bus not found" });

    res.json({ message: "Bus deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
