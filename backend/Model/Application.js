const mongoose = require("mongoose");
const Applicationipschema = new mongoose.Schema({
  company: String,
  category: String,
  coverLetter: String,
  user: Object,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["accepted", "pending", "rejected"],
    default: "pending",
  },
  Application: Object,
  // The generated resume sent with this application.
  resume: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "GeneratedResume" },
    title: String,
    shareToken: String,
  },
});
module.exports = mongoose.model("Application", Applicationipschema);
