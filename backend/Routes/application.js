const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const application = require("../Model/Application");
const { GeneratedResume } = require("../Model/Resume");
const { optionalAuth } = require("../middleware/auth");
const { sendError } = require("../utils/errors");
const Internship = require("../Model/Internship");
const { consumeApplication, releaseApplication } = require("../services/subscriptions");

router.post("/", optionalAuth, async (req, res) => {
  try {
    // Internship applications need a signed-in student and count toward their
    // plan's monthly quota (Task 6). Job applications are not limited.
    const targetId = req.body.Application;
    const isInternship = mongoose.isValidObjectId(targetId) && Boolean(await Internship.exists({ _id: targetId }));
    if (isInternship && !req.authUser) return sendError(req, res, 401, "UNAUTHORIZED");

    // An attached resume must be one of the signed-in student's generated resumes.
    let resume;
    if (req.body.resumeId) {
      if (!req.authUser) return sendError(req, res, 401, "UNAUTHORIZED");
      const generated = mongoose.isValidObjectId(req.body.resumeId)
        ? await GeneratedResume.findOne({ _id: req.body.resumeId, uid: req.authUser.uid }).select("title shareToken")
        : null;
      if (!generated) return sendError(req, res, 400, "RESUME_NOT_OWNED");
      resume = { id: generated._id, title: generated.title, shareToken: generated.shareToken };
    }

    let usage = null;
    if (isInternship) {
      const uid = req.authUser.uid;
      // Applying twice doesn't use up the quota; it's refused instead.
      if (await application.exists({ uid, kind: "internship", Application: targetId })) {
        return sendError(req, res, 409, "ALREADY_APPLIED");
      }
      usage = await consumeApplication(uid);
      if (!usage.ok) {
        const s = usage.summary;
        return sendError(
          req,
          res,
          403,
          "APPLICATION_LIMIT_REACHED",
          { limit: s?.limit ?? 0, plan: s?.planName || "Free" },
          { subscription: s }
        );
      }
    }

    const applicationipdata = new application({
      resume,
      company: req.body.company,
      category: req.body.category,
      coverLetter: req.body.coverLetter,
      user: req.body.user,
      Application: targetId,
      body: req.body.body,
      uid: req.authUser?.uid || null,
      kind: isInternship ? "internship" : "job",
    });
    try {
      const data = await applicationipdata.save();
      return res.send(data);
    } catch (error) {
      // Not saved: give the application back to the quota.
      if (usage?.ok) await releaseApplication(req.authUser.uid, usage.cycleKey);
      if (error?.code === 11000) return sendError(req, res, 409, "ALREADY_APPLIED");
      throw error;
    }
  } catch (error) {
    console.log(error);
    sendError(req, res, 500, "SERVER_ERROR");
  }
});
router.get("/", async (req, res) => {
  try {
    const data = await application.find();
    res.json(data).status(200);
  } catch (error) {
    console.log(error);
    res.status(404).json({ error: "internal server error" });
  }
});
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const data = await application.findById(id);
    if (!data) {
      res.status(404).json({ error: "application not found" });
    }
    res.json(data).status(200);
  } catch (error) {
    console.log(error);
    res.status(404).json({ error: "internal server error" });
  }
});
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  let status;
  if (action === "accepted") {
    status = "accepted";
  } else if (action === "rejected") {
    status = "rejected";
  } else {
    res.status(404).json({ error: "Invalid action" });
    return;
  }
  try {
    const updateapplication = await application.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    );
    if (!updateapplication) {
      res.status(404).json({ error: "Not able to update the application" });
      return;
    }
    res.status(200).json({ sucess: true, data: updateapplication });
  } catch (error) {
    res.status(500).json({ error: "internal server error" });
  }
});
module.exports = router;
