#!/usr/bin/env bash
set -euo pipefail

# CastleCall setup script
# Run this after cloning: ./setup.sh

VOICES_DIR="${HOME}/.local/share/piper/voices"
DEFAULT_VOICE="en_GB-jenny_dioco-medium"
VOICE_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/jenny_dioco/medium"

echo ""
echo "  🏰 CastleCall Setup"
echo "  ==================="
echo ""

# --- 1. Check for Node.js ---
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js 18+ first."
  echo "   https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ is required (found v${NODE_VERSION})."
  exit 1
fi
echo "✓ Node.js $(node -v)"

# --- 2. Check for Piper TTS ---
if command -v piper &> /dev/null; then
  echo "✓ Piper TTS found: $(which piper)"
else
  echo ""
  echo "⚠ Piper TTS not found on PATH."
  echo ""
  echo "  Install options:"
  echo "    1) sudo apt-get install piper       (Debian/Ubuntu)"
  echo "    2) pip install piper-tts             (pip)"
  echo "    3) Download binary from:"
  echo "       https://github.com/rhasspy/piper/releases"
  echo ""

  ARCH=$(uname -m)
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "x86_64" ]; then
    read -rp "  Attempt automatic binary install for ${ARCH}? [y/N] " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
      PIPER_URL="https://github.com/rhasspy/piper/releases/latest/download/piper_linux_${ARCH}.tar.gz"
      echo "  Downloading from ${PIPER_URL}..."
      TMP_DIR=$(mktemp -d)
      curl -fsSL "$PIPER_URL" -o "${TMP_DIR}/piper.tar.gz"
      tar -xzf "${TMP_DIR}/piper.tar.gz" -C "${TMP_DIR}"
      sudo mv "${TMP_DIR}/piper/piper" /usr/local/bin/piper
      rm -rf "${TMP_DIR}"
      echo "✓ Piper installed to /usr/local/bin/piper"
    else
      echo "  Skipping Piper install. You can install it later and update PIPER_PATH in .env."
    fi
  else
    echo "  Unrecognized architecture: ${ARCH}. Please install Piper manually."
  fi
fi

# --- 3. Download default voice ---
mkdir -p "$VOICES_DIR"

if [ -f "${VOICES_DIR}/${DEFAULT_VOICE}.onnx" ]; then
  echo "✓ Default voice already downloaded: ${DEFAULT_VOICE}"
else
  echo ""
  echo "  Downloading default voice: ${DEFAULT_VOICE}..."
  curl -fsSL "${VOICE_BASE_URL}/${DEFAULT_VOICE}.onnx" -o "${VOICES_DIR}/${DEFAULT_VOICE}.onnx"
  curl -fsSL "${VOICE_BASE_URL}/${DEFAULT_VOICE}.onnx.json" -o "${VOICES_DIR}/${DEFAULT_VOICE}.onnx.json"
  echo "✓ Voice downloaded to ${VOICES_DIR}/"
fi

# --- 4. Environment file ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "${SCRIPT_DIR}/.env" ]; then
  cp "${SCRIPT_DIR}/.env.example" "${SCRIPT_DIR}/.env"
  echo "✓ Created .env from .env.example (edit to customize)"
else
  echo "✓ .env already exists"
fi

# --- 5. Install Node dependencies ---
echo ""
echo "  Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent
echo "✓ Dependencies installed"

echo ""
echo "  ✅ Setup complete!"
echo ""
echo "  Start CastleCall:"
echo "    npm start          (production)"
echo "    npm run dev        (development, auto-reload)"
echo ""
echo "  Then open http://localhost:3000 in your browser."
echo ""
