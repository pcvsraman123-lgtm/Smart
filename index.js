const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const app = express();

app.use(cors());
app.use(express.json());

// Firebase admin
const serviceAccount = require("./serviceAccount.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://home-62121-default-rtdb.firebaseio.com"
});

const db = admin.database();

// -------------------------------
// DEVICE SYNC: ESP pulls commands
// -------------------------------
app.get("/device/sync", async (req, res) => {
  const snap = await db.ref("devices").once("value");
  res.json(snap.val());
});

// ------------------------------------
// DEVICE UPDATE: ESP pushes new events
// ------------------------------------
app.post("/device/update", async (req, res) => {
  const data = req.body;   // relay, pir, latch, mode
  await db.ref("devices").update(data);
  res.json({ status: "ok" });
});

// -------------------------------
// WEB / SMARTTHINGS CONTROL
// -------------------------------
app.post("/control/on", async (req, res) => {
  await db.ref("devices").update({ relay: "1", mode: "manual" });
  res.json({ status: "relay_on" });
});

app.post("/control/off", async (req, res) => {
  await db.ref("devices").update({ relay: "0", mode: "manual" });
  res.json({ status: "relay_off" });
});

app.post("/control/mode/auto", async (req, res) => {
  await db.ref("devices").update({ mode: "auto" });
  res.json({ status: "auto_mode" });
});

app.post("/control/mode/manual", async (req, res) => {
  await db.ref("devices").update({ mode: "manual" });
  res.json({ status: "manual_mode" });
});

// -------------------------------
// WEB UI FULL STATE
// -------------------------------
app.get("/state", async (req, res) => {
  const data = await db.ref("devices").once("value");
  res.json(data.val());
});

// -------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Running on " + PORT));
