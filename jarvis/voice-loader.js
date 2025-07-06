let BASE = '/hacsfiles/jarvis';

(async () => {
    // Prevent this script from running multiple times
    if (document.getElementById('voice-assistant-loader-marker')) {
        return;
    }

    // --- CONFIGURATION ---

    // All vendor scripts from your index.html
    const VENDOR_SCRIPTS = [
        BASE + "/vendor/react.production.min.js",
        BASE + "/vendor/react-dom.production.min.js",
        BASE + "/vendor/mobx.umd.production.min.js",
        BASE + "/vendor/mobxreactlite.umd.production.min.js",
        BASE + "/vendor/babel.min.js", // For in-browser JSX transpilation
        BASE + "/vendor/feather.min.js",
        BASE + "/vendor/socket.io.min.js",
        BASE + "/vendor/bumblebee/bumblebee.umd.min.js?t=1234",
        BASE + "/vendor/ort/ort.min.js",
        BASE + "/vendor/vad/bundle.min.js",
    ];

    const VENDOR_MODULES = [
        BASE + "/vendor/dotlottie-player.js"
    ];

    // Path to your main application script
    const APP_SCRIPT_SRC = BASE + "/main-ha.js?t=" + Date.now();


    // --- LOADER IMPLEMENTATION ---

    // Helper to load a script and return a promise
    function loadScript(src, isModule = false) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false; // Load scripts sequentially
            if (isModule) {
                script.type = 'module';
            }
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    // 1. Add a marker to indicate the loader has run
    const marker = document.createElement('div');
    marker.id = 'voice-assistant-loader-marker';
    marker.style.display = 'none';
    document.body.appendChild(marker);


    // 3. Create the root div for React if it doesn't exist
    if (!document.getElementById('root')) {
        const rootDiv = document.createElement('div');
        rootDiv.id = 'root';
        document.body.appendChild(rootDiv);
    }

    try {
        // 4. Load all vendor scripts sequentially
        for (const src of VENDOR_SCRIPTS) {
            await loadScript(src);
        }
        for (const src of VENDOR_MODULES) {
            await loadScript(src, true);
        }

        // 5. Manually fetch, transpile, and execute the main application script
        const response = await fetch(APP_SCRIPT_SRC);
        if (!response.ok) {
            throw new Error(`Failed to fetch app script: ${response.statusText}`);
        }
        const jsxCode = await response.text();

        // Transpile using Babel's API. The 'react' preset is crucial for JSX.
        const transformed = Babel.transform(jsxCode, {
            presets: ['react']
        });

        // Create a new script element to run the transpiled, regular JavaScript code
        const appScript = document.createElement('script');
        appScript.textContent = transformed.code;
        document.body.appendChild(appScript);

        console.log('Voice assistant has been loaded successfully.');

    } catch (error) {
        console.error('Failed to load voice assistant dependencies:', error);
    }
})();