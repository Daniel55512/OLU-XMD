"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");

const USER_AGENT = "OLU-XMD (https://www.olubills.com)";
const TENRAI_BASE = "https://api.tenrai.org/v1";
const REACTIONS = ["hug", "slap", "pat", "kiss", "dance", "cry"];

const MAX_GIF_BYTES = 10 * 1024 * 1024;
const MAX_MP4_BYTES = 15 * 1024 * 1024;

const MENU = `🎌 OLU-XMD ANIME AND MANGA MENU

ANIME & MANGA SEARCH
.anime <title> - Search anime details
.manga <title> - Search manga details
.character <name> - Search anime characters

RANDOM ANIME IMAGES
.waifu - Random waifu image
.neko - Random neko image
.shinobu - Random Shinobu image
.megumin - Random Megumin image
.kitsune - Random kitsune image
.animewall - Landscape anime wallpaper

ANIME QUOTES
.animequote - Random anime quote

ANIME REACTIONS (GROUPS)
.hug @user - Send an anime hug
.slap @user - Send an anime slap
.pat @user - Send an anime pat
.kiss @user - Send an anime kiss
.dance @user - Send an anime dance
.cry @user - Send an anime cry

Mention someone or reply to their message for reactions.

Powered by OLU-XMD`;

function messageText(msg) {
    const m = msg?.message || {};
    return String(
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ""
    ).trim();
}

function shorten(value, max = 900) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max
        ? text.slice(0, max - 1).trim() + "…"
        : text || "Information unavailable.";
}

async function getJson(url) {
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
        const error = new Error("API HTTP " + response.status);
        error.status = response.status;
        throw error;
    }

    return response.json();
}

async function reply(sock, msg, text) {
    return sock.sendMessage(
        msg.key.remoteJid,
        { text },
        { quoted: msg }
    );
}

// Tenrai uses the Jikan-compatible response structure.
// Keep requests comfortably below its public rate limit.
let tenraiQueue = Promise.resolve();
let lastTenraiRequest = 0;
const searchCache = new Map();

async function searchTenrai(resource, query) {
    const cacheKey = resource + ":" + query.toLowerCase();
    const cached = searchCache.get(cacheKey);

    if (cached && Date.now() - cached.time < 15 * 60 * 1000) {
        return cached.data;
    }

    const task = tenraiQueue.then(async () => {
        const wait = 1150 - (Date.now() - lastTenraiRequest);

        if (wait > 0) {
            await new Promise(resolve => setTimeout(resolve, wait));
        }

        lastTenraiRequest = Date.now();

        const url = new URL(`${TENRAI_BASE}/${resource}`);
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "1");

        if (resource === "anime" || resource === "manga") {
            url.searchParams.set("sfw", "true");
        }

        return getJson(url.toString());
    });

    tenraiQueue = task.catch(() => {});

    const result = await task;
    const item = result.data?.[0] || null;

    if (searchCache.size > 100) {
        searchCache.delete(searchCache.keys().next().value);
    }

    searchCache.set(cacheKey, {
        time: Date.now(),
        data: item
    });

    return item;
}

function getImage(item) {
    return (
        item?.images?.jpg?.large_image_url ||
        item?.images?.jpg?.image_url ||
        item?.images?.webp?.large_image_url ||
        item?.images?.webp?.image_url ||
        null
    );
}

async function sendSearch(sock, msg, query, resource) {
    const item = await searchTenrai(resource, query);

    if (!item) {
        return reply(
            sock,
            msg,
            `No ${resource} result found for "${query}". Try another search.`
        );
    }

    const image = getImage(item);
    const score = item.score != null ? `${item.score}/10` : "Not rated";

    let caption;

    if (resource === "anime") {
        caption =
            `🎌 ANIME INFORMATION\n\n` +
            `Title: ${item.title_english || item.title || "Unknown"}\n` +
            `Japanese: ${item.title_japanese || "N/A"}\n` +
            `Score: ${score}\n` +
            `Episodes: ${item.episodes ?? "Unknown"}\n` +
            `Status: ${item.status || "Unknown"}\n` +
            `Synopsis: ${shorten(item.synopsis)}\n\n` +
            `MyAnimeList: ${item.url || "Unavailable"}`;
    } else {
        caption =
            `📚 MANGA INFORMATION\n\n` +
            `Title: ${item.title_english || item.title || "Unknown"}\n` +
            `Score: ${score}\n` +
            `Chapters: ${item.chapters ?? "Unknown"}\n` +
            `Volumes: ${item.volumes ?? "Unknown"}\n` +
            `Status: ${item.status || "Unknown"}\n` +
            `Synopsis: ${shorten(item.synopsis)}\n\n` +
            `MyAnimeList: ${item.url || "Unavailable"}`;
    }

    if (image) {
        return sock.sendMessage(
            msg.key.remoteJid,
            { image: { url: image }, caption },
            { quoted: msg }
        );
    }

    return reply(sock, msg, caption);
}

