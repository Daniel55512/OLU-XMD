const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const formatter = require("wa-sticker-formatter");
const Sticker = formatter.Sticker || formatter.default?.Sticker || formatter.default;
const sharpPath = require.resolve("sharp", {
    paths: [path.dirname(require.resolve("wa-sticker-formatter"))]
});
const sharp = require(sharpPath);
const ffmpeg = require("ffmpeg-static");

const PACK = "OLU-XMD";
const AUTHOR = "OLU-XMD";
const MAX_MEDIA = 15 * 1024 * 1024;
const MAX_STICKER = 500 * 1024;

const baileysPromise = import("@whiskeysockets/baileys");

function escapeXml(value = "") {
    return String(value).replace(/[<>&'"]/g, c => ({
        "<": "&lt;", ">": "&gt;", "&": "&amp;",
        "'": "&apos;", '"': "&quot;"
    })[c]);
}

function getText(msg) {
    const m = msg.message || {};
    return m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption || "";
}

function getCommand(msg, prefix) {
    const first = getText(msg).trim().split(/\s+/)[0] || "";
    return first.startsWith(prefix)
        ? first.slice(prefix.length).toLowerCase()
        : "";
}

function getContext(msg) {
    const m = msg.message || {};
    return m.extendedTextMessage?.contextInfo ||
        m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo ||
        m.documentMessage?.contextInfo ||
        m.stickerMessage?.contextInfo ||
        null;
}

function normalizeContent(content, normalize) {
    let current = content;
    for (let i = 0; i < 5 && current; i++) {
        const next = normalize(current);
        if (!next || next === current) break;
        current = next;
    }
    return current;
}

function findMedia(content) {
    if (!content) return null;
    const types = [
        ["imageMessage", "image"],
        ["videoMessage", "video"],
        ["stickerMessage", "sticker"],
        ["documentMessage", "document"]
    ];

    for (const [key, type] of types) {
        if (content[key]) {
            const node = content[key];
            if (type === "document") {
                const mime = node.mimetype || "";
                if (mime.startsWith("image/")) return { node, type: "image" };
                if (mime.startsWith("video/")) return { node, type: "video" };
            } else {
                return { node, type };
            }
        }
    }
    return null;
}

async function getMedia(sock, msg, preferQuoted = true) {
    const baileys = await baileysPromise;
    const normalize = baileys.normalizeMessageContent || (x => x);
    const context = getContext(msg);

    let found = null;
    if (preferQuoted && context?.quotedMessage) {
        const quoted = normalizeContent(context.quotedMessage, normalize);
        found = findMedia(quoted);
    }

    if (!found) {
        const own = normalizeContent(msg.message, normalize);
        found = findMedia(own);
    }

    if (!found) {
        throw new Error("Reply to an image, GIF, video or sticker, then try again.");
    }

    const { node, type } = found;
    if (type === "video" && Number(node.seconds || 0) > 10) {
        throw new Error("Videos must be 10 seconds or shorter.");
    }

    const downloadType = type === "sticker" ? "sticker" : type;
    const stream = await baileys.downloadContentFromMessage(node, downloadType);
    const chunks = [];
    let size = 0;

    for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_MEDIA) throw new Error("That media file is too large (15 MB maximum).");
        chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error("I couldn't download that media. Please try again.");

    return {
        buffer,
        type,
        seconds: Number(node.seconds || 0),
        mime: node.mimetype || ""
    };
}

