let baileys;

async function loadBaileys() {
    if (!baileys) {
        baileys = await import("@whiskeysockets/baileys");
    }
    return baileys;
}

const path = require("path");
const fs = require("fs");
const db = require("./database");

const sessionsDirectory = path.join(__dirname, "sessions");
const activeSockets = new Map();
const prefix = ".";
const startTime = Date.now();


async function createWhatsAppSocket(userId) {
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        Browsers
    } = await loadBaileys();

    const sessionDirectory = path.join(
        sessionsDirectory,
        String(userId)
    );

    const { state, saveCreds } = await useMultiFileAuthState(
        sessionDirectory
    );

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false
    });

    activeSockets.set(String(userId), sock);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        console.log(
            "WHATSAPP CONNECTION:",
            update.connection || "waiting"
        );

        if (update.connection === "open") {
            console.log("WhatsApp connected for customer:", userId);
        }

        if (update.connection === "close") {
            const statusCode =
                update.lastDisconnect?.error?.output?.statusCode;

            console.log(
                "WHATSAPP DISCONNECT DETAILS:",
                update.lastDisconnect?.error
            );

            if (statusCode === 515) {
                console.log("Restarting WhatsApp socket...");

                setTimeout(async () => {
                    try {
                        await createWhatsAppSocket(userId);
                    } catch (error) {
                        console.error("WhatsApp restart failed:", error);
                    }
                }, 1500);
            }
        }
    });

    // RECEIVE WHATSAPP MESSAGES
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
            if (
                !msg.message ||
                msg.key.fromMe ||
                msg.key.remoteJid === "status@broadcast"
            ) continue;

         const text = (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    ""
).trim();

console.log("NEW MESSAGE RECEIVED!");
console.log("From:", msg.key.remoteJid);
console.log("Text:", text);

// WELCOME MESSAGE
const existingWelcome = db.prepare(
    "SELECT id FROM welcomed_contacts WHERE user_id = ? AND contact_jid = ?"
).get(Number(userId), msg.key.remoteJid);

if (!text.startsWith(prefix) && !existingWelcome) {
    db.prepare(
        "INSERT OR IGNORE INTO welcomed_contacts (user_id, contact_jid) VALUES (?, ?)"
    ).run(Number(userId), msg.key.remoteJid);

    await sock.sendMessage(msg.key.remoteJid, {
        text: `👋 Welcome to OLU-XMD!

Thank you for messaging us.

Type *.menu* to see what I can do for you. 🤖`
    });
}
            // HELLO COMMAND
         if (text.toLowerCase() === `${prefix}hello`) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: "Hello! Welcome to OLU-XMD 🤖"
                });
            }
// OWNER COMMAND
if (text.toLowerCase() === `${prefix}owner`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `👑 *OLU-XMD OWNER*

Owner: Udochukwu

Bot Name: OLU-XMD
Status: Online

Powered by OLU-XMD 🤖`
    });
}
// ABOUT COMMAND
if (text.toLowerCase() === `${prefix}about`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `🤖 *ABOUT OLU-XMD*

OLU-XMD is a WhatsApp automation bot.

Features:
• Automated responses
• Welcome messages
• Interactive menu
• Useful WhatsApp commands

Developed by: Udochukwu
Powered by OLU-XMD 🚀`
    });
}
// HELP COMMAND
if (text.toLowerCase() === `${prefix}help`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `📚 *OLU-XMD HELP CENTER*

Available Commands:

.hello - Greeting
.ping - Check bot status
.owner - Owner information
.about - About OLU-XMD
.menu - Display bot menu
.help - Show all commands

Powered by OLU-XMD 🤖`
    });
}
// STATUS COMMAND
if (text.toLowerCase() === `${prefix}status`) {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    await sock.sendMessage(msg.key.remoteJid, {
        text: `🤖 *OLU-XMD SYSTEM STATUS*

🟢 Bot Status: Online
⏱️ Uptime: ${hours} hours, ${minutes} minutes
👑 Owner: Udochukwu
📱 Platform: WhatsApp
⚙️ Runtime: Node.js

Powered by OLU-XMD`
    });
}
// RULES COMMAND
if (text.toLowerCase() === `${prefix}rules`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `📜 *OLU-XMD BOT RULES*

1. Do not spam the bot.
2. Use the correct commands.
3. Do not send abusive messages.
4. Respect other users.
5. Do not misuse bot features.

Thank you for using OLU-XMD! 🤖

Powered by OLU-XMD 🚀`
    });
}
// SUPPORT COMMAND
if (text.toLowerCase() === `${prefix}support`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `📞 *OLU-XMD SUPPORT*

Need help? Contact our support team.

WhatsApp: 09010215113

We are happy to assist you!

Powered by OLU-XMD 🤖`
    });
}
// DEVELOPER COMMAND
if (text.toLowerCase() === `${prefix}developer`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `👨‍💻 *OLU-XMD DEVELOPER*

Developer: Udochukwu
Bot Name: OLU-XMD
Technology: JavaScript & Node.js

Built with dedication. 🚀

Powered by OLU-XMD`
    });
}
// PROFILE COMMAND
if (text.toLowerCase() === `${prefix}profile`) {
    const userName = msg.pushName || "Not available";
    const whatsappId = msg.key.remoteJid;

    await sock.sendMessage(msg.key.remoteJid, {
        text: `👤 *OLU-XMD USER PROFILE*

Name: ${userName}
WhatsApp ID: ${whatsappId}

Powered by OLU-XMD 🤖`
    });
}
            // MENU COMMAND
            if (text.toLowerCase() === `${prefix}ping`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: "🏓 PONG! OLU-XMD is online and active."
    });
}
         // MENU COMMAND
