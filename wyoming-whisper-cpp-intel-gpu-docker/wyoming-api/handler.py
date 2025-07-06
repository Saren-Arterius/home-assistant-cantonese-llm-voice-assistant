"""Event handler for clients of the server."""
import argparse
import httpx
import logging
import wave
import time

from io import BytesIO

from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioChunkConverter, AudioStop
from wyoming.event import Event
from wyoming.info import Describe, Info
from wyoming.server import AsyncEventHandler

_LOGGER = logging.getLogger(__name__)


class WhisperAPIEventHandler(AsyncEventHandler):
    """Event handler for clients."""

    def __init__(
        self,
        wyoming_info: Info,
        cli_args: argparse.Namespace,
        *args,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)

        self.cli_args = cli_args
        self.wyoming_info_event = wyoming_info.event()
        self.audio = bytes()
        self.audio_converter = AudioChunkConverter(
            rate=16000,
            width=2,
            channels=1,
        )

    async def handle_event(self, event: Event) -> bool:
        if AudioChunk.is_type(event.type):
            if not self.audio:
                _LOGGER.debug("Receiving audio")

            chunk = AudioChunk.from_event(event)
            chunk = self.audio_converter.convert(chunk)
            self.audio += chunk.audio

            return True

        if AudioStop.is_type(event.type):
            _LOGGER.debug("Audio stopped")
            text = "(Speech To Text failed)"
            try:
                async with httpx.AsyncClient() as client:
                    with BytesIO() as tmpfile:
                        with wave.open(tmpfile, 'wb') as wavfile:
                            wavfile.setparams((1, 2, 16000, 0, 'NONE', 'NONE'))
                            wavfile.writeframes(self.audio)
                            audio_duration_seconds = len(self.audio) / (16000 * 2)  # Assuming 16kHz, 16-bit, mono
                            if audio_duration_seconds < 5:
                                request_timeout = 3
                            elif audio_duration_seconds < 9:
                                request_timeout = 4.5
                            else:
                                request_timeout = 10
                            headers = {
                                "X-Audio-Duration-MS": str(int(audio_duration_seconds * 1000))
                            }
                            _LOGGER.info(repr(headers))
                            files = {
                                "file": ("audio.wav", tmpfile.getvalue(), "audio/wav")
                            }
                            params = {
                                "temperature": "0.0",
                                "temperature_inc": "0.2",
                                "response_format": "json"
                            }
                            start = time.time()
                            r = await client.post(self.cli_args.api, headers=headers, files=files, params=params, timeout=request_timeout)
                            end = time.time()
                            r.raise_for_status() # Raise an exception for HTTP errors
                            text = r.json()['text']
                            _LOGGER.info(f'Used {end - start} seconds: {text}')
            except Exception as e:
                _LOGGER.error(repr(e))
                _LOGGER.error("Speech To Text failed: %s", e)

            await self.write_event(Transcript(text=text).event())
            _LOGGER.debug("Completed request")

            # Reset
            self.audio = bytes()

            return False

        if Transcribe.is_type(event.type):
            _LOGGER.debug("Transcibe event")
            return True

        if Describe.is_type(event.type):
            await self.write_event(self.wyoming_info_event)
            _LOGGER.debug("Sent info")
            return True

        return True
