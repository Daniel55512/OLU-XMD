
module.exports = {
    name: "uptime",
    description: "Check bot uptime",

    async execute(sock, msg) {
        const totalSeconds = Math.floor(process.uptime());

        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        await sock.sendMessage(msg.key.remoteJid, {
            text: `OLU-XMD SYSTEM UPTIME

Running for:
${days} days, ${hours} hours,
${minutes} minutes, ${seconds} seconds.

Powered by OLU-XMD.`
        });
    }
};

