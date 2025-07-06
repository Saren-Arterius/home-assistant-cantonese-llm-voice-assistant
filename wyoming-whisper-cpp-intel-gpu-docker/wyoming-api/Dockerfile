FROM debian:bookworm-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    netcat-traditional \
    python3-pip \
    python3-venv

RUN \
    git clone https://github.com/ser/wyoming-whisper-api-client.git wyoming-whisper-api-client \
    && cd wyoming-whisper-api-client \
    && script/setup

WORKDIR /wyoming-whisper-api-client
COPY const.py /wyoming-whisper-api-client/wyoming_whisper_api_client/const.py 
COPY handler.py /wyoming-whisper-api-client/wyoming_whisper_api_client/handler.py 


HEALTHCHECK --start-period=10m \
    CMD echo '{ "type": "describe" }' \
    | nc -w 1 localhost 7891 \
    | grep -iq "whisper-cpp" \
    || exit 1
