console.log('hello world from jarvis main');

const { useEffect } = React;
const { makeAutoObservable } = mobx;
const { Observer, observer } = mobxReactLite;

let token = '';
// let token = 'YOUR_TOKEN_HERE_AND_REMOVE_ME_AFTER_SET';
let pipeline_name = '';
// let token = '01jqpz9vap65xxce6ee0ke856r';

const BASE = '/hacsfiles/jarvis';

// --- Constants and Configuration ---
const HA_URL = 'https://' + location.host.replace('monitor-', 'ha-');
const EXIT_MAGIC = 'XXEXITXX';
const REFRESH_MAGIC = 'XXREFRESHXX';
const VOLUME_MAGIC = 'XXVOLUMEXX';

const WAKE_WORD_SPEECH_TIMEOUT = 7000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NIGHT_VOL_EXPONENT = 0.6;
let DAY_VOL = parseFloat(localStorage.getItem('day_volume') || '1');
let NIGHT_VOL = parseFloat(localStorage.getItem('night_volume') || '0.15848931925');
const STATE = {
    INITIALIZING: 0,
    IDLE: 1,                 // Hidden, listening for hotword
    WAKE_WORD_TRIGGERED: 2,  // Visible, waiting for VAD speech start/end or timeout
    SENDING_AUDIO: 3,        // VAD onSpeechEnd called, sending to HA, waiting for HA response
    PLAYING_TTS: 4,          // Playing audio response from HA
};

// --- MobX Store for UI State ---
class Store {
    alertMessage = null;
    alertExpire = 0;

    vaState = STATE.INITIALIZING;
    isUserSpeaking = false;
    voiceLastActiveAt = 0;

    lastSTT = '';
    lastSTTAnimState = 0; // 1 = fading out, 2 = changing pos, 0 = fading in or stable;

    lastTTS = '';
    lastTTSLength = 0;
    lastTTSAnimState = 0; // 1 = fading out, 2 = changing pos, 0 = fading in or stable;

    latestText = 0; // 0 = lastSTT, 1 = lastTTS

    currentTime = 0;
    constructor() {
        makeAutoObservable(this);
    }
}

const store = new Store();

