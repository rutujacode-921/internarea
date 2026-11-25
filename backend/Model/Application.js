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
  // Set by the server from the session (Task 6): who applied, and whether it
  // was an internship (counts toward the plan's monthly quota) or a job.
  uid: { type: String, default: null, index: true },
  kind: { type: String, enum: ["internship", "job", null], default: null },
  // The generated resume sent with this application.
  resume: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "GeneratedResume" },
    title: String,
    shareToken: String,
  },
});
// A student can apply to the same internship only once (so a double click or a
// retried request can't use up two applications).
Applicationipschema.index(
  { uid: 1, Application: 1 },
  { unique: true, partialFilterExpression: { kind: "internship", uid: { $type: "string" } } }
);
module.exports = mongoose.model("Application", Applicationipschema);
