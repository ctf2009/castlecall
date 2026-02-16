# CastleCall Planning

## Voice Update (Current)

- Default Piper voice has been switched to `en_GB-jenny_dioco-medium`.
- Reason: this is a closer accent to Australian English than the previous default, and is available in Piper's official voice catalog.
- Note: as of February 16, 2026, Piper does not list a native `en_AU-*` voice key in `voices.json`.

## ElevenLabs Integration Plan

## Goals

- Add optional ElevenLabs cloud TTS while keeping Piper as a fully local default.
- Keep API shape simple and mostly backward compatible.
- Allow choosing provider globally and per-announcement.
- Preserve current playback/output path (WAV file then speaker playback).

## Non-Goals (Phase 1)

- No user accounts or per-user ElevenLabs keys.
- No streaming playback optimization in first cut.
- No queueing redesign beyond current single-playback behavior.

## Proposed Architecture

- Keep `src/tts.js` as orchestration entrypoint.
- Split provider logic:
  - `src/tts/providers/piper.js`
  - `src/tts/providers/elevenlabs.js`
- Add a small provider router:
  - Select provider from request (if provided), else config default.
  - Validate supported providers.
- Normalize provider output:
  - Each provider returns a generated WAV file path.
  - Existing `aplay`/`sox` playback flow remains shared.

## Configuration Changes

Add to `.env.example`:

- `TTS_PROVIDER=piper`
- `ELEVENLABS_API_KEY=`
- `ELEVENLABS_VOICE_ID=`
- `ELEVENLABS_MODEL_ID=eleven_multilingual_v2`
- `ELEVENLABS_OUTPUT_FORMAT=pcm_22050`
- `ELEVENLABS_TIMEOUT_MS=15000`

Behavior:

- If provider is `piper`, no ElevenLabs config required.
- If provider is `elevenlabs`, fail fast on startup if key/voice ID are missing.

## API Changes

### Existing Endpoint

`POST /api/announce` request body additions:

- `provider` (optional): `"piper" | "elevenlabs"`
- `voice` remains provider-specific (existing field retained for compatibility).

### Optional New Endpoint

`GET /api/providers`

- Returns enabled providers and current default provider.
- Helps UI present provider choices safely.

## UI Changes

- Add provider dropdown near voice selector.
- On provider change:
  - Fetch compatible voices for that provider.
  - Keep current text/volume behavior unchanged.
- Show clear error toast for upstream provider failures (auth, quota, timeout).

## Error Handling and Reliability

- Map ElevenLabs errors to user-friendly messages:
  - 401/403 -> invalid API key
  - 429 -> rate limit/quota
  - 5xx/timeout -> provider unavailable
- Add optional fallback mode (config flag) to Piper when ElevenLabs fails:
  - `ELEVENLABS_FALLBACK_TO_PIPER=true|false`

## Security and Privacy

- Never log ElevenLabs API key.
- Redact auth headers from any debug output.
- Document that announcement text is sent to a third-party service when using ElevenLabs.

## Testing Plan

- Unit tests:
  - Provider selection and config validation.
  - ElevenLabs error mapping.
- Integration tests:
  - `POST /api/announce` with mocked ElevenLabs responses.
  - Fallback behavior (if enabled).
- Manual tests:
  - Local Piper-only flow.
  - ElevenLabs success/failure cases.

## Implementation Phases

1. Provider abstraction + config model changes.
2. ElevenLabs provider module + HTTP client integration.
3. API/UI provider selection support.
4. Error handling polish and fallback behavior.
5. Tests + docs update + deployment notes.

## Rollout Strategy

1. Merge with default `TTS_PROVIDER=piper`.
2. Deploy without ElevenLabs env vars (no behavior change).
3. Add ElevenLabs env vars and test with provider explicitly selected.
4. Optionally switch default provider after validation.