// --- UI Components ---
const VoiceUI = observer(() => {
    const isVisible = store.vaState > STATE.IDLE;

    const filter = (() => {
        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) {
            return !store.isUserSpeaking ? 'saturate(0.3) opacity(0.3)' : '';
        }
        if (store.vaState === STATE.SENDING_AUDIO) return 'opacity(0.5)';
        return '';
    })();

    const stateToTransform = (num) => {
        if (num === 1) return 'translateY(-20px)';
        if (num === 2) return 'translateY(20px)';
        return 'translateY(0px)';
    };

    const stateToOpacity = (num, opacity = 1) => {
        if (num === 1 || num === 2) return 0;
        return opacity;
    };

    const handleOverlayClick = () => {
        if (store.vaState === STATE.PLAYING_TTS) {
            setVAState(STATE.WAKE_WORD_TRIGGERED); // Interrupt TTS and listen again
            return;
        }
        if (store.vaState === STATE.WAKE_WORD_TRIGGERED && !store.isUserSpeaking) {
            pipelineActive = false; // Cancel listening
            resetAudioStreamingState();
            setVAState(STATE.IDLE);
            return;
        }
        if (store.vaState === STATE.SENDING_AUDIO) {
            resetAll(false);
        }
    };

    return (
        <>
            <div style={{ display: 'none' }}>{store.currentTime}</div>
            <div className="voice-overlay"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    backdropFilter: 'blur(8px) brightness(0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    opacity: isVisible ? 1 : 0,
                    pointerEvents: isVisible ? 'auto' : 'none',
                    transition: 'opacity 0.5s ease-in-out',
                }}
                onClick={handleOverlayClick}
            >
                <dotlottie-player
                    src={BASE + "/vendor/ai.lottie"}
                    background="transparent"
                    speed={0.5}
                    style={{
                        width: '400px',
                        height: '400px',
                        filter: filter,
                        transition: 'filter 0.3s ease-in-out'
                    }}
                    loop
                    autoplay
                ></dotlottie-player>

                <div style={{
                    position: 'absolute',
                    textAlign: 'center',
                    width: '100%',
                    maxWidth: '1200px',
                    height: '80%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '5vh 0',
                }}>
                    <div style={{
                        position: 'relative',
                        fontSize: store.lastSTT.length > 90 ? '2em' : '3em',
                        transition: 'all 0.3s ease-in-out',
                        lineHeight: '1.3em',
                        transform: stateToTransform(store.lastSTTAnimState),
                        opacity: stateToOpacity(store.lastSTTAnimState, store.latestText === 0 ? 1 : 0.5)
                    }}>
                        {store.lastSTT}
                    </div>

                    <div style={{
                        position: 'relative',
                        fontSize: store.lastTTS.length > 90 ? '2em' : '3em',
                        transition: 'all 0.3s ease-in-out',
                        lineHeight: '1.3em',
                        transform: stateToTransform(store.lastTTSAnimState),
                        opacity: stateToOpacity(store.lastTTSAnimState, store.latestText === 1 ? 1 : 0.5)
                    }}>
                        {store.lastTTS}
                    </div>
                </div>
            </div>

            <div className="alert-overlay"
                style={{
                    display: 'flex',
                    width: '100vw',
                    height: '100vh',
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    zIndex: 2000,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(4px) brightness(0.65)',
                    transition: 'opacity 0.3s ease-in-out',
                    opacity: store.alertMessage && store.alertExpire > Date.now() ? 1 : 0,
                    pointerEvents: store.alertMessage && store.alertExpire > Date.now() ? 'auto' : 'none',
                }}
                onClick={() => {
                    store.alertExpire = 0;
                }}>

                <div style={{
                    backgroundColor: '#232323a0',
                    padding: '20px',
                    borderRadius: '20px',
                    maxWidth: '90vw',
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                }}
                    onClick={(e) => e.stopPropagation()}>
                    <div style={{ textAlign: 'center', fontSize: '1.5em', marginBottom: '1em' }}>
                        {store.alertMessage && store.alertMessage[0]}
                    </div>
                    <pre style={{
                        margin: 0,
                        padding: 0,
                        whiteSpace: 'pre-wrap',
                        fontSize: '0.85em',
                        overflow: 'auto',
                    }}>
                        {store.alertMessage && store.alertMessage[1]}
                    </pre>
                </div>
            </div>
        </>
    );
});


ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <Observer>{() => <VoiceUI />}</Observer>
    </React.StrictMode>
);

// --- Utility Functions ---
function panelAlert(content, title, expire = 10000) {
    store.alertMessage = [title, content];
    store.alertExpire = Date.now() + expire;
}

// --- Home Assistant Voice Integration Logic ---

// Global state variables
let myvad = null;
let haWebSocket = null;
let bumblebee = null;

let currentMessageId = 0;
let pipelineActive = false;
let haReadyForAudio = false;
let currentPipelineRunId = null;
let currentPipelineListRequestId = null;
let currentDeviceConfigRequestId = null;
let sttBinaryHandlerId = null;

let wakeWordTimeoutId = null;
let ttsAudioElement = null;
let conversationId = newConversationId();
const audioCache = {};

// Configuration
let HA_TOKEN = null;
let HA_ASSIST_PIPELINE_NAME = null;

function killTTS() {
    if (ttsAudioElement) {
        ttsAudioElement.pause();
        ttsAudioElement.src = '';
        ttsAudioElement.onended = null;
        ttsAudioElement.onerror = null;
        ttsAudioElement = null;
    }
}

async function fetchAndCacheAudio(url, short) {
    if (audioCache[url]) {
        return audioCache[url].cloneNode();
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audioCache[url] = audio; // Cache the audio element
        audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
        audio.addEventListener('error', () => URL.revokeObjectURL(audioUrl), { once: true });
        if (short) {
            setTimeout(() => {
                delete audioCache[url];
            }, 60000);
        }
        return audio.cloneNode(); // Return a clone for playback
    } catch (e) {
        console.error('Failed to fetch and cache audio:', url, e);
        return new Audio(url); // Fallback to direct New Audio if fetch fails
    }
}

