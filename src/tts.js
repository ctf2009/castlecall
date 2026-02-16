const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");

const CACHE_DIR = path.join(os.tmpdir(), "castlecall-cache");
const PROVIDERS = ["piper", "elevenlabs"];

let currentlyPlaying = false;
let elevenLabsClientState = null;

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

  const additionalIds = config.elevenlabsAdditionalVoiceIds || [];
  const additionalIdsSet = new Set(additionalIds);
  const hiddenIds = new Set(config.elevenlabsHiddenVoiceIds || []);
  const customOnly = config.elevenlabsVoiceListMode === "custom_only";
  const makeFallbackVoice = (voiceId) => ({
    id: voiceId,
    file: null,
    locale: "",
    speaker: `Custom voice ${voiceId.substring(0, 6)}`,
    quality: "custom",
    provider: "elevenlabs",
    label: `Custom voice (${voiceId})`,
  });

  try {
    const elevenlabs = getElevenLabsClient(config);
    const data = await elevenlabs.voices.getAll();
    let voices = (data.voices || [])
      .map((voice) => {
      const accent = voice.labels?.accent || "";
      const locale = voice.verifiedLanguages?.[0]?.locale || "";
      const quality = voice.category || "";
      const accentSuffix = accent ? `, ${accent}` : "";

      return {
        id: voice.voiceId,
        file: null,
        locale,
        speaker: voice.name,
        quality,
        provider: "elevenlabs",
        label: `${voice.name} (${quality}${accentSuffix})`,
      };
      })
      .filter((voice) => !hiddenIds.has(voice.id));

    if (customOnly) {
      const byId = new Map(voices.map((voice) => [voice.id, voice]));
      return additionalIds
        .filter((voiceId) => !hiddenIds.has(voiceId))
        .map((voiceId) => byId.get(voiceId) || makeFallbackVoice(voiceId));
    }

    // Some voice IDs can be callable but not returned in the list for this account.
    const existingIds = new Set(voices.map((voice) => voice.id));
    for (const extraId of additionalIds) {
      if (!existingIds.has(extraId) && !hiddenIds.has(extraId)) {
        voices.push(makeFallbackVoice(extraId));
      }
    }

    return voices;
  } catch (error) {
    if (customOnly) {
      return additionalIds
        .filter((voiceId) => !hiddenIds.has(voiceId))
        .map((voiceId) => makeFallbackVoice(voiceId));
    }
    throw new Error(getElevenLabsErrorMessage(error));
  }
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

  try {
    const elevenlabs = getElevenLabsClient(config);
    const audioStream = await elevenlabs.textToSpeech.convert(
      voice,
      {
        text,
        modelId: config.elevenlabsModelId,
        outputFormat: config.elevenlabsOutputFormat,
      },
      {
        timeoutInSeconds: getTimeoutSeconds(config.elevenlabsTimeoutMs),
      }
    );

    const audioBuffer = await audioToBuffer(audioStream);
    const wavBuffer = pcm16MonoToWav(audioBuffer, sampleRate);
    fs.writeFileSync(outputFile, wavBuffer);
  } catch (error) {
    throw new Error(getElevenLabsErrorMessage(error));
  }
}

function getElevenLabsClient(config) {
  const timeoutInSeconds = getTimeoutSeconds(config.elevenlabsTimeoutMs);
  const key = `${config.elevenlabsApiKey}:${timeoutInSeconds}`;
  if (elevenLabsClientState?.key === key) {
    return elevenLabsClientState.client;
  }

  const client = new ElevenLabsClient({
    apiKey: config.elevenlabsApiKey,
    timeoutInSeconds,
  });
  elevenLabsClientState = { key, client };
  return client;
}

function getTimeoutSeconds(timeoutMs) {
  const seconds = Math.ceil((Number(timeoutMs) || 15000) / 1000);
  return Math.max(1, seconds);
}

async function audioToBuffer(audio) {
  if (!audio) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(audio)) {
    return audio;
  }
  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }
  if (typeof audio.arrayBuffer === "function") {
    return Buffer.from(await audio.arrayBuffer());
  }
  if (typeof audio.getReader === "function") {
    return readableStreamToBuffer(audio);
  }
  if (typeof audio[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of audio) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof audio.on === "function") {
    return new Promise((resolve, reject) => {
      const chunks = [];
      audio.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      audio.on("end", () => resolve(Buffer.concat(chunks)));
      audio.on("error", reject);
    });
  }

  throw new Error("Unsupported ElevenLabs audio response type");
}

async function readableStreamToBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
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

function getElevenLabsErrorMessage(error) {
  const status = error?.statusCode || error?.status;
  const body = error?.body;
  const details = body?.detail?.message || body?.detail || body?.message || error?.message || "";

  if (status === 401 || status === 403) {
    return "ElevenLabs authentication failed. Check ELEVENLABS_API_KEY.";
  }
  if (status === 429) {
    return "ElevenLabs rate limit or quota reached.";
  }
  if (status >= 500) {
    return "ElevenLabs is currently unavailable.";
  }
  if (details) {
    return `ElevenLabs request failed${status ? ` (${status})` : ""}: ${details}`;
  }
  if (status) {
    return `ElevenLabs request failed with status ${status}`;
  }
  return "ElevenLabs request failed";
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