if (text.trim().toLowerCase() === `${prefix}menu`) {
    await sock.sendMessage(msg.key.remoteJid, {
        text: `🤖 *OLU-XMD MAIN MENU*

━━━━━━━━━━━━━━━━━━

📌 *MAIN OPTIONS*

1. Account Information
2. Bot Features
3. Contact Support
4. Owner Information

━━━━━━━━━━━━━━━━━━

⚡ *AVAILABLE COMMANDS*

.hello - Greeting
.ping - Check bot status
.owner - Owner information
.about - About OLU-XMD
.help - Show all commands
.status - Bot status
.rules - Bot rules
.support - Contact support

━━━━━━━━━━━━━━━━━━

Reply with a number to select an option.

*Powered by OLU-XMD* 🚀`
    });
}
            // OPTION 1: ACCOUNT INFORMATION
            if (text.trim() === "1") {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `👤 *ACCOUNT INFORMATION*

Welcome to OLU-XMD!

Your WhatsApp account is connected to our bot.

For account assistance, please contact the administrator.

Powered by OLU-XMD 🤖`
                });
            }

            // OPTION 2: BOT FEATURES
           if (text.trim() === "2" && !text.trim().startsWith(prefix)) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `⚡ *OLU-XMD BOT FEATURES*

1. Automatic WhatsApp Replies
2. Welcome Messages
3. Group Management
4. Auto Status Viewing
5. Anti-Delete Messages
6. Custom Commands
7. More Features Coming Soon!

Powered by OLU-XMD 🤖`
                });
            }

            // OPTION 3: CONTACT SUPPORT
            if (text.trim() === "3") {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `📞 *OLU-XMD SUPPORT*

Need help with your account or bot?

Contact our support team for assistance.

Powered by OLU-XMD 🤖`
                });
            }

            // OPTION 4: OWNER INFORMATION
            if (text.trim() === "4") {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `👑 *OLU-XMD OWNER INFORMATION*

Bot Name: OLU-XMD
Administrator: OLU-XMD Admin

For assistance, contact the administrator.

Powered by OLU-XMD 🤖`
                });
            }
        }
    });

    return sock;
}

// GENERATE PAIRING CODE
async function generatePairingCode(userId, phoneNumber) {
    const { useMultiFileAuthState } = await loadBaileys();

    phoneNumber = String(phoneNumber).replace(/\D/g, "");

    if (!/^\d{10,15}$/.test(phoneNumber)) {
        throw new Error("Enter a valid phone number with country code.");
    }

    if (!userId) {
        throw new Error("Customer ID is required.");
    }

    const sessionDirectory = path.join(
        sessionsDirectory,
        String(userId)
    );

    fs.mkdirSync(sessionDirectory, { recursive: true });

    const { state } = await useMultiFileAuthState(sessionDirectory);

    if (state.creds.registered) {
        throw new Error("This WhatsApp account is already registered.");
    }

    const sock = await createWhatsAppSocket(userId);

    await new Promise(resolve => setTimeout(resolve, 3000));

    const pairingCode = await sock.requestPairingCode(phoneNumber);

    console.log("Pairing code request completed.");

    return { pairingCode };
}

// RECONNECT WHATSAPP
async function reconnectWhatsApp(userId) {
    const { useMultiFileAuthState } = await loadBaileys();

    const sessionDirectory = path.join(
        sessionsDirectory,
        String(userId)
    );

    const { state } = await useMultiFileAuthState(sessionDirectory);

    if (!state.creds.registered) {
        throw new Error("WhatsApp registration is not complete.");
    }

    return await createWhatsAppSocket(userId);
}

module.exports = {
    generatePairingCode,
    reconnectWhatsApp
};