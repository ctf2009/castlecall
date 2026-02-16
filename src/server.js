const express = require("express");
const path = require("path");
const {
  announce,
  getVoices,
  getProviders,
  getDefaultVoiceForProvider,
  isPlaying,
  normalizeProvider,
  PROVIDERS,
} = require("./tts");
const { addEntry, getHistory, getEntryById, removeEntryById } = require("./history");
const { loadConfig } = require("./config");

const config = loadConfig();
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function parseRequestedProvider(rawProvider, fallbackProvider) {
  if (rawProvider === undefined || rawProvider === null || rawProvider === "") {
    return normalizeProvider(fallbackProvider);
  }
  if (!PROVIDERS.includes(rawProvider)) {
    return null;
  }
  return rawProvider;
}

function getProviderConfigError(provider) {
  if (provider === "elevenlabs" && !config.elevenlabsApiKey) {
    return "ElevenLabs is not configured (missing ELEVENLABS_API_KEY)";
  }
  return null;
}

app.get("/api/providers", (req, res) => {
  res.json(getProviders(config));
});

// Get available voices
app.get("/api/voices", async (req, res) => {
  const selectedProvider = parseRequestedProvider(req.query.provider, config.ttsProvider);
  if (!selectedProvider) {
    return res.status(400).json({ error: "Invalid provider" });
  }
  const providerError = getProviderConfigError(selectedProvider);
  if (providerError) {
    return res.status(400).json({ error: providerError });
  }

  try {
    const voices = await getVoices(config, selectedProvider);
    res.json({
      voices,
      provider: selectedProvider,
      default: getDefaultVoiceForProvider(config, selectedProvider),
    });
  } catch (err) {
    console.error("Failed to list voices:", err);
    res.status(500).json({ error: "Failed to list voices" });
  }
});

// Submit an announcement
app.post("/api/announce", async (req, res) => {
  const { text, voice, volume, provider } = req.body;
  const selectedProvider = parseRequestedProvider(provider, config.ttsProvider);

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Text is required" });
  }

  if (!selectedProvider) {
    return res.status(400).json({ error: "Invalid provider" });
  }
  const providerError = getProviderConfigError(selectedProvider);
  if (providerError) {
    return res.status(400).json({ error: providerError });
  }

  if (text.length > config.maxTextLength) {
    return res
      .status(400)
      .json({ error: `Text must be ${config.maxTextLength} characters or less` });
  }

  if (isPlaying()) {
    return res.status(409).json({ error: "An announcement is already playing" });
  }

  const selectedVoice = voice || getDefaultVoiceForProvider(config, selectedProvider);
  const selectedVolume = Math.min(100, Math.max(0, parseInt(volume) || 40));

  try {
    console.log(
      `Announcing: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}" [provider=${selectedProvider}, voice=${selectedVoice}, vol=${selectedVolume}]`
    );

    const entry = addEntry(text, selectedVoice, selectedVolume, selectedProvider);

    await announce(config, {
      text: text.trim(),
      voice: selectedVoice,
      volume: selectedVolume,
      provider: selectedProvider,
    });

    res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error("Announcement failed:", err);
    res.status(500).json({ error: "Announcement failed: " + err.message });
  }
});

// Replay an announcement directly from history
app.post("/api/replay/:id", async (req, res) => {
  if (isPlaying()) {
    return res.status(409).json({ error: "An announcement is already playing" });
  }

  const entry = getEntryById(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: "History entry not found" });
  }

  const replayProvider = parseRequestedProvider(entry.provider, config.ttsProvider);
  if (!replayProvider) {
    return res.status(400).json({ error: "Invalid provider in history entry" });
  }
  const replayProviderError = getProviderConfigError(replayProvider);
  if (replayProviderError) {
    return res.status(400).json({ error: replayProviderError });
  }

  try {
    await announce(config, {
      text: entry.text,
      voice: entry.voice || getDefaultVoiceForProvider(config, replayProvider),
      volume: Math.min(100, Math.max(0, parseInt(entry.volume) || 40)),
      provider: replayProvider,
    });

    res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error("Replay failed:", err);
    res.status(500).json({ error: "Replay failed: " + err.message });
  }
});

// Get announcement history
app.get("/api/history", (req, res) => {
  res.json({ history: getHistory() });
});

// Delete a single history entry
app.delete("/api/history/:id", (req, res) => {
  const removed = removeEntryById(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "History entry not found" });
  }

  res.json({ success: true, id: removed.id });
});

// Get current status
app.get("/api/status", (req, res) => {
  res.json({ playing: isPlaying() });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`
  CastleCall is running!
  
  Local:   http://localhost:${config.port}
  Network: http://<your-pi-ip>:${config.port}
  
  Piper:   ${config.piperPath}
  TTS:     ${config.ttsProvider}
  Voices:  ${config.voicesDir}
  Device:  ${config.audioDevice}
  `);
});
