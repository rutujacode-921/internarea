const mongoose = require("mongoose");

// Resume content is validated and cleaned by utils/resumeData.js before it is
// stored, so it is kept here as a plain object.
const designFields = {
  template: { type: String, required: true },
  color: { type: String, required: true },
  font: { type: String, required: true },
  fontSize: { type: String, required: true },
};

// An editable resume draft. Students can keep several, e.g. one per role.
const ResumeSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, index: true },
    title: { type: String, required: true },
    ...designFields,
    data: { type: Object, default: {} },
    // A JPEG or PNG data URL, already size-checked.
    photo: { type: String, default: null },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, minimize: false }
);

// A saved snapshot of a draft. One is written every time the draft is saved.
const ResumeVersionSchema = new mongoose.Schema(
  {
    resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
    uid: { type: String, required: true },
    version: { type: Number, required: true },
    title: String,
    ...designFields,
    data: { type: Object, default: {} },
    photo: { type: String, default: null },
    note: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);
ResumeVersionSchema.index({ resumeId: 1, version: -1 }, { unique: true });

// A paid, generated PDF. Its content is frozen at the moment of payment.
const GeneratedResumeSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, index: true },
    resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume" },
    resumeVersion: Number,
    title: { type: String, required: true },
    template: String,
    color: String,
    font: String,
    fontSize: String,
    contentHash: { type: String, required: true },
    // One generated resume per payment, even if completion runs twice.
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, unique: true },
    fileName: { type: String, required: true },
    pdf: { type: Buffer, required: true },
    size: Number,
    // Unguessable token for the link recruiters open from an application.
    shareToken: { type: String, required: true, unique: true },
    downloadCount: { type: Number, default: 0 },
    lastDownloadedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
GeneratedResumeSchema.index({ uid: 1, contentHash: 1 });

// One row per download or recruiter view of a generated resume.
const ResumeDownloadSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  generatedResumeId: { type: mongoose.Schema.Types.ObjectId, ref: "GeneratedResume", required: true },
  title: String,
  kind: { type: String, enum: ["download", "shared_view"], default: "download" },
  ip: String,
  browser: String,
  os: String,
  device: String,
  createdAt: { type: Date, default: Date.now },
});
ResumeDownloadSchema.index({ uid: 1, createdAt: -1 });

module.exports = {
  Resume: mongoose.model("Resume", ResumeSchema),
  ResumeVersion: mongoose.model("ResumeVersion", ResumeVersionSchema),
  GeneratedResume: mongoose.model("GeneratedResume", GeneratedResumeSchema),
  ResumeDownload: mongoose.model("ResumeDownload", ResumeDownloadSchema),
};
