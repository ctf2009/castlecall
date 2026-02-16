const fs = require("fs");
const path = require("path");
const os = require("os");

function loadConfig() {
  // Load .env file manually (no dotenv dependency needed)
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();
        if (key && value && !process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    }
  }

  const resolveHome = (p) => p.replace(/^~/, os.homedir());
  const parseBool = (value, fallback) => {
    if (value === undefined) return fallback;
    return value.toLowerCase() !== "false";
  };
  const parseNumber = (value, fallback) => {
    const parsed = parseInt(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const normalizeProvider = (value) =>
    value === "elevenlabs" || value === "piper" ? value : "piper";
  const normalizeVoiceListMode = (value) =>
    value === "custom_only" ? "custom_only" : "all";
  const parseCsvList = (value) =>
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const ttsProvider = normalizeProvider(process.env.TTS_PROVIDER || "piper");
  const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY || "";
  const elevenlabsVoiceId = process.env.ELEVENLABS_VOICE_ID || "";
  const elevenlabsModelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const elevenlabsOutputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || "pcm_22050";
  const elevenlabsTimeoutMs = parseNumber(process.env.ELEVENLABS_TIMEOUT_MS, 15000);
  const elevenlabsVoiceListMode = normalizeVoiceListMode(
    process.env.ELEVENLABS_VOICE_LIST_MODE
  );
  const elevenlabsAdditionalVoiceIds = parseCsvList(
    process.env.ELEVENLABS_ADDITIONAL_VOICE_IDS
  );
  const elevenlabsHiddenVoiceIds = parseCsvList(process.env.ELEVENLABS_HIDDEN_VOICE_IDS);

  if (ttsProvider === "elevenlabs" && (!elevenlabsApiKey || !elevenlabsVoiceId)) {
    throw new Error(
      "TTS_PROVIDER is set to elevenlabs, but ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are not both set"
    );
  }

  return {
    port: parseNumber(process.env.PORT, 3000),
    piperPath: process.env.PIPER_PATH || "piper",
    voicesDir: resolveHome(
      process.env.VOICES_DIR || path.join(os.homedir(), ".local/share/piper/voices")
    ),
    defaultVoice: process.env.DEFAULT_VOICE || "en_GB-jenny_dioco-medium",
    audioDevice: process.env.AUDIO_DEVICE || "default",
    maxTextLength: parseNumber(process.env.MAX_TEXT_LENGTH, 500),
    cacheEnabled: parseBool(process.env.CACHE_ENABLED, true),
    cacheMaxFiles: parseNumber(process.env.CACHE_MAX_FILES, 100),
    ttsProvider,
    elevenlabsApiKey,
    elevenlabsVoiceId,
    elevenlabsModelId,
    elevenlabsOutputFormat,
    elevenlabsTimeoutMs,
    elevenlabsVoiceListMode,
    elevenlabsAdditionalVoiceIds,
    elevenlabsHiddenVoiceIds,
  };
}

module.exports = { loadConfig };
