const db = require("../database");
const { hasActiveSubscription } = require("../subscriptionService");

function hasGroupAccess(userId) {
    const id = Number(userId);
    return Number.isSafeInteger(id) && id > 0;
}

// Group-specific settings and moderation data are scoped to each OLU-XMD bot account.
db.exec(`
CREATE TABLE IF NOT EXISTS xmd_group_settings (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_jid)
);
CREATE TABLE IF NOT EXISTS xmd_group_warnings (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    warning_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_jid, participant_jid)
);
CREATE TABLE IF NOT EXISTS xmd_group_badwords (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    word TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_jid, word)
);
CREATE TABLE IF NOT EXISTS xmd_group_blacklist (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_jid, participant_jid)
);
CREATE TABLE IF NOT EXISTS xmd_group_activity (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    last_seen INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, group_jid, participant_jid)
);
CREATE TABLE IF NOT EXISTS xmd_group_messages (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    message_id TEXT NOT NULL,
    participant_jid TEXT,
    message_timestamp INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_jid, message_id)
);
CREATE TABLE IF NOT EXISTS xmd_group_spam_events (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS xmd_group_text_cache (
    user_id INTEGER NOT NULL,
    group_jid TEXT NOT NULL,
    message_id TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    message_text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_jid, message_id)
);
CREATE INDEX IF NOT EXISTS idx_xmd_group_spam_lookup
ON xmd_group_spam_events(user_id, group_jid, participant_jid, created_at);
`);

const aliases = [
    "everyone", "hidetag", "totag", "add", "kick", "remove", "ban", "unban",
    "promote", "demote", "promoteall", "demoteall", "mute", "unmute", "groupopen",
    "groupclose", "grouplink", "revoke", "setname", "setdesc", "setppgc", "delppgc",
    "grouprules", "setrules", "warn", "unwarn", "resetwarn", "warnlist", "setwarn",
    "welcome", "setwelcome", "goodbye", "setgoodbye", "antilink", "antilinkkick",
    "antilinkwarn", "antiwame", "antispam", "antitoxic", "addbadword", "delbadword",
    "listbadword", "antiviewonce", "antidelete", "antifake", "setfake", "antibot",
    "antisticker", "antimedia", "antitag", "anticall", "groupinfo", "admins", "inactive",
    "kickinactive", "active", "poll", "pin", "unpin", "delete", "purge", "approveall",
    "rejectall", "requests", "ephemeral", "restrict", "unrestrict", "slowmode", "lockcmd",
    "unlockcmd", "blacklist", "unblacklist", "leave", "invite"
];

const commandSet = new Set(["tagall", ...aliases]);
const DEFAULTS = {
    welcome: false,
    goodbye: false,
    welcomeText: "Welcome @user to @group! Please read the group rules.",
    goodbyeText: "@user has left @group.",
    antiLinkMode: "off",
    antiWame: false,
    antiSpam: false,
    antiToxic: false,
    antiSticker: false,
    antiMedia: false,
    antiTag: false,
    antiFake: false,
    antiCall: false,
    antiDelete: false,
    slowmode: 0,
    warnLimit: 3,
    fakePrefixes: [],
    lockedCommands: []
};

function getText(msg) {
    const m = msg?.message || {};
    return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || "").trim();
}
function digitsOf(jid) {
    return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}
