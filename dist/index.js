"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apps = exports.openApp = void 0;
const node_process_1 = require("node:process");
const node_buffer_1 = require("node:buffer");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const is_wsl_1 = require("is-wsl");
const define_lazy_prop_1 = require("define-lazy-prop");
const default_browser_1 = require("default-browser");
const is_inside_container_1 = require("is-inside-container");
// Path to included `xdg-open`.
const __dirname = node_path_1.default.dirname((0, node_url_1.fileURLToPath)(import.meta.url));
const localXdgOpenPath = node_path_1.default.join(__dirname, 'xdg-open');
const { platform, arch } = node_process_1.default;
/**
Get the mount point for fixed drives in WSL.

@inner
@returns {string} The mount point.
*/
const getWslDrivesMountPoint = (() => {
    // Default value for "root" param
    // according to https://docs.microsoft.com/en-us/windows/wsl/wsl-config
    const defaultMountPoint = '/mnt/';
    let mountPoint;
    return async function () {
        if (mountPoint) {
            // Return memoized mount point value
            return mountPoint;
        }
        const configFilePath = '/etc/wsl.conf';
        let isConfigFileExists = false;
        try {
            await promises_1.default.access(configFilePath, promises_1.constants.F_OK);
            isConfigFileExists = true;
        }
        catch { }
        if (!isConfigFileExists) {
            return defaultMountPoint;
        }
        const configContent = await promises_1.default.readFile(configFilePath, { encoding: 'utf8' });
        const configMountPoint = /(?<!#.*)root\s*=\s*(?<mountPoint>.*)/g.exec(configContent);
        if (!configMountPoint) {
            return defaultMountPoint;
        }
        mountPoint = configMountPoint.groups.mountPoint.trim();
        mountPoint = mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`;
        return mountPoint;
    };
})();
const pTryEach = async (array, mapper) => {
    let latestError;
    for (const item of array) {
        try {
            return await mapper(item); // eslint-disable-line no-await-in-loop
        }
        catch (error) {
            latestError = error;
        }
    }
    throw latestError;
};
const baseOpen = async (options) => {
    options = {
        wait: false,
        background: false,
        newInstance: false,
        allowNonzeroExitCode: false,
        ...options,
    };
    if (Array.isArray(options.app)) {
        return pTryEach(options.app, singleApp => baseOpen({
            ...options,
            app: singleApp,
        }));
    }
    let { name: app, arguments: appArguments = [] } = options.app ?? {};
    appArguments = [...appArguments];
    if (Array.isArray(app)) {
        return pTryEach(app, appName => baseOpen({
            ...options,
            app: {
                name: appName,
                arguments: appArguments,
            },
        }));
    }
    if (app === 'browser' || app === 'browserPrivate') {
        // IDs from default-browser for macOS and windows are the same
        const ids = {
            'com.google.chrome': 'chrome',
            'google-chrome.desktop': 'chrome',
            'org.mozilla.firefox': 'firefox',
            'firefox.desktop': 'firefox',
            'com.microsoft.msedge': 'edge',
            'com.microsoft.edge': 'edge',
            'microsoft-edge.desktop': 'edge',
        };
        // Incognito flags for each browser in `apps`.
        const flags = {
            chrome: '--incognito',
            firefox: '--private-window',
            edge: '--inPrivate',
        };
        const browser = await (0, default_browser_1.default)();
        if (browser.id in ids) {
            const browserName = ids[browser.id];
            if (app === 'browserPrivate') {
                appArguments.push(flags[browserName]);
            }
            return baseOpen({
                ...options,
                app: {
                    name: exports.apps[browserName],
                    arguments: appArguments,
                },
            });
        }
        throw new Error(`${browser.name} is not supported as a default browser`);
    }
    let command;
    const cliArguments = [];
    const childProcessOptions = {};
    if (platform === 'darwin') {
        command = 'open';
        if (options.wait) {
            cliArguments.push('--wait-apps');
        }
        if (options.background) {
            cliArguments.push('--background');
        }
        if (options.newInstance) {
            cliArguments.push('--new');
        }
        if (app) {
            cliArguments.push('-a', app);
        }
    }
    else if (platform === 'win32' || (is_wsl_1.default && !(0, is_inside_container_1.default)() && !app)) {
        const mountPoint = await getWslDrivesMountPoint();
        command = is_wsl_1.default
            ? `${mountPoint}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`
            : `${node_process_1.default.env.SYSTEMROOT || node_process_1.default.env.windir || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell`;
        cliArguments.push('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand');
        if (!is_wsl_1.default) {
            childProcessOptions.windowsVerbatimArguments = true;
        }
        const encodedArguments = ['Start'];
        if (options.wait) {
            encodedArguments.push('-Wait');
        }
        if (app) {
            // Double quote with double quotes to ensure the inner quotes are passed through.
            // Inner quotes are delimited for PowerShell interpretation with backticks.
            encodedArguments.push(`"\`"${app}\`""`);
            if (options.target) {
                appArguments.push(options.target);
            }
        }
        else if (options.target) {
            encodedArguments.push(`"${options.target}"`);
        }
        if (appArguments.length > 0) {
            appArguments = appArguments.map(argument => `"\`"${argument}\`""`);
            encodedArguments.push('-ArgumentList', appArguments.join(','));
        }
        // Using Base64-encoded command, accepted by PowerShell, to allow special characters.
        options.target = node_buffer_1.Buffer.from(encodedArguments.join(' '), 'utf16le').toString('base64');
    }
    else {
        if (app) {
            command = app;
        }
        else {
            // When bundled by Webpack, there's no actual package file path and no local `xdg-open`.
            const isBundled = !__dirname || __dirname === '/';
            // Check if local `xdg-open` exists and is executable.
            let exeLocalXdgOpen = false;
            try {
                await promises_1.default.access(localXdgOpenPath, promises_1.constants.X_OK);
                exeLocalXdgOpen = true;
            }
            catch { }
            const useSystemXdgOpen = node_process_1.default.versions.electron
                ?? (platform === 'android' || isBundled || !exeLocalXdgOpen);
            command = useSystemXdgOpen ? 'xdg-open' : localXdgOpenPath;
        }
        if (appArguments.length > 0) {
            cliArguments.push(...appArguments);
        }
        if (!options.wait) {
            // `xdg-open` will block the process unless stdio is ignored
            // and it's detached from the parent even if it's unref'd.
            childProcessOptions.stdio = 'ignore';
            childProcessOptions.detached = true;
        }
    }
    if (platform === 'darwin' && appArguments.length > 0) {
        cliArguments.push('--args', ...appArguments);
    }
    // This has to come after `--args`.
    if (options.target) {
        cliArguments.push(options.target);
    }
    const subprocess = node_child_process_1.default.spawn(command, cliArguments, childProcessOptions);
    if (options.wait) {
        return new Promise((resolve, reject) => {
            subprocess.once('error', reject);
            subprocess.once('close', exitCode => {
                if (!options.allowNonzeroExitCode && exitCode > 0) {
                    reject(new Error(`Exited with code ${exitCode}`));
                    return;
                }
                resolve(subprocess);
            });
        });
    }
    subprocess.unref();
    return subprocess;
};
const open = (target, options) => {
    if (typeof target !== 'string') {
        throw new TypeError('Expected a `target`');
    }
    return baseOpen({
        ...options,
        target,
    });
};
const openApp = (name, options) => {
    if (typeof name !== 'string' && !Array.isArray(name)) {
        throw new TypeError('Expected a valid `name`');
    }
    const { arguments: appArguments = [] } = options ?? {};
    if (appArguments !== undefined && appArguments !== null && !Array.isArray(appArguments)) {
        throw new TypeError('Expected `appArguments` as Array type');
    }
    return baseOpen({
        ...options,
        app: {
            name,
            arguments: appArguments,
        },
    });
};
exports.openApp = openApp;
function detectArchBinary(binary) {
    if (typeof binary === 'string' || Array.isArray(binary)) {
        return binary;
    }
    const { [arch]: archBinary } = binary;
    if (!archBinary) {
        throw new Error(`${arch} is not supported`);
    }
    return archBinary;
}
function detectPlatformBinary({ [platform]: platformBinary }, { wsl }) {
    if (wsl && is_wsl_1.default) {
        return detectArchBinary(wsl);
    }
    if (!platformBinary) {
        throw new Error(`${platform} is not supported`);
    }
    return detectArchBinary(platformBinary);
}
exports.apps = {};
(0, define_lazy_prop_1.default)(exports.apps, 'chrome', () => detectPlatformBinary({
    darwin: 'google chrome',
    win32: 'chrome',
    linux: ['google-chrome', 'google-chrome-stable', 'chromium'],
}, {
    wsl: {
        ia32: '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        x64: ['/mnt/c/Program Files/Google/Chrome/Application/chrome.exe', '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
    },
}));
(0, define_lazy_prop_1.default)(exports.apps, 'firefox', () => detectPlatformBinary({
    darwin: 'firefox',
    win32: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    linux: 'firefox',
}, {
    wsl: '/mnt/c/Program Files/Mozilla Firefox/firefox.exe',
}));
(0, define_lazy_prop_1.default)(exports.apps, 'edge', () => detectPlatformBinary({
    darwin: 'microsoft edge',
    win32: 'msedge',
    linux: ['microsoft-edge', 'microsoft-edge-dev'],
}, {
    wsl: '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
}));
(0, define_lazy_prop_1.default)(exports.apps, 'browser', () => 'browser');
(0, define_lazy_prop_1.default)(exports.apps, 'browserPrivate', () => 'browserPrivate');
exports.default = open;
