import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import cors from "cors";
import Twilio from "twilio";
import { createClient } from "@supabase/supabase-js";

// Load env vars (Render auto-injects them too)
import dotenv from "dotenv";
dotenv.config();

// ENV VARIABLES
const {
  OPENAI_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  TWILIO_AUTH_TOKEN,
  TWILIO_ACCOUNT_SID
} = process.env;

if (!OPENAI_API_KEY) console.error("❌ Missing OPENAI_API_KEY");
if (!SUPABASE_URL) console.error("❌ Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE) console.error("❌ Missing SUPABASE_SERVICE_ROLE");
if (!TWILIO_AUTH_TOKEN) console.error("❌ Missing TWILIO_AUTH_TOKEN");
if (!TWILIO_ACCOUNT_SID) console.error("❌ Missing TWILIO_ACCOUNT_SID");

// INIT CLIENTS
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
const twilio = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const app = express();
app.use(express.json());
app.use(cors());

// -------------------------
// HEALTH CHECK (Render requires this)
// -------------------------
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// -------------------------
// TWILIO WEBHOOK (incoming call)
// -------------------------
app.post("/voice", (req, res) => {
  const host = req.headers.host;

  const twiml = `
<Response>
  <Say voice="Polly.Joanna">Hi, you're through to Tradesmen AI, how can I help?</Say>
  <Connect>
    <Stream url="wss://${host}/stream" />
  </Connect>
</Response>`;

  res.type("text/xml");
  return res.send(twiml);
});

// -------------------------
// WEBSOCKET SERVER
// -------------------------
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (ws) => {
  console.log("🔌 Twilio WebSocket connected");

  try {
    // Create new OpenAI realtime session
    const session = await openai.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2024-12-17",
      instructions: "You are Tradesmen AI. Be helpful, friendly and concise."
    });

    const sessionWs = openai.realtime.connect(session.id);

    // Twilio -> OpenAI
    ws.on("message", (data) => {
      sessionWs.send(data);
    });

    // OpenAI -> Twilio
    sessionWs.on("message", (data) => {
      ws.send(data);
    });

    ws.on("close", () => {
      console.log("❌ Twilio disconnected");
      sessionWs.close();
    });
  } catch (err) {
    console.error("🔥 ERROR inside websocket handler:", err);
  }
});

// -------------------------
// HANDLE UPGRADE TO WEBSOCKET
// -------------------------
const server = app.listen(10000, () => {
  console.log("🚀 Server running on port 10000");
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
