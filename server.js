const express = require("express");
const path = require("path");
const baileys = import("@whiskeysockets/baileys");
const session = require("express-session");

const db = require("./database");
const { registerUser } = require("./auth");
const { loginUser } = require("./login");
const whatsappModule = import("./whatsapp.js");
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || "olu-xmd-local-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Website files
app.use(express.static("public"));

// Registration
app.post("/api/register", (req, res) => {
    try {
        const { name, email, password } = req.body;
        const userId = registerUser(name, email, password);

        res.status(201).json({
            success: true,
            message: "Account created successfully!",
            userId
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Login
app.post("/api/login", (req, res) => {
    try {
        const { email, password } = req.body;
        const user = loginUser(email, password);

        req.session.userId = user.id;

        res.json({
            success: true,
            message: "Login successful!",
            user
        });

    } catch (error) {
        res.status(401).json({
            success: false,
            message: error.message
        });
    }
});
// Customer wallet API
app.get("/api/wallet", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const wallet = db.prepare(`
            SELECT balance
            FROM wallets
            WHERE user_id = ?
        `).get(req.session.userId);

        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: "Wallet not found."
            });
        }

        const transactions = db.prepare(`
            SELECT type, amount, status, created_at
            FROM transactions
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 20
        `).all(req.session.userId);

        const user = db.prepare(`
            SELECT name FROM users WHERE id = ?
        `).get(req.session.userId);

        res.json({
            success: true,
            name: user.name,
            balance: wallet.balance,
            transactions
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to load wallet."
        });
    }
});// Create wallet funding request
app.post("/api/wallet/fund", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const amountNaira = Number(req.body.amount);

        if (
            !Number.isSafeInteger(amountNaira) ||
            amountNaira < 100 ||
            amountNaira > 1000000
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a whole amount between ₦100 and ₦1,000,000."
            });
        }

        const amountKobo = amountNaira * 100;
        const reference = "OLUXMD-" + require("crypto").randomUUID();

        db.prepare(`
            INSERT INTO transactions
            (user_id, type, amount, reference, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            req.session.userId,
            "wallet_funding",
            amountKobo,
            reference,
            "pending"
        );

        res.status(201).json({
            success: true,
            message: "Funding request created. Payment is not yet completed.",
            reference,
            amount: amountNaira
        });

    } catch (error) {
        console.error("Funding request error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to create funding request."
        });
    }
});// Generate WhatsApp pairing code
// Generate WhatsApp pairing code
app.post("/api/whatsapp/pair", async (req, res) => {
    console.log("PAIRING ROUTE HIT:", Date.now());

    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const { phoneNumber } = req.body;

        const { generatePairingCode } = await whatsappModule;

const result = await generatePairingCode(
    2,
    phoneNumber
);

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error("WhatsApp pairing error:", error);

        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});app.post("/api/whatsapp/reconnect", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

       const { reconnectWhatsApp } = await whatsappModule;
await reconnectWhatsApp(2);

        res.json({
            success: true,
            message: "WhatsApp reconnection started."
        });

    } catch (error) {
        console.error("WhatsApp reconnection error:", error);

        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});
// Start server
app.listen(PORT, () => {
    console.log("OLU-XMD Panel started!");
    console.log(`Open http://localhost:${PORT}`);
});