const express = require("express");
const path = require("path");
const { announce, getVoices, isPlaying } = require("./tts");
const { addEntry, getHistory } = require("./history");
const { loadConfig } = require("./config");

const config = loadConfig();
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Get available voices
app.get("/api/voices", async (req, res) => {
  try {
    const voices = await getVoices(config);
    res.json({ voices, default: config.defaultVoice });
  } catch (err) {
    console.error("Failed to list voices:", err);
    res.status(500).json({ error: "Failed to list voices" });
  }
});

// Submit an announcement
app.post("/api/announce", async (req, res) => {
  const { text, voice, volume } = req.body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Text is required" });
  }

  if (text.length > config.maxTextLength) {
    return res
      .status(400)
      .json({ error: `Text must be ${config.maxTextLength} characters or less` });
  }

  if (isPlaying()) {
    return res.status(409).json({ error: "An announcement is already playing" });
  }

  const selectedVoice = voice || config.defaultVoice;
  const selectedVolume = Math.min(100, Math.max(0, parseInt(volume) || 80));

  try {
    console.log(
      `📢 Announcing: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}" [voice=${selectedVoice}, vol=${selectedVolume}]`
    );

    const entry = addEntry(text, selectedVoice);

    await announce(config, {
      text: text.trim(),
      voice: selectedVoice,
      volume: selectedVolume,
    });

    res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error("Announcement failed:", err);
    res.status(500).json({ error: "Announcement failed: " + err.message });
  }
});

// Get announcement history
app.get("/api/history", (req, res) => {
  res.json({ history: getHistory() });
});

// Get current status
app.get("/api/status", (req, res) => {
  res.json({ playing: isPlaying() });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`
  🏰 CastleCall is running!
  
  Local:   http://localhost:${config.port}
  Network: http://<your-pi-ip>:${config.port}
  
  Piper:   ${config.piperPath}
  Voices:  ${config.voicesDir}
  Device:  ${config.audioDevice}
  `);
});