async function sendCharacter(sock, msg, query) {
    const item = await searchTenrai("characters", query);

    if (!item) {
        return reply(
            sock,
            msg,
            `No anime character found for "${query}".`
        );
    }

    const image = getImage(item);

    const caption =
        `🌟 ANIME CHARACTER\n\n` +
        `Name: ${item.name || "Unknown"}\n` +
        `Biography: ${shorten(item.about, 1100)}\n\n` +
        `MyAnimeList: ${item.url || "Unavailable"}`;

    if (image) {
        return sock.sendMessage(
            msg.key.remoteJid,
            { image: { url: image }, caption },
            { quoted: msg }
        );
    }

    return reply(sock, msg, caption);
}

// Random SFW image commands.
async function sendRandomImage(sock, msg, command) {
    // Character-specific commands use Tenrai's character catalogue.
    if (command === "shinobu" || command === "megumin") {
        const query = command === "shinobu"
            ? "Shinobu Kocho"
            : "Megumin";

        const item = await searchTenrai("characters", query);

        if (!item) {
            return reply(
                sock,
                msg,
                `No character result found for ${query}.`
            );
        }

        const imageUrl = getImage(item);

        if (!imageUrl) {
            throw new Error("Character image is unavailable.");
        }

        const caption =
            `🌟 ANIME CHARACTER: ${item.name || query}\n\n` +
            `${shorten(item.about, 600)}\n\n` +
            "Source: Tenrai / MyAnimeList";

        return sock.sendMessage(
            msg.key.remoteJid,
            {
                image: { url: imageUrl },
                caption
            },
            { quoted: msg }
        );
    }

    // Nekos.best provides these three SFW image categories.
    const categories = ["neko", "waifu", "kitsune"];

    if (!categories.includes(command)) {
        throw new Error("Unsupported anime image category.");
    }

    const data = await getJson(
        `https://nekos.best/api/v2/${command}`
    );

    const item = data.results?.[0];

    if (!item?.url) {
        throw new Error("The Nekos.best service returned no image.");
    }

    const caption =
        `✨ OLU-XMD ${command.toUpperCase()}` +
        (item.artist_name ? `\nArtist: ${item.artist_name}` : "") +
        (item.source_url ? `\nSource: ${item.source_url}` : "");

    return sock.sendMessage(
        msg.key.remoteJid,
        {
            image: { url: item.url },
            caption
        },
        { quoted: msg }
    );
}

async function sendWallpaper(sock, msg) {
    const url = new URL("https://api.waifu.im/images");
    url.searchParams.set("PageSize", "1");
    url.searchParams.set("IsNsfw", "False");
    url.searchParams.set("Orientation", "LANDSCAPE");

    const data = await getJson(url.toString());
    const item = data.items?.[0];
    const imageUrl = item?.url;

    if (!imageUrl) {
        throw new Error("No landscape wallpaper was returned.");
    }

    return sock.sendMessage(
        msg.key.remoteJid,
        {
            image: { url: imageUrl },
            caption: "🌄 OLU-XMD ANIME WALLPAPER\nSFW landscape artwork"
        },
        { quoted: msg }
    );
}

// Animechan free API: cache quotes to conserve the daily allowance.
let cachedQuote = null;
let cachedQuoteAt = 0;