function sameJid(a, b) {
    if (!a || !b) return false;
    if (String(a) === String(b)) return true;
    const da = digitsOf(a);
    const db = digitsOf(b);
    return da.length >= 7 && db.length >= 7 && da === db;
}
function participantIds(p) {
    if (typeof p === "string") return [p];
    return [p?.phoneNumber, p?.id, p?.jid].filter(Boolean);
}
function getActorIds(msg) {
    return [msg?.key?.participant, msg?.key?.participantAlt, msg?.key?.remoteJid].filter(Boolean);
}
function isMemberMatch(p, ids) {
    const candidates = participantIds(p);
    return ids.some(id => candidates.some(candidate => sameJid(id, candidate)));
}
function invalidateMeta(sock, jid) {
    metadataCache.delete(`${sock.user?.id || "unknown"}:${jid}`);
}
function getSettings(userId, groupJid) {
    const row = db.prepare(`SELECT settings FROM xmd_group_settings WHERE user_id = ? AND group_jid = ?`).get(Number(userId), groupJid);
    let saved = {};
    try { saved = row ? JSON.parse(row.settings) : {}; } catch { saved = {}; }
    return { ...DEFAULTS, ...saved };
}
function saveSettings(userId, groupJid, settings) {
    db.prepare(`
        INSERT INTO xmd_group_settings (user_id, group_jid, settings, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, group_jid) DO UPDATE SET
            settings = excluded.settings,
            updated_at = CURRENT_TIMESTAMP
    `).run(Number(userId), groupJid, JSON.stringify(settings));
}
function getQuotedContext(msg) {
    return msg?.message?.extendedTextMessage?.contextInfo ||
        msg?.message?.imageMessage?.contextInfo ||
        msg?.message?.videoMessage?.contextInfo || {};
}
function getTargetIds(msg, args) {
    const context = getQuotedContext(msg);
    const quotedParticipant = context.participantPn || context.participant;
    const targets = [
        ...(Array.isArray(context.mentionedJid) ? context.mentionedJid : []),
        quotedParticipant
    ].filter(Boolean);
    for (const token of (args || [])) {
        const digits = String(token).replace(/\D/g, "");
        if (digits.length >= 7 && digits.length <= 15) targets.push(`${digits}@s.whatsapp.net`);
    }
    return [...new Set(targets)];
}
function targetLabel(jid) { return `@${digitsOf(jid) || String(jid).split("@")[0]}`; }
function getBotIds(sock) {
    return [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber].filter(Boolean);
}
function isAdmin(meta, ids) {
    return (meta.participants || []).some(p => p.admin && isMemberMatch(p, ids));
}
function isBotAdmin(meta, sock) { return isAdmin(meta, getBotIds(sock)); }
const metadataCache = new Map();
async function getMeta(sock, jid) {
    const cacheKey = `${sock.user?.id || "unknown"}:${jid}`;
    const cached = metadataCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60000) return cached.value;
    const value = await sock.groupMetadata(jid);
    metadataCache.set(cacheKey, { at: Date.now(), value });
    return value;
}
async function reply(sock, jid, text, extra = {}) {
    return sock.sendMessage(jid, { text, ...extra });
}
async function requireAdmin(sock, msg, meta, botNeeded = true, delegatedAdmin = false) {
    const jid = msg.key.remoteJid;
    const actorIds = [...getActorIds(msg), ...(msg.key.fromMe ? getBotIds(sock) : [])];
    if (!delegatedAdmin && !isAdmin(meta, actorIds)) {
        await reply(sock, jid, "Only WhatsApp group admins can use this command.");
        return false;
    }
    if (botNeeded && !isBotAdmin(meta, sock)) {
        await reply(sock, jid, "Please make OLU-XMD a group admin first so it can perform this action.");
        return false;
    }
    return true;
}
function parseOnOff(value, current) {
    const v = String(value || "").toLowerCase();
    if (["on", "yes", "enable", "enabled"].includes(v)) return true;
    if (["off", "no", "disable", "disabled"].includes(v)) return false;
    return !current;
}
function getMentionJids(meta) {
    return (meta.participants || []).map(p => p.phoneNumber || p.id || p.jid).filter(Boolean);
}
function quoteKey(msg, jid) {
    const ctx = getQuotedContext(msg);
    if (!ctx.stanzaId || !ctx.quotedMessage) return null;
    return {
        key: {
            remoteJid: jid,
            id: ctx.stanzaId,
            participant: ctx.participantPn || ctx.participant,
            fromMe: false
        },
        message: ctx.quotedMessage
    };
}
function contentType(msg) {
    const m = msg?.message || {};
    return Object.keys(m).find(k => k.endsWith("Message") && !["messageContextInfo", "senderKeyDistributionMessage"].includes(k)) || "";
}
async function warnUser(userId, groupJid, target, settings) {
    db.prepare(`
        INSERT INTO xmd_group_warnings (user_id, group_jid, participant_jid, warning_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(user_id, group_jid, participant_jid) DO UPDATE SET
            warning_count = warning_count + 1,
            updated_at = CURRENT_TIMESTAMP
    `).run(Number(userId), groupJid, target);
    return db.prepare(`SELECT warning_count FROM xmd_group_warnings WHERE user_id = ? AND group_jid = ? AND participant_jid = ?`).get(Number(userId), groupJid, target).warning_count;
}
async function execute(sock, msg, { args = [], userId, prefix = ".", isOwner = false, isDeploymentOwner = false, isSudo = false } = {}) {
    const jid = msg.key.remoteJid;
    if (!jid?.endsWith("@g.us")) {
        await reply(sock, jid, "This command can only be used inside a WhatsApp group.");
        return;
    }
    const text = getText(msg);
    const words = text.slice(prefix.length).trim().split(/\s+/);
    const name = (words.shift() || "").toLowerCase();
    const params = words;
    const delegatedAdmin = Boolean(isOwner || isDeploymentOwner || isSudo);
    const meta = await getMeta(sock, jid);
    const settings = getSettings(userId, jid);
    const botAdmin = isBotAdmin(meta, sock);
    const adminOnly = new Set([
        "tagall", "everyone", "hidetag", "totag", "add", "kick", "remove", "ban", "unban",
        "promote", "demote", "promoteall", "demoteall", "mute", "unmute", "groupopen", "groupclose",
        "grouplink", "revoke", "setname", "setdesc", "setppgc", "delppgc", "setrules", "warn", "unwarn",
        "resetwarn", "warnlist", "setwarn", "welcome", "setwelcome", "goodbye", "setgoodbye", "antilink",
        "antilinkkick", "antilinkwarn", "antiwame", "antispam", "antitoxic", "addbadword", "delbadword",
        "listbadword", "antiviewonce", "antifake", "setfake", "antibot", "antisticker", "antimedia",
        "antitag", "anticall", "kickinactive", "poll", "pin", "unpin", "delete", "purge", "approveall",
        "rejectall", "ephemeral", "restrict", "unrestrict", "slowmode", "lockcmd", "unlockcmd", "blacklist",
        "unblacklist", "antidelete", "leave", "invite"
    ]);
    if (adminOnly.has(name)) {
        const botNeeded = !["tagall", "everyone", "hidetag", "totag", "groupinfo", "admins", "grouprules", "warnlist", "requests", "active", "inactive", "blacklist", "unblacklist", "antibot", "antiviewonce", "antidelete", "leave", "anticall", "welcome", "setwelcome", "goodbye", "setgoodbye"].includes(name);
        if (!(await requireAdmin(sock, msg, meta, botNeeded, delegatedAdmin))) return;
    }

    const participants = meta.participants || [];
    const mentions = getMentionJids(meta);
    const targetIds = getTargetIds(msg, params);
    const oneTarget = targetIds[0];
    const context = getQuotedContext(msg);

    switch (name) {
        case "tagall":
        case "everyone": {
            if (!mentions.length) return reply(sock, jid, "No group participants were found.");
            const prefixText = params.join(" ") || "Attention everyone!";
            const batchSize = 35;
            for (let i = 0; i < mentions.length; i += batchSize) {
                const batch = mentions.slice(i, i + batchSize);
                const lines = batch.map(p => `@${digitsOf(p) || p.split("@")[0]}`).join(" ");
                await reply(sock, jid, `${prefixText}\n\n${lines}`, { mentions: batch });
            }
            break;
        }
        case "hidetag": {
            const quoted = quoteKey(msg, jid);
            const quotedMessage = quoted?.message || {};

            const quotedText = (
                quotedMessage.conversation ||
                quotedMessage.extendedTextMessage?.text ||
                quotedMessage.imageMessage?.caption ||
                quotedMessage.videoMessage?.caption ||
                quotedMessage.documentMessage?.caption ||
                ""
            ).trim();

            const inlineText = params.join(" ").trim();
            const announcement = inlineText || quotedText;

            if (!announcement) {
                return reply(sock, jid,
                    `Usage: ${prefix}hidetag Your announcement`
                );
            }

            // Publish the clean announcement with hidden mentions.
            await reply(sock, jid, announcement, { mentions });

            // When using reply mode, remove the original announcement if permitted.
            if (quoted && !inlineText) {
                const quotedSender = quoted.key.participant;
                const quotedByBot = getBotIds(sock).some(
                    id => sameJid(id, quotedSender)
                );

                if (quotedByBot || botAdmin) {
                    try {
                        await sock.sendMessage(jid, { delete: {
                            ...quoted.key,
                            fromMe: quotedByBot
                        }});
                    } catch (error) {
                        console.error("Original announcement deletion failed:", error);
                    }
                }
            }

            // Remove the original .hidetag command message.
            if (msg.key?.id && (msg.key.fromMe || botAdmin)) {
                try {
                    await sock.sendMessage(jid, { delete: msg.key });
                    console.log("HIDETAG: Original command message deleted.");
                } catch (error) {
                    console.error("HIDETAG command deletion failed:", error);
                    await reply(sock, jid,
                        "Announcement published, but the original command could not be deleted."
                    );
                }
            } else if (msg.key?.id) {
                await reply(sock, jid,
                    "Announcement published. OLU-XMD needs group admin privileges to delete your command message."
                );
            }

            break;
        }
        case "totag": {
            const quoted = quoteKey(msg, jid);
            if (!quoted) return reply(sock, jid, "Reply to the message you want to highlight, then type .totag.");
            await sock.sendMessage(jid, {
                text: params.join(" ") || "Attention everyone!",
                mentions
            }, { quoted });
            break;
        }
        case "add": {
            const number = String(params[0] || "").replace(/\D/g, "");
            if (number.length < 8 || number.length > 15) return reply(sock, jid, `Usage: ${prefix}add 2348012345678`);
            const target = `${number}@s.whatsapp.net`;
            const banned = db.prepare(`SELECT 1 FROM xmd_group_blacklist WHERE user_id=? AND group_jid=? AND participant_jid=?`).get(Number(userId), jid, target);
            if (banned) return reply(sock, jid, "This number is blacklisted in this group. Use .unban first.");
            const result = await sock.groupParticipantsUpdate(jid, [target], "add");
            await reply(sock, jid, `Add request sent for ${number}. WhatsApp may require the person to accept an invitation.`);
            break;
        }
        case "kick":
        case "remove":
        case "ban": {
            if (!targetIds.length) return reply(sock, jid, `Mention or reply to a member, or provide an international number. Example: ${prefix}${name} 2348012345678`);
            if (name === "ban") {
                const insert = db.prepare(`INSERT OR IGNORE INTO xmd_group_blacklist (user_id, group_jid, participant_jid) VALUES (?, ?, ?)`);
                targetIds.forEach(target => insert.run(Number(userId), jid, target));
            }
            await sock.groupParticipantsUpdate(jid, targetIds, "remove");
            await reply(sock, jid, `${targetIds.length} member(s) ${name === "ban" ? "banned and removed" : "removed"}.`);
            break;
        }
        case "unban":
        case "unblacklist": {
            if (!oneTarget) return reply(sock, jid, `Mention or provide a phone number. Example: ${prefix}${name} 2348012345678`);
            const result = db.prepare(`DELETE FROM xmd_group_blacklist WHERE user_id=? AND group_jid=? AND participant_jid=?`).run(Number(userId), jid, oneTarget);
            await reply(sock, jid, result.changes ? "Member removed from the group blacklist." : "That member was not on the group blacklist.");
            break;
        }
        case "promote":
        case "demote": {
            if (!oneTarget) return reply(sock, jid, `Mention or reply to a member. Usage: ${prefix}${name} @member`);
            await sock.groupParticipantsUpdate(jid, [oneTarget], name);
            await reply(sock, jid, `Member ${name === "promote" ? "promoted to" : "removed from"} group admin.`);
            break;
        }
        case "promoteall":
        case "demoteall": {
            if (String(params[0] || "").toLowerCase() !== "confirm") return reply(sock, jid, `This affects many members. Type ${prefix}${name} confirm to proceed.`);
            const botIds = getBotIds(sock);
            const actorIds = [
        ...getActorIds(msg),
        ...(msg.key.fromMe
            ? [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber]
            : [])
    ].filter(Boolean);
            const targets = participants.filter(p => {
                const ids = participantIds(p);
                if (ids.some(id => botIds.some(b => sameJid(id, b)) || actorIds.some(a => sameJid(id, a)))) return false;
                if (name === "demoteall" && (p.admin === "superadmin" || p.isSuperAdmin)) return false;
                return name === "promoteall" ? !p.admin : !!p.admin;
            }).map(p => p.id || p.phoneNumber).filter(Boolean);
            if (!targets.length) return reply(sock, jid, "No eligible members were found.");
            await sock.groupParticipantsUpdate(jid, targets, name === "promoteall" ? "promote" : "demote");
            await reply(sock, jid, `${targets.length} eligible members processed.`);
            break;
        }
        case "mute":
        case "groupclose":
            await sock.groupSettingUpdate(jid, "announcement");
            await reply(sock, jid, "Group closed: only admins can send messages.");
            break;
        case "unmute":
        case "groupopen":
            await sock.groupSettingUpdate(jid, "not_announcement");
            await reply(sock, jid, "Group opened: all members can send messages.");
            break;
        case "restrict":
            await sock.groupSettingUpdate(jid, "locked");
            await reply(sock, jid, "Group information editing is now restricted to admins.");
            break;
        case "unrestrict":
            await sock.groupSettingUpdate(jid, "unlocked");
            await reply(sock, jid, "Group members can edit group information again.");
            break;
        case "grouplink": {
            const code = await sock.groupInviteCode(jid);
            await reply(sock, jid, `Group invite link:\nhttps://chat.whatsapp.com/${code}`);
            break;
        }
        case "revoke": {
            const code = await sock.groupRevokeInvite(jid);
            await reply(sock, jid, `Old invite link revoked. New link:\nhttps://chat.whatsapp.com/${code}`);
            break;
        }
        case "setname": {
            const subject = params.join(" ").trim();
            if (!subject) return reply(sock, jid, `Usage: ${prefix}setname New group name`);
            await sock.groupUpdateSubject(jid, subject.slice(0, 100));
            await reply(sock, jid, "Group name updated.");
            break;
        }
        case "setdesc": {
            const description = params.join(" ").trim();
            if (!description) return reply(sock, jid, `Usage: ${prefix}setdesc New group description`);
            await sock.groupUpdateDescription(jid, description.slice(0, 2048));
            await reply(sock, jid, "Group description updated.");
            break;
        }
        case "setppgc": {
            const quoted = quoteKey(msg, jid);
            if (!quoted || !quoted.message?.imageMessage) return reply(sock, jid, "Reply to an image with .setppgc to use it as the group picture.");
            const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
            const buffer = await downloadMediaMessage(quoted, "buffer", {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage });
            await sock.updateProfilePicture(jid, buffer);
            await reply(sock, jid, "Group profile picture updated.");
            break;
        }
        case "delppgc":
            await sock.removeProfilePicture(jid);
            await reply(sock, jid, "Group profile picture removed.");
            break;
        case "grouprules":
            await reply(sock, jid, settings.rules ? `📜 GROUP RULES\n\n${settings.rules}` : "No group rules have been saved. A group admin can use .setrules your rules.");
            break;
        case "setrules":
            settings.rules = params.join(" ").trim().slice(0, 3000);
            if (!settings.rules) return reply(sock, jid, `Usage: ${prefix}setrules Be respectful...`);
            saveSettings(userId, jid, settings);
            await reply(sock, jid, "Group rules saved.");
            break;
        case "warn": {
            if (!oneTarget) return reply(sock, jid, `Mention or reply to a member. Usage: ${prefix}warn @member [reason]`);
            const count = await warnUser(userId, jid, oneTarget, settings);
            const reason = params.slice(1).join(" ");
            await reply(sock, jid, `${targetLabel(oneTarget)} received warning ${count}/${settings.warnLimit}.${reason ? `\nReason: ${reason}` : ""}`, { mentions: [oneTarget] });
            if (count >= settings.warnLimit) {
                if (!botAdmin) return reply(sock, jid, "Warning limit reached, but OLU-XMD needs group admin privileges to remove the member.");
                await sock.groupParticipantsUpdate(jid, [oneTarget], "remove");
                await reply(sock, jid, "Warning limit reached. Member removed from the group.");
            }
            break;
        }
        case "unwarn": {
            if (!oneTarget) return reply(sock, jid, `Mention or reply to a member. Usage: ${prefix}unwarn @member`);
            const row = db.prepare(`SELECT warning_count FROM xmd_group_warnings WHERE user_id=? AND group_jid=? AND participant_jid=?`).get(Number(userId), jid, oneTarget);
            if (!row) return reply(sock, jid, "That member has no active warnings.");
            if (row.warning_count <= 1) db.prepare(`DELETE FROM xmd_group_warnings WHERE user_id=? AND group_jid=? AND participant_jid=?`).run(Number(userId), jid, oneTarget);
            else db.prepare(`UPDATE xmd_group_warnings SET warning_count=warning_count-1, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND group_jid=? AND participant_jid=?`).run(Number(userId), jid, oneTarget);
            await reply(sock, jid, "One warning removed.");
            break;
        }
        case "resetwarn": {
            if (!oneTarget) return reply(sock, jid, `Mention or reply to a member. Usage: ${prefix}resetwarn @member`);
            db.prepare(`DELETE FROM xmd_group_warnings WHERE user_id=? AND group_jid=? AND participant_jid=?`).run(Number(userId), jid, oneTarget);
            await reply(sock, jid, "Member warnings cleared.");
            break;
        }
        case "warnlist": {
            const rows = db.prepare(`SELECT participant_jid, warning_count FROM xmd_group_warnings WHERE user_id=? AND group_jid=? ORDER BY warning_count DESC`).all(Number(userId), jid);
            await reply(sock, jid, rows.length ? "⚠️ GROUP WARNINGS\n\n" + rows.map(r => `${targetLabel(r.participant_jid)} — ${r.warning_count}`).join("\n") : "No active warnings.", { mentions: rows.map(r => r.participant_jid) });
            break;
        }
        case "setwarn": {
            const limit = Number(params[0]);
            if (!Number.isInteger(limit) || limit < 1 || limit > 10) return reply(sock, jid, `Usage: ${prefix}setwarn 3 (choose 1–10)`);
            settings.warnLimit = limit;
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `Warning removal limit set to ${limit}.`);
            break;
        }
        case "welcome":
        case "goodbye": {
            const key = name;
            settings[key] = parseOnOff(params[0], settings[key]);
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `${name} messages ${settings[key] ? "enabled" : "disabled"}.`);
            break;
        }
        case "setwelcome":
        case "setgoodbye": {
            const key = name === "setwelcome" ? "welcomeText" : "goodbyeText";
            const value = params.join(" ").trim();
            if (!value) return reply(sock, jid, `Usage: ${prefix}${name} Hello @user, welcome to @group!`);
            settings[key] = value.slice(0, 1000);
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `${name === "setwelcome" ? "Welcome" : "Goodbye"} template saved. Use @user and @group as placeholders.`);
            break;
        }
        case "antidelete": {
            settings.antiDelete = parseOnOff(params[0], settings.antiDelete);
            saveSettings(userId, jid, settings);

            await reply(
                sock,
                jid,
                settings.antiDelete
                    ? "Anti-delete enabled. Deleted group messages will be reported when their content was cached."
                    : "Anti-delete disabled."
            );
            break;
        }
        case "antilink":
        case "antilinkkick":
        case "antilinkwarn": {
            const enabled = parseOnOff(params[0], settings.antiLinkMode !== "off");
            settings.antiLinkMode = enabled ? (name === "antilinkkick" ? "kick" : name === "antilinkwarn" ? "warn" : "delete") : "off";
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `Anti-link mode: ${settings.antiLinkMode}.`);
            break;
        }
        case "antiwame":
            settings.antiWame = parseOnOff(params[0], settings.antiWame);
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `Anti-wa.me ${settings.antiWame ? "enabled" : "disabled"}.`);
            break;
        case "antifake": {
            settings.antiFake = parseOnOff(params[0], settings.antiFake);
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `antifake ${settings.antiFake ? "enabled" : "disabled"}.`);
            break;
        }
        case "anticall": {
            if (typeof sock.rejectCall !== "function") return reply(sock, jid, "Anti-call rejection is not available in this installed Baileys build.");
            const globalSettings = getSettings(userId, "__global__");
            globalSettings.antiCall = parseOnOff(params[0], globalSettings.antiCall);
            saveSettings(userId, "__global__", globalSettings);
            await reply(sock, jid, `Global anti-call ${globalSettings.antiCall ? "enabled" : "disabled"} for this connected OLU-XMD account.`);
            break;
        }
        case "antispam":
        case "antitoxic":
        case "antisticker":
        case "antimedia":
        case "antitag": {
            const key = ({ antispam: "antiSpam", antitoxic: "antiToxic", antisticker: "antiSticker", antimedia: "antiMedia", antitag: "antiTag" })[name];
            settings[key] = parseOnOff(params[0], settings[key]);
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `${name} ${settings[key] ? "enabled" : "disabled"}.`);
            break;
        }
        case "addbadword": {
            const word = params.join(" ").trim().toLowerCase();
            if (!word || word.length > 80) return reply(sock, jid, `Usage: ${prefix}addbadword word`);
            db.prepare(`INSERT OR IGNORE INTO xmd_group_badwords (user_id, group_jid, word) VALUES (?, ?, ?)`).run(Number(userId), jid, word);
            await reply(sock, jid, "Blocked word added.");
            break;
        }
        case "delbadword": {
            const word = params.join(" ").trim().toLowerCase();
            if (!word) return reply(sock, jid, `Usage: ${prefix}delbadword word`);
            const result = db.prepare(`DELETE FROM xmd_group_badwords WHERE user_id=? AND group_jid=? AND word=?`).run(Number(userId), jid, word);
            await reply(sock, jid, result.changes ? "Blocked word removed." : "That word was not in the filter.");
            break;
        }
        case "listbadword": {
            const rows = db.prepare(`SELECT word FROM xmd_group_badwords WHERE user_id=? AND group_jid=? ORDER BY word`).all(Number(userId), jid);
            await reply(sock, jid, rows.length ? "🚫 BLOCKED WORDS\n\n" + rows.map(r => `• ${r.word}`).join("\n") : "No blocked words configured.");
            break;
        }
        case "setfake": {
            const prefixes = params.join("").split(/[;,]/).map(v => v.replace(/\D/g, "")).filter(v => v.length >= 1 && v.length <= 5);
            if (!prefixes.length) return reply(sock, jid, `Usage: ${prefix}setfake 234,1,44 (international calling prefixes)`);
            settings.fakePrefixes = [...new Set(prefixes)];
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `Restricted country prefixes saved: ${settings.fakePrefixes.join(", ")}. Enable with .antifake on.`);
            break;
        }
        case "antibot":
            await reply(sock, jid, "Automatic third-party bot detection is not enabled: WhatsApp does not expose a reliable bot identity for ordinary group participants. Use .blacklist to block a known account from bot commands.");
            break;
        case "antiviewonce":
            await reply(sock, jid, "OLU-XMD will not bypass WhatsApp View Once privacy. This command is not enabled.");
            break;

        case "groupinfo": {
            const adminCount = participants.filter(p => p.admin).length;
            const created = meta.creation ? new Date(Number(meta.creation) * 1000).toLocaleString() : "Not provided by WhatsApp";
            await reply(sock, jid, `📋 GROUP INFORMATION\n\nName: ${meta.subject || "Unknown"}\nMembers: ${participants.length}\nAdmins: ${adminCount}\nCreated: ${created}\nAnti-link: ${settings.antiLinkMode}\nWelcome: ${settings.welcome ? "On" : "Off"}\nGoodbye: ${settings.goodbye ? "On" : "Off"}\nSlow mode: ${settings.slowmode ? `${settings.slowmode}s` : "Off"}`);
            break;
        }
        case "admins": {
            const admins = participants.filter(p => p.admin).map(p => p.phoneNumber || p.id).filter(Boolean);
            await reply(sock, jid, admins.length ? "👮 GROUP ADMINS\n\n" + admins.map(targetLabel).join("\n") : "No group admins were returned.", { mentions: admins });
            break;
        }
        case "inactive":
        case "kickinactive": {
            const days = Math.min(365, Math.max(1, Number(params[0]) || 30));
            const cutoff = Date.now() - days * 86400000;
            const rows = db.prepare(`SELECT participant_jid, last_seen, message_count FROM xmd_group_activity WHERE user_id=? AND group_jid=?`).all(Number(userId), jid);
            const stale = participants.filter(p => {
                if (p.admin || isMemberMatch(p, getBotIds(sock))) return false;
                const ids = participantIds(p);
                const activity = rows.find(r => ids.some(id => sameJid(id, r.participant_jid)));
                return !!activity && activity.last_seen < cutoff;
            });
            const targets = stale.map(p => p.phoneNumber || p.id).filter(Boolean);
            if (name === "inactive") return reply(sock, jid, targets.length ? `Inactive for ${days}+ days (${targets.length}):\n\n${targets.map(targetLabel).join("\n")}` : `No inactive members found for ${days}+ days.`, { mentions: targets });
            if (String(params[1] || "").toLowerCase() !== "confirm") return reply(sock, jid, `Found ${targets.length} inactive members. To remove up to 20 non-admins, type .kickinactive ${days} confirm.`);
            const batch = targets.slice(0, 20);
            if (!batch.length) return reply(sock, jid, "No eligible inactive members to remove.");
            await sock.groupParticipantsUpdate(jid, batch, "remove");
            await reply(sock, jid, `Removed ${batch.length} inactive members. Members are never removed automatically without confirmation.`);
            break;
        }
        case "active": {
            const rows = db.prepare(`SELECT participant_jid, message_count FROM xmd_group_activity WHERE user_id=? AND group_jid=? ORDER BY message_count DESC LIMIT 10`).all(Number(userId), jid);
            await reply(sock, jid, rows.length ? "🏆 MOST ACTIVE MEMBERS\n\n" + rows.map((r, i) => `${i + 1}. ${targetLabel(r.participant_jid)} — ${r.message_count} messages`).join("\n") : "No group activity has been recorded yet.", { mentions: rows.map(r => r.participant_jid) });
            break;
        }
        case "poll": {
            const parts = params.join(" ").split("|").map(v => v.trim()).filter(Boolean);
            if (parts.length < 3 || parts.length > 13) return reply(sock, jid, `Usage: ${prefix}poll Question? | Option 1 | Option 2 (2–12 options)`);
            await sock.sendMessage(jid, { poll: { name: parts[0].slice(0, 250), values: parts.slice(1).map(v => v.slice(0, 100)), selectableCount: 1 } });
            break;
        }
        case "pin":
        case "unpin": {
            const quoted = quoteKey(msg, jid);
            if (!quoted) return reply(sock, jid, `Reply to a message and type ${prefix}${name}.`);
            if (getBotIds(sock).some(id => sameJid(id, quoted.key.participant))) quoted.key.fromMe = true;
            await sock.sendMessage(jid, {
                pin: {
                    type: name === "pin" ? 1 : 0,
                    time: 86400,
                    key: quoted.key
                }
            });
            await reply(sock, jid, name === "pin" ? "Message pinned for 24 hours." : "Message unpinned.");
            break;
        }
        case "delete": {
            const quoted = quoteKey(msg, jid);
            if (!quoted) return reply(sock, jid, `Reply to a message and type ${prefix}delete.`);
            if (getBotIds(sock).some(id => sameJid(id, quoted.key.participant))) quoted.key.fromMe = true;
            await sock.sendMessage(jid, { delete: quoted.key });
            break;
        }
        case "purge": {
            const count = Math.min(30, Math.max(1, Number(params[0]) || 5));
            const rows = db.prepare(`SELECT message_id, participant_jid FROM xmd_group_messages WHERE user_id=? AND group_jid=? ORDER BY message_timestamp DESC LIMIT ?`).all(Number(userId), jid, count);
            if (!rows.length) return reply(sock, jid, "No recent messages are available to purge. New incoming group messages are recorded from now on.");
            let deleted = 0;
            for (const row of rows) {
                try {
                    await sock.sendMessage(jid, { delete: { remoteJid: jid, id: row.message_id, participant: row.participant_jid, fromMe: false } });
                    deleted++;
                } catch (error) { console.error("Group purge item failed:", error.message); }
            }
            await reply(sock, jid, `Purge attempted for ${rows.length} messages; ${deleted} deletion request(s) sent.`);
            break;
        }
        case "requests":
        case "approveall":
        case "rejectall": {
            const requests = await sock.groupRequestParticipantsList(jid);
            const ids = (requests || []).map(r => r.jid || r.id || r.participant).filter(Boolean);
            if (name === "requests") return reply(sock, jid, ids.length ? `Pending join requests (${ids.length}):\n\n${ids.map(targetLabel).join("\n")}` : "There are no pending join requests.", { mentions: ids });
            if (!ids.length) return reply(sock, jid, "There are no pending join requests to process.");
            const result = await sock.groupRequestParticipantsUpdate(jid, ids, name === "approveall" ? "approve" : "reject");
            await reply(sock, jid, `${name === "approveall" ? "Approval" : "Rejection"} requests submitted for ${ids.length} member(s).`);
            break;
        }
        case "ephemeral": {
            const value = String(params[0] || "").toLowerCase();
            const durations = { off: 0, "24h": 86400, "7d": 604800, "90d": 7776000 };
            if (!(value in durations)) return reply(sock, jid, `Usage: ${prefix}ephemeral 24h | 7d | 90d | off`);
            await sock.groupToggleEphemeral(jid, durations[value]);
            await reply(sock, jid, `Disappearing messages set to ${value}.`);
            break;
        }
        case "slowmode": {
            const seconds = Math.max(0, Math.min(3600, Number(params[0]) || 0));
            settings.slowmode = seconds;
            saveSettings(userId, jid, settings);
            await reply(sock, jid, seconds ? `Slow mode enabled: one message every ${seconds} seconds for non-admins.` : "Slow mode disabled.");
            break;
        }
        case "lockcmd":
        case "unlockcmd": {
            const targetCommand = String(params[0] || "").replace(/^\./, "").toLowerCase();
            if (!/^[a-z][a-z0-9_-]{0,29}$/.test(targetCommand)) return reply(sock, jid, `Usage: ${prefix}${name} commandname`);
            const locked = new Set(settings.lockedCommands || []);
            if (name === "lockcmd") locked.add(targetCommand); else locked.delete(targetCommand);
            settings.lockedCommands = [...locked];
            saveSettings(userId, jid, settings);
            await reply(sock, jid, `Command .${targetCommand} ${name === "lockcmd" ? "locked" : "unlocked"} for non-admin members.`);
            break;
        }
        case "blacklist": {
            if (!oneTarget) return reply(sock, jid, `Mention/reply to a member or supply a phone number: ${prefix}blacklist 2348012345678`);
            db.prepare(`INSERT OR IGNORE INTO xmd_group_blacklist (user_id, group_jid, participant_jid) VALUES (?, ?, ?)`).run(Number(userId), jid, oneTarget);
            await reply(sock, jid, `${targetLabel(oneTarget)} can no longer trigger bot commands in this group.`, { mentions: [oneTarget] });
            break;
        }
        case "leave":
            await reply(sock, jid, "OLU-XMD is leaving this group.");
            await sock.groupLeave(jid);
            break;
        case "invite": {
            const number = String(params[0] || "").replace(/\D/g, "");
            if (number.length < 8 || number.length > 15) return reply(sock, jid, `Usage: ${prefix}invite 2348012345678`);
            const code = await sock.groupInviteCode(jid);
            await sock.sendMessage(`${number}@s.whatsapp.net`, { text: `You are invited to join ${meta.subject || "a WhatsApp group"}:\nhttps://chat.whatsapp.com/${code}` });
            await reply(sock, jid, `Group invitation sent to ${number}.`);
            break;
        }
        default:
            await reply(sock, jid, `Command .${name} is registered but not implemented in this build.`);
    }
}

