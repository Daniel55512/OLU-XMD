const db = require("../database");

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_CACHE_ITEMS = 100;

const messageCache = new Map();
let baileysPromise;

function getBaileys() {
    if (!baileysPromise) {
        baileysPromise = import("@whiskeysockets/baileys");
    }
    return baileysPromise;
}

db.exec(`
    CREATE TABLE IF NOT EXISTS xmd_viewonce_settings (
        user_id INTEGER PRIMARY KEY,
        settings TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

function getSettings(userId) {
    const row = db.prepare(
        "SELECT settings FROM xmd_viewonce_settings WHERE user_id = ?"
    ).get(Number(userId));

    try {
        return row ? JSON.parse(row.settings) : {
            antideleteChats: [],
            antivvChats: [],
            consent: {}
        };
    } catch {
        return {
            antideleteChats: [],
            antivvChats: [],
            consent: {}
        };
    }
}

function saveSettings(userId, settings) {
    db.prepare(`
        INSERT INTO xmd_viewonce_settings (user_id, settings, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            settings = excluded.settings,
            updated_at = CURRENT_TIMESTAMP
    `).run(Number(userId), JSON.stringify(settings));
}

function isViewOnce(message) {
    if (!message || typeof message !== "object") return false;

    return Boolean(
        message.viewOnceMessage ||
        message.viewOnceMessageV2 ||
        message.viewOnceMessageV2Extension
    );
}

function unwrapEphemeral(message) {
    let current = message;

    for (let i = 0; i < 3 && current?.ephemeralMessage?.message; i++) {
        current = current.ephemeralMessage.message;
    }

    return current;
}

function getQuotedMessage(msg) {
    const context =
        msg?.message?.extendedTextMessage?.contextInfo ||
        msg?.message?.imageMessage?.contextInfo ||
        msg?.message?.videoMessage?.contextInfo;

    if (!context?.quotedMessage) return null;

    return {
        message: unwrapEphemeral(context.quotedMessage),
        context
    };
}

function getMediaNode(message) {
    if (!message || isViewOnce(message)) return null;

    if (message.imageMessage) {
        return { node: message.imageMessage, type: "image" };
    }

    if (message.videoMessage) {
        return { node: message.videoMessage, type: "video" };
    }

    if (message.audioMessage) {
        return { node: message.audioMessage, type: "audio" };
    }

    return null;
}

function getText(message) {
    return (
        message?.conversation ||
        message?.extendedTextMessage?.text ||
        message?.imageMessage?.caption ||
        message?.videoMessage?.caption ||
        message?.documentMessage?.caption ||
        ""
    );
}

function getSenderJid(msg) {
    return msg?.key?.participant || msg?.key?.remoteJid || "";
}

function getOwnJid(sock) {
    return sock?.user?.id || sock?.user?.phoneNumber || sock?.user?.lid || "";
}

function isGroup(jid) {
    return String(jid || "").endsWith("@g.us");
}

function pruneCache() {
    const now = Date.now();

    for (const [key, item] of messageCache) {
        if (now - item.timestamp > CACHE_TTL_MS) {
            messageCache.delete(key);
        }
    }

    while (messageCache.size > MAX_CACHE_ITEMS) {
        const oldestKey = messageCache.keys().next().value;
        messageCache.delete(oldestKey);
    }
}

async function downloadMedia(node, type) {
    const baileys = await getBaileys();
    const stream = await baileys.downloadContentFromMessage(node, type);
    const chunks = [];
    let total = 0;

    for await (const chunk of stream) {
        total += chunk.length;
        if (total > MAX_MEDIA_BYTES) {
            throw new Error("Media is larger than the 5 MB archive limit.");
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

async function sendSavedMedia(sock, jid, item, caption) {
    if (item.type === "image") {
        return sock.sendMessage(jid, {
            image: item.buffer,
            caption
        });
    }

    if (item.type === "video") {
        return sock.sendMessage(jid, {
            video: item.buffer,
            caption
        });
    }

    return sock.sendMessage(jid, {
        audio: item.buffer,
        mimetype: item.mimetype || "audio/ogg",
        ptt: Boolean(item.ptt)
    });
}

async function sendQuotedMedia(sock, msg, destination, commandLabel) {
    const quoted = getQuotedMessage(msg);

    if (!quoted) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: "Reply to an ordinary image, video, or voice note with this command."
        });
        return;
    }

    if (isViewOnce(quoted.message)) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: "View-Once media is protected and cannot be saved or forwarded by this plugin."
        });
        return;
    }

    const media = getMediaNode(quoted.message);

    if (!media) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: "The replied message does not contain a supported ordinary image, video, or audio file."
        });
        return;
    }

    try {
        const buffer = await downloadMedia(media.node, media.type);
        const item = {
            type: media.type,
            buffer,
            mimetype: media.node.mimetype,
            ptt: media.node.ptt
        };

        await sendSavedMedia(
            sock,
            destination,
            item,
            media.type === "audio" ? undefined : `Saved with ${commandLabel} • OLU-XMD`
        );

        if (destination !== msg.key.remoteJid) {
            await sock.sendMessage(msg.key.remoteJid, {
                text: "The selected ordinary media was sent to your own WhatsApp chat."
            });
        }
    } catch (error) {
        console.error("VIEWONCE PLUGIN MEDIA ERROR:", error);
        await sock.sendMessage(msg.key.remoteJid, {
            text: "I couldn't download that media. It may be unavailable or larger than 5 MB."
        });
    }
}

module.exports = {
    name: "vv",
    aliases: ["vv2", "vvme", "antivv", "antidelete", "archiveconsent", "save"],

    async execute(sock, msg, {
        args = [],
        userId,
        prefix = ".",
        isOwner = false
    } = {}) {
        const command = String(
            msg?.message?.conversation ||
            msg?.message?.extendedTextMessage?.text ||
            ""
        ).trim().slice(prefix.length).split(/\s+/)[0].toLowerCase();

        const chatJid = msg.key.remoteJid;
        const option = String(args[0] || "").toLowerCase();
        const settings = getSettings(userId);

        if (command === "vv") {
            await sendQuotedMedia(sock, msg, chatJid, ".vv");
            return;
        }

        if (command === "vv2" || command === "vvme") {
            if (!isOwner) {
                await sock.sendMessage(chatJid, {
                    text: "This command is reserved for the OLU-XMD owner."
                });
                return;
            }

            const ownJid = getOwnJid(sock);

            if (!ownJid) {
                await sock.sendMessage(chatJid, {
                    text: "I couldn't identify this bot account's own WhatsApp address."
                });
                return;
            }

            await sendQuotedMedia(sock, msg, ownJid, command);
            return;
        }

        if (command === "save") {
            if (!isOwner) {
                await sock.sendMessage(chatJid, {
                    text: "This command is reserved for the OLU-XMD owner."
                });
                return;
            }

            const quoted = getQuotedMessage(msg);
            const media = quoted && getMediaNode(quoted.message);

            if (!quoted || isViewOnce(quoted.message) || !media ||
                !["image", "video"].includes(media.type)) {
                await sock.sendMessage(chatJid, {
                    text: "Reply to a normally viewable Status image or video with .save. View-Once media is not supported."
                });
                return;
            }

            const ownJid = getOwnJid(sock);

            if (!ownJid) {
                await sock.sendMessage(chatJid, {
                    text: "I couldn't identify this bot account's own WhatsApp address."
                });
                return;
            }

            try {
                const buffer = await downloadMedia(media.node, media.type);
                await sendSavedMedia(sock, ownJid, {
                    type: media.type,
                    buffer,
                    mimetype: media.node.mimetype
                }, "Status saved with OLU-XMD");
                await sock.sendMessage(chatJid, {
                    text: "The selected ordinary image or video was sent to your own WhatsApp chat."
                });
            } catch (error) {
                console.error("STATUS SAVE ERROR:", error);
                await sock.sendMessage(chatJid, {
                    text: "I couldn't save that Status media."
                });
            }
            return;
        }

        if (command === "archiveconsent") {
            if (!["on", "off"].includes(option)) {
                await sock.sendMessage(chatJid, {
                    text: `Use ${prefix}archiveconsent on to opt in, or ${prefix}archiveconsent off to opt out of the temporary message archive.`
                });
                return;
            }

            settings.consent ||= {};
            settings.consent[chatJid] ||= [];

            const sender = getSenderJid(msg);
            const members = settings.consent[chatJid];

            if (option === "on" && !members.includes(sender)) {
                members.push(sender);
            } else if (option === "off") {
                settings.consent[chatJid] = members.filter(jid => jid !== sender);
            }

            saveSettings(userId, settings);

            await sock.sendMessage(chatJid, {
                text: option === "on"
                    ? "You opted in. Your ordinary messages may be temporarily archived in this chat while the owner has .antidelete enabled. View-Once messages are never archived. You can opt out anytime with .archiveconsent off."
                    : "You opted out. New messages from you will not be added to the temporary archive."
            });
            return;
        }

        if (command === "antidelete" || command === "antivv") {
            if (!isOwner) {
                await sock.sendMessage(chatJid, {
                    text: "This command is reserved for the OLU-XMD owner."
                });
                return;
            }

            if (!["on", "off", "status"].includes(option)) {
                await sock.sendMessage(chatJid, {
                    text: `Use ${prefix}${command} on, ${prefix}${command} off, or ${prefix}${command} status.`
                });
                return;
            }

            const listName = command === "antidelete"
                ? "antideleteChats"
                : "antivvChats";

            settings[listName] ||= [];

            if (option === "status") {
                const enabled = settings[listName].includes(chatJid);
                await sock.sendMessage(chatJid, {
                    text: `${command} is ${enabled ? "ON" : "OFF"} in this chat.`
                });
                return;
            }

            if (option === "on" && !settings[listName].includes(chatJid)) {
                settings[listName].push(chatJid);
            } else if (option === "off") {
                settings[listName] = settings[listName].filter(jid => jid !== chatJid);
            }

            saveSettings(userId, settings);

            if (command === "antidelete" && option === "on") {
                await sock.sendMessage(chatJid, {
                    text: "OLU-XMD temporary archive notice: only participants who explicitly opt in with .archiveconsent on may have their ordinary messages temporarily cached for up to 3 minutes. Opt out anytime with .archiveconsent off. View-Once messages are excluded. Cached content is kept in memory, not permanently stored."
                });
            } else if (command === "antivv" && option === "on") {
                await sock.sendMessage(chatJid, {
                    text: "OLU-XMD privacy notice: View-Once media is not automatically saved, intercepted, or forwarded. Please only send media you are comfortable sharing with the chat."
                });
            } else {
                await sock.sendMessage(chatJid, {
                    text: `${command} is now ${option.toUpperCase()} in this chat.`
                });
            }

            if (command === "antidelete" && option === "off") {
                for (const [key, item] of messageCache) {
                    if (item.chatJid === chatJid) messageCache.delete(key);
                }
            }
        }
    },

    async handleMessage(sock, msg, { userId, type } = {}) {
        if (!msg?.key?.remoteJid || msg.key.remoteJid === "status@broadcast") return;
        if (type !== "notify") return;

        const chatJid = msg.key.remoteJid;
        const protocol = msg.message?.protocolMessage;

        if (protocol?.type === 0 && protocol.key?.id) {
            const cacheKey = `${chatJid}:${protocol.key.id}`;
            const item = messageCache.get(cacheKey);

            if (!item) return;

            const settings = getSettings(userId);
            if (!settings.antideleteChats?.includes(chatJid)) return;

            messageCache.delete(cacheKey);

            try {
                const notice = "Recovered from the temporary, opt-in archive (message was deleted).";

                if (item.text) {
                    await sock.sendMessage(chatJid, {
                        text: `${notice}\n\n${item.text}`
                    });
                } else if (item.buffer) {
                    await sendSavedMedia(sock, chatJid, item, notice);
                }
            } catch (error) {
                console.error("CONSENT ARCHIVE RESTORE ERROR:", error);
            }
            return;
        }

        if (msg.key.fromMe || !msg.message || isViewOnce(msg.message)) return;

        const settings = getSettings(userId);
        if (!settings.antideleteChats?.includes(chatJid)) return;

        const sender = getSenderJid(msg);
        console.log("ARCHIVE SENDER DIAGNOSTIC:", {
            userId,
            chatJid,
            sender,
            participant: msg.key?.participant,
            participantAlt: msg.key?.participantAlt,
            consentList: settings.consent?.[chatJid] || [],
            archiveEnabled: settings.antideleteChats?.includes(chatJid)
        });
        if (!settings.consent?.[chatJid]?.includes(sender)) return;

        const text = getText(msg.message);
        const media = getMediaNode(msg.message);
        const cacheKey = `${chatJid}:${msg.key.id}`;

        if (!msg.key.id) return;

        const item = {
            chatJid,
            sender,
            text,
            timestamp: Date.now()
        };

        if (media) {
            try {
                item.type = media.type;
                item.buffer = await downloadMedia(media.node, media.type);
                item.mimetype = media.node.mimetype;
                item.ptt = media.node.ptt;
            } catch (error) {
                console.warn("CONSENT ARCHIVE MEDIA SKIPPED:", error.message);
            }
        }

        if (text || item.buffer) {
            messageCache.set(cacheKey, item);
            pruneCache();
        }
    }
};
