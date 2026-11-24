const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const application = require("../Model/Application");
const { GeneratedResume } = require("../Model/Resume");
const { optionalAuth } = require("../middleware/auth");
const { sendError } = require("../utils/errors");

router.post("/", optionalAuth, async (req, res) => {
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
  const applicationipdata = new application({
    resume,
    company: req.body.company,
    category: req.body.category,
    coverLetter: req.body.coverLetter,
    user: req.body.user,
    Application: req.body.Application,
    body: req.body.body,
  });
  await applicationipdata
    .save()
    .then((data) => {
      res.send(data);
    })
    .catch((error) => {
      console.log(error);
      sendError(req, res, 500, "SERVER_ERROR");
    });
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