async function handleMessage(sock, msg, { userId, prefix = "." } = {}) {
    const jid = msg?.key?.remoteJid;
    if (!jid?.endsWith("@g.us") || !msg.message || msg.key.fromMe) return false;
    const actorIds = [
        ...getActorIds(msg),
        ...(msg.key.fromMe
            ? [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber]
            : [])
    ].filter(Boolean);
    const actor = msg.key.participantAlt || msg.key.participant;
    if (!actor) return false;
    const text = getText(msg);
    const settings = getSettings(userId, jid);

    if (settings.antiDelete && msg.key.id) {
        const cacheNow = Date.now();
        const messageType = contentType(msg);
        const mediaLabels = {
            imageMessage: "[Image message]",
            videoMessage: "[Video message]",
            audioMessage: "[Audio message]",
            documentMessage: "[Document message]",
            stickerMessage: "[Sticker message]",
            locationMessage: "[Location message]",
            contactMessage: "[Contact message]",
            pollCreationMessage: "[Poll message]"
        };

        const cachedText = (
            text ||
            mediaLabels[messageType] ||
            (messageType ? `[${messageType}]` : "[Unsupported message]")
        ).slice(0, 3000);

        db.prepare(`
            INSERT OR REPLACE INTO xmd_group_text_cache
            (user_id, group_jid, message_id, participant_jid, message_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(Number(userId), jid, msg.key.id, actor, cachedText, cacheNow);

        // Keep at most 300 cached messages per group and remove records older than 24 hours.
        db.prepare(`
            DELETE FROM xmd_group_text_cache
            WHERE user_id = ? AND group_jid = ?
            AND (
                created_at < ?
                OR message_id NOT IN (
                    SELECT message_id
                    FROM xmd_group_text_cache
                    WHERE user_id = ? AND group_jid = ?
                    ORDER BY created_at DESC
                    LIMIT 300
                )
            )
        `).run(Number(userId), jid, cacheNow - 86400000, Number(userId), jid);
    }

    const isCommand = text.startsWith(prefix);
    let meta;
    try { meta = await getMeta(sock, jid); } catch (error) { console.error("Group automation metadata error:", error.message); return false; }
    const senderAdmin = isAdmin(meta, actorIds);

    const now = Date.now();
    if (settings.antiSpam || settings.slowmode > 0) {
        db.prepare(`INSERT INTO xmd_group_spam_events (user_id, group_jid, participant_jid, created_at) VALUES (?, ?, ?, ?)`)
            .run(Number(userId), jid, actor, now);
        db.prepare(`DELETE FROM xmd_group_spam_events WHERE user_id=? AND group_jid=? AND created_at<?`)
            .run(Number(userId), jid, now - 3600000);
    }

    if (msg.key.id) {
        db.prepare(`
            INSERT INTO xmd_group_activity (user_id, group_jid, participant_jid, last_seen, last_message_at, message_count)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(user_id, group_jid, participant_jid) DO UPDATE SET
                last_seen=excluded.last_seen,
                last_message_at=excluded.last_message_at,
                message_count=xmd_group_activity.message_count+1
        `).run(Number(userId), jid, actor, now, now);
        db.prepare(`INSERT OR IGNORE INTO xmd_group_messages (user_id, group_jid, message_id, participant_jid, message_timestamp) VALUES (?, ?, ?, ?, ?)`)
            .run(Number(userId), jid, msg.key.id, actor, now);
        db.prepare(`DELETE FROM xmd_group_messages WHERE user_id=? AND group_jid=? AND message_id NOT IN (SELECT message_id FROM xmd_group_messages WHERE user_id=? AND group_jid=? ORDER BY message_timestamp DESC LIMIT 150)`)
            .run(Number(userId), jid, Number(userId), jid);
    }

    const blacklistRows = db.prepare(`SELECT participant_jid FROM xmd_group_blacklist WHERE user_id=? AND group_jid=?`).all(Number(userId), jid);
    const isBlacklisted = blacklistRows.some(row => actorIds.some(id => sameJid(id, row.participant_jid)));
    if (isCommand && isBlacklisted && !senderAdmin) {
        await reply(sock, jid, "You are blocked from using OLU-XMD commands in this group.");
        return true;
    }
    if (isCommand) {
        const commandName = text.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();
        if ((settings.lockedCommands || []).includes(commandName) && !senderAdmin) {
            await reply(sock, jid, `The .${commandName} command is locked for group members.`);
            return true;
        }
        return false;
    }
    if (senderAdmin) return false;

    const type = contentType(msg);
    const ctx = getQuotedContext(msg);
    const mentionedCount = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid.length : 0;
    const lower = text.toLowerCase();
    const badWords = db.prepare(`SELECT word FROM xmd_group_badwords WHERE user_id=? AND group_jid=?`).all(Number(userId), jid).map(r => r.word);
    let reason = "";
    let mode = "delete";

    const isWaLink = /(?:https?:\/\/)?(?:www\.)?(?:wa\.me\/|api\.whatsapp\.com\/send)/i.test(text);
    const isLink = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|bit\.ly\/)/i.test(text);
    if (settings.antiWame && isWaLink) reason = "WhatsApp direct links are not allowed";
    else if (settings.antiLinkMode !== "off" && isLink) { reason = "External links are not allowed"; mode = settings.antiLinkMode; }
    else if (settings.antiToxic && text && badWords.some(w => lower.includes(w))) reason = "Blocked language is not allowed";
    else if (settings.antiSticker && type === "stickerMessage") reason = "Stickers are disabled";
    else if (settings.antiMedia && ["imageMessage", "videoMessage", "documentMessage", "audioMessage"].includes(type)) reason = "Media messages are disabled";
    else if (settings.antiTag && mentionedCount >= 5) reason = "Mass tagging is not allowed";

    if (settings.antiSpam) {
        db.prepare(`DELETE FROM xmd_group_spam_events WHERE user_id=? AND group_jid=? AND created_at<?`)
            .run(Number(userId), jid, Date.now() - 6000);
        const count = db.prepare(`SELECT COUNT(*) AS n FROM xmd_group_spam_events WHERE user_id=? AND group_jid=? AND participant_jid=? AND created_at>=?`)
            .get(Number(userId), jid, actor, now - 6000).n;
        if (!reason && count > 5) reason = "Please slow down; message flooding is not allowed";
    }
    if (!reason && settings.slowmode > 0) {
        const row = db.prepare(`SELECT last_message_at FROM xmd_group_activity WHERE user_id=? AND group_jid=? AND participant_jid=?`).get(Number(userId), jid, actor);
        // A separate recent-event query avoids counting the current message as its own cooldown.
        const events = db.prepare(`SELECT created_at FROM xmd_group_spam_events WHERE user_id=? AND group_jid=? AND participant_jid=? ORDER BY created_at DESC LIMIT 2`).all(Number(userId), jid, actor);
        const previous = events.length > 1 ? events[1].created_at : 0;
        if (previous && Date.now() - previous < settings.slowmode * 1000) reason = `Slow mode is active. Wait ${Math.ceil((settings.slowmode * 1000 - (Date.now() - previous)) / 1000)} second(s).`;
    }
    if (!hasGroupAccess(userId)) return false;
    if (!reason) return false;

    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (error) { console.error("Group moderation delete failed:", error.message); }
    if (mode === "kick" && settings.antiLinkMode === "kick") {
        try { await sock.groupParticipantsUpdate(jid, [actor], "remove"); } catch (error) { console.error("Anti-link removal failed:", error.message); }
    } else if (mode === "warn" && settings.antiLinkMode === "warn") {
        const count = await warnUser(userId, jid, actor, settings);
        if (count >= settings.warnLimit) {
            try { await sock.groupParticipantsUpdate(jid, [actor], "remove"); } catch (error) { console.error("Anti-link warning removal failed:", error.message); }
        }
    }
    await reply(sock, jid, `⚠️ ${reason}.`);
    return true;
}

async function handleParticipantsUpdate(sock, update, { userId } = {}) {
    if (!update?.id?.endsWith("@g.us") || !hasGroupAccess(userId)) return;
    const jid = update.id;
    invalidateMeta(sock, jid);
    const settings = getSettings(userId, jid);
    const meta = await getMeta(sock, jid).catch(() => null);
    const botAdmin = meta ? isBotAdmin(meta, sock) : false;
    for (const entry of (update.participants || [])) {
        const ids = participantIds(entry);
        const target = ids[0];
        if (!target) continue;
        if (update.action === "add") {
            const bannedRows = db.prepare(`SELECT participant_jid FROM xmd_group_blacklist WHERE user_id=? AND group_jid=?`).all(Number(userId), jid);
            const banned = bannedRows.some(row => ids.some(id => sameJid(id, row.participant_jid)));
            const phone = ids.map(digitsOf).find(v => v.length >= 7) || "";
            const fake = settings.antiFake && (settings.fakePrefixes || []).some(prefix => phone.startsWith(prefix));
            if ((banned || fake) && botAdmin) {
                try { await sock.groupParticipantsUpdate(jid, [target], "remove"); } catch (error) { console.error("Join protection removal failed:", error.message); }
                continue;
            }
            if (settings.welcome) {
                const groupName = meta?.subject || "this group";
                const body = settings.welcomeText.replace(/@user/g, targetLabel(target)).replace(/@group/g, groupName);
                await reply(sock, jid, body, { mentions: [target] });
            }
        } else if (update.action === "remove" && settings.goodbye) {
            const groupName = meta?.subject || "this group";
            const body = settings.goodbyeText.replace(/@user/g, targetLabel(target)).replace(/@group/g, groupName);
            await reply(sock, jid, body, { mentions: [target] });
        }
    }
}


async function handleMessagesDelete(sock, event, { userId } = {}) {
    if (!hasGroupAccess(userId) || !Array.isArray(event?.keys)) return;

    for (const key of event.keys) {
        const jid = key?.remoteJid;
        const messageId = key?.id;

        if (!jid?.endsWith("@g.us") || !messageId) continue;

        const settings = getSettings(userId, jid);
        if (!settings.antiDelete) continue;

        const cached = db.prepare(`
            SELECT participant_jid, message_text
            FROM xmd_group_text_cache
            WHERE user_id = ? AND group_jid = ? AND message_id = ?
        `).get(Number(userId), jid, messageId);

        if (!cached) continue;

        const sender = cached.participant_jid;
        const senderText = targetLabel(sender);

        try {
            await sock.sendMessage(jid, {
                text:
                    "🗑️ DELETED MESSAGE DETECTED\n\n" +
                    `Sender: ${senderText}\n` +
                    `Message:\n${cached.message_text}`,
                mentions: sender ? [sender] : []
            });

            db.prepare(`
                DELETE FROM xmd_group_text_cache
                WHERE user_id = ? AND group_jid = ? AND message_id = ?
            `).run(Number(userId), jid, messageId);

        } catch (error) {
            console.error("ANTI-DELETE REPORT ERROR:", error.message);
        }
    }
}

async function handleCall(sock, calls, { userId } = {}) {
    if (!Array.isArray(calls) || !hasGroupAccess(userId)) return;
    const settings = getSettings(userId, "__global__");
    if (!settings.antiCall || typeof sock.rejectCall !== "function") return;
    for (const call of calls) {
        if (call.status !== "offer") continue;
        try { await sock.rejectCall(call.id, call.from); }
        catch (error) { console.error("Anti-call reject failed:", error.message); }
    }
}

module.exports = {
    name: "tagall",
    aliases,
    description: "OLU-XMD group management and moderation commands",
    execute,
    handleMessage,
    handleParticipantsUpdate,
    handleMessagesDelete,
    handleCall
};