const MAX_HISTORY = 50;
const history = [];

function addEntry(text, voice) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    text,
    voice,
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

module.exports = { addEntry, getHistory };
