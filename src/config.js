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

  return {
    port: parseInt(process.env.PORT) || 3000,
    piperPath: process.env.PIPER_PATH || "piper",
    voicesDir: resolveHome(
      process.env.VOICES_DIR || path.join(os.homedir(), ".local/share/piper/voices")
    ),
    defaultVoice: process.env.DEFAULT_VOICE || "en_GB-jenny_dioco-medium",
    audioDevice: process.env.AUDIO_DEVICE || "default",
    maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH) || 500,
    cacheEnabled: parseBool(process.env.CACHE_ENABLED, true),
    cacheMaxFiles: parseInt(process.env.CACHE_MAX_FILES) || 100,
  };
}

module.exports = { loadConfig };