function runFfmpeg(input, inputExt, outputExt, argsBuilder, inputOptions = []) {
    return new Promise((resolve, reject) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "olu-xmd-sticker-"));
        const inputPath = path.join(dir, `input.${inputExt}`);
        const outputPath = path.join(dir, `output.${outputExt}`);

        fs.writeFileSync(inputPath, input);

        const args = ["-hide_banner", "-loglevel", "error", "-y",
            ...inputOptions, "-i", inputPath, ...argsBuilder(outputPath)];

        const child = spawn(ffmpeg, args, { windowsHide: true });
        let stderr = "";

        child.stderr.on("data", d => { stderr += d.toString(); });
        child.on("error", err => {
            fs.rmSync(dir, { recursive: true, force: true });
            reject(err);
        });
        child.on("close", code => {
            try {
                if (code !== 0 || !fs.existsSync(outputPath)) {
                    throw new Error(stderr.slice(-1200) || "FFmpeg conversion failed.");
                }
                const result = fs.readFileSync(outputPath);
                fs.rmSync(dir, { recursive: true, force: true });
                resolve(result);
            } catch (error) {
                fs.rmSync(dir, { recursive: true, force: true });
                reject(error);
            }
        });
    });
}

async function makeSticker(buffer, options = {}) {
    const qualities = [75, 60, 45];
    let result;

    for (const quality of qualities) {
        const sticker = new Sticker(buffer, {
            pack: options.pack || PACK,
            author: options.author || AUTHOR,
            quality,
            type: "full"
        });
        result = await sticker.toBuffer();
        if (result.length <= MAX_STICKER) return result;
    }

    if (result.length > MAX_STICKER) {
        throw new Error("The sticker is too large for WhatsApp. Try a smaller image or shorter video.");
    }
    return result;
}

function isAnimatedWebp(buffer) {
    return buffer.includes(Buffer.from("ANIM")) ||
        buffer.includes(Buffer.from("ANMF"));
}

function wrapText(value, max = 20, linesMax = 5) {
    const words = String(value).trim().split(/\s+/);
    const lines = [];
    let line = "";

    for (const word of words) {
        if (!word) continue;
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > max && line) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);

    if (lines.length > linesMax) {
        lines.length = linesMax;
        lines[linesMax - 1] = lines[linesMax - 1].slice(0, max - 1) + "â€¦";
    }
    return lines;
}

function textSvg(text, animated = false) {
    const lines = wrapText(text, 19, 5);
    const startY = 256 - ((lines.length - 1) * 45) / 2;
    const tspans = lines.map((line, i) =>
        `<tspan x="256" y="${startY + i * 48}">${escapeXml(line)}</tspan>`
    ).join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <rect x="12" y="12" width="488" height="488" rx="62" fill="#132563"/>
      <rect x="25" y="25" width="462" height="462" rx="52" fill="none" stroke="#F7C843" stroke-width="7"/>
      <text text-anchor="middle" font-family="Arial,sans-serif" font-size="39"
        font-weight="bold" fill="#FF7A00" stroke="#091638" stroke-width="1.5"
        paint-order="stroke">${tspans}</text>
    </svg>`;
}

async function svgToPng(svg) {
    return sharp(Buffer.from(svg)).png().toBuffer();
}

async function sendSticker(sock, jid, buffer, quoted) {
    await sock.sendMessage(jid, {
        sticker: buffer,
        mimetype: "image/webp"
    }, { quoted });
}

async function makeQuoteSticker(sock, msg, text) {
    if (!text.trim()) throw new Error("Usage: .quotely your message here");

    const context = getContext(msg);
    const target = context?.participant || msg.key.participant || msg.key.remoteJid;
    let name = context?.participant
        ? context.participant.split("@")[0]
        : (msg.pushName || "OLU-XMD User");

    let avatar = "";
    if (target && typeof sock.profilePictureUrl === "function") {
        try {
            const url = await sock.profilePictureUrl(target, "image");
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (response.ok) {
                const imageBuffer = Buffer.from(await response.arrayBuffer());
                if (imageBuffer.length <= 2 * 1024 * 1024) {
                    const png = await sharp(imageBuffer)
                        .resize(112, 112, { fit: "cover" })
                        .png().toBuffer();
                    avatar = `data:image/png;base64,${png.toString("base64")}`;
                }
            }
        } catch (_) {}
    }

    const initials = escapeXml(name.slice(0, 1).toUpperCase());
    const lines = wrapText(text, 27, 6);
    const message = lines.map((line, i) =>
        `<tspan x="165" y="${185 + i * 42}">${escapeXml(line)}</tspan>`
    ).join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <rect width="512" height="512" rx="55" fill="#132563"/>
      <rect x="25" y="25" width="462" height="462" rx="42" fill="#F7C843"/>
      <rect x="42" y="42" width="428" height="428" rx="34" fill="#132563"/>
      ${avatar
        ? `<image href="${avatar}" x="55" y="65" width="82" height="82" clip-path="url(#circle)"/>`
        : `<circle cx="96" cy="106" r="41" fill="#FF7A00"/><text x="96" y="120" text-anchor="middle" font-size="42" fill="#132563" font-weight="bold">${initials}</text>`}
      <defs><clipPath id="circle"><circle cx="96" cy="106" r="41"/></clipPath></defs>
      <text x="155" y="105" font-family="Arial" font-size="25" font-weight="bold" fill="#F7C843">${escapeXml(name.slice(0, 25))}</text>
      <rect x="55" y="160" width="402" height="245" rx="25" fill="#FFFFFF"/>
      <text font-family="Arial,sans-serif" font-size="27" fill="#132563">${message}</text>
      <text x="430" y="445" text-anchor="end" font-family="Arial" font-size="17" fill="#F7C843">OLU-XMD</text>
    </svg>`;

    return svgToPng(svg);
}

