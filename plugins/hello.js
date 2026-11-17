
module.exports = {
    name: "hello",
    description: "Welcome users",

    async execute(sock, msg) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: `Hello! Welcome to OLU-XMD.

Your WhatsApp assistant is online and ready.

Powered by OLU-XMD.`
        });
    }
};

