const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
 */
function announce(config, { text, voice, volume }) {
  return new Promise((resolve, reject) => {
    currentlyPlaying = true;

    const voiceModel = path.join(config.voicesDir, `${voice}.onnx`);

    if (!fs.existsSync(voiceModel)) {
      currentlyPlaying = false;
      return reject(new Error(`Voice model not found: ${voiceModel}`));
    }

    // Create a temp file for the WAV output
    const tmpFile = path.join(os.tmpdir(), `castlecall-${Date.now()}.wav`);

    // Run piper to generate WAV
    const piper = spawn(config.piperPath, [
      "--model",
      voiceModel,
      "--output_file",
      tmpFile,
    ]);

    let piperStderr = "";

    piper.stderr.on("data", (data) => {
      piperStderr += data.toString();
    });

    // Feed text to piper's stdin
    piper.stdin.write(text);
    piper.stdin.end();

    piper.on("close", (code) => {
      if (code !== 0) {
        currentlyPlaying = false;
        cleanup(tmpFile);
        return reject(new Error(`Piper exited with code ${code}: ${piperStderr}`));
      }

      if (!fs.existsSync(tmpFile)) {
        currentlyPlaying = false;
        return reject(new Error("Piper did not produce output file"));
      }

      // Play the WAV file using aplay
      // Apply volume scaling via amixer or sox if available
      const playArgs = [];

      if (config.audioDevice !== "default") {
        playArgs.push("-D", config.audioDevice);
      }

      playArgs.push(tmpFile);

      // If volume is not 100, try to use sox (play) for volume control
      // Otherwise fall back to aplay
      if (volume < 100) {
        // Try sox/play first for volume control
        const play = spawn("play", [tmpFile, "vol", (volume / 100).toFixed(2)], {
          stdio: ["ignore", "ignore", "pipe"],
        });

        let playStderr = "";
        play.stderr.on("data", (data) => {
          playStderr += data.toString();
        });

        play.on("error", () => {
          // sox not available, fall back to aplay without volume control
          console.warn(
            "⚠️  sox/play not found, using aplay (volume control unavailable). Install sox: sudo apt-get install sox"
          );
          playWithAplay(config, tmpFile, resolve, reject);
        });

        play.on("close", (playCode) => {
          currentlyPlaying = false;
          cleanup(tmpFile);
          if (playCode !== 0) {
            return reject(new Error(`play exited with code ${playCode}: ${playStderr}`));
          }
          resolve();
        });
      } else {
        playWithAplay(config, tmpFile, resolve, reject);
      }
    });

    piper.on("error", (err) => {
      currentlyPlaying = false;
      cleanup(tmpFile);
      reject(new Error(`Failed to run piper: ${err.message}. Is piper installed?`));
    });
  });
}

function playWithAplay(config, tmpFile, resolve, reject) {
  const aplayArgs = [];
  if (config.audioDevice !== "default") {
    aplayArgs.push("-D", config.audioDevice);
  }
  aplayArgs.push(tmpFile);

  const aplay = spawn("aplay", aplayArgs, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let aplayStderr = "";
  aplay.stderr.on("data", (data) => {
    aplayStderr += data.toString();
  });

  aplay.on("close", (code) => {
    currentlyPlaying = false;
    cleanup(tmpFile);
    if (code !== 0) {
      return reject(new Error(`aplay exited with code ${code}: ${aplayStderr}`));
    }
    resolve();
  });

  aplay.on("error", (err) => {
    currentlyPlaying = false;
    cleanup(tmpFile);
    reject(new Error(`Failed to run aplay: ${err.message}`));
  });
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