async function sendQuote(sock, msg) {
    if (!cachedQuote || Date.now() - cachedQuoteAt > 30 * 60 * 1000) {
        const data = await getJson(
            "https://api.animechan.io/v1/quotes/random"
        );

        cachedQuote = data.data;

        if (!cachedQuote?.content) {
            cachedQuote = null;
            throw new Error("No quote returned.");
        }

        cachedQuoteAt = Date.now();
    }

    const quote = cachedQuote;

    return reply(
        sock,
        msg,
        `💬 ANIME QUOTE\n\n“${quote.content}”\n\n` +
        `Character: ${quote.character?.name || "Unknown"}\n` +
        `Anime: ${quote.anime?.name || "Unknown"}\n\n` +
        `Powered by OLU-XMD`
    );
}

function reactionTargets(msg) {
    const m = msg?.message || {};
    const context =
        m.extendedTextMessage?.contextInfo ||
        m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo ||
        m.documentMessage?.contextInfo ||
        {};

    const targets = Array.isArray(context.mentionedJid)
        ? [...context.mentionedJid]
        : [];

    if (!targets.length && context.participant) {
        targets.push(context.participant);
    }

    return [...new Set(targets.filter(Boolean))];
}

async function runFfmpeg(inputPath, outputPath, profile) {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        throw new Error("FFmpeg binary is unavailable.");
    }

    const filter =
        `fps=${profile.fps},` +
        "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos," +
        "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000," +
        "format=yuva420p";

    await new Promise((resolve, reject) => {
        const args = [
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", inputPath,
            "-t", String(profile.duration),
            "-an",
            "-vf", filter,
            "-c:v", "libwebp_anim",
            "-lossless", "0",
            "-quality", String(profile.quality),
            "-compression_level", "6",
            "-preset", "picture",
            "-loop", "0",
            outputPath
        ];

        const child = spawn(ffmpegPath, args, {
            windowsHide: true,
            stdio: ["ignore", "ignore", "pipe"]
        });

        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, 60000);

        child.stderr.on("data", chunk => {
            stderr = (stderr + chunk.toString()).slice(-2000);
        });

        child.once("error", error => {
            clearTimeout(timer);
            reject(error);
        });

        child.once("close", code => {
            clearTimeout(timer);

            if (timedOut) {
                return reject(new Error("Animated sticker conversion timed out."));
            }

            if (code !== 0) {
                return reject(new Error(
                    "Animated WebP conversion failed: " + stderr
                ));
            }

            resolve();
        });
    });
}

async function convertGifToAnimatedWebp(gifUrl) {
    const parsed = new URL(gifUrl);

    if (
        parsed.protocol !== "https:" ||
        !(
            parsed.hostname === "nekos.best" ||
            parsed.hostname.endsWith(".nekos.best")
        )
    ) {
        throw new Error("Unexpected reaction GIF source.");
    }

    const response = await fetch(parsed, {
        headers: {
            "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
        throw new Error("Unable to download reaction GIF.");
    }

    const contentLength = Number(
        response.headers.get("content-length") || 0
    );

    if (contentLength > MAX_GIF_BYTES) {
        throw new Error("Reaction GIF is too large.");
    }

    const gifBuffer = Buffer.from(await response.arrayBuffer());

    if (!gifBuffer.length || gifBuffer.length > MAX_GIF_BYTES) {
        throw new Error("Reaction GIF is empty or too large.");
    }

    const folder = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "olu-xmd-sticker-")
    );

    const inputPath = path.join(folder, "reaction.gif");
    const outputPath = path.join(folder, "reaction.webp");

    const profiles = [
        { fps: 12, quality: 55, duration: 8 },
        { fps: 10, quality: 42, duration: 7 },
        { fps: 8, quality: 30, duration: 6 },
        { fps: 6, quality: 22, duration: 5 }
    ];

    try {
        await fs.promises.writeFile(inputPath, gifBuffer);

        for (const profile of profiles) {
            await fs.promises.rm(outputPath, { force: true });

            await runFfmpeg(inputPath, outputPath, profile);

            const stats = await fs.promises.stat(outputPath);

            console.log("ANIMATED STICKER CONVERSION:", {
                profile,
                sizeKB: Math.round(stats.size / 1024)
            });

            if (stats.size > 500 * 1024) {
                console.log("Sticker too large. Trying smaller profile.");
                continue;
            }

            const stickerBuffer = await fs.promises.readFile(outputPath);

            const isWebp =
                stickerBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
                stickerBuffer.subarray(8, 12).toString("ascii") === "WEBP";

            const hasAnimation =
                stickerBuffer.includes(Buffer.from("ANIM")) &&
                stickerBuffer.includes(Buffer.from("ANMF"));

            if (!isWebp || !hasAnimation) {
                throw new Error("Output is not a valid animated WebP.");
            }

            return stickerBuffer;
        }

        throw new Error(
            "Could not compress the animated sticker below WhatsApp's 500KB limit."
        );
    } finally {
        await fs.promises.rm(folder, {
            recursive: true,
            force: true
        });
    }
}

