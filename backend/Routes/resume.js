const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../Model/User");
const { Resume, ResumeVersion, GeneratedResume, ResumeDownload } = require("../Model/Resume");
const { requireAuth } = require("../middleware/auth");
const { sendError, asyncHandler } = require("../utils/errors");
const { getClientInfo } = require("../utils/clientInfo");
const { getOrCreateUser, premiumInfo } = require("../utils/users");
const {
  normalizeResumeData,
  normalizeDesign,
  normalizePhoto,
  findResumeIssues,
  emptyResumeData,
  cleanText,
  DEFAULT_DESIGN,
} = require("../utils/resumeData");

const MAX_DRAFTS = 20;
const MAX_VERSIONS_KEPT = 30;

const isId = (value) => mongoose.isValidObjectId(value);

async function logDownload(req, generated, kind) {
  try {
    const { ip, browser, os, device } = getClientInfo(req);
    await ResumeDownload.create({
      uid: generated.uid,
      generatedResumeId: generated._id,
      title: generated.title,
      kind,
      ip,
      browser,
      os,
      device,
    });
    await GeneratedResume.updateOne(
      { _id: generated._id },
      { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } }
    );
  } catch (error) {
    console.error("Failed to log resume download:", error);
  }
}

const sendPdf = (res, generated, disposition) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${generated.fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(generated.pdf);
};

// GET /api/resumes/shared/:token - recruiters open the resume attached to an
// application through this unguessable link. No sign-in needed.
router.get(
  "/shared/:token",
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    if (!/^[a-f0-9]{48}$/.test(token)) return sendError(req, res, 404, "GENERATED_RESUME_NOT_FOUND");
    const generated = await GeneratedResume.findOne({ shareToken: token });
    if (!generated) return sendError(req, res, 404, "GENERATED_RESUME_NOT_FOUND");
    await logDownload(req, generated, "shared_view");
    sendPdf(res, generated, "inline");
  })
);

router.use(requireAuth);

// Loads the user and rejects the request unless Premium is active.
const requirePremium = asyncHandler(async (req, res, next) => {
  const user = await getOrCreateUser(req.authUser);
  if (!user.isPremium()) return sendError(req, res, 403, "PREMIUM_REQUIRED");
  req.user = user;
  next();
});

const draftSummary = (resume) => ({
  id: resume._id,
  title: resume.title,
  template: resume.template,
  color: resume.color,
  version: resume.version,
  updatedAt: resume.updatedAt,
  createdAt: resume.createdAt,
  issueCount: findResumeIssues(normalizeResumeData(resume.data)).length,
});

const draftDetail = (resume) => ({
  id: resume._id,
  title: resume.title,
  design: normalizeDesign(resume),
  data: normalizeResumeData(resume.data),
  photo: resume.photo,
  version: resume.version,
  updatedAt: resume.updatedAt,
  issues: findResumeIssues(normalizeResumeData(resume.data)),
});

async function snapshotVersion(resume, note) {
  await ResumeVersion.create({
    resumeId: resume._id,
    uid: resume.uid,
    version: resume.version,
    title: resume.title,
    template: resume.template,
    color: resume.color,
    font: resume.font,
    fontSize: resume.fontSize,
    data: resume.data,
    photo: resume.photo,
    note,
  });
  // Keep the most recent versions only.
  const old = await ResumeVersion.find({ resumeId: resume._id })
    .sort({ version: -1 })
    .skip(MAX_VERSIONS_KEPT)
    .select("_id");
  if (old.length) await ResumeVersion.deleteMany({ _id: { $in: old.map((v) => v._id) } });
}

// GET /api/resumes/me - Premium status, default resume and counts.
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await getOrCreateUser(req.authUser);
    res.json({ premium: premiumInfo(user), defaultResumeId: user.defaultResumeId, maxDrafts: MAX_DRAFTS });
  })
);

// GET /api/resumes/drafts
router.get(
  "/drafts",
  asyncHandler(async (req, res) => {
    const drafts = await Resume.find({ uid: req.authUser.uid }).sort({ updatedAt: -1 }).select("-photo");
    res.json({ drafts: drafts.map(draftSummary) });
  })
);

