---
name: transcribe
description: >-
  This skill should be used when a Telegram voice or audio message arrives
  with attachment_kind "voice" or "audio" in the channel meta, or when the
  user asks to "transcribe", "what did they say", or "listen to this voice message".
  Transcribes audio files to text using local whisper-cli.
allowed-tools:
  - Bash
  - Read
---

# Voice/Audio Transcription

Transcribe Telegram voice and audio messages to text using a local whisper-cli binary.

## When This Triggers

A Telegram message arrives with `attachment_kind` set to `voice` or `audio` and an `attachment_file_id` in the channel meta.

## Workflow

1. Download the attachment using the official plugin's `download_attachment` tool with the `file_id` from `attachment_file_id` in the channel meta. The tool returns a local file path.

2. Read the transcription config:
```bash
cat ~/.claude/channels/telegram/command-config.json | grep -A5 '"transcription"'
```

3. Convert and transcribe using the binary and model from config:
```bash
AUDIO_PATH="<downloaded file path>"
WAV_PATH="${AUDIO_PATH%.*}.wav"
ffmpeg -i "$AUDIO_PATH" -ar 16000 -ac 1 -y "$WAV_PATH" 2>/dev/null
whisper-cli -m "<model path from config>" -l "<language from config>" --no-timestamps -f "$WAV_PATH" 2>/dev/null
rm -f "$WAV_PATH"
```

4. Use the transcribed text as the user's message and respond accordingly.

## If Transcription Fails

If `whisper-cli` or `ffmpeg` is not installed, or the config is missing, respond to the Telegram user explaining that voice transcription is not configured and ask them to type their message instead.

## Config Reference

Transcription settings in `~/.claude/channels/telegram/command-config.json`:
```json
{
  "transcription": {
    "binary": "whisper-cli",
    "model": "/path/to/ggml-base.en.bin",
    "language": "en"
  }
}
```
