const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CACHE_DIR = path.join(os.tmpdir(), "castlecall-cache");
const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const PROVIDERS = ["piper", "elevenlabs"];

let currentlyPlaying = false;

function normalizeProvider(provider) {
  return provider === "elevenlabs" ? "elevenlabs" : "piper";
}

function getDefaultVoiceForProvider(config, provider) {
  return provider === "elevenlabs" ? config.elevenlabsVoiceId : config.defaultVoice;
}

function getProviders(config) {
  const defaultProvider = normalizeProvider(config.ttsProvider);
  const elevenlabsEnabled = Boolean(config.elevenlabsApiKey);

  return {
    default: defaultProvider,
    providers: [
      {
        id: "piper",
        label: "Piper (Local)",
        enabled: true,
      },
      {
        id: "elevenlabs",
        label: "ElevenLabs (Cloud)",
        enabled: elevenlabsEnabled,
        reason: elevenlabsEnabled ? undefined : "Set ELEVENLABS_API_KEY in .env",
      },
    ],
  };
}

async function getVoices(config, providerInput) {
  const provider = normalizeProvider(providerInput || config.ttsProvider);
  if (provider === "elevenlabs") {
    return getElevenLabsVoices(config);
  }
  return getPiperVoices(config);
}

/**
 * Generate speech from selected provider and play it through speakers.
 * Reuses cached audio for repeated provider+voice+text combinations.
 */
function announce(config, { text, voice, volume, provider: providerInput }) {
  return new Promise((resolve, reject) => {
    currentlyPlaying = true;

    const provider = normalizeProvider(providerInput || config.ttsProvider);
    const selectedVoice = voice || getDefaultVoiceForProvider(config, provider);
    const useCache = config.cacheEnabled !== false;
    const outputFile = useCache
      ? getCacheFilePath(provider, selectedVoice, text, config.elevenlabsModelId)
      : path.join(os.tmpdir(), `castlecall-${Date.now()}.wav`);

    if (!selectedVoice) {
      currentlyPlaying = false;
      return reject(
        new Error(
          provider === "elevenlabs"
            ? "No ElevenLabs voice set. Configure ELEVENLABS_VOICE_ID or choose a voice."
            : "No Piper voice selected."
        )
      );
    }

    if (useCache && fs.existsSync(outputFile)) {
      touchFile(outputFile);
      return playAudioFile(config, outputFile, volume, resolve, reject, false);
    }

    if (useCache) {
      ensureCacheDir();
    }

    const generateAudio =
      provider === "elevenlabs"
        ? generateWithElevenLabs(config, {
            text,
            voice: selectedVoice,
            outputFile,
          })
        : generateWithPiper(config, {
            text,
            voice: selectedVoice,
            outputFile,
          });

    generateAudio
      .then(() => {
        if (!fs.existsSync(outputFile)) {
          currentlyPlaying = false;
          return reject(new Error("TTS provider did not produce output file"));
        }

        if (useCache) {
          touchFile(outputFile);
          enforceCacheLimit(config.cacheMaxFiles);
        }

        playAudioFile(config, outputFile, volume, resolve, reject, !useCache);
      })
      .catch((err) => {
        currentlyPlaying = false;
        cleanup(outputFile);
        reject(err);
      });
  });
}

async function getPiperVoices(config) {
  const voicesDir = config.voicesDir;

  if (!fs.existsSync(voicesDir)) {
    return [];
  }

  const files = fs.readdirSync(voicesDir);
  return files
    .filter((f) => f.endsWith(".onnx") && !f.endsWith(".onnx.json"))
    .map((f) => {
      const name = f.replace(".onnx", "");
      const parts = name.split("-");
      const locale = parts[0] || "";
      const speaker = parts[1] || "";
      const quality = parts[2] || "";

      return {
        id: name,
        file: f,
        locale,
        speaker,
        quality,
        provider: "piper",
        label: `${speaker} (${locale}, ${quality})`,
      };
    });
}

async function getElevenLabsVoices(config) {
  if (!config.elevenlabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }

  const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: {
      "xi-api-key": config.elevenlabsApiKey,
    },
    signal: AbortSignal.timeout(config.elevenlabsTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(await getElevenLabsErrorMessage(response));
  }

  const data = await response.json();
  return (data.voices || []).map((voice) => {
    const accent = voice.labels?.accent || "";
    const locale = voice.verified_languages?.[0]?.locale || "";
    const quality = voice.category || "";
    const accentSuffix = accent ? `, ${accent}` : "";

    return {
      id: voice.voice_id,
      file: null,
      locale,
      speaker: voice.name,
      quality,
      provider: "elevenlabs",
      label: `${voice.name} (${quality}${accentSuffix})`,
    };
  });
}

