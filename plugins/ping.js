const fs = require("fs");
const path = require("path");

const processedPingMessages = new Map();
const DEDUPE_TTL = 5 * 60 * 1000;

function persistPingDiagnostic(userId, stage, details = {}) {
    if (Number(userId) !== 1) return;

    try {
        const diagnosticDir = path.join(__dirname, "..", "diagnostics");
        fs.mkdirSync(diagnosticDir, { recursive: true });

        fs.appendFileSync(
            path.join(diagnosticDir, "account1-events.jsonl"),
            JSON.stringify({
                loggedAt: new Date().toISOString(),
                event: "PING_PLUGIN",
                stage,
                userId,
                ...details
            }) + "\n",
            "utf8"
        );
    } catch (error) {
        console.error("PING PERSISTENT DIAGNOSTIC ERROR:", error.message);
    }
}

module.exports = {
    name: "ping",
    description: "Check bot response speed",

    async execute(sock, msg, { userId } = {}) {
        const jid = msg?.key?.remoteJid;
        const messageId = msg?.key?.id;


        const now = Date.now();

        for (const [key, timestamp] of processedPingMessages) {
            if (now - timestamp > DEDUPE_TTL) {
                processedPingMessages.delete(key);
            }
        }

        const dedupeKey = `${userId}:${jid}:${messageId}`;

        if (messageId && processedPingMessages.has(dedupeKey)) {
            persistPingDiagnostic(userId, "DUPLICATE_IGNORED", {
                remoteJid: jid,
                messageId
            });
            return;
        }

        if (messageId) {
            processedPingMessages.set(dedupeKey, now);
        }

        persistPingDiagnostic(userId, "START", {
            remoteJid: jid,
            messageId,
            fromMe: false
        });

        console.log("PING SEND START:", {
            userId,
            jid,
            messageId,
            account: sock.user?.id
        });

        try {
            const result = await sock.sendMessage(jid, {
                text: "Pong! OLU-XMD is online."
            });

            persistPingDiagnostic(userId, "SEND_SUCCESS", {
                remoteJid: jid,
                incomingMessageId: messageId,
                outgoingMessageId: result?.key?.id
            });

            console.log("PING SEND SUCCESS:", {
                jid,
                messageId: result?.key?.id
            });
        } catch (error) {
            persistPingDiagnostic(userId, "SEND_FAILED", {
                remoteJid: jid,
                incomingMessageId: messageId,
                error: error.message
            });

            console.error("PING SEND FAILED:", {
                jid,
                message: error.message,
                stack: error.stack
            });

            throw error;
        }
    }
};