async function playAudio(url) {
    let v = DAY_VOL;
    const currentHour = new Date().getHours();
    if (currentHour >= 23 || currentHour < 8) { // Between 11 PM and 8 AM
        v = NIGHT_VOL;
    }

    try {
        const audio = await fetchAndCacheAudio(url);
        audio.volume = v;
        return audio.play().catch(e => console.error('Error playing audio from cache:', e));
    } catch (e) {
        console.error('Error getting audio from cache/fetching, falling back:', e);
        const audio = new Audio(url);
        audio.volume = v;
        return audio.play().catch(e => console.error('Error playing audio fallback:', e));
    }
}

function setVolume(volume) {
    let newVolume = DAY_VOL * 100; // Current day volume as percentage
    if (typeof volume === 'string') {
        const trimmedVolume = volume.trim();
        if (trimmedVolume.startsWith('+')) {
            const increment = parseInt(trimmedVolume.substring(1)) || 10;
            newVolume += increment;
        } else if (trimmedVolume.startsWith('-')) {
            const decrement = parseInt(trimmedVolume.substring(1)) || 10;
            newVolume -= decrement;
        } else {
            newVolume = parseInt(trimmedVolume);
        }
    } else {
        newVolume = volume;
    }

    newVolume = Math.max(0, Math.min(100, newVolume));
    DAY_VOL = newVolume / 100;
    NIGHT_VOL = (newVolume ** NIGHT_VOL_EXPONENT) / 100; // Maintain proportion if desired
    localStorage.setItem('day_volume', DAY_VOL.toString());
    localStorage.setItem('night_volume', NIGHT_VOL.toString());
    panelAlert(<h1><center>Volume set to {parseInt(newVolume)}</center></h1>, null, 3000);
    console.log(`Volume set to: DAY_VOL=${DAY_VOL}, NIGHT_VOL=${NIGHT_VOL}`);
}

function getStateName(stateValue) {
    return Object.keys(STATE).find(key => STATE[key] === stateValue) || 'UNKNOWN_STATE';
}

function setVAState(newState, ...args) {
    const oldState = store.vaState;
    console.log(`State transition: ${getStateName(oldState)} -> ${getStateName(newState)}`);
    store.vaState = newState;

    if (wakeWordTimeoutId) {
        clearTimeout(wakeWordTimeoutId);
        wakeWordTimeoutId = null;
    }

    killTTS();

    switch (newState) {
        case STATE.IDLE:
            pipelineActive = false;
            resetAudioStreamingState();
            if (myvad && myvad.listening) myvad.pause();
            if (oldState >= STATE.WAKE_WORD_TRIGGERED) {
                playAudio(BASE + '/cancel.mp3');
            }
            if (bumblebee) bumblebee.start();
            break;

        case STATE.WAKE_WORD_TRIGGERED:
            pipelineActive = false;
            store.isUserSpeaking = false;
            const startVADAndSetTimeout = async () => {
                if (store.vaState !== STATE.WAKE_WORD_TRIGGERED) return;
                if (!myvad) {
                    panelAlert("Voice detection system is not ready.");
                    setVAState(STATE.IDLE);
                    return;
                }
                if (!myvad.listening) myvad.start();
                playAudio(BASE + '/activate.mp3');
                wakeWordTimeoutId = setTimeout(() => {
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && !pipelineActive) {
                        if (myvad && myvad.listening) myvad.pause();
                        setVAState(STATE.IDLE);
                    }
                }, WAKE_WORD_SPEECH_TIMEOUT);
            };
            (async () => {
                if (store.vaState !== STATE.WAKE_WORD_TRIGGERED) return;
                if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
                    try {
                        await connectWebSocket();
                        if (!myvad) await initializeVAD();
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) startVADAndSetTimeout();
                    } catch (err) {
                        panelAlert("Failed to prepare for voice input: " + err.message);
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) setVAState(STATE.IDLE);
                    }
                } else if (!myvad) {
                    try {
                        await initializeVAD();
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) startVADAndSetTimeout();
                    } catch (err) {
                        panelAlert("Failed to initialize voice detection: " + err.message);
                        if (store.vaState === STATE.WAKE_WORD_TRIGGERED) setVAState(STATE.IDLE);
                    }
                } else {
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED) startVADAndSetTimeout();
                }
            })();
            break;

        case STATE.SENDING_AUDIO:
            if (!pipelineActive) {
                setVAState(STATE.IDLE);
                return;
            }
            playAudio(BASE + '/analyzing.mp3');
            break;

        case STATE.PLAYING_TTS:
            const ttsUrl = args[0];
            if (!ttsUrl) {
                setVAState(STATE.WAKE_WORD_TRIGGERED);
                return;
            }
            pipelineActive = false;
            killTTS();

            (async () => {
                try {
                    ttsAudioElement = await fetchAndCacheAudio(ttsUrl, true);
                    ttsAudioElement.playbackRate = store.lastTTSLength > 20 ? 1.5 : 1.25;
                    ttsAudioElement.onended = () => {
                        ttsAudioElement = null;
                        if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                    };
                    ttsAudioElement.onerror = (e) => {
                        // panelAlert("Error playing assistant response. E2: " + e.message);
                        ttsAudioElement = null;
                        if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                    };
                    let v = DAY_VOL;
                    const currentHour = new Date().getHours();
                    if (currentHour >= 23 || currentHour < 8) { // Between 11 PM and 8 AM
                        v = NIGHT_VOL;
                    }
                    ttsAudioElement.volume = v;
                    await ttsAudioElement.play();
                } catch (e) {
                    panelAlert("Could not play assistant response. E2: " + e.message);
                    if (store.vaState === STATE.PLAYING_TTS) setVAState(STATE.WAKE_WORD_TRIGGERED);
                }
            })();
            break;
    }
}


