const MAX_HISTORY = 50;
const history = [];

function addEntry(text, voice, volume = 40, provider = "piper") {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    text,
    voice,
    volume,
    provider,
    timestamp: new Date().toISOString(),
  };

  history.unshift(entry);

  // Trim to max size
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }

  return entry;
}

function getHistory() {
  return history;
}

function getEntryById(id) {
  return history.find((entry) => entry.id === id);
}

module.exports = { addEntry, getHistory, getEntryById };
