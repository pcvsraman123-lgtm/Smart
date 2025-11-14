const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// -------------------------
// FIREBASE INIT
// -------------------------
let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

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

// -------------------------
// DEVICE API FOR ESP + WEB
// -------------------------

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

// -------------------------
// SMARTTHINGS CLOUD APP
// -------------------------

// random token generator
function rand(len = 36) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

// -------------------------
// 1) OAuth Authorize
// -------------------------
app.get("/smartthings/oauth/authorize", async (req, res) => {
  const { response_type, client_id, redirect_uri, state } = req.query;

  if (response_type !== "code")
    return res.status(400).send("Invalid response_type");

  if (client_id !== process.env.SMART_CLIENT_ID)
    return res.status(400).send("Invalid client_id");

  if (!redirect_uri) return res.status(400).send("Missing redirect_uri");

  const authCode = rand(20);

  await db.ref(`/smartthings/codes/${authCode}`).set({
    client_id,
    redirect_uri,
    userId: process.env.DEFAULT_SMARTTHINGS_USER || "demo-user",
    createdAt: Date.now()
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", authCode);
  if (state) url.searchParams.set("state", state);

  return res.redirect(url.toString());
});

// -------------------------
// 2) OAuth Token Exchange
// -------------------------
app.post("/smartthings/oauth/token", async (req, res) => {
  const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;

  if (grant_type !== "authorization_code")
    return res.status(400).json({ error: "unsupported_grant_type" });

  if (client_id !== process.env.SMART_CLIENT_ID ||
      client_secret !== process.env.SMART_CLIENT_SECRET)
    return res.status(401).json({ error: "invalid_client" });

  const codeSnap = await db.ref(`/smartthings/codes/${code}`).once("value");

  if (!codeSnap.exists())
    return res.status(400).json({ error: "invalid_grant" });

  const data = codeSnap.val();

  if (redirect_uri && redirect_uri !== data.redirect_uri)
    return res.status(400).json({ error: "redirect_uri mismatch" });

  const access_token = rand(48);
  const refresh_token = rand(48);

  const tokenObj = {
    access_token,
    refresh_token,
    expires_in: 3600,
    token_type: "bearer",
    userId: data.userId,
    createdAt: Date.now()
  };

  await db.ref(`/smartthings/tokens/${access_token}`).set(tokenObj);

  await db.ref(`/smartthings/refresh/${refresh_token}`).set(tokenObj);

  await db.ref(`/smartthings/codes/${code}`).remove();

  return res.json(tokenObj);
});

// -------------------------
// Validate Access Token
// -------------------------
async function validateSTToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.split(" ")[1];

  const snap = await db.ref(`/smartthings/tokens/${token}`).once("value");
  return snap.exists() ? snap.val() : null;
}

// -------------------------
// 3) SmartThings Schema
// -------------------------
app.post("/smartthings", async (req, res) => {
  const body = req.body || {};
  const type = body?.headers?.interactionType;

  const token = await validateSTToken(req);
  if (!token)
    return res.status(401).json({ error: "unauthorized" });

  const deviceId = "parking-light-1";

  // ---- DISCOVERY ----
  if (type === "discoveryRequest") {
    return res.json({
      headers: { interactionType: "discoveryResponse" },
      devices: [
        {
          externalDeviceId: deviceId,
          friendlyName: "Parking Light",
          deviceHandlerType: "switch",
          deviceProfile: {
            components: [
              {
                id: "main",
                capabilities: [
                  { id: "switch" },
                  { id: "motionSensor" }
                ]
              }
            ]
          }
        }
      ]
    });
  }

  // ---- STATE REFRESH ----
  if (type === "stateRefreshRequest") {
    const relay = (await relayRef.get()).val() || "0";
    const pir = (await pirRef.get()).val() || "Idle";

    return res.json({
      headers: { interactionType: "stateRefreshResponse" },
      deviceState: [
        {
          externalDeviceId: deviceId,
          states: [
            {
              component: "main",
              capability: "switch",
              attribute: "switch",
              value: relay === "1" ? "on" : "off"
            },
            {
              component: "main",
              capability: "motionSensor",
              attribute: "motion",
              value: pir === "ON" ? "active" : "inactive"
            }
          ]
        }
      ]
    });
  }

  // ---- COMMANDS ----
  if (type === "commandRequest") {
    const commands = body.deviceCommands || [];

    for (const dev of commands) {
      for (const cmd of (dev.commands || [])) {
        if (cmd.capability === "switch") {
          if (cmd.command === "on") {
            await relayRef.set("1");
          }
          if (cmd.command === "off") {
            await relayRef.set("0");
          }
        }
      }
    }

    // return updated state
    const relay = (await relayRef.get()).val() || "0";
    const pir = (await pirRef.get()).val() || "Idle";

    return res.json({
      headers: { interactionType: "commandResponse" },
      deviceState: [
        {
          externalDeviceId: deviceId,
          states: [
            {
              component: "main",
              capability: "switch",
              attribute: "switch",
              value: relay === "1" ? "on" : "off"
            },
            {
              component: "main",
              capability: "motionSensor",
              attribute: "motion",
              value: pir === "ON" ? "active" : "inactive"
            }
          ]
        }
      ]
    });
  }

  return res.status(400).json({ error: "invalid interactionType" });
});

// ------------------
// ROOT
// ------------------
app.get("/", (req, res) => {
  res.send("SmartThings + Smart Home Backend Running ✔");
});

// ------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("🚀 Server running on Port", PORT)
);