if (token) {
    localStorage.setItem('ha_token', token);
}

if (pipeline_name) {
    localStorage.setItem('ha_pipeline_name', pipeline_name);
}

function getConfigValue(paramName, storageKey) {
    const urlParams = new URLSearchParams(window.location.search);
    const valueFromUrl = urlParams.get(paramName);
    if (valueFromUrl) {
        localStorage.setItem(storageKey, valueFromUrl);
        urlParams.delete(paramName);
        const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
        window.history.replaceState({}, document.title, newUrl);
        return valueFromUrl;
    }
    return localStorage.getItem(storageKey);
}

function getHAToken() { return getConfigValue('token', 'ha_token'); }
function getHAPipelineName() { return getConfigValue('pipeline_name', 'ha_pipeline_name'); }

async function initializeApp() {
    setVAState(STATE.INITIALIZING);
    HA_TOKEN = getHAToken();
    HA_ASSIST_PIPELINE_NAME = getHAPipelineName();
    if (!HA_TOKEN || !HA_ASSIST_PIPELINE_NAME) {
        panelAlert("Configuration Incomplete", "Please provide Home Assistant token and pipeline name as URL parameters (e.g., ?token=...&pipeline_name=...). They will be saved to local storage. " + location);
        console.error("Configuration incomplete.");
    }

    // Pre-cache necessary audio files
    await Promise.all([
        fetchAndCacheAudio(BASE + '/activate.mp3'),
        fetchAndCacheAudio(BASE + '/cancel.mp3'),
        fetchAndCacheAudio(BASE + '/analyzing.mp3')
    ]).catch(e => console.warn('Failed to pre-cache audio files:', e));


    try {
        bumblebee = new Bumblebee();
        bumblebee.setWorkersPath(BASE + '/vendor/bumblebee/workers');
        // bumblebee.addHotword('computer');
        // bumblebee.addHotword('jarvis');
        bumblebee.addHotword('bumblebee');
        bumblebee.addHotword('hey_siri');
        bumblebee.setSensitivity(1);
        bumblebee.setMicVolume(1.2);
        bumblebee.on('hotword', handleHotword);
    } catch (error) {
        panelAlert("Error initializing hotword engine: " + error.message);
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
    } catch (err) {
        panelAlert('Microphone access is required: ' + err.message);
        return;
    }

    if (HA_TOKEN && HA_ASSIST_PIPELINE_NAME) {
        try {
            await connectWebSocket();
        } catch (error) {
            panelAlert("Could not connect to Home Assistant: " + error.message);
        }
    }

    if (bumblebee) {
        try {
            await bumblebee.start();
        } catch (error) {
            panelAlert("Failed to start hotword detection: " + error.message);
        }
    }
    setVAState(STATE.IDLE);
}


function resetAll(notify = true) {
    pipelineActive = false;
    resetAudioStreamingState();
    conversationId = newConversationId();
    setVAState(STATE.IDLE);
    if (notify) {
        panelAlert(<h1><center>AI Reset Success</center></h1>, null, 3000);
    }
}

