# 🏰 CastleCall

A home PA / announcement system for Raspberry Pi. Type text into a web UI, hear it through your ceiling speakers.

Built to run alongside AirPlay (shairport-sync) on a Pi connected to an amplifier and in-ceiling speakers.

## Features

- 🎙️ Text-to-speech via [Piper TTS](https://github.com/rhasspy/piper) (fully local, no cloud APIs)
- 🌐 Clean web UI accessible from any device on your network
- 📢 Adjustable volume, voice selection, and speech rate
- 📝 Announcement history log
- 🔊 Plays directly through Pi audio output to your amp/speakers
- ⚡ Lightweight — designed to coexist with shairport-sync

## Architecture

```
Phone/Laptop → Browser → CastleCall Web UI
                              ↓
                    POST /api/announce { text, voice, volume }
                              ↓
                    Piper TTS generates WAV
                              ↓
                    aplay outputs to Pi audio
                              ↓
                    Amp → Ceiling Speakers 🔊
```

## Prerequisites

- Raspberry Pi (3B+ or newer recommended) with audio output configured
- Node.js 18+ installed on the Pi
- Your amp/speaker setup already working with the Pi audio output

## Quick Start

```bash
git clone <your-repo-url>
cd castlecall
./setup.sh
npm start
```

The setup script handles everything: installs Piper TTS, downloads a voice model, creates your `.env`, and installs Node dependencies.

Then open `http://<your-pi-ip>:3000` in your browser.

## Manual Installation

> The [setup script](#quick-start) handles these steps automatically. Follow these if you prefer more control.

### 1. Install Piper TTS

```bash
# Install piper
sudo apt-get update
sudo apt-get install -y piper

# OR install via pip
pip install piper-tts

# OR download the binary directly
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_aarch64.tar.gz
tar -xzf piper_linux_aarch64.tar.gz
sudo mv piper /usr/local/bin/
```

### 2. Download a Voice

```bash
# Create voices directory
mkdir -p ~/.local/share/piper/voices

# Download a good English voice (Alba - medium quality, good balance of speed/quality)
cd ~/.local/share/piper/voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json

# Optional: Download additional voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

Browse all available voices at: https://rhasspy.github.io/piper-samples/

### 3. Install CastleCall

```bash
git clone <your-repo-url>
cd castlecall
npm install
```

### 4. Configure

```bash
cp .env.example .env
# Edit .env with your settings
nano .env
```

### 5. Run

```bash
# Development
npm run dev

# Production
npm start

# With PM2 (recommended for always-on)
pm2 start npm --name castlecall -- start
pm2 save
pm2 startup
```

Then open `http://<your-pi-ip>:3000` in your browser.

## Configuration

See `.env.example` for all options:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Web server port |
| `PIPER_PATH` | `piper` | Path to piper binary |
| `VOICES_DIR` | `~/.local/share/piper/voices` | Directory containing voice models |
| `DEFAULT_VOICE` | `en_GB-alba-medium` | Default voice to use |
| `AUDIO_DEVICE` | `default` | ALSA audio device |
| `MAX_TEXT_LENGTH` | `500` | Max characters per announcement |

## API

### `POST /api/announce`

```json
{
  "text": "Dinner is ready!",
  "voice": "en_GB-alba-medium",
  "volume": 80
}
```

### `GET /api/voices`

Returns available voice models.

### `GET /api/history`

Returns recent announcement history.

## Running as a Service

> **Note:** Edit `castlecall.service` before copying to update the `User` and `WorkingDirectory` values for your system. See the comments in the file.

```bash
sudo cp castlecall.service /etc/systemd/system/
sudo systemctl enable castlecall
sudo systemctl start castlecall
```

## Tips

- **AirPlay coexistence**: CastleCall uses `aplay` which shares the ALSA device. If music is playing via AirPlay, announcements will mix in (or queue depending on your ALSA config).
- **Volume control**: Use `amixer` on the Pi to set the master volume. CastleCall's volume slider adjusts TTS output level relative to this.
- **Network access**: Make sure port 3000 is accessible on your local network.

## License

[MIT](LICENSE)
