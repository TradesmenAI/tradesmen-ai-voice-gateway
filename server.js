import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import cors from "cors";
import Twilio from "twilio";
import { createClient } from "@supabase/supabase-js";

// -------------------------------
// ENVIRONMENT VARIABLES
// -------------------------------
const {
  OPENAI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  TWILIO_AUTH_TOKEN,
  TWILIO_ACCOUNT_SID
} = process.env;

// Validate ENV on boot (helps debugging)
if (!OPENAI_API_KEY) console.error("❌ Missing OPENAI_API_KEY");
if (!SUPABASE_URL) console.error("❌ Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE) console.error("❌ Missing SUPABASE_SERVICE_ROLE");
if (!TWILIO_AUTH_TOKEN) console.error("❌ Missing TWILIO_AUTH_TOKEN");
if (!TWILIO_ACCOUNT_SID) console.error("❌ Missing TWILIO_ACCOUNT_SID");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
const twilio = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// HEALTH CHECK (Render requires this)
// -------------------------------
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// -------------------------------
// TWILIO VOICE WEBHOOK
// -------------------------------
app.post("/voice", (req, res) => {
  const host = req.headers.host;

  const twiml = `
<Response>
  <Connect>
    <Stream url="wss://${host}/stream" />
  </Connect>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

// -------------------------------
// WEBSOCKET SERVER
// -------------------------------
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (ws) => {
  console.log("🔌 Twilio WebSocket connected");

  // Create OpenAI Realtime session
  const session = await openai.realtime.sessions.create({
    model: "gpt-4o-realtime-preview-2024-12-17",
    voice: "alloy",
    instructions: "Hi, you're through to Tradesmen AI, how can I help?"
  });

  const aiWs = new WebSocket(session.url);

  // Twilio → OpenAI
  ws.on("message", (data) => {
    aiWs.send(data);
  });

  // OpenAI → Twilio
  aiWs.on("message", (data) => {
    ws.send(data);
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    aiWs.close();
  });
});

// -------------------------------
// SERVER + WS UPGRADE HANDLER
// -------------------------------
const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});
