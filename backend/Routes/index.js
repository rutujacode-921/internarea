const express = require("express");
const router = express.Router();
const admin = require("./admin");
const intern = require("./internship");
const job = require("./job");
const application=require("./application")
const language = require("./language");
const resume = require("./resume");
const payment = require("./payment");
const auth = require("./auth");
const sessions = require("./sessions");
const spaceRoutes = require("./space");

router.use("/admin", admin);
router.use("/internship", intern);
router.use("/job", job);
router.use("/application", application);
router.use("/language", language);
router.use("/resumes", resume);
router.use("/payments", payment);
router.use("/auth", auth);
router.use("/auth", sessions);
router.use("/space", spaceRoutes);


module.exports = router;
