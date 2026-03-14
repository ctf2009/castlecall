# CastleCall

Home PA / announcement system for Raspberry Pi. Type text in a web UI and play announcements through your speakers.

Built to run alongside AirPlay (`shairport-sync`) on a Pi connected to an amplifier and speakers.

## Example UI

![CastleCall UI example](Example.png)

## Features

- Local TTS with [Piper](https://github.com/rhasspy/piper)
- Optional cloud TTS with [ElevenLabs](https://elevenlabs.io/)
- Optional 30-second song generation with ElevenLabs Song Studio
- Browser preview and local history for generated songs
- Explicit device announce for generated songs (no auto-play on generate)
- Provider and voice selection in the UI
- Adjustable volume
- Optional delayed announcements (1-60 minutes)
- Replayable announcement history
- Audio caching for faster repeated announcements/replays

## Architecture

```
Phone/Laptop -> Browser -> CastleCall Web UI
                          |
                          v
         POST /api/announce { text, provider, voice, volume }
                          |
                          v
       Provider (Piper or ElevenLabs) generates WAV audio
                          |
                          v
                 aplay/play outputs to Pi audio
                          |
                          v
                     Amp -> Speakers
```

## Prerequisites

- Raspberry Pi (3B+ recommended) with working audio output
- Node.js 18+ installed
- `aplay` available (from `alsa-utils`)
- `sox` installed if you want device playback from Song Studio
- `libsox-fmt-mp3` installed on Linux so SoX can decode MP3 song files

## Quick Start

```bash
git clone <your-repo-url>
cd castlecall
./setup.sh
npm start
```

Open `http://<your-pi-ip>:3000`.

## Manual Installation

### 1. Install Piper TTS

```bash
# Recommended: install Rhasspy Piper binary from releases
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_armv7l.tar.gz
tar -xzf piper_linux_armv7l.tar.gz
sudo mkdir -p /usr/local/piper
sudo cp -r piper/* /usr/local/piper/
sudo ln -sf /usr/local/piper/piper /usr/local/bin/piper-tts
```

Set `PIPER_PATH=/usr/local/bin/piper-tts` in `.env`.

### 2. Download a Voice

```bash
mkdir -p ~/.local/share/piper/voices
cd ~/.local/share/piper/voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium.onnx.json
```

### 3. Install CastleCall

```bash
git clone <your-repo-url>
cd castlecall
npm install
cp .env.example .env
```

### 4. Install Audio Playback Tools (Recommended for Pi)

```bash
sudo apt-get update
sudo apt-get install -y alsa-utils sox libsox-fmt-mp3
```

`alsa-utils` provides `aplay` for WAV announcements. `sox` plus `libsox-fmt-mp3` allows Song Studio tracks to be announced through the Pi speakers.

### 5. Run

```bash
npm start
```

## Configuration

See `.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Web server port |
| `PIPER_PATH` | `piper` | Path to piper binary |
| `VOICES_DIR` | `~/.local/share/piper/voices` | Piper voice directory |
| `DEFAULT_VOICE` | `en_GB-jenny_dioco-medium` | Default Piper voice |
| `AUDIO_DEVICE` | `default` | ALSA output device |
| `MAX_TEXT_LENGTH` | `500` | Max announcement length |
| `CACHE_ENABLED` | `true` | Enable WAV cache |
| `CACHE_MAX_FILES` | `100` | Max cached WAV files |
| `TTS_PROVIDER` | `piper` | Default provider: `piper` or `elevenlabs` |
| `ELEVENLABS_API_KEY` | _(empty)_ | ElevenLabs API key (add `music_generation` for Song Studio, `user_read` for usage stats) |
| `ELEVENLABS_VOICE_ID` | _(empty)_ | Default ElevenLabs voice ID |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | ElevenLabs model |
| `ELEVENLABS_OUTPUT_FORMAT` | `pcm_22050` | ElevenLabs PCM format |
| `ELEVENLABS_TIMEOUT_MS` | `15000` | ElevenLabs timeout (ms) |

Notes:
- `ELEVENLABS_OUTPUT_FORMAT` currently supports `pcm_*` formats only.
- If `TTS_PROVIDER=elevenlabs`, both `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` must be set.
- Song Studio appears only when the ElevenLabs key is valid and can access music generation.
- Song Studio generates one 30-second track per request and reuses the normal cache directory.
- Song Studio does not auto-play on CastleCall when you click `Generate Song`. Generate first, preview in the browser, then explicitly announce it.

## Song Studio Flow

1. Enter a prompt and click `Generate Song`.
2. CastleCall generates one 30-second track and stores it in local song history.
3. Preview it in the browser using the built-in audio player.
4. Click `Announce On CastleCall` when you want that song played through the device speakers.

On Windows or other non-Pi local development machines, browser preview will usually work even if device playback is unavailable.

## API

### `GET /api/providers`

Returns available providers and the default provider.

### `GET /api/voices?provider=<piper|elevenlabs>`

Returns voices for the selected provider.

### `POST /api/announce`

```json
{
  "text": "Dinner is ready!",
  "provider": "piper",
  "voice": "en_GB-jenny_dioco-medium",
  "volume": 40,
  "delayMinutes": 5
}
```

`delayMinutes` is optional. Use `0` for immediate playback, up to a maximum of `60`.

### `GET /api/music/status`

Returns whether Song Studio is available, plus any visible ElevenLabs usage snapshot.

### `POST /api/music`

```json
{
  "prompt": "A song to tell Arlo and Zoey it's time for daycare",
  "volume": 55
}
```

Generates exactly one 30-second song with ElevenLabs and returns it for preview/history. It does not automatically play on CastleCall.

### `GET /api/music/history`

Returns recent generated songs with preview URLs.

### `GET /api/music/file/:id`

Streams a generated song for browser preview.

### `POST /api/music/replay/:id`

Announces a previously generated song through the CastleCall speakers.

### `DELETE /api/music/history/:id`

Removes a song from local song history.

### `GET /api/history`

Returns recent announcement history.

### `POST /api/replay/:id`

Replays a history entry by ID.

### `GET /api/status`

Returns playback status.

## Running as a Service

Update `castlecall.service` for your user and path, then:

```bash
sudo cp castlecall.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable castlecall
sudo systemctl start castlecall
```

## Tips

- If `sox` is installed, volume scaling uses `play`; otherwise playback falls back to `aplay`.
- Song Studio needs `sox/play` plus `libsox-fmt-mp3` because ElevenLabs music is cached as MP3.
- If Song Studio replay fails with `no handler for file extension 'mp3'`, install `libsox-fmt-mp3`.
- If you are testing locally on Windows, use browser preview first. Device playback behavior is aimed at the Pi/Linux deployment.
- Cached files are stored under `/tmp/castlecall-cache`.

## MCP Server

An MCP server is available for integrating CastleCall with AI agents (Claude Desktop, Claude Code, etc.):

[castlecall-mcp](https://github.com/ctf2009/castlecall-mcp) — Exposes an `announce` tool over stdio transport, supporting both Piper and ElevenLabs providers.

## License

[MIT](LICENSE)
