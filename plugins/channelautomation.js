module.exports = {
    name: "channelpost",
    aliases: [
        "channelimage", "channelvideo", "channelschedule",
        "channelinfo", "channelstatus"
    ],
    description: "WhatsApp Channel automation",

    async execute(sock, msg, { args = [], prefix = "." } = {}) {
        const body = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ""
        ).trim();

        const command = body.slice(prefix.length).trim()
            .split(/\s+/)[0].toLowerCase();

        const descriptions = {
            channelpost: "Publish a text update to a WhatsApp Channel",
            channelimage: "Publish an image to a WhatsApp Channel",
            channelvideo: "Publish a video to a WhatsApp Channel",
            channelschedule: "Schedule a WhatsApp Channel update",
            channelinfo: "Inspect WhatsApp Channel information",
            channelstatus: "Check WhatsApp Channel automation status"
        };

        return sock.sendMessage(msg.key.remoteJid, {
            text:
                "OLU-XMD WHATSAPP CHANNEL\n\n" +
                (descriptions[command] || "Channel automation") +
                "\n\nThis command is registered. Channel publishing and scheduling will only be activated after the connected account's Channel permissions and Baileys operations are verified."
        }, { quoted: msg });
    }
};