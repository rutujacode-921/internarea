require("dotenv").config();
const bodyparser = require("body-parser");
const express = require("express");
const app = express();
const cors = require("cors");
const { connect } = require("./db");
const router = require("./Routes/index");
const port = process.env.PORT || 5000;

// Lets req.ip report the real client IP behind a proxy (e.g. Render) for the audit log.
app.set("trust proxy", true);

app.use(cors());
// Keep the raw body too: Razorpay webhook signatures are computed over it.
app.use(
  bodyparser.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      if (req.originalUrl.startsWith("/api/payments/webhook")) req.rawBody = buf.toString("utf8");
    },
  })
);
app.use(bodyparser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("hello this is internshala backend");
});
app.use("/api", router);
connect();
app.use((req, res, next) => {
  req.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Origin", "*");
  next();
});
app.listen(port, () => {
  console.log(`Server is running on the port ${port}`);
});
