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
const MAX_SCHEDULE_DELAY_MINUTES = 60;
const SCHEDULE_RETRY_MS = 5000;
const SCHEDULE_MAX_RETRIES = 24;
const scheduledJobs = new Map();

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

function parseDelayMinutes(rawDelayMinutes) {
  if (rawDelayMinutes === undefined || rawDelayMinutes === null || rawDelayMinutes === "") {
    return 0;
  }

  let parsed;
  if (typeof rawDelayMinutes === "number") {
    if (!Number.isInteger(rawDelayMinutes)) {
      return null;
    }
    parsed = rawDelayMinutes;
  } else if (typeof rawDelayMinutes === "string") {
    const trimmed = rawDelayMinutes.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    parsed = Number(trimmed);
  } else {
    return null;
  }

  if (parsed < 0 || parsed > MAX_SCHEDULE_DELAY_MINUTES) {
    return null;
  }
  return parsed;
}

function clampVolume(rawVolume) {
  return Math.min(100, Math.max(0, parseInt(rawVolume) || 40));
}

async function runAnnouncementNow({ text, provider, voice, volume, addToHistory = true }) {
  const selectedVoice = voice || getDefaultVoiceForProvider(config, provider);
  const selectedVolume = clampVolume(volume);
  const trimmedText = text.trim();

  console.log(
    `Announcing: "${trimmedText.substring(0, 50)}${trimmedText.length > 50 ? "..." : ""}" [provider=${provider}, voice=${selectedVoice}, vol=${selectedVolume}]`
  );

  const entry = addToHistory ? addEntry(trimmedText, selectedVoice, selectedVolume, provider) : null;

  await announce(config, {
    text: trimmedText,
    voice: selectedVoice,
    volume: selectedVolume,
    provider,
  });

  return entry;
}

function scheduleAnnouncement({ text, provider, voice, volume }, delayMinutes) {
  const delayMs = delayMinutes * 60 * 1000;
  const scheduleId = `sch_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
  const runAtMs = Date.now() + delayMs;

  const job = {
    id: scheduleId,
    text: text.trim(),
    provider,
    voice,
    volume: clampVolume(volume),
    retries: 0,
    runAtMs,
    timer: null,
  };

  const executeJob = async () => {
    const currentJob = scheduledJobs.get(scheduleId);
    if (!currentJob) {
      return;
    }

    if (isPlaying()) {
      if (currentJob.retries >= SCHEDULE_MAX_RETRIES) {
        scheduledJobs.delete(scheduleId);
        console.warn(
          `Scheduled announcement dropped after waiting for playback slot [id=${scheduleId}]`
        );
        return;
      }

      currentJob.retries += 1;
      currentJob.runAtMs = Date.now() + SCHEDULE_RETRY_MS;
      currentJob.timer = setTimeout(executeJob, SCHEDULE_RETRY_MS);
      return;
    }

    scheduledJobs.delete(scheduleId);

    try {
      await runAnnouncementNow(currentJob);
    } catch (err) {
      console.error(`Scheduled announcement failed [id=${scheduleId}]:`, err);
    }
  };

  job.timer = setTimeout(executeJob, delayMs);
  scheduledJobs.set(scheduleId, job);

  return {
    id: scheduleId,
    runAt: new Date(runAtMs).toISOString(),
  };
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
  const { text, voice, volume, provider, delayMinutes } = req.body;
  const selectedProvider = parseRequestedProvider(provider, config.ttsProvider);
  const selectedDelayMinutes = parseDelayMinutes(delayMinutes);

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Text is required" });
  }
  if (selectedDelayMinutes === null) {
    return res
      .status(400)
      .json({ error: `delayMinutes must be a number between 0 and ${MAX_SCHEDULE_DELAY_MINUTES}` });
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

  if (selectedDelayMinutes === 0 && isPlaying()) {
    return res.status(409).json({ error: "An announcement is already playing" });
  }

  const selectedVoice = voice || getDefaultVoiceForProvider(config, selectedProvider);
  const selectedVolume = clampVolume(volume);

  try {
    if (selectedDelayMinutes > 0) {
      const schedule = scheduleAnnouncement(
        {
          text: text.trim(),
          provider: selectedProvider,
          voice: selectedVoice,
          volume: selectedVolume,
        },
        selectedDelayMinutes
      );
      return res.json({
        success: true,
        scheduled: true,
        id: schedule.id,
        runAt: schedule.runAt,
        delayMinutes: selectedDelayMinutes,
      });
    }

    const entry = await runAnnouncementNow({
      text,
      provider: selectedProvider,
      voice: selectedVoice,
      volume: selectedVolume,
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
    await runAnnouncementNow({
      text: entry.text,
      provider: replayProvider,
      voice: entry.voice || getDefaultVoiceForProvider(config, replayProvider),
      volume: clampVolume(entry.volume),
      addToHistory: false,
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
