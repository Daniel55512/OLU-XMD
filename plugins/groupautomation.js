module.exports = {
    name: "groupautomation",
    aliases: ["groupauto", "groupreport"],
    description: "OLU-XMD Group automation",

    async execute(sock, msg, { prefix = "." } = {}) {
        return sock.sendMessage(msg.key.remoteJid, {
            text:
                "OLU-XMD GROUP AUTOMATION\n\n" +
                "Group automation remains separate from Personal Status and WhatsApp Channels.\n\n" +
                "Existing group commands and plugins are preserved.\n" +
                "Use .menu to view your available group commands."
        }, { quoted: msg });
    }
};