async function handleHotword(hotwordDetails) {
    const hotword = typeof hotwordDetails === 'string' ? hotwordDetails : hotwordDetails.hotword;
    if (hotword === 'bumblebee') {
        resetAll();
        return;
    }
    let oldConvoId = conversationId;
    // reset convo id (prevent state fuckup if SENDING_AUDIO)
    if (store.vaState === STATE.SENDING_AUDIO || (store.vaState === STATE.WAKE_WORD_TRIGGERED && pipelineActive)) {
        conversationId = newConversationId();
    }
    // reset convo id if convo too old
    if (Date.now() - store.voiceLastActiveAt > 300 * 1000) {
        conversationId = newConversationId();
    }
    store.voiceLastActiveAt = Date.now();
    if (conversationId !== oldConvoId || store.vaState === STATE.IDLE) {
        store.lastSTT = '';
        store.lastTTS = '幫緊你幫緊你...';
    }

    HA_TOKEN = getHAToken();
    HA_ASSIST_PIPELINE_NAME = getHAPipelineName();
    if (!HA_TOKEN || !HA_ASSIST_PIPELINE_NAME) {
        panelAlert("HA Token or Pipeline Name missing. Cannot process hotword.");
        setVAState(STATE.IDLE);
        return;
    }
    setVAState(STATE.WAKE_WORD_TRIGGERED, hotwordDetails);
}


function connectWebSocket() {
    return new Promise((resolve, reject) => {
        if (haWebSocket && haWebSocket.readyState === WebSocket.OPEN) {
            if (!myvad) initializeVAD().then(resolve).catch(reject); else resolve();
            return;
        }
        if (haWebSocket && haWebSocket.readyState === WebSocket.CONNECTING) {
            reject(new Error("WebSocket connection already in progress.")); return;
        }
        if (!HA_TOKEN) {
            reject(new Error("Home Assistant Token not available.")); return;
        }
        const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
        haWebSocket = new WebSocket(wsUrl);

        haWebSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'auth_required':
                    haWebSocket.send(JSON.stringify({ type: 'auth', access_token: HA_TOKEN }));
                    break;
                case 'auth_ok':
                    initializeVAD().then(() => {
                        requestDeviceAndPipelineInfo();
                        resolve();
                    }).catch(reject);
                    break;
                case 'auth_invalid':
                    localStorage.removeItem('ha_token'); HA_TOKEN = null;
                    panelAlert('HA token is invalid. Please provide a new token and refresh.');
                    haWebSocket.close();
                    reject(new Error('WebSocket auth failed: Invalid token.'));
                    break;
                case 'result':
                    if (message.id === currentPipelineRunId && !message.success) console.error('HA WS: assist_pipeline/run command failed:', message.error);
                    break;
                case 'event': handlePipelineEvent(message.event); break;
                case 'pong': break;
                default: break;
            }
        };
        haWebSocket.onclose = () => {
            haWebSocket = null;
            if (store.vaState > STATE.IDLE) {
                panelAlert("Connection to Home Assistant lost.");
                setVAState(STATE.IDLE);
            }
            if (navigator.onLine && HA_TOKEN) {
                setTimeout(() => {
                    if (!haWebSocket) connectWebSocket().catch(err => console.error('VA: WebSocket auto-reconnect failed:', err.message));
                }, 5000);
            }
        };
        haWebSocket.onerror = (error) => {
            if (store.vaState > STATE.IDLE) panelAlert("Connection error with Home Assistant.");
            reject(new Error('WebSocket connection error.'));
        };
    });
}

function initializeVAD() {
    return new Promise(async (resolve, reject) => {
        if (myvad) { resolve(); return; }
        try {
            if (typeof vad === 'undefined' || typeof vad.MicVAD === 'undefined') return reject(new Error("VAD library not found."));
            myvad = await vad.MicVAD.new({
                model: 'v5',
                onnxWASMBasePath: BASE + '/vendor/ort/',
                baseAssetPath: BASE + '/vendor/vad/',
                redemptionFrames: 20,
                onSpeechRealStart: () => {
                    store.voiceLastActiveAt = Date.now();
                    store.isUserSpeaking = true;
                    if (wakeWordTimeoutId) clearTimeout(wakeWordTimeoutId);
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED) initiateHAPipelineRun();
                },
                onSpeechEnd: async (finalAudioBuffer) => {
                    if (myvad && myvad.listening) myvad.pause();
                    if (store.vaState === STATE.WAKE_WORD_TRIGGERED && pipelineActive) {
                        await processAndSendAudio(finalAudioBuffer);
                        setVAState(STATE.SENDING_AUDIO);
                    } else if (!pipelineActive && store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                        panelAlert("Could not process your request.");
                        setVAState(STATE.IDLE);
                    }
                },
            });
            resolve();
        } catch (error) { myvad = null; reject(error); }
    });
}

