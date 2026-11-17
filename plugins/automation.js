const db = require("../database");

db.exec(`
CREATE TABLE IF NOT EXISTS xmd_automation_settings (
    user_id INTEGER PRIMARY KEY,
    settings TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function getSettings(userId) {
    const row = db.prepare(
        "SELECT settings FROM xmd_automation_settings WHERE user_id = ?"
    ).get(Number(userId));

    try {
        return row ? JSON.parse(row.settings || "{}") : {};
    } catch {
        return {};
    }
}

function saveSettings(userId, settings) {
    db.prepare(`
        INSERT INTO xmd_automation_settings (user_id, settings, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            settings = excluded.settings,
            updated_at = CURRENT_TIMESTAMP
    `).run(Number(userId), JSON.stringify(settings));
}

function getMessageText(msg) {
    const m = msg?.message || {};
    return String(
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ""
    ).trim();
}

const pendingPresence = new Map();

async function handleIncoming(sock, msg, { userId } = {}) {
    if (!userId || !msg?.key || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;

    const settings = getSettings(userId);
    const presenceKey = String(userId) + ":" + jid;

    if (settings.autoread === true) {
        try {
            await sock.readMessages([msg.key]);
        } catch (error) {
            console.error("AUTO READ ERROR:", userId, error.message);
        }
    }

    const presence = settings.autorecording === true
        ? "recording"
        : settings.autotyping === true
            ? "composing"
            : null;

    if (presence) {
        try {
            await sock.sendPresenceUpdate(presence, jid);

            const previous = pendingPresence.get(presenceKey);
            if (previous) clearTimeout(previous);

            const timer = setTimeout(async () => {
                if (pendingPresence.get(presenceKey) !== timer) return;
                pendingPresence.delete(presenceKey);

                try {
                    await sock.sendPresenceUpdate("paused", jid);
                } catch (error) {
                    console.error("PRESENCE PAUSE ERROR:", userId, error.message);
                }
            }, 2500);

            pendingPresence.set(presenceKey, timer);
        } catch (error) {
            console.error("AUTO PRESENCE ERROR:", userId, error.message);
        }
    }
}

async function execute(sock, msg, { args = [], userId, prefix = ".", isOwner = false } = {}) {
    // OLU-XMD OWNER-ONLY AUTOMATION GUARD
    if (!isOwner) {
        return sock.sendMessage(msg.key.remoteJid, {
            text: "This command is for the owner only."
        }, { quoted: msg });
    }

    const text = getMessageText(msg);
    const command = (text.split(/\s+/)[0] || "")
        .slice(prefix.length)
        .toLowerCase();

    const settings = getSettings(userId);
    const action = String(args[0] || "").toLowerCase();

    const toggles = {
        autotyping: "Auto Typing",
        autorecording: "Auto Recording",
        autoread: "Auto Read"
    };

    if (command === "autoviewonce") {
        return sock.sendMessage(msg.key.remoteJid, {
            text: "Auto View Once is not available. OLU-XMD will not bypass or save protected one-view media."
        });
    }

    if (command === "online") {
        if (!["on", "off"].includes(action)) {
            return sock.sendMessage(msg.key.remoteJid, {
                text: "ONLINE MODE\n.online on - Appear available\n.online off - Appear unavailable"
            });
        }

        try {
            await sock.sendPresenceUpdate(action === "on" ? "available" : "unavailable");
            settings.online = action === "on";
            saveSettings(userId, settings);

            return sock.sendMessage(msg.key.remoteJid, {
                text: "Online mode: " + (settings.online ? "ON" : "OFF")
            });
        } catch (error) {
            return sock.sendMessage(msg.key.remoteJid, {
                text: "Unable to change online presence: " + error.message
            });
        }
    }

    if (!toggles[command]) return;

    if (action === "status") {
        return sock.sendMessage(msg.key.remoteJid, {
            text: Object.entries(toggles)
                .map(([key, name]) => name + ": " + (settings[key] ? "ON" : "OFF"))
                .join("\n")
        });
    }

    if (!["on", "off"].includes(action)) {
        return sock.sendMessage(msg.key.remoteJid, {
            text: toggles[command] + "\n" +
                "." + command + " on\n" +
                "." + command + " off\n" +
                "." + command + " status"
        });
    }

    settings[command] = action === "on";
    saveSettings(userId, settings);

    return sock.sendMessage(msg.key.remoteJid, {
        text: toggles[command] + " turned " + action.toUpperCase() + "."
    });
}

module.exports = {
    name: "automation",
    aliases: ["autotyping", "autorecording", "autoread", "online", "autoviewonce"],
    description: "Personal WhatsApp automation controls",
    execute,
    handleIncoming
};
