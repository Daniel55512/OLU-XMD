const fs = require("fs");
const path = require("path");

function persistPingDiagnostic(userId, stage, details = {}) {
    if (Number(userId) !== 1) return;

    try {
        const diagnosticDir = path.join(__dirname, "..", "diagnostics");
        fs.mkdirSync(diagnosticDir, { recursive: true });

        const record = {
            loggedAt: new Date().toISOString(),
            event: "PING_PLUGIN",
            stage,
            userId,
            ...details
        };

        fs.appendFileSync(
            path.join(diagnosticDir, "account1-events.jsonl"),
            JSON.stringify(record) + "\n",
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
        const start = Date.now();
        const jid = msg.key.remoteJid;

        persistPingDiagnostic(userId, "START", {
            remoteJid: jid,
            messageId: msg.key.id
        });

        console.log("PING SEND START:", {
            jid,
            account: sock.user?.id
        });

        try {
            const result = await sock.sendMessage(jid, {
                text: "Pong! Response: " + (Date.now() - start) + "ms"
            });

            const elapsedMs = Date.now() - start;

            persistPingDiagnostic(userId, "SEND_SUCCESS", {
                remoteJid: jid,
                messageId: result?.key?.id,
                elapsedMs
            });

            console.log("PING SEND SUCCESS:", {
                jid,
                messageId: result?.key?.id
            });
        } catch (error) {
            persistPingDiagnostic(userId, "SEND_FAILED", {
                remoteJid: jid,
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