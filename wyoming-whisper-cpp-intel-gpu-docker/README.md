# Wyoming Whisper.cpp for Intel GPUs in Docker

Run an Intel GPU-accelerated 
[Wyoming protocol](https://github.com/rhasspy/wyoming) speech-to-text service
for your [Home Asssistant](https://github.com/home-assistant/core) in Docker.

Utilizes [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and
[Wyoming Whisper API client](https://github.com/ser/wyoming-whisper-api-client).

Tested on an Intel Arc A380.

## Hardware requirements

- Intel UHD Graphics for 11th generation Intel processors or newer
- Intel Iris Xe graphics
- Intel Arc graphics
- Intel Server GPU
- Intel Data Center GPU Flex Series
- Intel Data Center GPU Max Series

## Installation

- Open the `docker-compose.yaml` and change the necessary values like user and
  path for all services.
- Ensure the `group_add` matches your `render` group id.
- Install by running `docker compose up -d`.

## Usage

Add this as a service for the Wyoming Integration. When setting it up, enter your host IP (`127.0.0.1` if you run the container on the same host and HA is in a container too) and port `7891`.

The initial request will be relatively slow, but subsequent ones will be significantly faster.

## Improving accuracy

To improve accuracy, especially of difficult, uncommon words, you may use the initial prompt option.
In the `.env` file, simply change the value of
```
- PROMPT=""
```
It can set to words that are common in your commands, words that whisper.cpp is having difficulty understanding, or some brief instructions.
It seems to work best when you just give it all the areas, devices and actions that control them, without any particular structure, like so:
```
- PROMPT="turn off turn on open close stop play run set timer cancel temperature degrees weather tv lights lamp curtains roomba thermostat AC bedroom kitchen entryway corridor living room gym"
```

## Changing model

By default, the container is set to use `large-v2`, but you are free to set `MODEL` environment variable in the `.env` file to [any supported model](https://github.com/ggerganov/whisper.cpp/blob/d682e150908e10caa4c15883c633d7902d385237/models/download-ggml-model.sh#L28).
