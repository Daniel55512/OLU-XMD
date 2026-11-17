module.exports = {
    name: "ping",
    description: "Check bot response speed",

    async execute(sock, msg) {
        const start = Date.now();
        const jid = msg.key.remoteJid;

        console.log("PING SEND START:", {
            jid,
            account: sock.user?.id
        });

        try {
            const result = await sock.sendMessage(jid, {
                text: "Pong! Response: " + (Date.now() - start) + "ms"
            });

            console.log("PING SEND SUCCESS:", {
                jid,
                messageId: result?.key?.id
            });
        } catch (error) {
            console.error("PING SEND FAILED:", {
                jid,
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
};
