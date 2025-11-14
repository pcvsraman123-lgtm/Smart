const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// Load Firebase service account from ENV
let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Init Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://home-62121-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Firebase refs
const relayRef = db.ref("devices/relay");
const pirRef = db.ref("devices/pir");
const latchRef = db.ref("devices/latch");
const modeRef = db.ref("devices/mode");

// ---- GET STATE ----
app.get("/state", async (req, res) => {
  const relay = (await relayRef.get()).val() || "0";
  const pir = (await pirRef.get()).val() || "Idle";
  const latch = (await latchRef.get()).val() || "off";
  const mode = (await modeRef.get()).val() || "auto";

  res.json({ relay, pir, latch, mode });
});

// ---- UPDATE RELAY ----
app.post("/relay", async (req, res) => {
  const { state } = req.body;
  await relayRef.set(state);
  res.json({ success: true });
});

// ---- UPDATE PIR ----
app.post("/pir", async (req, res) => {
  const { value } = req.body;
  await pirRef.set(value);
  res.json({ success: true });
});

// ---- UPDATE LATCH ----
app.post("/latch", async (req, res) => {
  const { state } = req.body;
  await latchRef.set(state);
  res.json({ success: true });
});

// ---- UPDATE MODE ----
app.post("/mode", async (req, res) => {
  const { mode } = req.body;
  await modeRef.set(mode);
  res.json({ success: true });
});

// ---- ROOT ----
app.get("/", (req, res) => {
  res.send("Smart Home Backend Running ✔");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on Port", PORT));
