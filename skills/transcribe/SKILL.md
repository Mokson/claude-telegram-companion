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

1. Download the attachment using the official plugin's `download_attachment` tool with the `file_id` from `attachment_file_id`. The tool returns a local file path.

2. Find whisper model and transcribe in a single Bash call:
```bash
AUDIO_PATH="<downloaded file path>"
WAV_PATH="${AUDIO_PATH%.*}.wav"
MODEL=$(ls ~/.local/share/whisper.cpp/models/ggml-base*.bin /opt/homebrew/share/whisper.cpp/models/ggml-base*.bin 2>/dev/null | head -1)
if [ -z "$MODEL" ]; then echo "ERROR: no whisper model found"; exit 1; fi
ffmpeg -i "$AUDIO_PATH" -ar 16000 -ac 1 -y "$WAV_PATH" 2>/dev/null
whisper-cli -m "$MODEL" --no-timestamps -f "$WAV_PATH" 2>/dev/null
rm -f "$WAV_PATH"
```

3. Use the transcribed text as the user's message and respond accordingly.

## If Transcription Fails

If `whisper-cli`, `ffmpeg`, or a model file is not found, tell the Telegram user that voice transcription is not set up and ask them to type their message instead.

Install with: `brew install whisper-cpp ffmpeg` and download a model to `~/.local/share/whisper.cpp/models/`.
