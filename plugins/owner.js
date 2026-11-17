
module.exports = {
    name: "owner",
    description: "Display bot owner information",

    async execute(sock, msg) {
        await sock.sendMessage(msg.key.remoteJid, {
            text: `OLU-XMD OWNER INFORMATION

Bot Name: OLU-XMD
Owner: Udochukwu
Platform: WhatsApp
Status: Active

For support and enquiries, contact the bot administrator.

Powered by OLU-XMD.`
        });
    }
};
