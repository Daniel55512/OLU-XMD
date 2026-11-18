const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();
const baileys = require(path.join(root, "node_modules/@whiskeysockets/baileys/package.json"));
const signal = require(path.join(root, "node_modules/libsignal/package.json"));

if (baileys.version !== "7.0.0-rc14" || signal.version !== "6.0.0") {
    throw new Error("Version mismatch. No files changed.");
}

const recvFile = path.join(root, "node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js");
const cipherFile = path.join(root, "node_modules/libsignal/src/session_cipher.js");

function replaceExactly(source, oldText, newText, label) {
    const oldCount = source.split(oldText).length - 1;
    const newCount = source.split(newText).length - 1;

    if (oldCount === 1 && newCount === 0) {
        console.log("Prepared: " + label);
        return source.replace(oldText, newText);
    }

    if (oldCount === 0 && newCount === 1) {
        console.log("Already applied: " + label);
        return source;
    }

    throw new Error("Unexpected match count: " + label + ". No files changed.");
}

function read(file) {
    return fs.readFileSync(file, "utf8");
}

const recvRaw = read(recvFile);
const cipherRaw = read(cipherFile);

let recv = recvRaw.replace(/\r\n/g, "\n");
let cipher = cipherRaw.replace(/\r\n/g, "\n");

// 1. Use the actual group participant for incoming retry-session recovery.
recv = replaceExactly(
    recv,
    "const fromJid = node.attrs.from;",
    "const fromJid = node.attrs.participant || node.attrs.from;",
    "Correct incoming retry sender identity"
);

// 2. Include keys in the first incoming-message retry.
recv = replaceExactly(
    recv,
    "await sendRetryRequest(node, !encNode);",
    "await sendRetryRequest(node, true);",
    "Include keys in first retry"
);

// 3. Attempt decryption on a copy so failed attempts cannot damage stored sessions.
const startMarker = "    async decryptWithSessions(data, sessions) {";
const endMarker = "\n    async decryptWhisperMessage(data) {";

const start = cipher.indexOf(startMarker);
const end = cipher.indexOf(endMarker, start);

if (start < 0 || end < 0 || cipher.indexOf(startMarker, start + 1) >= 0) {
    throw new Error("Unexpected libsignal decryption function. No files changed.");
}

const oldFunction = cipher.slice(start, end);
let newFunction;

if (
    oldFunction.includes("session.constructor.deserialize(session.serialize())") &&
    oldFunction.includes("Object.assign(session, candidate);")
) {
    console.log("Already applied: Safe session-copy decryption");
    newFunction = oldFunction;
} else {
    if (!oldFunction.includes("plaintext = await this.doDecryptWhisperMessage(data, session);")) {
        throw new Error("Unexpected decryption implementation. No files changed.");
    }

    newFunction = `    async decryptWithSessions(data, sessions) {
        if (!sessions.length) {
            throw new errors.SessionError("No sessions available");
        }
        const errs = [];
        for (const session of sessions) {
            try {
                const candidate = session.constructor.deserialize(session.serialize());
                const plaintext = await this.doDecryptWhisperMessage(data, candidate);
                candidate.indexInfo.used = Date.now();
                Object.assign(session, candidate);
                return { session, plaintext };
            } catch (error) {
                errs.push(error);
            }
        }
        console.error("Failed to decrypt message with any known session...");
        for (const error of errs) {
            console.error("Session error:" + error, error.stack);
        }
        throw new errors.SessionError("No matching sessions found for message");
    }`;

    console.log("Prepared: Safe session-copy decryption");
}

cipher = cipher.slice(0, start) + newFunction + cipher.slice(end);

const plans = [
    { file: recvFile, original: recvRaw, updated: recv, name: "messages-recv.js" },
    { file: cipherFile, original: cipherRaw, updated: cipher, name: "session_cipher.js" }
];

const changed = plans.filter(item => item.original !== item.updated);
const backupDir = path.join(root, "backups");
fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
for (const item of changed) {
    const backup = path.join(backupDir, item.name + "-before-lid-recovery-" + timestamp + ".bak");
    fs.copyFileSync(item.file, backup);
    item.backup = backup;
}

try {
    for (const item of changed) {
        fs.writeFileSync(item.file, item.updated, "utf8");
    }

    for (const item of plans) {
        const check = spawnSync(process.execPath, ["--check", item.file], { encoding: "utf8" });
        if (check.status !== 0) {
            throw new Error(check.stderr || "Syntax check failed: " + item.name);
        }
    }
} catch (error) {
    for (const item of changed) {
        fs.writeFileSync(item.file, item.original, "utf8");
    }
    throw error;
}

console.log("SUCCESS: Baileys and libsignal recovery patches verified.");
console.log("Changed files: " + (changed.map(x => x.name).join(", ") || "none"));
console.log("Backups are in the backups folder.");