async function handle(sock, msg, command, args, prefix) {
    const jid = msg.key.remoteJid;
    const text = args.join(" ").trim();

    if (command === "stickermenu") {
        const menu = [
            "\u2554\u2550\u2550\u300C OLU-XMD STICKER TOOLS \u300D",
            "\u2551",
            `\u2551 ${prefix}sticker / ${prefix}s`,
            "\u2551 Convert replied image, GIF or short video",
            "\u2551",
            `\u2551 ${prefix}take pack | author`,
            "\u2551 Change sticker pack and author",
            "\u2551",
            `\u2551 ${prefix}toimg`,
            "\u2551 Convert a replied static sticker to PNG",
            "\u2551",
            `\u2551 ${prefix}tovid / ${prefix}tomp4`,
            "\u2551 Convert animated sticker to MP4",
            "\u2551",
            `\u2551 ${prefix}ttp text`,
            "\u2551 Create a text sticker",
            "\u2551",
            `\u2551 ${prefix}attp text`,
            "\u2551 Create an animated text sticker",
            "\u2551",
            `\u2551 ${prefix}quotely text / ${prefix}qc text`,
            "\u2551 Create a chat quote sticker",
            "\u2551",
            `\u2551 ${prefix}emojimix \u{1F600}+\u{1F602}`,
            "\u2551 Mix two emojis",
            "\u255A\u2550\u2550\u300C OLU-XMD \u300D"
        ].join("\n");

        return sock.sendMessage(jid, {
            text: menu
        }, { quoted: msg });
    }
    if (command === "sticker" || command === "s") {
        const media = await getMedia(sock, msg);
        let input = media.buffer;

        if (media.type === "video") {
            const duration = media.seconds || 9;
            input = await runFfmpeg(input, "mp4", "gif", out => [
                "-t", String(Math.min(duration, 9)),
                "-vf", "fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
                "-an", out
            ]);
        }

        const sticker = await makeSticker(input);
        return sendSticker(sock, jid, sticker, msg);
    }

    if (command === "take" || command === "steal") {
        const media = await getMedia(sock, msg);
        if (media.type !== "sticker") {
            throw new Error("Reply to a sticker with .take pack name | author");
        }

        const parts = text.split("|").map(x => x.trim());
        const pack = parts[0] || PACK;
        const author = parts[1] || AUTHOR;
        const sticker = await makeSticker(media.buffer, { pack, author });
        return sendSticker(sock, jid, sticker, msg);
    }

    if (command === "toimg") {
        const media = await getMedia(sock, msg);
        if (media.type !== "sticker") throw new Error("Reply to a sticker with .toimg");
        if (isAnimatedWebp(media.buffer)) {
            throw new Error("That sticker is animated. Use .tovid to convert it to MP4.");
        }
        const png = await sharp(media.buffer).png().toBuffer();
        return sock.sendMessage(jid, {
            image: png,
            mimetype: "image/png",
            caption: "Converted by OLU-XMD"
        }, { quoted: msg });
    }

    if (command === "tovid" || command === "tomp4") {
        const media = await getMedia(sock, msg);
        if (media.type !== "sticker" || !isAnimatedWebp(media.buffer)) {
            throw new Error("Reply to an animated sticker with .tovid");
        }
        const mp4 = await runFfmpeg(media.buffer, "webp", "mp4", out => [
            "-movflags", "+faststart",
            "-vf", "fps=15,scale=512:-2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-an", out
        ]);
        return sock.sendMessage(jid, {
            video: mp4,
            mimetype: "video/mp4",
            caption: "Converted by OLU-XMD"
        }, { quoted: msg });
    }

    if (command === "ttp") {
        if (!text) throw new Error("Usage: .ttp your text here");
        const png = await svgToPng(textSvg(text));
        const sticker = await makeSticker(png);
        return sendSticker(sock, jid, sticker, msg);
    }

    if (command === "attp") {
        if (!text) throw new Error("Usage: .attp your text here");
        const png = await svgToPng(textSvg(text, true));
        const animated = await runFfmpeg(png, "png", "webp", out => [
            "-t", "3",
            "-vf", "fps=12,setpts=PTS-STARTPTS,hue=h=t*120:s=1,format=yuva420p",
            "-c:v", "libwebp_anim", "-lossless", "0",
            "-q:v", "55", "-loop", "0", "-an", out
        ], ["-loop", "1", "-framerate", "12"]);
        const sticker = await makeSticker(animated);
        return sendSticker(sock, jid, sticker, msg);
    }

    if (command === "quotely" || command === "qc") {
        const png = await makeQuoteSticker(sock, msg, text);
        const sticker = await makeSticker(png);
        return sendSticker(sock, jid, sticker, msg);
    }

    if (command === "emojimix") {
        const match = text.match(/^(.+?)\s*\+\s*(.+)$/u);
        if (!match) throw new Error("Usage: .emojimix ðŸ˜€+ðŸ˜‚");

        const first = match[1].trim();
        const second = match[2].trim();
        if (first.length > 12 || second.length > 12) {
            throw new Error("Please provide two individual emojis.");
        }

        const url = `https://emojik.vercel.app/s/${encodeURIComponent(first + "_" + second)}?size=512`;
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("That emoji combination is unavailable. Try another pair.");

        const image = Buffer.from(await response.arrayBuffer());
        if (!image.length || image.length > 5 * 1024 * 1024) {
            throw new Error("The emoji image could not be processed.");
        }

        const sticker = await makeSticker(image);
        return sendSticker(sock, jid, sticker, msg);
    }
}

module.exports = {
    name: "sticker",
    aliases: [
        "s", "take", "steal", "toimg", "tovid", "tomp4",
        "ttp", "attp", "quotely", "qc", "emojimix", "stickermenu"
    ],
    async execute(sock, msg, { args = [], prefix = "." } = {}) {
        const command = getCommand(msg, prefix);
        try {
            await handle(sock, msg, command, args, prefix);
        } catch (error) {
            console.error("OLU-XMD STICKER ERROR:", error);
            await sock.sendMessage(msg.key.remoteJid, {
                text: `âŒ ${error.message || "Sticker operation failed."}`
            }, { quoted: msg });
        }
    }
};

