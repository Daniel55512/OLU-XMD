const db = require("../database");

db.exec(`
    CREATE TABLE IF NOT EXISTS xmd_deployment_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        jid TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'sudo',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, jid)
    );

    CREATE TABLE IF NOT EXISTS xmd_deployment_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        jid TEXT NOT NULL,
        blocked_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, jid)
    );
`);

function normalizeJid(value) {
    if (!value) return "";

    const raw = String(value).trim().toLowerCase();

    if (raw.includes("@")) {
        return raw.replace(/:\d+(?=@)/, "");
    }

    const digits = raw.replace(/\D/g, "");
    return digits ? `${digits}@s.whatsapp.net` : "";
}

function getTarget(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    if (raw.includes("@")) return normalizeJid(raw);

    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";

    return `${digits}@s.whatsapp.net`;
}

function isSudo(userId, jid) {
    const normalized = normalizeJid(jid);
    if (!userId || !normalized) return false;

    return Boolean(db.prepare(`
        SELECT 1 FROM xmd_deployment_admins
        WHERE user_id = ? AND jid = ? AND role = 'sudo'
    `).get(Number(userId), normalized));
}

function isBlocked(userId, senderJids = []) {
    if (!userId) return false;

    const candidates = [...new Set(
        senderJids.map(normalizeJid).filter(Boolean)
    )];

    if (!candidates.length) return false;

    const check = db.prepare(`
        SELECT 1 FROM xmd_deployment_blocks
        WHERE user_id = ? AND jid = ?
    `);

    return candidates.some(jid => Boolean(check.get(Number(userId), jid)));
}

async function execute(sock, msg, {
    args = [],
    userId,
    isDeploymentOwner = false,
    isOwner = false,
    prefix = "."
} = {}) {
    const command = String(
        msg?.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        ""
    ).trim().split(/\s+/)[0].slice(prefix.length).toLowerCase();

    const chat = msg.key.remoteJid;
    const action = String(args[0] || "").toLowerCase();
    const target = getTarget(args[1]);

    if (!isDeploymentOwner && !isOwner) {
        return sock.sendMessage(chat, {
            text: "Only this deployment's owner can manage sudo users and blocked users."
        }, { quoted: msg });
    }

    if (command === "sudo") {
        if (action === "list") {
            const rows = db.prepare(`
                SELECT jid FROM xmd_deployment_admins
                WHERE user_id = ? AND role = 'sudo'
                ORDER BY created_at ASC
            `).all(Number(userId));

            return sock.sendMessage(chat, {
                text: rows.length
                    ? "OLU-XMD SUDO USERS\n\n" + rows.map((row, i) =>
                        `${i + 1}. ${row.jid}`
                    ).join("\n")
                    : "No sudo users have been added to this deployment."
            }, { quoted: msg });
        }

        if (!["add", "remove"].includes(action) || !target) {
            return sock.sendMessage(chat, {
                text:
                    "DEPLOYMENT SUDO MANAGEMENT\n\n" +
                    `${prefix}sudo add 234XXXXXXXXX\n` +
                    `${prefix}sudo remove 234XXXXXXXXX\n` +
                    `${prefix}sudo list\n\n` +
                    "Only this deployment's owner can manage sudo users."
            }, { quoted: msg });
        }

        if (action === "add") {
            db.prepare(`
                INSERT OR IGNORE INTO xmd_deployment_admins
                (user_id, jid, role)
                VALUES (?, ?, 'sudo')
            `).run(Number(userId), target);

            return sock.sendMessage(chat, {
                text: `Sudo access granted to ${target} on this deployment.`
            }, { quoted: msg });
        }

        const result = db.prepare(`
            DELETE FROM xmd_deployment_admins
            WHERE user_id = ? AND jid = ? AND role = 'sudo'
        `).run(Number(userId), target);

        return sock.sendMessage(chat, {
            text: result.changes
                ? `Sudo access removed from ${target}.`
                : `${target} is not a sudo user on this deployment.`
        }, { quoted: msg });
    }

    if (command === "block" || command === "unblock") {
        if (!target) {
            return sock.sendMessage(chat, {
                text:
                    `${command.toUpperCase()} A USER ON THIS BOT\n\n` +
                    `${prefix}${command} 234XXXXXXXXX\n\n` +
                    "This only controls access to this OLU-XMD deployment. " +
                    "It does not block the person's WhatsApp contact or suspend their website account."
            }, { quoted: msg });
        }

        if (command === "block") {
            db.prepare(`
                INSERT OR IGNORE INTO xmd_deployment_blocks
                (user_id, jid, blocked_by)
                VALUES (?, ?, ?)
            `).run(Number(userId), target, normalizeJid(sock.user?.id));

            return sock.sendMessage(chat, {
                text: `${target} is now blocked from using commands on this deployment.`
            }, { quoted: msg });
        }

        const result = db.prepare(`
            DELETE FROM xmd_deployment_blocks
            WHERE user_id = ? AND jid = ?
        `).run(Number(userId), target);

        return sock.sendMessage(chat, {
            text: result.changes
                ? `${target} has been unblocked on this deployment.`
                : `${target} was not blocked on this deployment.`
        }, { quoted: msg });
    }
}

module.exports = {
    name: "admincontrols",
    aliases: ["sudo", "block", "unblock"],
    description: "Deployment-specific sudo and command access controls",
    execute,
    isSudo,
    isBlocked,
    normalizeJid
};
