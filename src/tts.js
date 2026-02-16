const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CACHE_DIR = path.join(os.tmpdir(), "castlecall-cache");

let currentlyPlaying = false;

/**
 * Get list of available Piper voice models from the voices directory.
 */
async function getVoices(config) {
  const voicesDir = config.voicesDir;

  if (!fs.existsSync(voicesDir)) {
    return [];
  }

  const files = fs.readdirSync(voicesDir);
  const voices = files
    .filter((f) => f.endsWith(".onnx") && !f.endsWith(".onnx.json"))
    .map((f) => {
      const name = f.replace(".onnx", "");
      // Parse voice info from name (e.g., en_GB-alba-medium)
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
        label: `${speaker} (${locale}, ${quality})`,
      };
    });

  return voices;
}

/**
 * Generate speech from text using Piper and play it through speakers.
 * Reuses cached audio for repeated text+voice combinations.
 */
function announce(config, { text, voice, volume }) {
  return new Promise((resolve, reject) => {
    currentlyPlaying = true;

    const voiceModel = path.join(config.voicesDir, `${voice}.onnx`);
    if (!fs.existsSync(voiceModel)) {
      currentlyPlaying = false;
      return reject(new Error(`Voice model not found: ${voiceModel}`));
    }

    const useCache = config.cacheEnabled !== false;
    const outputFile = useCache
      ? getCacheFilePath(voice, text)
      : path.join(os.tmpdir(), `castlecall-${Date.now()}.wav`);

    if (useCache && fs.existsSync(outputFile)) {
      touchFile(outputFile);
      return playAudioFile(config, outputFile, volume, resolve, reject, false);
    }

    if (useCache) {
      ensureCacheDir();
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
        currentlyPlaying = false;
        cleanup(outputFile);
        return reject(new Error(`Piper exited with code ${code}: ${piperStderr}`));
      }

      if (!fs.existsSync(outputFile)) {
        currentlyPlaying = false;
        return reject(new Error("Piper did not produce output file"));
      }

      if (useCache) {
        touchFile(outputFile);
        enforceCacheLimit(config.cacheMaxFiles);
      }

      playAudioFile(config, outputFile, volume, resolve, reject, !useCache);
    });

    piper.on("error", (err) => {
      currentlyPlaying = false;
      cleanup(outputFile);
      reject(new Error(`Failed to run piper: ${err.message}. Is piper installed?`));
    });
  });
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

function getCacheFilePath(voice, text) {
  const safeVoice = voice.replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = crypto.createHash("sha1").update(`${voice}\n${text}`).digest("hex");
  return path.join(CACHE_DIR, `${safeVoice}-${hash}.wav`);
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

module.exports = { announce, getVoices, isPlaying };
