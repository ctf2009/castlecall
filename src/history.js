const MAX_HISTORY = 50;
const announcementHistory = [];
const songHistory = [];

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function trimHistory(list) {
  if (list.length > MAX_HISTORY) {
    list.length = MAX_HISTORY;
  }
}

function addEntry(text, voice, volume = 40, provider = "piper") {
  const entry = {
    id: createId(),
    text,
    voice,
    volume,
    provider,
    timestamp: new Date().toISOString(),
  };

  announcementHistory.unshift(entry);
  trimHistory(announcementHistory);
  return entry;
}

function getHistory() {
  return announcementHistory;
}

function getEntryById(id) {
  return announcementHistory.find((entry) => entry.id === id);
}

function removeEntryById(id) {
  const index = announcementHistory.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return null;
  }

  const [removed] = announcementHistory.splice(index, 1);
  return removed;
}

function addSongEntry({ prompt, volume = 40, filePath, cached = false, durationMs = 30000 }) {
  const entry = {
    id: createId(),
    prompt,
    volume,
    filePath,
    cached,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  songHistory.unshift(entry);
  trimHistory(songHistory);
  return entry;
}

function getSongHistory() {
  return songHistory;
}

function getSongEntryById(id) {
  return songHistory.find((entry) => entry.id === id);
}

function removeSongEntryById(id) {
  const index = songHistory.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return null;
  }

  const [removed] = songHistory.splice(index, 1);
  return removed;
}

module.exports = {
  addEntry,
  addSongEntry,
  getEntryById,
  getHistory,
  getSongEntryById,
  getSongHistory,
  removeEntryById,
  removeSongEntryById,
};
