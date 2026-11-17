
const crypto = require("crypto");

module.exports = {
    name: "groupstatus",
    description: "Publish your own text, image or video as WhatsApp Group Status",

    async execute(sock, msg, { userId } = {}) {
        const groupJid = msg.key.remoteJid;
console.log("GROUPSTATUS SENDER:", {
    participant: msg.key.participant,
    participantAlt: msg.key.participantAlt,
    remoteJid: msg.key.remoteJid
});
        if (!groupJid || !groupJid.endsWith("@g.us")) {
            await sock.sendMessage(groupJid, {
                text: "Please use .groupstatus inside a WhatsApp group."
            });
            return;
        }

        if (msg?.key?.fromMe !== true) {
            await sock.sendMessage(groupJid, {
                text: "Only the connected WhatsApp account can publish a Group Status with .groupstatus."
            }, { quoted: msg });
            return;
        }

        const {
            normalizeMessageContent,
            downloadMediaMessage,
            getContentType,
            areJidsSameUser,
                        generateWAMessageContent,
            prepareWAMessageMedia,
            generateWAMessageFromContent,
            jidNormalizedUser
        } = await import("@whiskeysockets/baileys");

        const commandContent = normalizeMessageContent(msg.message);
        const replyContext = commandContent?.extendedTextMessage?.contextInfo;

        const quotedRaw = replyContext?.quotedMessage;
        const quotedId = replyContext?.stanzaId;
        const quotedSender =
            replyContext?.participantPn || replyContext?.participant;

        if (!quotedRaw || !quotedId || !quotedSender) {
            await sock.sendMessage(groupJid, {
                text: "Reply to your own text, picture or video with .groupstatus."
            });
            return;
        }

        const ownIds = [
            sock.user?.id,
            sock.user?.lid,
            sock.user?.phoneNumber
        ].filter(Boolean);

        const isOwnMessage = ownIds.some(id => {
            try {
                return areJidsSameUser(id, quotedSender);
            } catch {
                return id === quotedSender;
            }
        });

        if (!isOwnMessage) {
            await sock.sendMessage(groupJid, {
                text: "You can only publish a message originally sent by your own WhatsApp account."
            });
            return;
        }

        const quotedMessage = {
            key: {
                remoteJid: groupJid,
                fromMe: true,
                id: quotedId,
                participant: quotedSender
            },
            message: quotedRaw
        };

        const content = normalizeMessageContent(quotedRaw);
        const messageType = getContentType(content);

        const text =
            content?.conversation ||
            content?.extendedTextMessage?.text ||
            content?.imageMessage?.caption ||
            content?.videoMessage?.caption ||
            "";

        let statusContent;

        if (
            messageType === "conversation" ||
            messageType === "extendedTextMessage"
        ) {
            if (!text.trim()) {
                await sock.sendMessage(groupJid, {
                    text: "The replied message has no publishable text."
                });
                return;
            }

            statusContent = { text };
        } else if (
            messageType === "imageMessage" ||
            messageType === "videoMessage"
        ) {
            const media = await downloadMediaMessage(
                quotedMessage,
                "buffer",
                {},
                {
                    logger: sock.logger,
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            statusContent = messageType === "imageMessage"
                ? { image: media, caption: text || undefined }
                : { video: media, caption: text || undefined };
        } else {
            await sock.sendMessage(groupJid, {
                text: "Only your own text, image or video messages can be published."
            });
            return;
        }

        const senderJid = jidNormalizedUser(sock.user.id);

        const contextInfo = {
            isGroupStatus: true,
            statusAttributions: [
                {
                    type: 5,
                    groupStatus: {
                        authorJid: senderJid
                    }
                }
            ]
        };

        let innerMessage;

if (messageType === "imageMessage" || messageType === "videoMessage") {
    const preparedMedia = await prepareWAMessageMedia(
        statusContent,
        {
    logger: sock.logger,
    upload: sock.waUploadToServer
}
    );

    const mediaKey = messageType === "imageMessage"
        ? "imageMessage"
        : "videoMessage";

    preparedMedia[mediaKey].contextInfo = contextInfo;
    innerMessage = preparedMedia;
} else {
    innerMessage = await generateWAMessageContent(
        {
            ...statusContent,
            contextInfo
        },
        {
            logger: sock.logger,
            upload: sock.waUploadToServer,
            jid: groupJid
        }
    );
}

        let wrappedMessage;

if (messageType === "imageMessage" || messageType === "videoMessage") {
    const messageSecret = crypto.randomBytes(32);

    wrappedMessage = {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: {
            message: {
                ...innerMessage,
                messageContextInfo: { messageSecret }
            }
        }
    };
} else {
    wrappedMessage = {
        groupStatusMessageV2: {
            message: innerMessage
        }
    };
}

        const generated = generateWAMessageFromContent(
            groupJid,
            wrappedMessage,
            { userJid: senderJid }
        );

        await sock.relayMessage(
            groupJid,
            generated.message,
            { messageId: generated.key.id }
        );

        await sock.sendMessage(groupJid, {
            react: {
                text: "âœ…",
                key: msg.key
            }
        });
    }
};
