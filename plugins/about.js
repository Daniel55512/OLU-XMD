
module.exports = {
    name: "about",
    description: "About OLU-XMD",

    async execute(sock, msg) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: `ABOUT OLU-XMD

OLU-XMD is a powerful WhatsApp automation bot.

Features include:
- Automated replies
- Group management
- Custom commands
- Status management
- Plugins and automation

More exciting features are coming soon!

Powered by OLU-XMD.`
        });
    }
};
