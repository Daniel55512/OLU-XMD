const pick = items => items[Math.floor(Math.random() * items.length)];

module.exports = {
    name: "fun",
    aliases: [
        "joke", "fact", "quote", "truth", "dare",
        "quiz", "riddle", "funcharacter", "flip",
        "roll", "eightball", "compliment"
    ],
    description: "OLU-XMD Fun and Entertainment Commands",

    async execute(sock, msg, { args = [], prefix = "." } = {}) {
        const body = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ""
        ).trim();

        const commandName = (
            body.slice(prefix.length).trim().split(/\s+/)[0] || "fun"
        ).toLowerCase();

        const jokes = [
            "Why did the computer go to the doctor? It caught a virus!",
            "Why was the math book sad? It had too many problems.",
            "Why did the phone wear glasses? It lost its contacts."
        ];

        const facts = [
            "Octopuses have three hearts.",
            "A day on Venus is longer than a year on Venus.",
            "Honey can remain edible for thousands of years when properly stored.",
            "An adult human has 206 bones."
        ];

        const quotes = [
            "Great things are done by a series of small things brought together.",
            "Success is the sum of small efforts repeated day after day.",
            "Believe you can and you're halfway there.",
            "Every expert was once a beginner."
        ];

        const truths = [
            "What is one dream you have never shared?",
            "What is your funniest childhood memory?",
            "What is one thing you wish you could change?",
            "Who inspires you the most?"
        ];

        const dares = [
            "Send a funny emoji to the group.",
            "Share your funniest joke.",
            "Describe yourself using only three words.",
            "Sing one line from your favourite song."
        ];

        const quizzes = [
            { q: "Which planet is known as the Red Planet?", options: "A. Venus  B. Mars  C. Jupiter", answer: "B. Mars" },
            { q: "How many days are in a leap year?", options: "A. 365  B. 366  C. 367", answer: "B. 366" },
            { q: "Which animal is the largest on Earth?", options: "A. Elephant  B. Giraffe  C. Blue whale", answer: "C. Blue whale" }
        ];

        const riddles = [
            { q: "What has keys but cannot open locks?", a: "A piano." },
            { q: "What gets wetter as it dries?", a: "A towel." },
            { q: "What has a face and two hands but no arms or legs?", a: "A clock." }
        ];

        const characters = [
            "The Natural Leader: confident, bold and inspiring.",
            "The Problem Solver: creative, clever and determined.",
            "The Entertainer: funny, lively and full of energy.",
            "The Dreamer: imaginative, hopeful and ambitious."
        ];

        const compliments = [
            "You have a wonderful way of making people smile!",
            "Your determination can take you far. Keep going!",
            "You are unique, valuable and appreciated.",
            "Your positive energy makes a difference."
        ];

        const eightBall = [
            "Yes, definitely!",
            "The outlook is good.",
            "Ask again later.",
            "It is uncertain.",
            "Probably not.",
            "Absolutely!"
        ];

        let response;

        switch (commandName) {
            case "fun":
                response = `OLU-XMD FUN COMMANDS

.joke - Random joke
.fact - Interesting fact
.quote - Inspirational quote
.truth - Truth question
.dare - Dare challenge
.quiz - General knowledge quiz
.riddle - Brain teaser
.funcharacter - Fun personality
.flip - Toss a coin
.roll - Roll a dice
.eightball - Ask the magic 8-ball
.compliment - Receive a compliment`;
                break;

            case "joke":
                response = "😂 OLU-XMD JOKE\n\n" + pick(jokes);
                break;

            case "fact":
                response = "💡 DID YOU KNOW?\n\n" + pick(facts);
                break;

            case "quote":
                response = "🌟 DAILY QUOTE\n\n" + pick(quotes);
                break;

            case "truth":
                response = "🎯 TRUTH QUESTION\n\n" + pick(truths);
                break;

            case "dare":
                response = "🔥 YOUR DARE\n\n" + pick(dares);
                break;

            case "quiz": {
                const quiz = pick(quizzes);
                response = `🧠 OLU-XMD QUIZ\n\n${quiz.q}\n\n${quiz.options}\n\nAnswer: ${quiz.answer}`;
                break;
            }

            case "riddle": {
                const riddle = pick(riddles);
                response = `🤔 RIDDLE\n\n${riddle.q}\n\nAnswer: ${riddle.a}`;
                break;
            }

            case "funcharacter":
                response = "🎭 YOUR CHARACTER\n\n" + pick(characters);
                break;

            case "flip":
                response = "🪙 COIN TOSS\n\n" + pick(["Heads!", "Tails!"]);
                break;

            case "roll": {
                const sides = args.length ? Number(args[0]) : 6;
                if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
                    response = "Usage: .roll or .roll 20\nChoose between 2 and 1000 sides.";
                } else {
                    response = `🎲 DICE RESULT\n\nYou rolled ${Math.floor(Math.random() * sides) + 1} (${sides}-sided dice).`;
                }
                break;
            }

            case "eightball":
                response = args.join(" ").trim()
                    ? "🔮 MAGIC 8-BALL\n\n" + pick(eightBall)
                    : "Ask a question first.\nExample: .eightball Will I succeed?";
                break;

            case "compliment":
                response = "💖 A MESSAGE FOR YOU\n\n" + pick(compliments);
                break;

            default:
                response = "Unknown Fun command. Type .fun to see available commands.";
        }

        await sock.sendMessage(msg.key.remoteJid, { text: response });
    }
};