// POST /api/resumes/drafts - new draft, or a copy of an existing one.
router.post(
  "/drafts",
  requirePremium,
  asyncHandler(async (req, res) => {
    const count = await Resume.countDocuments({ uid: req.user.uid });
    if (count >= MAX_DRAFTS) return sendError(req, res, 409, "RESUME_LIMIT", { max: MAX_DRAFTS });

    let source = null;
    if (req.body?.copyFrom) {
      if (!isId(req.body.copyFrom)) return sendError(req, res, 404, "RESUME_NOT_FOUND");
      source = await Resume.findOne({ _id: req.body.copyFrom, uid: req.user.uid });
      if (!source) return sendError(req, res, 404, "RESUME_NOT_FOUND");
    }

    const title =
      cleanText(req.body?.title, 80) || (source ? `${source.title} (copy)`.slice(0, 80) : `Resume ${count + 1}`);
    const resume = await Resume.create({
      uid: req.user.uid,
      title,
      ...(source ? normalizeDesign(source) : DEFAULT_DESIGN),
      data: source ? normalizeResumeData(source.data) : emptyResumeData(req.authUser),
      photo: source ? source.photo : null,
      version: 1,
    });
    await snapshotVersion(resume, source ? "copied" : "created");
    res.status(201).json({ resume: draftDetail(resume) });
  })
);

async function findDraft(req, res) {
  if (!isId(req.params.id)) {
    sendError(req, res, 404, "RESUME_NOT_FOUND");
    return null;
  }
  const resume = await Resume.findOne({ _id: req.params.id, uid: req.authUser.uid });
  if (!resume) sendError(req, res, 404, "RESUME_NOT_FOUND");
  return resume;
}

// GET /api/resumes/drafts/:id
router.get(
  "/drafts/:id",
  asyncHandler(async (req, res) => {
    const resume = await findDraft(req, res);
    if (resume) res.json({ resume: draftDetail(resume) });
  })
);

// PUT /api/resumes/drafts/:id - save. Every save becomes a new version.
// baseVersion guards against overwriting changes made in another tab.
router.put(
  "/drafts/:id",
  requirePremium,
  asyncHandler(async (req, res) => {
    const resume = await findDraft(req, res);
    if (!resume) return;
    const body = req.body || {};

    const photo = normalizePhoto(body.photo);
    if (!photo.ok) return sendError(req, res, 400, photo.code);

    const baseVersion = Number(body.baseVersion);
    const update = {
      title: cleanText(body.title, 80) || resume.title,
      ...normalizeDesign(body.design),
      data: normalizeResumeData(body.data),
      photo: photo.photo,
    };

    const saved = await Resume.findOneAndUpdate(
      { _id: resume._id, uid: resume.uid, version: baseVersion },
      { $set: update, $inc: { version: 1 } },
      { new: true }
    );
    if (!saved) {
      return sendError(req, res, 409, "VERSION_CONFLICT", {}, { currentVersion: resume.version });
    }
    await snapshotVersion(saved, cleanText(body.note, 100) || "saved");
    res.json({ resume: draftDetail(saved) });
  })
);

// DELETE /api/resumes/drafts/:id - generated PDFs are kept.
router.delete(
  "/drafts/:id",
  asyncHandler(async (req, res) => {
    const resume = await findDraft(req, res);
    if (!resume) return;
    await ResumeVersion.deleteMany({ resumeId: resume._id });
    await resume.deleteOne();
    res.json({ deleted: true });
  })
);

// GET /api/resumes/drafts/:id/versions
router.get(
  "/drafts/:id/versions",
  asyncHandler(async (req, res) => {
    const resume = await findDraft(req, res);
    if (!resume) return;
    const versions = await ResumeVersion.find({ resumeId: resume._id })
      .sort({ version: -1 })
      .select("version title template color font note createdAt");
    res.json({ versions, current: resume.version });
  })
);

// GET /api/resumes/drafts/:id/versions/:version - full content, for preview.
router.get(
  "/drafts/:id/versions/:version",
  asyncHandler(async (req, res) => {
    const resume = await findDraft(req, res);
    if (!resume) return;
    const version = await ResumeVersion.findOne({ resumeId: resume._id, version: Number(req.params.version) });
    if (!version) return sendError(req, res, 404, "VERSION_NOT_FOUND");
    res.json({
      version: {
        version: version.version,
        title: version.title,
        design: normalizeDesign(version),
        data: normalizeResumeData(version.data),
        photo: version.photo,
        createdAt: version.createdAt,
      },
    });
  })
);