async function sendReaction(sock, msg, command) {
    const jid = msg.key.remoteJid || "";

    if (!jid.endsWith("@g.us")) {
        return reply(
            sock,
            msg,
            "Anime reactions are available inside WhatsApp groups."
        );
    }

    const targets = reactionTargets(msg);

    if (!targets.length) {
        return reply(
            sock,
            msg,
            `Mention someone or reply to their message.\nExample: .${command} @user`
        );
    }

    const data = await getJson(
        `https://nekos.best/api/v2/${command}`
    );

    const item = data.results?.[0];

    if (!item?.url) {
        throw new Error("No reaction animation was returned.");
    }

    const stickerBuffer = await convertGifToAnimatedWebp(item.url);

    console.log("OLU-XMD ANIMATED STICKER SEND:", {
        command,
        group: jid,
        recipients: targets,
        sizeKB: Math.round(stickerBuffer.length / 1024)
    });

    return sock.sendMessage(
        jid,
        {
            sticker: stickerBuffer,
            mimetype: "image/webp",
            isAnimated: true,
            accessibilityLabel: `OLU-XMD ${command} anime reaction`,
            contextInfo: {
                mentionedJid: targets
            }
        },
        { quoted: msg }
    );
}

function friendlyError(error) {
    if (error?.status === 429) {
        return "The anime service is busy or rate-limited. Please try again later.";
    }

    if (
        error?.name === "TimeoutError" ||
        error?.name === "AbortError"
    ) {
        return "The anime service took too long to respond. Please try again.";
    }

    if (String(error?.message || "").includes("FFmpeg")) {
        return "The reaction video could not be converted. Please check FFmpeg.";
    }

    return "Sorry, this anime service is temporarily unavailable. Please try again shortly.";
}

module.exports = {
    name: "anime",
    aliases: [
        "animemenu",
        "animechar",
        "manga",
        "character",
        "waifu",
        "neko",
        "shinobu",
        "megumin",
        "kitsune",
        "animewall",
        "animequote",
        ...REACTIONS
    ],
    description: "Anime, manga, images, quotes and group reactions",

    async execute(sock, msg, { prefix = "." } = {}) {
        const body = messageText(msg);
        const command = (
            body.slice(prefix.length).trim().split(/\s+/)[0] || ""
        ).toLowerCase();

        const query = body.replace(/^\S+\s*/, "").trim();

        try {
            if (command === "animemenu") {
                return reply(sock, msg, MENU);
            }

            if (command === "anime" || command === "manga") {
                if (!query) {
                    return reply(
                        sock,
                        msg,
                        `Usage: ${prefix}${command} <title>\nExample: ${prefix}${command} Naruto`
                    );
                }

                return sendSearch(
                    sock,
                    msg,
                    query,
                    command
                );
            }

            if (
                command === "character" ||
                command === "animechar"
            ) {
                if (!query) {
                    return reply(
                        sock,
                        msg,
                        `Usage: ${prefix}character <name>\nExample: ${prefix}character Naruto`
                    );
                }

                return sendCharacter(sock, msg, query);
            }

            if (
                ["waifu", "neko", "shinobu", "megumin", "kitsune"]
                    .includes(command)
            ) {
                return sendRandomImage(sock, msg, command);
            }

            if (command === "animewall") {
                return sendWallpaper(sock, msg);
            }

            if (command === "animequote") {
                return sendQuote(sock, msg);
            }

            if (REACTIONS.includes(command)) {
                return sendReaction(sock, msg, command);
            }

            return reply(sock, msg, "Unknown anime command. Type .animemenu.");
        } catch (error) {
            console.error("OLU-XMD ANIME PLUGIN ERROR:", command, error);

            return reply(
                sock,
                msg,
                friendlyError(error)
            );
        }
    }
};