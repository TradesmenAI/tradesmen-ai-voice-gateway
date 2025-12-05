import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import Twilio from "twilio";
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

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
const twilio = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const app = express();
app.use(express.json());
app.use(cors());

// -------------------------------
// TWILIO WEBHOOK — CALL ENTRYPOINT
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

  // NEW REALTIME API — correct version
  const session = openai.realtime.connect({
    model: "gpt-4o-realtime-preview-2024-12-17"
  });

  // send greeting (OpenAI renders voice)
  session.send({
    type: "response.create",
    response: {
      instructions: "Hi, you're through to Tradesmen AI, how can I help?"
    }
  });

  // Twilio → OpenAI
  ws.on("message", (msg) => {
    session.send(msg);
  });

  // OpenAI → Twilio
  session.on("message", (msg) => {
    ws.send(msg);
  });

  ws.on("close", () => {
    console.log("❌ Twilio disconnected");
    session.close();
  });
});

// -------------------------------
// SERVER & WS UPGRADE
// -------------------------------
const PORT = process.env.PORT || 10000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Required by Twilio WebSocket Streams
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws);
    });
  } else {
    socket.destroy();
  }
});
