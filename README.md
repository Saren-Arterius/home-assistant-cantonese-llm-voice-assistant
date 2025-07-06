# Saren's Cantonese LLM Voice Assistant config for Home Assistant v0.0.2-4
Transform your Cantonese-speaking Hong Kong home to use LLMs in Home Assistant without language barriers.

See it in action: https://www.youtube.com/watch?v=AsE5OYmnYws

# What to Expect
- Natural Cantonese Conversation with AI with fairly good UX. Capable of controlling most of your IoT devices without scripting.
- Abusing HA's `todo` as AI's Persistent Memory.
- Tool calling via custom Node.js APIs for advanced integrations without touching HA's DSL.
  - Fetching KMB ETAs.
  - Fetching HKO's weather RSS, including radar images. Radar images will be analyzed by calling a SOTA multimodal LLM.
- LLMs capable of reading YAML documentation before setting up automation.
- ~1s Speech-To-Text (STT) time for common voice commands using Intel 13900H's iGPU.

# Caveats
- STT may have lower accuracy compared to cloud-based voice input methods.
- STT is currently unreliable in performance and may fail to recognize speech (though a script exists to force restart, minimizing impact).
- While mostly intelligent (人工智能), it can sometimes be unintelligent (人工智障). Be patient and try to speak as clearly as possible (both pronunciation and communication).
- For now: No "remind me in 5 minutes." No internet search. No playing music or video.

# Requirements
- Intel iGPU with **correctly installed host drivers** for Docker passthrough (e.g., `intel-opencl-icd` on Linux). (May work on CPU/CUDA, but custom optimizations for Intel iGPU may cause issues).
- 16GB RAM (Three instances of whisper.cpp are used for classical time and space tradeoff).
- Any modern tablet PC/Android with a Chrome browser.
- Home Assistant with **HACS (Home Assistant Community Store)** is recommended for managing custom frontend components, as the paths provided assume its structure.
- Docker with **`docker-compose`** (Typically included with Docker Desktop, but may be a separate install on Linux)
- OpenRouter API key for LLMs (or Local LLMs [llama.cpp/ollama] if your hardware is sufficiently powerful).
- Some programming knowledge to modify the configuration with correct syntax.

# Installation and Setup
1. Clone this repo and cd `home-assistant-cantonese-llm-voice-assistant`.

2. Go to `wyoming-whisper-cpp-intel-gpu-docker`. This is the Speech-To-Text core.
    1. If you prefer not to use multiple whisper.cpp instances, edit `docker-compose.yaml` and `haproxy/haproxy.cfg`.
    2. If your iGPU is weaker, edit `wyoming-api/handler.py`. Change `request_timeout` accordingly.
    3. Run `docker-compose up -d`.

3. Go to `extended_openai_conversation`. This is the LLM interaction core.
    1. Read `extended_openai_conversation/README.md` to set up the core plugin.

4. Set up `jarvis`. This is the core UI that integrates in-browser wake word + voice activity detection (VAD) and invokes the HA Voice Assistant pipeline.
    1. Go to `/profile/security` of your HA instance and create a permanent token. Edit line 7 of `main-ha.js` and replace it with `let token = '...';`. Alternatively, you can append ?token=XXX&pipeline_name=YYY to HA's dashboard URL to set parameters.
    2. Edit line 9 of `main-ha.js` for the pipeline name. To find the pipeline name, open the web inspector, inspect `/websocket`, and click Voice Assistant in HA. ![asd](https://drop.wtako.net/file/bf7026d94abe23bc8b90d7a146d31bcbf62cee35.png)
    3. The dashboard must include `-samsung` to activate jarvis. To change this, edit line 834.
    4. Copy the `jarvis` folder into HA's `config/www/community/jarvis`.
    5. Go to `/config/lovelace/resources` of your HA instance; add `/hacsfiles/jarvis/voice-loader.js?a=1` as a Javascript module.

5. Set up `llm-api`. This provides the (example) external interface for the LLM to fetch data or syntax documentation from the internet. Think of a low-grade MCP server.
    1. Go to `llm-api`.
    2. If you want HKO Radar analysis, edit `docker-compose.yml` to provide your own OpenRouter API key and Telegram bot details. Otherwise, remove the related API from `apis.json`.
    3. Edit `apis.json` and `kmb/index.js` so that the bus stations are relevant to your home and workplace, not mine. No changes are needed if you live at KAM TAI COURT and work near TST HAIPHONG ROAD.
    4. Run `docker-compose up -d`.

# Usage
1. Create a dashboard whose name includes `samsung` or other name you changed earlier setting up `jarvis`.
2. Allow microphone access to the web page.
3. Input token and pipeline name as mentioned in `jarvis` setup.
3. Say "**Hey Siri**" to activate the UI. It must be in English, and it must be "Hey Siri." It has the highest success rate and has never misfired for me. Change line 500 of `jarvis/main-ha.js` if you prefer otherwise.
4. Say "bumblebee" to reset the LLM context. 
5. If UI is activated:
    - Say "重新整理" to reload both the UI and LLM context.
    - Say "細聲d/大聲d/將音量設為50%" to set the volume of sounds and voices.
    - Say "冇你既事/你可以走啦" or anything dismissive to close the UI.
    - Ask questions about your home, bus ETAs, weather, etc. You can also tell the LLM to create automation or other tasks.
    - It is likely you can interrupt it when TTS is speaking by saying "**Hey Siri**."

# Licenses
- llm-api: GPLv3
- jarvis (main-ha.js and voice-loader.js): GPLv3
- System Prompts and Function list: CC0
- Other components has their own corresponding authors and licenses.
