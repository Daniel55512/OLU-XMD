const db = require("../database");
const processedStatusReads = new Set();
const processedStatusReactions = new Set();

const DEFAULT_STATUS_EMOJIS = ["❤️", "🔥", "😂", "😍", "🙏"];

db.exec(`
CREATE TABLE IF NOT EXISTS xmd_status_settings (
    user_id INTEGER PRIMARY KEY,
    settings TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function getSettings(userId) {
    const row = db.prepare(
        "SELECT settings FROM xmd_status_settings WHERE user_id = ?"
    ).get(Number(userId));

    try {
        return row ? JSON.parse(row.settings) : {};
    } catch {
        return {};
    }
}

function saveSettings(userId, settings) {
    db.prepare(`
        INSERT INTO xmd_status_settings (user_id, settings)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
        settings = excluded.settings,
        updated_at = CURRENT_TIMESTAMP
    `).run(Number(userId), JSON.stringify(settings));
}

function getStatusEmojis(settings) {
    return Array.isArray(settings.statusEmojis)
        ? settings.statusEmojis
        : [...DEFAULT_STATUS_EMOJIS];
}

function remember(set, key) {
    if (set.has(key)) return false;

    set.add(key);

    if (set.size > 5000) {
        set.delete(set.values().next().value);
    }

    return true;
}

const features = [
    "autoreact", "autoview", "autoreply", "statussave",
    "autostatus", "statusprivacy", "statusviews", "statuslike",
    "statusmention", "statusdownload", "statusforward",
    "statusbroadcast", "statusschedule", "statusfilter",
    "statusreport"
];

module.exports = {
    name: "autostatus",
    aliases: features.filter(x => x !== "autostatus"),
    description: "Personal WhatsApp Status automation",

    async execute(sock, msg, { userId, prefix = ".", isOwner = false } = {}) {
        // OLU-XMD OWNER-ONLY STATUS GUARD
        if (!isOwner) {
            return sock.sendMessage(msg.key.remoteJid, {
                text: "This command is for the owner only."
            }, { quoted: msg });
        }

        const body = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ""
        ).trim();

        const parts = body.slice(prefix.length).trim().split(/\s+/);
        const command = (parts.shift() || "").toLowerCase();
        const action = (parts.shift() || "").toLowerCase();
        const emoji = parts.join(" ");

        const settings = getSettings(userId);

        if (command === "statusreport" || command === "autostatus") {
            const lines = features.map(name =>
                `${name}: ${settings[name] ? "ON" : "OFF"}`
            );

            const emojis = getStatusEmojis(settings);

            return sock.sendMessage(msg.key.remoteJid, {
                text:
                    "PERSONAL WHATSAPP STATUS AUTOMATION\n\n" +
                    lines.join("\n") +
                    "\n\nSaved reaction emojis: " +
                    (emojis.length ? emojis.join(" ") : "None") +
                    "\n\nUse .autoreact on/off, .autoview on/off, etc."
            }, { quoted: msg });
        }

        if (!features.includes(command)) return;

        if (command === "autoreact") {
            let emojis = getStatusEmojis(settings);

            if (action === "list") {
                return sock.sendMessage(msg.key.remoteJid, {
                    text:
                        "YOUR STATUS REACTION EMOJIS\n\n" +
                        (emojis.length
                            ? emojis.map((e, i) => `${i + 1}. ${e}`).join("\n")
                            : "No emojis saved.") +
                        "\n\nAdd: .autoreact add ❤️" +
                        "\nRemove: .autoreact remove ❤️"
                }, { quoted: msg });
            }

            if (action === "add" || action === "remove") {
                if (!emoji || emoji.length > 16 ||
                    /\s/.test(emoji) ||
                    [...new Intl.Segmenter(undefined, {
                        granularity: "grapheme"
                    }).segment(emoji)].length !== 1) {
                    return sock.sendMessage(msg.key.remoteJid, {
                        text: `Usage: ${prefix}autoreact ${action} ❤️\nEnter one emoji.`
                    }, { quoted: msg });
                }

                if (action === "add") {
                    if (emojis.includes(emoji)) {
                        return sock.sendMessage(msg.key.remoteJid, {
                            text: `${emoji} is already in your reaction list.`
                        }, { quoted: msg });
                    }

                    emojis.push(emoji);
                } else {
                    if (!emojis.includes(emoji)) {
                        return sock.sendMessage(msg.key.remoteJid, {
                            text: `${emoji} is not in your reaction list.`
                        }, { quoted: msg });
                    }

                    emojis = emojis.filter(item => item !== emoji);
                }

                settings.statusEmojis = emojis;
                saveSettings(userId, settings);

                return sock.sendMessage(msg.key.remoteJid, {
                    text:
                        `${emoji} ${action === "add" ? "added to" : "removed from"} your reaction list.\n\n` +
                        (emojis.length ? emojis.join(" ") : "Your list is empty.")
                }, { quoted: msg });
            }

            if (!["on", "off"].includes(action)) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text:
                        "AUTO STATUS REACTION\n\n" +
                        `${prefix}autoreact on\n` +
                        `${prefix}autoreact off\n` +
                        `${prefix}autoreact add ❤️\n` +
                        `${prefix}autoreact remove ❤️\n` +
                        `${prefix}autoreact list`
                }, { quoted: msg });
            }

            if (action === "on" && emojis.length === 0) {
                return sock.sendMessage(msg.key.remoteJid, {
                    text: "Your emoji list is empty. Add an emoji first using .autoreact add ❤️"
                }, { quoted: msg });
            }

            settings.statusEmojis = emojis;
            settings.autoreact = action === "on";
            saveSettings(userId, settings);

            return sock.sendMessage(msg.key.remoteJid, {
                text:
                    `Personal Status Auto Reaction: ${action.toUpperCase()}\n` +
                    (action === "on" ? `Random emojis: ${emojis.join(" ")}` : "")
            }, { quoted: msg });
        }

        const supportedToggles = ["autoview", "autoreply"];

        if (!supportedToggles.includes(command)) {
            return sock.sendMessage(msg.key.remoteJid, {
                text: `${command} is registered, but its WhatsApp operation has not yet been implemented and verified.`
            }, { quoted: msg });
        }

        if (!["on", "off"].includes(action)) {
            return sock.sendMessage(msg.key.remoteJid, {
                text: `Usage: ${prefix}${command} on OR ${prefix}${command} off`
            }, { quoted: msg });
        }

        settings[command] = action === "on";
        saveSettings(userId, settings);

        return sock.sendMessage(msg.key.remoteJid, {
            text: `Personal Status setting ${command}: ${action.toUpperCase()}`
        }, { quoted: msg });
    },

    async handleStatus(sock, msg, { userId } = {}) {
        const settings = getSettings(userId);

        const isPersonalStatus =
            msg.key?.remoteJid === "status@broadcast" &&
            !!msg.key?.id &&
            !!msg.key?.participant &&
            msg.key?.fromMe !== true;

        if (!isPersonalStatus) return;

        console.log("OLU-XMD STATUS EVENT RECEIVED:", {
            userId,
            remoteJid: msg.key.remoteJid,
            messageId: msg.key.id,
            sender: msg.key.participant
        });

        if (settings.autoview === true) {
            const readKey = `${userId}:${msg.key.id}:${msg.key.participant}`;

            if (remember(processedStatusReads, readKey)) {
                try {
                    await sock.readMessages([msg.key]);

                    console.log("OLU-XMD STATUS AUTO-VIEW REQUEST SENT:", {
                        userId,
                        messageId: msg.key.id,
                        sender: msg.key.participant
                    });
                } catch (error) {
                    processedStatusReads.delete(readKey);

                    console.error("OLU-XMD STATUS AUTO-VIEW ERROR:", {
                        userId,
                        messageId: msg.key.id,
                        error: error.message
                    });
                }
            }
        }

        if (settings.autoreact === true) {
            const emojis = getStatusEmojis(settings);

            if (!emojis.length) return;

            const reactionKey =
                `${userId}:${msg.key.id}:${msg.key.participant}`;

            if (!processedStatusReactions.has(reactionKey)) {
                const emoji = emojis[
                    Math.floor(Math.random() * emojis.length)
                ];

                try {
                    await sock.sendMessage(
                        "status@broadcast",
                        {
                            react: {
                                text: emoji,
                                key: msg.key
                            }
                        },
                        {
                            statusJidList: [msg.key.participant]
                        }
                    );

                    remember(processedStatusReactions, reactionKey);

                    console.log("OLU-XMD STATUS AUTO-REACTION SENT:", {
                        userId,
                        messageId: msg.key.id,
                        sender: msg.key.participant,
                        emoji
                    });
                } catch (error) {
                    console.error("OLU-XMD STATUS AUTO-REACTION ERROR:", {
                        userId,
                        messageId: msg.key.id,
                        sender: msg.key.participant,
                        emoji,
                        error: error.message
                    });
                }
            }
        }
    }
};