function generateWithPiper(config, { text, voice, outputFile }) {
  return new Promise((resolve, reject) => {
    const voiceModel = path.join(config.voicesDir, `${voice}.onnx`);
    if (!fs.existsSync(voiceModel)) {
      return reject(new Error(`Voice model not found: ${voiceModel}`));
    }

    const piper = spawn(config.piperPath, [
      "--model",
      voiceModel,
      "--output_file",
      outputFile,
    ]);

    let piperStderr = "";
    piper.stderr.on("data", (data) => {
      piperStderr += data.toString();
    });

    piper.stdin.write(text);
    piper.stdin.end();

    piper.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Piper exited with code ${code}: ${piperStderr}`));
      }
      resolve();
    });

    piper.on("error", (err) => {
      reject(new Error(`Failed to run piper: ${err.message}. Is piper installed?`));
    });
  });
}

async function generateWithElevenLabs(config, { text, voice, outputFile }) {
  if (!config.elevenlabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }

  if (!voice) {
    throw new Error("No ElevenLabs voice selected");
  }

  const sampleRate = parsePcmSampleRate(config.elevenlabsOutputFormat);
  const requestUrl = new URL(`${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voice)}`);
  requestUrl.searchParams.set("output_format", config.elevenlabsOutputFormat);

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenlabsApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenlabsModelId,
    }),
    signal: AbortSignal.timeout(config.elevenlabsTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(await getElevenLabsErrorMessage(response));
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const wavBuffer = pcm16MonoToWav(audioBuffer, sampleRate);
  fs.writeFileSync(outputFile, wavBuffer);
}

function parsePcmSampleRate(outputFormat) {
  const match = /^pcm_(\d+)$/.exec(outputFormat || "");
  if (!match) {
    throw new Error(
      `Unsupported ELEVENLABS_OUTPUT_FORMAT "${outputFormat}". Use pcm_16000/pcm_22050/pcm_24000/pcm_44100`
    );
  }
  return parseInt(match[1]);
}

function pcm16MonoToWav(pcmBuffer, sampleRate) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function getElevenLabsErrorMessage(response) {
  let details = "";
  try {
    const payload = await response.json();
    details = payload?.detail?.message || payload?.detail || payload?.message || "";
  } catch {
    // ignore parse errors
  }

  if (response.status === 401 || response.status === 403) {
    return "ElevenLabs authentication failed. Check ELEVENLABS_API_KEY.";
  }
  if (response.status === 429) {
    return "ElevenLabs rate limit or quota reached.";
  }
  if (response.status >= 500) {
    return "ElevenLabs is currently unavailable.";
  }
  if (details) {
    return `ElevenLabs request failed (${response.status}): ${details}`;
  }

  return `ElevenLabs request failed with status ${response.status}`;
}

function playAudioFile(config, audioFile, volume, resolve, reject, cleanupOnFinish) {
  if (volume < 100) {
    const play = spawn("play", [audioFile, "vol", (volume / 100).toFixed(2)], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let playStderr = "";
    let fallbackToAplay = false;

    play.stderr.on("data", (data) => {
      playStderr += data.toString();
    });

    play.on("error", () => {
      fallbackToAplay = true;
      console.warn(
        "sox/play not found, using aplay (volume control unavailable). Install sox: sudo apt-get install sox"
      );
      playWithAplay(config, audioFile, resolve, reject, cleanupOnFinish);
    });

    play.on("close", (playCode) => {
      if (fallbackToAplay) {
        return;
      }

      currentlyPlaying = false;
      if (cleanupOnFinish) {
        cleanup(audioFile);
      }
      if (playCode !== 0) {
        return reject(new Error(`play exited with code ${playCode}: ${playStderr}`));
      }
      resolve();
    });

    return;
  }

  playWithAplay(config, audioFile, resolve, reject, cleanupOnFinish);
}

function playWithAplay(config, audioFile, resolve, reject, cleanupOnFinish) {
  const aplayArgs = [];
  if (config.audioDevice !== "default") {
    aplayArgs.push("-D", config.audioDevice);
  }
  aplayArgs.push(audioFile);

  const aplay = spawn("aplay", aplayArgs, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let aplayStderr = "";
  aplay.stderr.on("data", (data) => {
    aplayStderr += data.toString();
  });

  aplay.on("close", (code) => {
    currentlyPlaying = false;
    if (cleanupOnFinish) {
      cleanup(audioFile);
    }
    if (code !== 0) {
      return reject(new Error(`aplay exited with code ${code}: ${aplayStderr}`));
    }
    resolve();
  });

  aplay.on("error", (err) => {
    currentlyPlaying = false;
    if (cleanupOnFinish) {
      cleanup(audioFile);
    }
    reject(new Error(`Failed to run aplay: ${err.message}`));
  });
}

function getCacheFilePath(provider, voice, text, modelId) {
  const safeProvider = (provider || "piper").replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeVoice = (voice || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = crypto
    .createHash("sha1")
    .update(`${safeProvider}\n${safeVoice}\n${modelId || ""}\n${text}`)
    .digest("hex");
  return path.join(CACHE_DIR, `${safeProvider}-${safeVoice}-${hash}.wav`);
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function touchFile(filePath) {
  try {
    const now = new Date();
    fs.utimesSync(filePath, now, now);
  } catch {
    // ignore touch errors
  }
}

function enforceCacheLimit(maxFiles) {
  if (!Number.isFinite(maxFiles) || maxFiles < 1 || !fs.existsSync(CACHE_DIR)) {
    return;
  }

  try {
    const cachedFiles = fs
      .readdirSync(CACHE_DIR)
      .filter((name) => name.endsWith(".wav"))
      .map((name) => {
        const filePath = path.join(CACHE_DIR, name);
        return {
          filePath,
          mtimeMs: fs.statSync(filePath).mtimeMs,
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const file of cachedFiles.slice(maxFiles)) {
      cleanup(file.filePath);
    }
  } catch {
    // ignore cache cleanup errors
  }
}

function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup errors
  }
}

function isPlaying() {
  return currentlyPlaying;
}

module.exports = {
  announce,
  getVoices,
  getProviders,
  getDefaultVoiceForProvider,
  isPlaying,
  normalizeProvider,
  PROVIDERS,
};
