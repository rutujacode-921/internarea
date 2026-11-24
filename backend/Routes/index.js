const express = require("express");
const router = express.Router();
const admin = require("./admin");
const intern = require("./internship");
const job = require("./job");
const application=require("./application")
const language = require("./language");
const resume = require("./resume");
const payment = require("./payment");

router.use("/admin", admin);
router.use("/internship", intern);
router.use("/job", job);
router.use("/application", application);
router.use("/language", language);
router.use("/resumes", resume);
router.use("/payments", payment);


module.exports = router;