function sendMessage(message) {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) return -1;
    currentMessageId++;
    try {
        haWebSocket.send(JSON.stringify({ ...message, id: currentMessageId }));
        return currentMessageId;
    } catch (error) { return -1; }
}

function requestDeviceAndPipelineInfo() {
    currentDeviceConfigRequestId = sendMessage({ type: "mobile_app/get_config" });
    currentPipelineListRequestId = sendMessage({ type: "assist_pipeline/pipeline/list" });
}

function resetAudioStreamingState() {
    haReadyForAudio = false;
    sttBinaryHandlerId = null;
}

function float32ToInt16(buffer) {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7FFF;
    return buf;
}

function newConversationId() { return 'monitor-' + Date.now(); }

async function processAndSendAudio(audio) {
    if (!pipelineActive || !(store.vaState === STATE.WAKE_WORD_TRIGGERED || store.vaState === STATE.SENDING_AUDIO)) return;
    if (haReadyForAudio) {
        await sendAudioToHA(audio);
        sendHAStreamEnd();
    }
}

async function lastSTTAnimation(newText) {
    store.latestText = 0; store.lastSTTAnimState = 1; await sleep(300);
    store.lastSTTAnimState = 2; store.lastSTT = newText; await sleep(300);
    store.lastSTTAnimState = 0;
}

async function lastTTSAnimation(newText) {
    store.lastTTSLength = newText.length; store.latestText = 1; store.lastTTSAnimState = 1; await sleep(300);
    store.lastTTSAnimState = 2; store.lastTTS = newText; await sleep(300);
    store.lastTTSAnimState = 0;
}

function handlePipelineEvent(event) {
    if (!pipelineActive && event.type !== 'tts-end') {
        if (event.type === 'error') {
            panelAlert(`Voice assistant error: ${event.data.message}`);
            setVAState(STATE.IDLE);
        }
        return;
    }

    switch (event.type) {
        case 'run-start':
            haReadyForAudio = true;
            if (event.data?.runner_data && typeof event.data.runner_data.stt_binary_handler_id === 'number') {
                sttBinaryHandlerId = event.data.runner_data.stt_binary_handler_id;
            } else {
                sttBinaryHandlerId = null;
                pipelineActive = false;
                setVAState(STATE.IDLE);
                panelAlert("Voice assistant configuration error from server.");
            }
            break;
        case 'stt-end': lastSTTAnimation(event.data.stt_output.text.trim()); break;
        case 'tts-start':
            let ttsText = event.data.tts_input.trim();
            if (ttsText.includes('Provider')) {
                setVAState(STATE.IDLE);
                panelAlert("AI Error. Please try again.");
                return;
            }
            if (ttsText.includes(EXIT_MAGIC)) { setVAState(STATE.IDLE); return; }
            if (ttsText.includes(REFRESH_MAGIC)) { location.reload(); return; }
            if (ttsText.includes(VOLUME_MAGIC)) {
                const volumeMatch = ttsText.match(new RegExp(`${VOLUME_MAGIC}\\s*([+-]?\\d+)?`));
                if (volumeMatch && volumeMatch[1] !== undefined) {
                    setVolume(volumeMatch[1]);
                } else if (ttsText.includes(`${VOLUME_MAGIC} +`)) {
                    setVolume('+10');
                } else if (ttsText.includes(`${VOLUME_MAGIC} -`)) {
                    setVolume('-10');
                }
                resetAll(false);
                return;
            }
            lastTTSAnimation(ttsText);
            break;
        case 'tts-end':
            if (event.data?.tts_output?.url) {
                const ttsUrl = (event.data.tts_output.url.startsWith('http') ? '' : HA_URL) + event.data.tts_output.url;
                if (store.vaState === STATE.SENDING_AUDIO || store.vaState === STATE.WAKE_WORD_TRIGGERED) {
                    setVAState(STATE.PLAYING_TTS, ttsUrl);
                }
            }
            break;
        case 'run-end':
            pipelineActive = false; currentPipelineRunId = null; resetAudioStreamingState();
            if (store.vaState > STATE.IDLE && store.vaState < STATE.PLAYING_TTS) setVAState(STATE.IDLE);
            break;
        case 'error':
            panelAlert(`Voice assistant error: ${event.data.message} (Code: ${event.data.code})`);
            pipelineActive = false; currentPipelineRunId = null; resetAudioStreamingState();
            setVAState(STATE.IDLE);
            break;
    }
}
async function sendAudioToHA(audioBuffer) {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN || !pipelineActive || !haReadyForAudio || sttBinaryHandlerId === null) {
        if (sttBinaryHandlerId === null) panelAlert("Error sending audio: missing handler ID.");
        pipelineActive = false; setVAState(STATE.IDLE);
        return;
    }
    const int16Audio = float32ToInt16(audioBuffer);
    const audioBytes = int16Audio.buffer;
    const prefixedBuffer = new ArrayBuffer(1 + audioBytes.byteLength);
    const view = new DataView(prefixedBuffer);
    view.setUint8(0, sttBinaryHandlerId);
    new Uint8Array(prefixedBuffer, 1).set(new Uint8Array(audioBytes));
    try {
        haWebSocket.send(prefixedBuffer);
    } catch (error) { pipelineActive = false; setVAState(STATE.IDLE); }
}

