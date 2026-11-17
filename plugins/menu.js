
module.exports = {
    name: "menu",
    aliases: ["groupmenu", "infomenu"],
    description: "OLU-XMD formatted command menus",

    async execute(sock, msg) {
        const bold = value => "*" + value + "*";

        const informationSections = [
            {
                heading: "INFORMATION MENU",
                commands: [
                    ".menu - Display the complete command menu",
                    ".infomenu - Display information commands",
                    ".groupmenu - Display group commands",
                    ".help - Command guide",
                    ".ping - Check bot response",
                    ".uptime - Bot running time",
                    ".hello - Greeting",
                    ".about - About OLU-XMD",
                    ".owner - Owner information"
                ]
            }
        ];

        const personalSections = [
            {
                heading: "PERSONAL WHATSAPP AUTOMATION",
                commands: [
                    ".automation - Personal automation controls",
                    ".autotyping on/off - Automatic typing indicator",
                    ".autorecording on/off - Automatic recording indicator",
                    ".autoread on/off - Automatically read incoming messages",
                    ".online on/off - Set available or unavailable presence",
                    ".autoviewonce - Not available; protected media is not bypassed",
                    ".autostatus - Show status automation settings",
                    ".autoview - Automatically view statuses",
                    ".autoreact - Automatically react to statuses"
                ]
            },
            {
                heading: "STICKER AND MEDIA TOOLS",
                commands: [
                    ".stickermenu - Display sticker commands",
                    ".sticker / .s - Convert image, GIF or short video",
                    ".take pack | author - Change sticker pack details",
                    ".toimg - Convert static sticker to PNG",
                    ".tovid / .tomp4 - Convert animated sticker to MP4",
                    ".ttp <text> - Create text sticker",
                    ".attp <text> - Create animated text sticker",
                    ".quotely / .qc <text> - Create quote sticker",
                    ".emojimix <emoji1>+<emoji2> - Mix two emojis",
                ]
            },
            {
                heading: "ANIME AND MANGA",
                commands: [
                    ".animemenu - Display anime command menu",
                    ".anime <title> - Search anime information",
                    ".manga <title> - Search manga information",
                    ".character <name> - Search anime character",
                    ".animechar <name> - Character search alias",
                    ".waifu - Random waifu image",
                    ".neko - Random neko image",
                    ".shinobu - Random Shinobu image",
                    ".megumin - Random Megumin image",
                    ".kitsune - Random kitsune image",
                    ".animewall - Landscape anime wallpaper",
                    ".animequote - Random anime quote",
                    ".hug @user - Anime hug reaction",
                    ".slap @user - Anime slap reaction",
                    ".pat @user - Anime pat reaction",
                    ".kiss @user - Anime kiss reaction",
                    ".dance @user - Anime dance reaction",
                    ".cry @user - Anime cry reaction"
                ]
            },
            {
                heading: "FUN AND ENTERTAINMENT",
                commands: [
                    ".fun - Fun command menu",
                    ".joke - Random joke",
                    ".fact - Interesting fact",
                    ".quote - Inspirational quote",
                    ".truth - Truth question",
                    ".dare - Dare challenge",
                    ".quiz - General knowledge quiz",
                    ".riddle - Brain teaser",
                    ".funcharacter - Fun personality",
                    ".flip - Toss a coin",
                    ".roll - Roll a dice",
                    ".eightball - Magic 8-ball",
                    ".compliment - Give a compliment"
                ]
            },
            {
                heading: "CHANNEL AND ADMIN CONTROLS",
                commands: [
                    ".channelpost - WhatsApp Channel automation",
                    ".admincontrols - Deployment-specific access controls",
                    ".sudo - Admin access controls",
                    ".block - Block command access",
                    ".unblock - Restore command access"
                ]
            },
            {
                heading: "MEDIA PRIVACY AND ARCHIVE",
                commands: [
                    ".vv - Save a replied ordinary image, video or voice note",
                    ".vv2 / .vvme - Send replied ordinary media to owner self-chat",
                    ".save - Save a replied viewable image or video",
                    ".antivv on/off - Post a visible View-Once privacy notice",
                    ".antidelete on/off - Temporary archive controls",
                    ".archiveconsent on/off - Opt in or out of temporary archiving",
                    "View-Once media is never bypassed. Archiving requires participant consent."
                ]
            }
        ];

        const groupSections = [
            {
                heading: "TAGGING AND MENTIONS",
                commands: [
                    ".tagall - Mention all members",
                    ".everyone - Mention group participants",
                    ".hidetag - Notify members without visible tags",
                    ".totag - Tag members on a replied message"
                ]
            },
            {
                heading: "MEMBER MANAGEMENT",
                commands: [
                    ".add - Add a member by phone number",
                    ".kick - Remove a tagged or replied member",
                    ".remove - Remove specified members",
                    ".ban - Remove and blacklist a member",
                    ".unban - Remove a member from blacklist",
                    ".promote - Promote a member to admin",
                    ".demote - Remove admin privileges",
                    ".promoteall - Promote eligible members",
                    ".demoteall - Demote eligible administrators",
                    ".mute - Restrict member messaging",
                    ".unmute - Allow member messaging"
                ]
            },
            {
                heading: "GROUP SETTINGS AND PROFILE",
                commands: [
                    ".groupopen - Open group discussion",
                    ".groupclose - Close group discussion",
                    ".invite - Send a group invitation privately",
                    ".grouplink - Display group invite link",
                    ".revoke - Reset group invite link",
                    ".setname - Change group name",
                    ".setdesc - Change group description",
                    ".setppgc - Change group picture using a replied image",
                    ".delppgc - Remove group picture",
                    ".ephemeral - Set disappearing messages",
                    ".restrict - Restrict group information editing",
                    ".unrestrict - Allow group information editing"
                ]
            },
            {
                heading: "GROUP RULES AND WARNINGS",
                commands: [
                    ".grouprules - Display group rules",
                    ".setrules - Save group rules",
                    ".warn - Warn a member",
                    ".unwarn - Remove one warning",
                    ".resetwarn - Reset member warnings",
                    ".warnlist - Display active warnings",
                    ".setwarn - Set warning limit"
                ]
            },
            {
                heading: "WELCOME AND GOODBYE",
                commands: [
                    ".welcome - Enable or disable welcome messages",
                    ".setwelcome - Customize welcome message",
                    ".goodbye - Enable or disable farewell messages",
                    ".setgoodbye - Customize goodbye message"
                ]
            },
            {
                heading: "GROUP PROTECTION",
                commands: [
                    ".antilink - Delete external links",
                    ".antilinkkick - Delete links and remove sender",
                    ".antilinkwarn - Delete links and warn sender",
                    ".antiwame - Block WhatsApp direct links",
                    ".antispam - Detect message flooding",
                    ".antitoxic - Filter prohibited words",
                    ".addbadword - Add a blocked word",
                    ".delbadword - Remove a blocked word",
                    ".listbadword - Show blocked words",
                    ".antifake - Block configured country prefixes",
                    ".setfake - Configure blocked prefixes",
                    ".antibot - Not available yet",
                    ".antisticker - Restrict stickers",
                    ".antimedia - Restrict media",
                    ".antitag - Prevent unauthorized mass tagging",
                    ".anticall - Block calls to the bot"
                ]
            },
            {
                heading: "GROUP INFORMATION AND ACTIVITY",
                commands: [
                    ".groupinfo - Display group information",
                    ".admins - List group administrators",
                    ".inactive - Find inactive members",
                    ".kickinactive - Remove eligible inactive members",
                    ".active - Show active members"
                ]
            },
            {
                heading: "MESSAGES AND MODERATION",
                commands: [
                    ".poll - Create a WhatsApp poll",
                    ".pin - Pin a replied message",
                    ".unpin - Unpin a message",
                    ".delete - Delete an eligible message",
                    ".purge - Bulk-delete recent messages"
                ]
            },
            {
                heading: "MEMBERSHIP REQUESTS",
                commands: [
                    ".requests - List pending join requests",
                    ".approveall - Approve pending requests",
                    ".rejectall - Reject pending requests"
                ]
            },
            {
                heading: "ADVANCED GROUP CONTROLS",
                commands: [
                    ".slowmode - Set message cooldown",
                    ".lockcmd - Disable a command in the group",
                    ".unlockcmd - Re-enable a locked command",
                    ".blacklist - Block a member from bot commands",
                    ".unblacklist - Restore command access",
                    ".leave - Make the bot leave the group"
                ]
            },
            {
                heading: "GROUP AUTOMATION AND STATUS",
                commands: [
                    ".groupstatus - Publish your own group status",
                    ".groupautomation - Group automation",
                    ".groupauto - Group automation alias",
                    ".groupreport - Group report"
                ]
            }
        ];

        function renderMenu(title, sections, groupNotice) {
            const output = [
                bold("=============================="),
                bold(title),
                bold("OLU-XMD OFFICIAL BOT"),
                bold("COMMAND PREFIX: ."),
                bold("==============================")
            ];

            for (const section of sections) {
                output.push("");
                output.push(bold("=== " + section.heading + " ==="));

                for (const command of section.commands) {
                    output.push(bold(command));
                }
            }

            if (groupNotice) {
                output.push("");
                output.push(bold("GROUP COMMANDS MUST BE USED INSIDE THE RELEVANT GROUP."));
                output.push(bold("Some actions require group admin permissions."));
            }

            output.push("");
            output.push(bold("POWERED BY OLU-XMD"));
            output.push(bold("=============================="));

            return output.join("\n");
        }

        const messageText = [
            msg.message?.conversation,
            msg.message?.extendedTextMessage?.text,
            msg.message?.imageMessage?.caption,
            msg.message?.videoMessage?.caption
        ].find(value => typeof value === "string") || "";

        const invokedCommand = messageText.trim()
            .split(/\s+/)[0]
            .replace(/^[^a-z0-9]+/i, "")
            .toLowerCase();

        let title = "OLU-XMD MAIN MENU";
        let sections = informationSections.concat(
            personalSections,
            groupSections
        );
        let groupNotice = true;

        if (invokedCommand === "groupmenu") {
            title = "OLU-XMD GROUP MENU";
            sections = groupSections;
            groupNotice = true;
        } else if (invokedCommand === "infomenu") {
            title = "OLU-XMD INFORMATION MENU";
            sections = informationSections;
            groupNotice = false;
        }

        
        const destination = msg.key.remoteJid;

        console.log("MENU SEND START:", {
            account: sock.user?.id,
            destination,
            menu: title
        });

        try {
            const sent = await sock.sendMessage(destination, {
                text: renderMenu(title, sections, groupNotice)
            });

            console.log("MENU SEND SUCCESS:", {
                account: sock.user?.id,
                destination,
                messageId: sent?.key?.id
            });

            return sent;
        } catch (error) {
            console.error("MENU SEND FAILED:", {
                account: sock.user?.id,
                destination,
                message: error.message,
                stack: error.stack
            });

            throw error;
        }

    }
};