// POST /api/resumes/drafts/:id/versions/:version/restore - saved as a new version.
router.post(
  "/drafts/:id/versions/:version/restore",
  requirePremium,
  asyncHandler(async (req, res) => {
    const resume = await findDraft(req, res);
    if (!resume) return;
    const version = await ResumeVersion.findOne({ resumeId: resume._id, version: Number(req.params.version) });
    if (!version) return sendError(req, res, 404, "VERSION_NOT_FOUND");

    const saved = await Resume.findOneAndUpdate(
      { _id: resume._id, version: resume.version },
      {
        $set: {
          title: version.title,
          ...normalizeDesign(version),
          data: normalizeResumeData(version.data),
          photo: version.photo,
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    if (!saved) return sendError(req, res, 409, "VERSION_CONFLICT");
    await snapshotVersion(saved, `restored v${version.version}`);
    res.json({ resume: draftDetail(saved) });
  })
);

const generatedSummary = (g, defaultId) => ({
  id: g._id,
  title: g.title,
  fileName: g.fileName,
  template: g.template,
  color: g.color,
  size: g.size,
  resumeId: g.resumeId,
  resumeVersion: g.resumeVersion,
  paymentId: g.paymentId,
  downloadCount: g.downloadCount,
  lastDownloadedAt: g.lastDownloadedAt,
  createdAt: g.createdAt,
  isDefault: Boolean(defaultId && defaultId.equals(g._id)),
});

// GET /api/resumes/generated - paid PDFs, newest first.
router.get(
  "/generated",
  asyncHandler(async (req, res) => {
    const user = await getOrCreateUser(req.authUser);
    const list = await GeneratedResume.find({ uid: user.uid }).sort({ createdAt: -1 }).select("-pdf -shareToken");
    // If the default was removed somehow, fall back to the newest resume.
    let defaultId = user.defaultResumeId;
    if ((!defaultId || !list.some((g) => g._id.equals(defaultId))) && list.length) {
      defaultId = list[0]._id;
      await User.updateOne({ uid: user.uid }, { $set: { defaultResumeId: defaultId } });
    }
    res.json({ resumes: list.map((g) => generatedSummary(g, defaultId)), defaultResumeId: defaultId || null });
  })
);

// PUT /api/resumes/default - choose which generated resume goes with applications.
router.put(
  "/default",
  asyncHandler(async (req, res) => {
    const { generatedResumeId } = req.body || {};
    if (!isId(generatedResumeId)) return sendError(req, res, 404, "GENERATED_RESUME_NOT_FOUND");
    const generated = await GeneratedResume.findOne({ _id: generatedResumeId, uid: req.authUser.uid }).select("_id");
    if (!generated) return sendError(req, res, 404, "GENERATED_RESUME_NOT_FOUND");
    await getOrCreateUser(req.authUser);
    await User.updateOne({ uid: req.authUser.uid }, { $set: { defaultResumeId: generated._id } });
    res.json({ defaultResumeId: generated._id });
  })
);

// GET /api/resumes/generated/:id/download - free, since it was already paid for.
router.get(
  "/generated/:id/download",
  asyncHandler(async (req, res) => {
    if (!isId(req.params.id)) return sendError(req, res, 404, "GENERATED_RESUME_NOT_FOUND");
    const generated = await GeneratedResume.findOne({ _id: req.params.id, uid: req.authUser.uid });
    if (!generated) return sendError(req, res, 404, "GENERATED_RESUME_NOT_FOUND");
    await logDownload(req, generated, "download");
    sendPdf(res, generated, req.query.inline === "1" ? "inline" : "attachment");
  })
);

// GET /api/resumes/downloads - download and recruiter-view history.
router.get(
  "/downloads",
  asyncHandler(async (req, res) => {
    const entries = await ResumeDownload.find({ uid: req.authUser.uid })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("-uid -__v");
    res.json({ entries });
  })
);

module.exports = router;