function sendHAStreamEnd() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN || !pipelineActive || sttBinaryHandlerId === null) {
        if (sttBinaryHandlerId === null) panelAlert("Error ending audio stream: missing handler ID.");
        pipelineActive = false; setVAState(STATE.IDLE);
        return;
    }
    const endMarker = new Uint8Array([sttBinaryHandlerId]);
    try {
        haWebSocket.send(endMarker.buffer);
        haReadyForAudio = false;
    } catch (error) { pipelineActive = false; setVAState(STATE.IDLE); }
}

function initiateHAPipelineRun() {
    if (!haWebSocket || haWebSocket.readyState !== WebSocket.OPEN) {
        panelAlert("Not connected to Home Assistant.");
        setVAState(STATE.IDLE); return;
    }
    if (pipelineActive || store.vaState !== STATE.WAKE_WORD_TRIGGERED || !HA_ASSIST_PIPELINE_NAME) {
        if (!HA_ASSIST_PIPELINE_NAME) panelAlert("HA Assist Pipeline Name is not configured.");
        setVAState(STATE.IDLE); return;
    }
    resetAudioStreamingState();
    currentPipelineRunId = sendMessage({
        type: 'assist_pipeline/run', start_stage: 'stt', end_stage: 'tts',
        input: { sample_rate: 16000 }, pipeline: HA_ASSIST_PIPELINE_NAME, conversation_id: conversationId,
    });
    if (currentPipelineRunId === -1) {
        panelAlert("Failed to start voice command with Home Assistant.");
        setVAState(STATE.IDLE);
    } else {
        pipelineActive = true;
    }
}

if (location.href.includes('-samsung')) {
    initializeApp().catch(initializationError => {
        panelAlert("Application failed to initialize: " + initializationError.message);
    });
    panelAlert(<h1><center>Jarvis v0.0.2-4</center></h1>)

    document.querySelector("body").addEventListener('click', (e) => {
        document.querySelector("body").requestFullscreen();
    });

    setInterval(() => {
        store.currentTime = Date.now();
    }, 1000)

    // The content of your main.css is embedded here
    /*
        body {
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
        color: white;
    }

    #root {
        width: 100%;
        display: flex;
        align-items: center;
        flex-direction: column;
    }
        */
    const APP_CSS = `
    dotlottie-player {
        transition: all 0.2s ease-in-out;
    }

    @property --a {
        syntax: '<percentage>';
        inherits: false;
        initial-value: 0%;
    }
  `;

    // 2. Inject CSS into the document's head
    const styleElement = document.createElement('style');
    styleElement.textContent = APP_CSS;
    document.head.appendChild(styleElement);

}
