require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const QRCode = require("qrcode");
const baileys = import("@whiskeysockets/baileys");
const session = require("express-session");

const db = require("./database");
const { getCountries, getCountryByCode, getSupportedCurrencyCodes } = require("./country-directory");
const {
    getSubscriptionStatus
} = require("./subscriptionService");
const { registerUser } = require("./auth");
const { loginUser } = require("./login");
const { registerGoogleAuthRoutes } = require("./google-auth-routes");
const whatsappModule = require("./whatsapp.js");
const app = express();
const PORT = Number(process.env.SERVER_PORT || 3000);
// Record an Owner administrative action
function recordAdminAudit(adminUserId, action, targetUserId = null, details = null) {
    try {
        db.prepare(`
            INSERT INTO admin_audit_logs
                (admin_user_id, action, target_user_id, details)
            VALUES (?, ?, ?, ?)
        `).run(adminUserId, action, targetUserId, details);
    } catch (error) {
        console.error("Admin audit logging error:", error);
    }
}

// Middleware
app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); } }));

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

registerGoogleAuthRoutes(app);

// Public country and currency directory for registration.
app.get("/api/countries", (req, res) => {
    res.set("Cache-Control", "public, max-age=3600");

    res.json({
        success: true,
        countries: getCountries()
    });
});

// Check customer login and return account details
// Check login and return account details and role
app.get("/api/session", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({
                success: true,
                loggedIn: false,
                name: null,
                email: null,
                role: null
            });
        }

        const user = db.prepare(`
            SELECT
                users.name,
                users.email,
                COALESCE(admin_users.role, 'customer') AS role
            FROM users
            LEFT JOIN admin_users
                ON users.id = admin_users.user_id
            WHERE users.id = ?
        `).get(req.session.userId);

        if (!user) {
            return res.json({
                success: true,
                loggedIn: false,
                name: null,
                email: null,
                role: null
            });
        }

        res.json({
            success: true,
            loggedIn: true,
            name: user.name,
            email: user.email,
            role: user.role
        });

    } catch (error) {
        console.error("Session details error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load account details."
        });
    }
});
// Owner-only security middleware with 15-minute inactivity timeout
function requireOwner(req, res, next) {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const admin = db.prepare(`
            SELECT role
            FROM admin_users
            WHERE user_id = ?
        `).get(req.session.userId);

        if (!admin || admin.role !== "owner") {
            return res.status(403).json({
                success: false,
                message: "Owner access only."
            });
        }

        const lastActivity = Number(req.session.ownerLastActivityAt || 0);

        if (!lastActivity || Date.now() - lastActivity > 15 * 60 * 1000) {
            return req.session.destroy(() => {
                res.clearCookie("connect.sid", { path: "/" });
                res.status(401).json({
                    success: false,
                    code: "OWNER_SESSION_EXPIRED",
                    message: "Owner session expired. Please login again."
                });
            });
        }

        req.session.ownerLastActivityAt = Date.now();
        req.session.cookie.maxAge = 15 * 60 * 1000;
        next();

    } catch (error) {
        console.error("Owner authorization error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to verify Owner access."
        });
    }
}

// Owner access verification
app.get("/api/admin/check", requireOwner, (req, res) => {
    res.json({
        success: true,
        message: "Owner access verified.",
        role: "owner"
    });
});
     

// Owner administrative activity logs
app.get("/api/admin/activity-logs", requireOwner, (req, res) => {
    try {
        const logs = db.prepare(`
            SELECT
                logs.id,
                logs.action,
                logs.details,
                logs.created_at,
                admins.name AS admin_name,
                admins.email AS admin_email,
                targets.name AS target_user_name,
                targets.email AS target_user_email
            FROM admin_audit_logs AS logs
            INNER JOIN users AS admins
                ON admins.id = logs.admin_user_id
            LEFT JOIN users AS targets
                ON targets.id = logs.target_user_id
            ORDER BY logs.created_at DESC, logs.id DESC
            LIMIT 200
        `).all();

        res.json({
            success: true,
            logs
        });
    } catch (error) {
        console.error("Admin activity logs error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load administrative activity logs."
        });
    }
});
// Owner Dashboard Statistics
app.get("/api/admin/dashboard/stats", requireOwner, (req, res) => {
    try {
        const totalUsers = db.prepare(`
            SELECT COUNT(*) AS total FROM users
        `).get().total;

        const totalSubscriptions = db.prepare(`
            SELECT COUNT(*) AS total
            FROM subscriptions
            WHERE status = 'active'
              AND datetime(expires_at) > datetime('now')
        `).get().total;

        const totalWalletBalance = db.prepare(`
            SELECT COALESCE(SUM(balance), 0) AS total
            FROM wallets
        `).get().total;

        const totalXmdCoins = db.prepare(`
            SELECT COALESCE(SUM(balance), 0) AS total
            FROM coin_wallets
        `).get().total;

        const totalPlans = db.prepare(`
            SELECT COUNT(*) AS total
            FROM subscription_plans
            WHERE is_active = 1
        `).get().total;

        res.json({
            success: true,
            statistics: {
                totalUsers,
                totalSubscriptions,
                totalWalletBalanceKobo: totalWalletBalance,
                totalXmdCoins,
                totalPlans
            }
        });

    } catch (error) {
        console.error("Owner dashboard statistics error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load dashboard statistics."
        });
    }
});
app.get("/api/admin/customers", requireOwner, (req, res) => {
    try {
        const search = String(req.query.search || "").trim();

        const customers = db.prepare(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.country_code,
                u.currency_code,
                u.created_at,

                COALESCE(w.balance, 0) AS wallet_balance_kobo,
                COALESCE(cw.balance, 0) AS xmd_coin_balance,

                (
                    SELECT sp.name
                    FROM subscriptions s
                    LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
                    WHERE s.user_id = u.id
                    ORDER BY s.created_at DESC, s.id DESC
                    LIMIT 1
                ) AS subscription_plan,

                (
                    SELECT s.status
                    FROM subscriptions s
                    WHERE s.user_id = u.id
                    ORDER BY s.created_at DESC, s.id DESC
                    LIMIT 1
                ) AS subscription_status,

                (
                    SELECT s.expires_at
                    FROM subscriptions s
                    WHERE s.user_id = u.id
                    ORDER BY s.created_at DESC, s.id DESC
                    LIMIT 1
                ) AS subscription_expires_at

            FROM users u
            LEFT JOIN wallets w ON w.user_id = u.id
            LEFT JOIN coin_wallets cw ON cw.user_id = u.id

            WHERE (
                @search = ''
                OR u.name LIKE @pattern
                OR u.email LIKE @pattern
                OR CAST(u.id AS TEXT) = @search
            )

            AND NOT EXISTS (
                SELECT 1
                FROM admin_users AS admin
                WHERE admin.user_id = u.id
            )
            ORDER BY u.id DESC
            LIMIT 100
        `).all({
            search,
            pattern: `%${search}%`
        });

        res.json({
            success: true,
            total: customers.length,
            customers
        });

    } catch (error) {
        console.error("Customer management error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load customers."
        });
    }
});


// Owner: View a customer's XMD Coin balance and history
app.get("/api/admin/coins/:userId", requireOwner, (req, res) => {
    try {
        const customerId = Number(req.params.userId);

        if (!Number.isSafeInteger(customerId) || customerId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        const customer = db.prepare(`
            SELECT id, name, email
            FROM users
            WHERE id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM admin_users AS admin
                  WHERE admin.user_id = users.id
              )
        `).get(customerId);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer not found."
            });
        }

        const wallet = db.prepare(`
            SELECT balance
            FROM coin_wallets
            WHERE user_id = ?
        `).get(customerId);

        const transactions = db.prepare(`
            SELECT
                ct.id,
                ct.type,
                ct.amount,
                ct.reference,
                ct.status,
                ct.reason,
                ct.created_at,
                admins.name AS admin_name,
                admins.email AS admin_email
            FROM coin_transactions ct
            LEFT JOIN users admins
                ON admins.id = ct.admin_user_id
            WHERE ct.user_id = ?
            ORDER BY ct.created_at DESC, ct.id DESC
            LIMIT 100
        `).all(customerId);

        res.json({
            success: true,
            customer,
            balance: wallet ? wallet.balance : 0,
            transactions
        });

    } catch (error) {
        console.error("Owner coin history error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load XMD Coin history."
        });
    }
});

// Owner: Safely grant or deduct customer XMD Coins
function performOwnerCoinAdjustment(req, res, type) {
    try {
        const customerId = Number(req.params.userId);
        const amount = Number(req.body?.amount);
        const reason = typeof req.body?.reason === "string"
            ? req.body.reason.trim()
            : "";

        if (!Number.isSafeInteger(customerId) || customerId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid whole-number coin amount."
            });
        }

        if (!reason || reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: "A reason is required and must not exceed 500 characters."
            });
        }

        const result = db.transaction(() => {
            const customer = db.prepare(`
                SELECT id FROM users
                WHERE id = ?
                  AND NOT EXISTS (
                      SELECT 1 FROM admin_users AS admin
                      WHERE admin.user_id = users.id
                  )
            `).get(customerId);

            if (!customer) {
                const error = new Error("Customer not found.");
                error.statusCode = 404;
                throw error;
            }

            db.prepare(`
                INSERT OR IGNORE INTO coin_wallets (user_id, balance)
                VALUES (?, 0)
            `).run(customerId);

            const wallet = db.prepare(`
                SELECT balance FROM coin_wallets WHERE user_id = ?
            `).get(customerId);

            const currentBalance = Number(wallet.balance);

            if (!Number.isSafeInteger(currentBalance) || currentBalance < 0) {
                throw new Error("Customer coin balance is invalid.");
            }

            let newBalance;

            if (type === "owner_grant") {
                newBalance = currentBalance + amount;

                if (!Number.isSafeInteger(newBalance)) {
                    const error = new Error("Resulting balance is too large.");
                    error.statusCode = 400;
                    throw error;
                }

                db.prepare(`
                    UPDATE coin_wallets
                    SET balance = balance + ?
                    WHERE user_id = ?
                `).run(amount, customerId);

            } else {
                if (currentBalance < amount) {
                    const error = new Error(
                        "Insufficient XMD Coin balance. Current balance: " +
                        currentBalance
                    );
                    error.statusCode = 400;
                    throw error;
                }

                newBalance = currentBalance - amount;

                db.prepare(`
                    UPDATE coin_wallets
                    SET balance = balance - ?
                    WHERE user_id = ? AND balance >= ?
                `).run(amount, customerId, amount);
            }

            const reference =
                "OLUXMD-OWNER-" +
                type.toUpperCase() + "-" +
                require("crypto").randomUUID();

            db.prepare(`
                INSERT INTO coin_transactions (
                    user_id,
                    type,
                    amount,
                    reference,
                    status,
                    reason,
                    admin_user_id
                )
                VALUES (?, ?, ?, ?, 'completed', ?, ?)
            `).run(
                customerId,
                type,
                amount,
                reference,
                reason,
                req.session.userId
            );

            const action = type === "owner_grant"
                ? "xmd_coin_grant"
                : "xmd_coin_deduction";

            const description =
                (type === "owner_grant" ? "Granted " : "Deducted ") +
                amount + " XMD Coins. Reason: " +
                reason + ". Reference: " + reference;

            db.prepare(`
                INSERT INTO admin_audit_logs
                    (admin_user_id, action, target_user_id, details)
                VALUES (?, ?, ?, ?)
            `).run(
                req.session.userId,
                action,
                customerId,
                description
            );

            return {
                customerId,
                amount,
                previousBalance: currentBalance,
                newBalance,
                reference,
                type
            };
        })();

        res.json({
            success: true,
            message: type === "owner_grant"
                ? "XMD Coins granted successfully."
                : "XMD Coins deducted successfully.",
            adjustment: result
        });

    } catch (error) {
        console.error("Owner coin adjustment error:", error);

        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Unable to process coin adjustment."
        });
    }
}

app.post("/api/admin/coins/:userId/grant", requireOwner, (req, res) => {
    performOwnerCoinAdjustment(req, res, "owner_grant");
});

app.post("/api/admin/coins/:userId/deduct", requireOwner, (req, res) => {
    performOwnerCoinAdjustment(req, res, "owner_deduction");
});
// Owner: Read-only customer profile
app.get("/api/admin/customers/:id/profile", requireOwner, (req, res) => {
    try {
        const customerId = Number(req.params.id);

        if (!Number.isSafeInteger(customerId) || customerId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid customer ID."
            });
        }

        const customer = db.prepare(`
            SELECT id, name, email, country_code, currency_code, created_at
            FROM users
            WHERE id = ?
        `).get(customerId);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer not found."
            });
        }

        const walletBalance = db.prepare(`
            SELECT COALESCE(balance, 0) AS balance
            FROM wallets
            WHERE user_id = ?
        `).get(customerId);

        const walletTransactions = db.prepare(`
            SELECT id, type, amount, reference, status, created_at
            FROM transactions
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `).all(customerId);

        const coinBalance = db.prepare(`
            SELECT COALESCE(balance, 0) AS balance
            FROM coin_wallets
            WHERE user_id = ?
        `).get(customerId);

        const coinTransactions = db.prepare(`
            SELECT
                id, type, amount, reference, status, reason,
                admin_user_id, currency_code,
                purchase_amount_minor_units, created_at
            FROM coin_transactions
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `).all(customerId);

        const subscriptions = db.prepare(`
            SELECT
                s.id,
                s.status,
                s.starts_at,
                s.expires_at,
                s.created_at,
                sp.name AS plan_name,
                sp.code AS plan_code,
                sp.duration_days,
                p.reference AS payment_reference,
                p.amount_kobo AS payment_amount_kobo,
                p.status AS payment_status,
                p.verified_at AS payment_verified_at
            FROM subscriptions s
            LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
            LEFT JOIN subscription_payments p ON p.id = s.payment_id
            WHERE s.user_id = ?
            ORDER BY s.created_at DESC, s.id DESC
            LIMIT 50
        `).all(customerId);

        recordAdminAudit(
            req.session.userId,
            "customer_profile_view",
            customerId,
            "Owner viewed customer profile, wallet, XMD Coin and subscription details"
        );
        res.json({
            success: true,
            customer,
            wallet: {
                balanceKobo: walletBalance ? walletBalance.balance : 0,
                transactions: walletTransactions
            },
            xmdCoins: {
                balance: coinBalance ? coinBalance.balance : 0,
                transactions: coinTransactions
            },
            subscriptions
        });

    } catch (error) {
        console.error("Customer profile error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load customer profile."
        });
    }
});


// Dedicated Owner login
app.post("/api/owner/login", (req, res) => {
    try {
        const { email, password } = req.body || {};

        const user = loginUser(email || "", password || "");

        if (user.role !== "owner") {
            return res.status(403).json({
                success: false,
                message: "Owner access only."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                console.error("Owner session error:", error);
                return res.status(500).json({
                    success: false,
                    message: "Unable to create Owner session."
                });
            }

            req.session.userId = user.id;
            req.session.role = "owner";
            req.session.ownerLastActivityAt = Date.now();
            req.session.cookie.maxAge = 15 * 60 * 1000;

            req.session.save((saveError) => {
                if (saveError) {
                    console.error("Owner session save error:", saveError);
                    return res.status(500).json({
                        success: false,
                        message: "Unable to save Owner session."
                    });
                }

                recordAdminAudit(
                    user.id,
                    "owner_login",
                    null,
                    "Owner signed in to the control panel"
                );

                res.json({
                    success: true,
                    message: "Owner login successful."
                });
            });
        });

    } catch (error) {
        res.status(401).json({
            success: false,
            message: "Invalid email or password."
        });
    }
});

// Protect the Owner dashboard page itself
app.get("/admin.html", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect("/owner-login.html");
        }

        const admin = db.prepare(`
            SELECT role FROM admin_users WHERE user_id = ?
        `).get(req.session.userId);

        if (!admin || admin.role !== "owner") {
            return res.redirect("/owner-login.html");
        }

        const lastActivity = Number(req.session.ownerLastActivityAt || 0);

        if (!lastActivity || Date.now() - lastActivity > 15 * 60 * 1000) {
            return req.session.destroy(() => {
                res.clearCookie("connect.sid", { path: "/" });
                res.redirect("/owner-login.html");
            });
        }

        req.session.ownerLastActivityAt = Date.now();
        req.session.cookie.maxAge = 15 * 60 * 1000;
        res.sendFile(path.join(__dirname, "public", "admin.html"));

    } catch (error) {
        console.error("Owner dashboard access error:", error);
        res.status(500).send("Unable to verify Owner access.");
    }
});

// Public landing page and customer dashboard access
function renderHomePage(req, res) {
    if (!req.session.userId) {
        return res.sendFile(path.join(__dirname, "public", "index.html"));
    }

    try {
        const account = db.prepare(`
            SELECT COALESCE(admin_users.role, 'customer') AS role
            FROM users
            LEFT JOIN admin_users
                ON users.id = admin_users.user_id
            WHERE users.id = ?
        `).get(req.session.userId);

        if (!account) {
            return req.session.destroy(() => {
                res.clearCookie("connect.sid", { path: "/" });
                res.redirect("/");
            });
        }

        if (account.role === "owner") {
            return res.redirect("/admin.html");
        }

        return res.redirect("/dashboard.html");

    } catch (error) {
        console.error("Homepage access error:", error);
        return res.status(500).send("Unable to load the homepage.");
    }
}

app.get("/", renderHomePage);
app.get("/index.html", renderHomePage);

// Customer dashboard: login is required
app.get("/dashboard.html", (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/login.html");
    }

    try {
        const account = db.prepare(`
            SELECT COALESCE(admin_users.role, 'customer') AS role
            FROM users
            LEFT JOIN admin_users
                ON users.id = admin_users.user_id
            WHERE users.id = ?
        `).get(req.session.userId);

        if (!account) {
            return req.session.destroy(() => {
                res.clearCookie("connect.sid", { path: "/" });
                res.redirect("/login.html");
            });
        }

        if (account.role !== "owner" && account.role !== "customer") {
            return res.redirect("/login.html");
        }

        res.set("Cache-Control", "no-store, private");
        return res.sendFile(
            path.join(__dirname, "public", "dashboard.html")
        );

    } catch (error) {
        console.error("Customer dashboard access error:", error);
        return res.status(500).send("Unable to verify dashboard access.");
    }
});
// Protect customer-only pages
function renderCustomerPage(pageName, allowOwner = false) {
    return (req, res) => {
        if (!req.session.userId) {
            return res.redirect("/login.html");
        }

        try {
            const account = db.prepare(`
                SELECT COALESCE(admin_users.role, 'customer') AS role
                FROM users
                LEFT JOIN admin_users
                    ON users.id = admin_users.user_id
                WHERE users.id = ?
            `).get(req.session.userId);

            if (!account) {
                return req.session.destroy(() => {
                    res.clearCookie("connect.sid", { path: "/" });
                    res.redirect("/login.html");
                });
            }

            if (account.role === "owner" && !allowOwner) {
                return res.redirect("/admin.html");
            }

            if (account.role !== "customer" && !(allowOwner && account.role === "owner")) {
                return res.redirect("/login.html");
            }

            res.set("Cache-Control", "no-store, private");
            return res.sendFile(
                path.join(__dirname, "public", pageName)
            );

        } catch (error) {
            console.error("Customer page access error:", error);
            return res.status(500).send("Unable to verify customer access.");
        }
    };
}

// Protect all customer-only pages
app.get("/auto-reply.html", renderCustomerPage("auto-reply.html"));
app.get("/bot.html", renderCustomerPage("bot.html"));
app.get("/connect.html", renderCustomerPage("connect.html"));
app.get("/custom-commands.html", renderCustomerPage("custom-commands.html", true));
app.get("/subscription.html", renderCustomerPage("subscription.html"));
app.get("/wallet.html", renderCustomerPage("wallet.html"));
app.use(express.static(path.join(__dirname, "public")));

// Registration
app.post("/api/register", (req, res) => {
    try {
        const { name, email, password, countryCode } = req.body;
        const userId = registerUser(name, email, password, countryCode);

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
if (user.role === "customer") {
    try {
        db.prepare(`
            INSERT INTO customer_activity (user_id, event_type, details)
            VALUES (?, ?, ?)
        `).run(user.id, "login", "Customer logged in");
    } catch (activityError) {
        console.error("Customer login activity error:", activityError);
    }
}


        req.session.userId = user.id;
        req.session.role = user.role;
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
// Customer logout - ends login session only
app.post("/api/logout", (req, res) => {
    const userId = req.session.userId;
    const role = req.session.role;

    if (userId && role === "customer") {
        try {
            db.prepare(`
                INSERT INTO customer_activity (user_id, event_type, details)
                VALUES (?, ?, ?)
            `).run(userId, "logout", "Customer logged out");
        } catch (activityError) {
            console.error("Customer logout activity error:", activityError);
        }
    }
    if (userId && role === "owner") {
        recordAdminAudit(
            userId,
            "owner_logout",
            null,
            "Owner logged out of the control panel"
        );
    }

    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Could not log out."
            });
        }

        res.clearCookie("connect.sid", { path: "/" });

        res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

function getPayVesselConfig() {
    const environment = String(process.env.PAYVESSEL_ENV || "sandbox")
        .trim()
        .toLowerCase();

    if (environment !== "sandbox" && environment !== "live") {
        throw new Error("Invalid PayVessel environment configuration.");
    }

    if (
        environment === "live" &&
        String(process.env.PAYVESSEL_LIVE_ENABLED || "").toLowerCase() !== "true"
    ) {
        throw new Error("PayVessel Live payments are disabled until Sandbox testing and business approval are complete.");
    }

    const apiKey = process.env.PAYVESSEL_API_KEY;
    const apiSecret = process.env.PAYVESSEL_API_SECRET;

    if (!apiKey || !apiSecret) {
        throw new Error("PayVessel Sandbox credentials are not configured. No payment was initiated.");
    }

    return {
        environment,
        baseUrl: environment === "sandbox"
            ? "https://sandbox.payvessel.com"
            : "https://api.payvessel.com",
        apiKey,
        apiSecret
    };
}

// Initialize a PayVessel XMD Coin purchase using global USD pricing.
// External checkout remains disabled until provider approval and API testing.
app.post("/api/xmd-coins/payvessel/initialize", async (req, res) => {
    let reference = null;

    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please log in first."
            });
        }

        const userId = Number(req.session.userId);

        const customer = db.prepare(`
            SELECT id, name, email, country_code, currency_code
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer account not found."
            });
        }

        const currencyCode = String(customer.currency_code || "")
            .trim()
            .toUpperCase();

        // PayVessel is restricted to NGN until its international
        // currency and local bank-transfer support are confirmed.
        if (customer.country_code !== "NG" || currencyCode !== "NGN") {
            return res.status(400).json({
                success: false,
                message: "PayVessel checkout is not yet approved for your country's currency. Your displayed local price remains available."
            });
        }

        const master = db.prepare(`
            SELECT coins_per_package, usd_price_minor_units
            FROM xmd_coin_master_pricing
            WHERE id = 1
        `).get();

        if (
            !master ||
            !Number.isSafeInteger(master.coins_per_package) ||
            master.coins_per_package <= 0 ||
            !Number.isSafeInteger(master.usd_price_minor_units) ||
            master.usd_price_minor_units <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "The global USD master price is not configured."
            });
        }

        const rate = db.prepare(`
            SELECT rate_per_usd, rate_date, source
            FROM xmd_coin_exchange_rates
            WHERE currency_code = 'NGN'
        `).get();

        if (
            !rate ||
            !Number.isFinite(Number(rate.rate_per_usd)) ||
            Number(rate.rate_per_usd) <= 0
        ) {
            return res.status(503).json({
                success: false,
                message: "The NGN exchange rate is unavailable. Please try again after the Owner refreshes exchange rates."
            });
        }

        const currencyExponent = getXmdCurrencyExponent("NGN");
        const multiplier = Math.pow(10, currencyExponent);

        const usdAmount = master.usd_price_minor_units / 100;
        const exchangeRate = Number(rate.rate_per_usd);

        const calculatedLocalAmount =
            usdAmount * exchangeRate * multiplier;

        const amountMinorUnits = Math.round(calculatedLocalAmount);

        if (
            !Number.isSafeInteger(amountMinorUnits) ||
            amountMinorUnits <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "The calculated local payment amount is invalid."
            });
        }

        if (
            typeof customer.name !== "string" ||
            !customer.name.trim() ||
            typeof customer.email !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)
        ) {
            return res.status(400).json({
                success: false,
                message: "Your account needs a valid name and email address before checkout."
            });
        }

        const phoneInput = String(req.body?.phone || "").trim();
        let phoneDigits = phoneInput.replace(/\D/g, "");

        if (phoneDigits.length === 11 && phoneDigits.startsWith("0")) {
            phoneDigits = "234" + phoneDigits.slice(1);
        }

        if (!/^\d{10,15}$/.test(phoneDigits)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid phone number with country code."
            });
        }

        // Never call PayVessel until the integration has been approved
        // and the exact provider API contract has been tested.
        if (
            String(process.env.PAYVESSEL_CHECKOUT_ENABLED || "")
                .toLowerCase() !== "true"
        ) {
            return res.status(503).json({
                success: false,
                checkoutDisabled: true,
                message: "PayVessel checkout is temporarily disabled pending provider approval and Sandbox testing.",
                quote: {
                    coins: master.coins_per_package,
                    baseCurrency: "USD",
                    baseAmountMinorUnits: master.usd_price_minor_units,
                    currencyCode: "NGN",
                    amountMinorUnits,
                    exchangeRate,
                    exchangeRateDate: rate.rate_date,
                    exchangeRateSource: rate.source,
                    currencyExponent
                }
            });
        }

        const config = getPayVesselConfig();

        reference =
            "OLUXMD-" +
            Date.now() +
            "-" +
            crypto.randomBytes(6).toString("hex").toUpperCase();

        db.prepare(`
            INSERT INTO xmd_coin_payment_intents (
                user_id,
                gateway,
                reference,
                coins,
                currency_code,
                amount_minor_units,
                status,
                base_currency_code,
                base_amount_minor_units,
                exchange_rate,
                exchange_rate_date,
                exchange_rate_source,
                currency_exponent
            )
            VALUES (?, 'payvessel', ?, ?, 'NGN', ?, 'pending',
                    'USD', ?, ?, ?, ?, ?)
        `).run(
            userId,
            reference,
            master.coins_per_package,
            amountMinorUnits,
            master.usd_price_minor_units,
            exchangeRate,
            rate.rate_date,
            rate.source,
            currencyExponent
        );

        // NGN amount is sent in naira, not kobo.
        const amountNaira = (amountMinorUnits / multiplier).toFixed(2);

        const payload = {
            amount: amountNaira,
            currency: "NGN",
            reference,
            channels: ["BANK_TRANSFER"],
            customer_name: customer.name.trim(),
            customer_email: customer.email.trim(),
            customer_phone_number: "+" + phoneDigits,
            metadata: {
                platform: "OLU-XMD",
                product: "XMD_COIN_PURCHASE",
                customer_id: String(userId),
                coins: String(master.coins_per_package),
                base_currency: "USD",
                base_amount_minor_units: String(master.usd_price_minor_units),
                exchange_rate: String(exchangeRate),
                exchange_rate_date: rate.rate_date
            }
        };

        const appBaseUrl = String(process.env.APP_BASE_URL || "")
            .replace(/\/+$/, "");

        const isLocalDevelopmentUrl =
            /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(appBaseUrl);

        if (appBaseUrl.startsWith("https://") || isLocalDevelopmentUrl) {
            payload.redirect_url =
                appBaseUrl +
                "/wallet.html?payvessel_return=1&reference=" +
                encodeURIComponent(reference);
        }

        const providerResponse = await fetch(
            config.baseUrl + "/pms/transactions/initialize/",
            {
                method: "POST",
                headers: {
                    "api-key": config.apiKey,
                    "api-secret": config.apiSecret,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(20000)
            }
        );

        const providerBody = await providerResponse.json().catch(() => null);
        const providerData = providerBody?.data || {};

        const rawCheckoutUrl =
            providerData.checkout_url ||
            providerData.authorization_url;

        if (
            !providerResponse.ok ||
            !providerBody ||
            providerBody.status === false ||
            providerBody.status === "error" ||
            !rawCheckoutUrl
        ) {
            const reason = String(
                providerBody?.message ||
                "PayVessel could not initialize checkout."
            ).slice(0, 500);

            db.prepare(`
                UPDATE xmd_coin_payment_intents
                SET status = 'failed',
                    failure_reason = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE reference = ? AND user_id = ?
            `).run(reason, reference, userId);

            return res.status(502).json({
                success: false,
                message: reason,
                reference
            });
        }

        let checkoutUrl;

        try {
            const parsedUrl = new URL(rawCheckoutUrl);

            if (
                parsedUrl.protocol !== "https:" ||
                !(
                    parsedUrl.hostname === "payvessel.com" ||
                    parsedUrl.hostname.endsWith(".payvessel.com")
                )
            ) {
                throw new Error("Unexpected checkout URL.");
            }

            checkoutUrl = parsedUrl.toString();
        } catch {
            db.prepare(`
                UPDATE xmd_coin_payment_intents
                SET status = 'failed',
                    failure_reason = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE reference = ? AND user_id = ?
            `).run(
                "PayVessel returned an invalid checkout URL.",
                reference,
                userId
            );

            return res.status(502).json({
                success: false,
                message: "PayVessel returned an invalid checkout URL."
            });
        }

        const providerReference = String(
            providerData.reference ||
            providerData.transaction_ref ||
            reference
        );

        db.prepare(`
            UPDATE xmd_coin_payment_intents
            SET
                checkout_url = ?,
                provider_transaction_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE reference = ? AND user_id = ?
        `).run(checkoutUrl, providerReference, reference, userId);

        return res.json({
            success: true,
            message: "PayVessel checkout is ready.",
            reference,
            checkoutUrl,
            coins: master.coins_per_package,
            amountMinorUnits,
            currencyCode: "NGN",
            baseCurrencyCode: "USD",
            baseAmountMinorUnits: master.usd_price_minor_units,
            exchangeRate,
            exchangeRateDate: rate.rate_date
        });

    } catch (error) {
        console.error("OLU-XMD PayVessel initialization error:", error.message);

        if (reference) {
            try {
                db.prepare(`
                    UPDATE xmd_coin_payment_intents
                    SET status = 'failed',
                        failure_reason = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE reference = ? AND status = 'pending'
                `).run(
                    String(error.message || "Initialization error").slice(0, 500),
                    reference
                );
            } catch (databaseError) {
                console.error(
                    "Could not update PayVessel intent:",
                    databaseError.message
                );
            }
        }

        return res.status(502).json({
            success: false,
            message: "Unable to initialize PayVessel checkout. No XMD Coins were credited.",
            reference
        });
    }
});
// Verify a PayVessel payment and credit the customer exactly once.
app.post("/api/xmd-coins/payvessel/verify", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please log in first."
            });
        }

        const config = getPayVesselConfig();
        const userId = Number(req.session.userId);
        const reference = String(req.body?.reference || "").trim();

        if (!/^OLUXMD-[A-Za-z0-9-]{10,80}$/.test(reference)) {
            return res.status(400).json({
                success: false,
                message: "Invalid OLU-XMD payment reference."
            });
        }

        const intent = db.prepare(`
            SELECT *
            FROM xmd_coin_payment_intents
            WHERE reference = ? AND user_id = ? AND gateway = 'payvessel'
        `).get(reference, userId);

        if (!intent) {
            return res.status(404).json({
                success: false,
                message: "Payment record not found."
            });
        }

        if (intent.status === "paid") {
            const wallet = db.prepare(`
                SELECT balance FROM coin_wallets WHERE user_id = ?
            `).get(userId);

            return res.json({
                success: true,
                alreadyCredited: true,
                balance: wallet ? wallet.balance : 0,
                message: "This payment has already been credited."
            });
        }

        if (intent.status !== "pending") {
            return res.status(409).json({
                success: false,
                status: intent.status,
                message: "This payment is not in a verifiable pending state."
            });
        }

        const providerReference = String(
            intent.provider_transaction_id || intent.reference
        );

        const providerResponse = await fetch(
            config.baseUrl +
                "/pms/transactions/" +
                encodeURIComponent(providerReference) +
                "/confirm/",
            {
                method: "GET",
                headers: {
                    "api-key": config.apiKey,
                    "api-secret": config.apiSecret,
                    "Content-Type": "application/json"
                },
                signal: AbortSignal.timeout(20000)
            }
        );

        const providerBody = await providerResponse.json().catch(() => null);
        const providerData = providerBody?.data || {};

        if (!providerResponse.ok || !providerBody || !providerData.status) {
            return res.status(502).json({
                success: false,
                message: providerBody?.message || "Unable to verify payment with PayVessel."
            });
        }

        const providerStatus = String(providerData.status).toLowerCase();

        if (providerStatus !== "success") {
            if (["failed", "abandoned", "cancelled"].includes(providerStatus)) {
                db.prepare(`
                    UPDATE xmd_coin_payment_intents
                    SET
                        status = ?,
                        failure_reason = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE reference = ? AND user_id = ? AND status = 'pending'
                `).run(
                    providerStatus,
                    String(providerData.gateway_response || providerStatus).slice(0, 500),
                    reference,
                    userId
                );

                return res.json({
                    success: false,
                    status: providerStatus,
                    message: "PayVessel reports that this payment was not completed."
                });
            }

            return res.status(202).json({
                success: true,
                pending: true,
                status: providerStatus || "pending",
                message: "Payment is not confirmed yet. No XMD Coins have been credited."
            });
        }

        const returnedReference = String(
            providerData.reference ||
            providerData.transaction_ref ||
            ""
        );

        const rawVerifiedAmount = providerData.amount;
        let verifiedAmount = null;

        if (
            typeof rawVerifiedAmount === "number" &&
            Number.isSafeInteger(rawVerifiedAmount) &&
            rawVerifiedAmount >= 0
        ) {
            verifiedAmount = rawVerifiedAmount;
        } else if (typeof rawVerifiedAmount === "string") {
            const cleanAmount = rawVerifiedAmount.trim();

            if (/^\d+$/.test(cleanAmount)) {
                verifiedAmount = Number(cleanAmount);
            } else if (/^\d+\.\d{1,2}$/.test(cleanAmount)) {
                verifiedAmount = Math.round(Number(cleanAmount) * 100);
            }
        }

        const verifiedCurrency = String(
            providerData.currency || providerData.order?.currency || ""
        ).toUpperCase();

        if (returnedReference !== providerReference) {
            return res.status(409).json({
                success: false,
                message: "The verified PayVessel reference does not match this payment."
            });
        }

        if (
            !Number.isSafeInteger(verifiedAmount) ||
            verifiedAmount !== Number(intent.amount_minor_units) ||
            verifiedCurrency !== intent.currency_code
        ) {
            console.error("PayVessel verification mismatch for OLU-XMD reference:", reference);

            return res.status(409).json({
                success: false,
                message: "Payment amount or currency does not match the original XMD Coin purchase. No coins were credited."
            });
        }

        const applyPayment = db.transaction(() => {
            const currentIntent = db.prepare(`
                SELECT * FROM xmd_coin_payment_intents
                WHERE reference = ? AND user_id = ?
            `).get(reference, userId);

            if (!currentIntent) {
                throw new Error("Payment record disappeared during verification.");
            }

            if (currentIntent.status === "paid") {
                const existingWallet = db.prepare(`
                    SELECT balance FROM coin_wallets WHERE user_id = ?
                `).get(userId);

                return {
                    alreadyCredited: true,
                    balance: existingWallet ? existingWallet.balance : 0
                };
            }

            if (currentIntent.status !== "pending") {
                throw new Error("Payment is no longer pending.");
            }

            db.prepare(`
                INSERT OR IGNORE INTO coin_wallets (user_id, balance)
                VALUES (?, 0)
            `).run(userId);

            const walletUpdate = db.prepare(`
                UPDATE coin_wallets
                SET balance = balance + ?
                WHERE user_id = ?
            `).run(Number(currentIntent.coins), userId);

            if (walletUpdate.changes !== 1) {
                throw new Error("Unable to update XMD Coin wallet.");
            }

            db.prepare(`
                INSERT INTO coin_transactions (
                    user_id,
                    type,
                    amount,
                    reference,
                    status,
                    reason,
                    currency_code,
                    purchase_amount_minor_units,
                    base_currency_code,
                    base_amount_minor_units,
                    exchange_rate,
                    exchange_rate_date,
                    exchange_rate_source,
                    currency_exponent
                )
                VALUES (?, 'purchase', ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId,
                Number(currentIntent.coins),
                reference,
                "PayVessel XMD Coin purchase",
                currentIntent.currency_code,
                Number(currentIntent.amount_minor_units),
                currentIntent.base_currency_code,
                currentIntent.base_amount_minor_units,
                currentIntent.exchange_rate,
                currentIntent.exchange_rate_date,
                currentIntent.exchange_rate_source,
                currentIntent.currency_exponent
            );

            db.prepare(`
                UPDATE xmd_coin_payment_intents
                SET
                    status = 'paid',
                    provider_transaction_id = ?,
                    paid_at = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE reference = ? AND user_id = ? AND status = 'pending'
            `).run(
                providerReference,
                providerData.paid_at || null,
                reference,
                userId
            );

            const updatedWallet = db.prepare(`
                SELECT balance FROM coin_wallets WHERE user_id = ?
            `).get(userId);

            return {
                alreadyCredited: false,
                balance: updatedWallet.balance
            };
        });

        const result = applyPayment();

        return res.json({
            success: true,
            alreadyCredited: result.alreadyCredited,
            coinsCredited: result.alreadyCredited ? 0 : Number(intent.coins),
            balance: result.balance,
            reference,
            message: result.alreadyCredited
                ? "This payment was already credited."
                : "Payment verified. XMD Coins credited successfully."
        });

    } catch (error) {
        console.error("OLU-XMD PayVessel verification error:", error.message);

        return res.status(502).json({
            success: false,
            message: "Unable to verify this PayVessel payment. No new XMD Coins were credited."
        });
    }
});

// Customer XMD Coin wallet API - GLOBAL USD MASTER PRICING
app.get("/api/xmd-coins", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const userId = Number(req.session.userId);

        const customer = db.prepare(`
            SELECT
                country_code,
                currency_code
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer account not found."
            });
        }

        const customerCountry = getCountryByCode(customer.country_code);

        const master = db.prepare(`
            SELECT
                coins_per_package,
                usd_price_minor_units
            FROM xmd_coin_master_pricing
            WHERE id = 1
        `).get();

        const wallet = db.prepare(`
            SELECT balance
            FROM coin_wallets
            WHERE user_id = ?
        `).get(userId);

        const transactions = db.prepare(`
            SELECT
                id,
                type,
                amount,
                reference,
                status,
                reason,
                currency_code,
                purchase_amount_minor_units,
                base_currency_code,
                base_amount_minor_units,
                exchange_rate,
                exchange_rate_date,
                exchange_rate_source,
                currency_exponent,
                created_at
            FROM coin_transactions
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        `).all(userId);

        const currencyCode = String(
            customerCountry?.currencyCode ||
            customer.currency_code ||
            ""
        ).trim().toUpperCase();

        let rate = null;

        if (currencyCode === "USD") {
            rate = {
                rate_per_usd: 1,
                rate_date: "USD base",
                source: "USD base"
            };
        } else if (/^[A-Z]{3}$/.test(currencyCode)) {
            rate = db.prepare(`
                SELECT
                    rate_per_usd,
                    rate_date,
                    source
                FROM xmd_coin_exchange_rates
                WHERE currency_code = ?
            `).get(currencyCode);
        }

        const validMasterPrice =
            master &&
            Number.isSafeInteger(master.coins_per_package) &&
            master.coins_per_package > 0 &&
            Number.isSafeInteger(master.usd_price_minor_units) &&
            master.usd_price_minor_units > 0;

        const validRate =
            rate &&
            Number.isFinite(Number(rate.rate_per_usd)) &&
            Number(rate.rate_per_usd) > 0;

        const exponent = currencyCode
            ? getXmdCurrencyExponent(currencyCode)
            : 2;

        const multiplier = Math.pow(10, exponent);

        let packagePriceMinorUnits = null;

        if (validMasterPrice && validRate) {
            const usdAmount = master.usd_price_minor_units / 100;

            const calculatedAmount =
                usdAmount * Number(rate.rate_per_usd) * multiplier;

            if (
                Number.isFinite(calculatedAmount) &&
                Number.isSafeInteger(Math.round(calculatedAmount))
            ) {
                packagePriceMinorUnits = Math.round(calculatedAmount);
            }
        }

        const purchaseAvailable =
            packagePriceMinorUnits !== null &&
            Boolean(customer.country_code) &&
            Boolean(currencyCode);

        let purchaseMessage;

        if (!validMasterPrice) {
            purchaseMessage = "Global USD master price is not configured yet.";
        } else if (!validRate) {
            purchaseMessage = "Exchange rate is not available for your currency yet.";
        } else {
            purchaseMessage =
                "Your XMD Coin price has been calculated using the global USD master price. Payment checkout is not yet activated.";
        }

        res.json({
            success: true,

            balance: wallet ? wallet.balance : 0,

            countryCode: customer.country_code,
            countryName: customerCountry?.countryName || customer.country_code || null,

            currencyCode: currencyCode || null,
            currencySymbol: currencyCode
                ? getXmdCurrencySymbol(currencyCode)
                : null,

            currencyExponent: exponent,

            coinsPerPackage: master
                ? master.coins_per_package
                : null,

            masterCurrencyCode: "USD",

            masterPriceMinorUnits:
                master && master.usd_price_minor_units !== null
                    ? master.usd_price_minor_units
                    : null,

            packagePriceMinorUnits,

            exchangeRate:
                validRate ? Number(rate.rate_per_usd) : null,

            exchangeRateDate:
                validRate ? rate.rate_date : null,

            exchangeRateSource:
                validRate ? rate.source : null,

            purchaseAvailable,

            checkoutAvailable: false,

            purchaseMessage,

            transactions
        });

    } catch (error) {
        console.error("XMD Coin global wallet error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load XMD Coin wallet."
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
            SELECT
                u.name,
                u.currency_code,
                r.currency_symbol
            FROM users u
            LEFT JOIN regional_coin_prices r
                ON r.country_code = u.country_code
                AND r.currency_code = u.currency_code
            WHERE u.id = ?
        `).get(req.session.userId);

        res.json({
            success: true,
            name: user.name,
            balance: wallet.balance,
            currencyCode: user.currency_code,
            currencySymbol: getXmdCurrencySymbol(user.currency_code),
            transactions
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Unable to load wallet."
        });
    }
});// Paystack regular wallet funding
app.post("/api/wallet/fund", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const amountNaira = Number(req.body.amount);

        if (!Number.isSafeInteger(amountNaira) ||
            amountNaira < 100 || amountNaira > 1000000) {
            return res.status(400).json({
                success: false,
                message: "Enter an amount between â‚¦100 and â‚¦1,000,000."
            });
        }

        const user = db.prepare(
            "SELECT email, currency_code FROM users WHERE id = ?"
        ).get(req.session.userId);

        if (!user || !user.email) {
            return res.status(400).json({
                success: false,
                message: "A valid email is required."
            });
        }

        if (user.currency_code !== "NGN") {
            return res.status(400).json({
                success: false,
                message: "Paystack wallet funding currently supports NGN only."
            });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey || !secretKey.startsWith("sk_test_")) {
            return res.status(503).json({
                success: false,
                message: "Paystack Test Mode is not configured."
            });
        }

        const amountKobo = amountNaira * 100;
        const reference = "OLUXMD-" + crypto.randomUUID();
        const callbackUrl =
            (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "") +
            "/api/wallet/paystack/callback";

        db.prepare(`
            INSERT INTO transactions
            (user_id, type, amount, reference, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(req.session.userId, "wallet_funding", amountKobo, reference, "pending");

        try {
            const paymentResponse = await fetch(
                "https://api.paystack.co/transaction/initialize",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${secretKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        email: user.email,
                        amount: amountKobo,
                        currency: "NGN",
                        reference,
                        callback_url: callbackUrl
                    })
                }
            );

            const payment = await paymentResponse.json();

            if (!paymentResponse.ok || !payment.status ||
                !payment.data?.authorization_url) {
                db.prepare(`
                    UPDATE transactions SET status = 'failed'
                    WHERE reference = ? AND status = 'pending'
                `).run(reference);

                return res.status(502).json({
                    success: false,
                    message: "Unable to initialize Paystack payment."
                });
            }

            return res.status(201).json({
                success: true,
                reference,
                authorization_url: payment.data.authorization_url
            });

        } catch (error) {
            db.prepare(`
                UPDATE transactions SET status = 'failed'
                WHERE reference = ? AND status = 'pending'
            `).run(reference);
            throw error;
        }

    } catch (error) {
        console.error("Wallet funding error:", error);
        return res.status(500).json({
            success: false,
            message: "Unable to create wallet payment."
        });
    }
});// Paystack wallet payment verification
app.get("/api/wallet/paystack/callback", async (req, res) => {
    try {
        const reference = String(req.query.reference || "");
        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!reference || !secretKey || !secretKey.startsWith("sk_test_")) {
            return res.redirect("/wallet.html?payment=failed");
        }

        const paymentResponse = await fetch(
            "https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`
                }
            }
        );

        const payment = await paymentResponse.json();
        const data = payment.data;

        if (
            !paymentResponse.ok ||
            !payment.status ||
            !data ||
            data.status !== "success" ||
            data.reference !== reference ||
            data.currency !== "NGN"
        ) {
            return res.redirect("/wallet.html?payment=failed");
        }

        const transaction = db.prepare(`
            SELECT user_id, amount, status
            FROM transactions
            WHERE reference = ? AND type = 'wallet_funding'
        `).get(reference);

        if (!transaction || Number(data.amount) !== transaction.amount) {
            return res.redirect("/wallet.html?payment=failed");
        }

        if (transaction.status === "success") {
            return res.redirect("/wallet.html?payment=success");
        }

        if (transaction.status !== "pending") {
            return res.redirect("/wallet.html?payment=failed");
        }

        const creditWallet = db.transaction(() => {
            const current = db.prepare(`
                SELECT status FROM transactions
                WHERE reference = ? AND type = 'wallet_funding'
            `).get(reference);

            if (!current || current.status !== "pending") {
                return false;
            }

            const updated = db.prepare(`
                UPDATE transactions
                SET status = 'success'
                WHERE reference = ?
                  AND type = 'wallet_funding'
                  AND status = 'pending'
            `).run(reference);

            if (updated.changes !== 1) {
                return false;
            }

            const credited = db.prepare(`
                UPDATE wallets
                SET balance = balance + ?
                WHERE user_id = ?
            `).run(transaction.amount, transaction.user_id);

            if (credited.changes !== 1) {
                throw new Error("Customer wallet not found.");
            }

            return true;
        });

        creditWallet();

        return res.redirect("/wallet.html?payment=success");

    } catch (error) {
        console.error("Paystack wallet verification error:", error);
        return res.redirect("/wallet.html?payment=failed");
    }
});// Generate WhatsApp pairing code
// Generate WhatsApp pairing code
// Paystack webhook for regular wallet funding
app.post("/api/wallet/paystack/webhook", async (req, res) => {
    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
        const rawBody = req.rawBody;

        if (!Buffer.isBuffer(rawBody)) return res.sendStatus(400);

        let signatureValid = false;
        const modernSignature = req.headers["paystack-signature"];

        if (typeof modernSignature === "string" && webhookSecret) {
            const parts = modernSignature.split(",").map(p => p.trim());
            const timestampPart = parts.find(p => p.startsWith("t="));
            const timestamp = timestampPart ? timestampPart.slice(2) : "";
            const timestampSeconds = Number(timestamp);

            if (
                timestamp &&
                Number.isInteger(timestampSeconds) &&
                Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) <= 300
            ) {
                const expected = crypto.createHmac("sha512", webhookSecret)
                    .update(timestamp + ".")
                    .update(rawBody)
                    .digest();

                for (const part of parts.filter(p => p.startsWith("v1="))) {
                    const value = part.slice(3);
                    const separator = value.indexOf(":");
                    if (separator < 0) continue;

                    const suppliedHex = value.slice(separator + 1);
                    if (!/^[0-9a-f]{128}$/i.test(suppliedHex)) continue;

                    const supplied = Buffer.from(suppliedHex, "hex");

                    if (
                        supplied.length === expected.length &&
                        crypto.timingSafeEqual(expected, supplied)
                    ) {
                        signatureValid = true;
                        break;
                    }
                }
            }

            if (!signatureValid) return res.sendStatus(401);

        } else {
            // Legacy Paystack signature
            const signature = req.headers["x-paystack-signature"];

            if (
                !secretKey ||
                typeof signature !== "string" ||
                !/^[0-9a-f]{128}$/i.test(signature)
            ) {
                return res.sendStatus(401);
            }

            const expected = crypto.createHmac("sha512", secretKey)
                .update(rawBody)
                .digest();

            const supplied = Buffer.from(signature, "hex");

            signatureValid =
                supplied.length === expected.length &&
                crypto.timingSafeEqual(expected, supplied);

            if (!signatureValid) return res.sendStatus(401);
        }

        const event = req.body;

        if (!event || typeof event.event !== "string") {
            return res.sendStatus(400);
        }

        if (
            event.event !== "charge.success" &&
            event.event !== "charge.failed"
        ) {
            return res.sendStatus(200);
        }

        const data = event.data || {};
        const reference = String(data.reference || "");

        if (!reference) return res.sendStatus(200);

        const transaction = db.prepare(`
            SELECT user_id, amount, status
            FROM transactions
            WHERE reference = ? AND type = 'wallet_funding'
        `).get(reference);

        if (!transaction) return res.sendStatus(200);

        if (
            Number(data.amount) !== transaction.amount ||
            String(data.currency || "").toUpperCase() !== "NGN"
        ) {
            return res.sendStatus(200);
        }

        if (event.event === "charge.failed") {
            db.prepare(`
                UPDATE transactions
                SET status = 'failed'
                WHERE reference = ?
                  AND type = 'wallet_funding'
                  AND status = 'pending'
            `).run(reference);

            return res.sendStatus(200);
        }

        if (transaction.status === "success") return res.sendStatus(200);
        if (transaction.status !== "pending") return res.sendStatus(200);
        if (!secretKey) return res.sendStatus(503);

        // Verify successful payment directly with Paystack
        const verifyResponse = await fetch(
            "https://api.paystack.co/transaction/verify/" +
            encodeURIComponent(reference),
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`
                }
            }
        );

        const verifyBody = await verifyResponse.json();
        const verified = verifyBody.data;

        if (
            !verifyResponse.ok ||
            !verifyBody.status ||
            !verified ||
            verified.status !== "success" ||
            verified.reference !== reference ||
            Number(verified.amount) !== transaction.amount ||
            verified.currency !== "NGN"
        ) {
            return res.sendStatus(503);
        }

        // Atomic credit: prevent duplicate wallet funding
        const creditWallet = db.transaction(() => {
            const current = db.prepare(`
                SELECT status FROM transactions
                WHERE reference = ? AND type = 'wallet_funding'
            `).get(reference);

            if (!current || current.status !== "pending") return false;

            const updated = db.prepare(`
                UPDATE transactions
                SET status = 'success'
                WHERE reference = ?
                  AND type = 'wallet_funding'
                  AND status = 'pending'
            `).run(reference);

            if (updated.changes !== 1) return false;

            const credited = db.prepare(`
                UPDATE wallets
                SET balance = balance + ?
                WHERE user_id = ?
            `).run(transaction.amount, transaction.user_id);

            if (credited.changes !== 1) {
                throw new Error("Customer wallet not found.");
            }

            return true;
        });

        creditWallet();
        return res.sendStatus(200);

    } catch (error) {
        console.error("Paystack webhook error:", error);
        return res.sendStatus(500);
    }
});
app.post("/api/whatsapp/reconnect", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const { reconnectWhatsApp } = await whatsappModule;

        console.log("RECONNECT USER ID:", req.session.userId);

        await reconnectWhatsApp(req.session.userId);

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
});// Generate WhatsApp pairing code
app.post("/api/whatsapp/pair", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const { phoneNumber } = req.body;

        const { generatePairingCode } = whatsappModule;

        const result = await generatePairingCode(
            req.session.userId,
            phoneNumber
        );

        res.json({
            success: true,
            pairingCode: result.pairingCode
        });

    } catch (error) {
        console.error("WhatsApp pairing error:", error);

        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Generate a WhatsApp QR code for the logged-in customer
app.post("/api/whatsapp/qr/start", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const result = await whatsappModule.startWhatsAppQR(
            req.session.userId
        );

        const qrDataUrl = await QRCode.toDataURL(result.qr);

        res.json({
            success: true,
            qrDataUrl
        });
    } catch (error) {
        console.error("WhatsApp QR generation error:", error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// STOP WHATSAPP BOT
app.post("/api/whatsapp/stop", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    try {
        const result = await whatsappModule.stopWhatsApp(
            req.session.userId
        );
        res.json(result);
    } catch (error) {
        console.error("WhatsApp stop error:", error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// START WHATSAPP BOT
app.post("/api/whatsapp/start", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    try {
        await whatsappModule.startWhatsApp(req.session.userId);
        res.json({
            success: true,
            message: "WhatsApp bot is starting."
        });
    } catch (error) {
        console.error("WhatsApp start error:", error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});
// Public server health status
app.get("/api/server/status", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

// Get WhatsApp connection status
app.get("/api/whatsapp/status", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    try {
        const getWhatsAppStatus = whatsappModule.getWhatsAppStatus;

        res.json({
            success: true,
            status: getWhatsAppStatus(req.session.userId)
        });

        } catch (error) {
        console.error("WhatsApp status error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load WhatsApp status."
        });
    }
});

// GET CONNECTED WHATSAPP NUMBER
app.get("/api/whatsapp/number", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    try {
        const number = whatsappModule.getConnectedWhatsAppNumber(
            req.session.userId
        );

        res.json({
            success: true,
            number: number || "Not connected"
        });

    } catch (error) {
        console.error("WhatsApp number error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load WhatsApp number."
        });
    }
});
// GET AVAILABLE SUBSCRIPTION PLANS
app.get("/api/subscription/plans", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        // Determine customer country.
        // Missing or unsupported countries default to Nigeria.
        const customer = db.prepare(`
            SELECT country_code
            FROM users
            WHERE id = ?
        `).get(req.session.userId);

        let countryCode = String(
            customer?.country_code || "NG"
        ).trim().toUpperCase();

        let country = getCountryByCode(countryCode);

        if (!country) {
            countryCode = "NG";
            country = getCountryByCode("NG");
        }

        if (!country) {
            throw new Error("Default Nigeria currency mapping is unavailable.");
        }

        const currencyCode = country.currencyCode;
        const currencySymbol = country.currencySymbol;
        const currencyExponent =
            getXmdCurrencyExponent(currencyCode);

        // USD always has an exchange rate of 1.
        let exchangeRate = 1;
        let rateDate = null;
        let exchangeRateSource = "USD master currency";

        if (currencyCode !== "USD") {
            const rate = db.prepare(`
                SELECT rate_per_usd, rate_date, source
                FROM xmd_coin_exchange_rates
                WHERE currency_code = ?
            `).get(currencyCode);

            if (rate && Number.isFinite(Number(rate.rate_per_usd))
                && Number(rate.rate_per_usd) > 0) {
                exchangeRate = Number(rate.rate_per_usd);
                rateDate = rate.rate_date;
                exchangeRateSource = rate.source;
            } else {
                exchangeRate = null;
            }
        }

        const plans = db.prepare(`
            SELECT
                sp.id,
                sp.code,
                sp.name,
                sp.duration_days,
                sp.is_active,
                usp.usd_price_minor_units,
                usp.is_active AS price_is_active
            FROM subscription_plans sp
            LEFT JOIN subscription_plan_usd_prices usp
                ON usp.plan_id = sp.id
            ORDER BY sp.duration_days ASC
        `).all();

        const formattedPlans = plans.map(plan => {
            const usdPriceMinorUnits =
                plan.usd_price_minor_units === null ||
                plan.usd_price_minor_units === undefined
                    ? null
                    : Number(plan.usd_price_minor_units);

            const validUsdPrice =
                Number.isSafeInteger(usdPriceMinorUnits) &&
                usdPriceMinorUnits > 0;

            const priceActive =
                Number(plan.price_is_active) === 1;

            const validRate =
                exchangeRate !== null &&
                Number.isFinite(exchangeRate) &&
                exchangeRate > 0;

            const priceAvailable =
                validUsdPrice &&
                priceActive &&
                validRate;

            let formattedPrice = "Price coming soon";
            let localPriceMinorUnits = null;

            if (validUsdPrice && !validRate) {
                formattedPrice = "Exchange rate unavailable";
            } else if (priceAvailable) {
                const usdAmount = usdPriceMinorUnits / 100;

                const localAmount =
                    usdAmount * exchangeRate;

                localPriceMinorUnits = Math.round(
                    localAmount * Math.pow(10, currencyExponent)
                );

                formattedPrice = new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: currencyCode,
                    minimumFractionDigits: currencyExponent,
                    maximumFractionDigits: currencyExponent
                }).format(
                    localPriceMinorUnits /
                    Math.pow(10, currencyExponent)
                );
            }

            return {
                id: plan.id,
                code: plan.code,
                name: plan.name,
                duration_days: plan.duration_days,
                is_active: Boolean(plan.is_active),

                usd_price_minor_units: usdPriceMinorUnits,

                country_code: countryCode,
                country_name: country.countryName,
                currency_code: currencyCode,
                currency_symbol: currencySymbol,
                currency_exponent: currencyExponent,

                exchange_rate: exchangeRate,
                rate_date: rateDate,
                exchange_rate_source: exchangeRateSource,

                local_price_minor_units: localPriceMinorUnits,
                formatted_price: formattedPrice,
                price_available: priceAvailable,

                // Subscription checkout remains disabled.
                can_purchase: false
            };
        });

        res.json({
            success: true,
            country_code: countryCode,
            currency_code: currencyCode,
            plans: formattedPlans
        });

    } catch (error) {
        console.error("Subscription plans error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load subscription plans."
        });
    }
});

// GET CUSTOMER SUBSCRIPTION
// GET CUSTOMER SUBSCRIPTION
app.get("/api/subscription/me", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const result = getSubscriptionStatus(req.session.userId);

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error("Customer subscription error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load your subscription."
        });
    }
});// OLU-XMD AUTO REPLY API

// LOAD AUTO REPLY SETTINGS
app.get("/api/auto-reply", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const userId = Number(req.session.userId);

        if (!getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({
                success: false,
                message: "Auto Reply requires a Premium subscription."
            });
        }

        const settings = db.prepare(`
            SELECT enabled, default_reply
            FROM auto_reply_settings
            WHERE user_id = ?
        `).get(userId);

        const keywords = db.prepare(`
            SELECT id, keyword, response
            FROM auto_reply_keywords
            WHERE user_id = ?
            ORDER BY id DESC
        `).all(userId);

        res.json({
            success: true,
            settings: settings || {
                enabled: 0,
                default_reply: ""
            },
            keywords
        });

    } catch (error) {
        console.error("Auto Reply loading error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load Auto Reply settings."
        });
    }
});

// SAVE AUTO REPLY SETTINGS
app.post("/api/auto-reply", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const userId = Number(req.session.userId);

        if (!getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({
                success: false,
                message: "Auto Reply requires a Premium subscription."
            });
        }

        const { enabled, defaultReply } = req.body;

        if (typeof enabled !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "Invalid Auto Reply status."
            });
        }

        if (
            typeof defaultReply !== "string" ||
            defaultReply.length > 1000
        ) {
            return res.status(400).json({
                success: false,
                message: "Default reply must not exceed 1000 characters."
            });
        }

        db.prepare(`
            INSERT INTO auto_reply_settings
                (user_id, enabled, default_reply)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                enabled = excluded.enabled,
                default_reply = excluded.default_reply,
                updated_at = CURRENT_TIMESTAMP
        `).run(userId, enabled ? 1 : 0, defaultReply.trim());

        res.json({
            success: true,
            message: "Auto Reply settings saved successfully."
        });

    } catch (error) {
        console.error("Auto Reply saving error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to save Auto Reply settings."
        });
    }
});// ADD AUTO REPLY KEYWORD
app.post("/api/auto-reply/keywords", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const userId = Number(req.session.userId);

        if (!getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({
                success: false,
                message: "Premium subscription required."
            });
        }

        const keyword = req.body.keyword;
        const response = req.body.response;

        if (
            typeof keyword !== "string" ||
            typeof response !== "string" ||
            !keyword.trim() ||
            !response.trim() ||
            keyword.length > 50 ||
            response.length > 1000
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid keyword and response."
            });
        }

        const count = db.prepare(`
            SELECT COUNT(*) AS total
            FROM auto_reply_keywords
            WHERE user_id = ?
        `).get(userId).total;

        if (count >= 20) {
            return res.status(400).json({
                success: false,
                message: "You can add a maximum of 20 keywords."
            });
        }

        db.prepare(`
            INSERT INTO auto_reply_keywords
                (user_id, keyword, response)
            VALUES (?, ?, ?)
        `).run(
            userId,
            keyword.trim().toLowerCase(),
            response.trim()
        );

        res.json({
            success: true,
            message: "Keyword added successfully."
        });

    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                success: false,
                message: "This keyword already exists."
            });
        }

        console.error("Adding keyword error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to add keyword."
        });
    }
});

// DELETE AUTO REPLY KEYWORD
app.delete("/api/auto-reply/keywords/:id", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const userId = Number(req.session.userId);

        if (!getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({
                success: false,
                message: "Premium subscription required."
            });
        }

        const keywordId = Number(req.params.id);

        if (!Number.isSafeInteger(keywordId) || keywordId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid keyword ID."
            });
        }

        const result = db.prepare(`
            DELETE FROM auto_reply_keywords
            WHERE id = ? AND user_id = ?
        `).run(keywordId, userId);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Keyword not found."
            });
        }

        res.json({
            success: true,
            message: "Keyword deleted successfully."
        });

    } catch (error) {
        console.error("Deleting keyword error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to delete keyword."
        });
    }
});

// CUSTOM COMMANDS API

// GET CUSTOMER CUSTOM COMMANDS
app.get("/api/custom-commands", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: "Please login first." });
        }

        const userId = Number(req.session.userId);

        if (userId !== 1 && !getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({ success: false, message: "Premium subscription required." });
        }

        const commands = db.prepare(`
            SELECT id, command, response, created_at
            FROM custom_commands
            WHERE user_id = ?
            ORDER BY id DESC
        `).all(userId);

        res.json({ success: true, commands });

    } catch (error) {
        console.error("Loading custom commands error:", error);
        res.status(500).json({ success: false, message: "Unable to load custom commands." });
    }
});

// CREATE CUSTOM COMMAND
app.post("/api/custom-commands", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: "Please login first." });
        }

        const userId = Number(req.session.userId);

        if (userId !== 1 && !getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({ success: false, message: "Premium subscription required." });
        }

        const command = String(req.body.command || "").trim().toLowerCase();
        const response = String(req.body.response || "").trim();

        if (!/^[a-z][a-z0-9_-]{0,29}$/.test(command)) {
            return res.status(400).json({
                success: false,
                message: "Command must start with a letter and contain only letters, numbers, hyphens or underscores. Maximum 30 characters."
            });
        }

        const reservedCommands = [
            "hello", "owner", "about", "help", "ping", "uptime",
            "status", "rules", "support", "developer", "profile", "menu"
        ];

        if (reservedCommands.includes(command)) {
            return res.status(400).json({
                success: false,
                message: "This command name is already reserved by OLU-XMD."
            });
        }

        if (!response || response.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "Response is required and must not exceed 1000 characters."
            });
        }

        const count = db.prepare(
            "SELECT COUNT(*) AS total FROM custom_commands WHERE user_id = ?"
        ).get(userId).total;

        if (count >= 20) {
            return res.status(400).json({
                success: false,
                message: "You can create a maximum of 20 custom commands."
            });
        }

        const result = db.prepare(`
            INSERT INTO custom_commands (user_id, command, response)
            VALUES (?, ?, ?)
        `).run(userId, command, response);

        res.status(201).json({
            success: true,
            message: "Custom command created successfully.",
            id: Number(result.lastInsertRowid)
        });

    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                success: false,
                message: "This command already exists."
            });
        }

        console.error("Creating custom command error:", error);
        res.status(500).json({ success: false, message: "Unable to create custom command." });
    }
});

// EDIT CUSTOM COMMAND
app.put("/api/custom-commands/:id", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: "Please login first." });
        }

        const userId = Number(req.session.userId);

        if (userId !== 1 && !getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({ success: false, message: "Premium subscription required." });
        }

        const id = Number(req.params.id);
        const response = String(req.body.response || "").trim();

        if (!Number.isSafeInteger(id) || id <= 0 || !response || response.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "Invalid command ID or response."
            });
        }

        const result = db.prepare(`
            UPDATE custom_commands
            SET response = ?
            WHERE id = ? AND user_id = ?
        `).run(response, id, userId);

        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: "Custom command not found." });
        }

        res.json({ success: true, message: "Custom command updated successfully." });

    } catch (error) {
        console.error("Updating custom command error:", error);
        res.status(500).json({ success: false, message: "Unable to update custom command." });
    }
});

// DELETE CUSTOM COMMAND
app.delete("/api/custom-commands/:id", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, message: "Please login first." });
        }

        const userId = Number(req.session.userId);

        if (userId !== 1 && !getSubscriptionStatus(userId).accessAllowed) {
            return res.status(403).json({ success: false, message: "Premium subscription required." });
        }

        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: "Invalid command ID." });
        }

        const result = db.prepare(`
            DELETE FROM custom_commands
            WHERE id = ? AND user_id = ?
        `).run(id, userId);

        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: "Custom command not found." });
        }

        res.json({ success: true, message: "Custom command deleted successfully." });

    } catch (error) {
        console.error("Deleting custom command error:", error);
        res.status(500).json({ success: false, message: "Unable to delete custom command." });
    }
});
// ==========================================
// REGIONAL XMD COIN PRICING - OWNER ONLY
// ==========================================


// ==========================================
// GLOBAL USD MASTER PRICING - OWNER ONLY
// ==========================================

function getXmdCurrencySymbol(currencyCode) {
    const code = String(currencyCode || "").toUpperCase();

    const knownSymbols = {
        USD: "$",
        NGN: "\u20A6",
        GHS: "GH\u20B5",
        ZAR: "R"
    };

    if (knownSymbols[code]) {
        return knownSymbols[code];
    }

    try {
        return new Intl.NumberFormat("en", {
            style: "currency",
            currency: code
        }).formatToParts(1).find(part => part.type === "currency")?.value
            || code;
    } catch {
        return code;
    }
}

function getXmdCurrencyExponent(currencyCode) {
    try {
        return new Intl.NumberFormat("en", {
            style: "currency",
            currency: currencyCode
        }).resolvedOptions().maximumFractionDigits;
    } catch {
        return 2;
    }
}

// ==========================================
// GLOBAL USD SUBSCRIPTION PRICING API
// ==========================================

// Owner: Load subscription USD prices and local currency previews.
app.get("/api/admin/subscription-usd-pricing", requireOwner, (req, res) => {
    try {
        const plans = db.prepare(`
            SELECT
                p.id,
                p.code,
                p.name,
                p.duration_days,
                p.is_active,
                usd.usd_price_minor_units,
                COALESCE(usd.is_active, 1) AS price_is_active,
                usd.updated_at,
                usd.updated_by
            FROM subscription_plans p
            LEFT JOIN subscription_plan_usd_prices usd
                ON usd.plan_id = p.id
            ORDER BY p.duration_days ASC
        `).all();

        const savedRates = db.prepare(`
            SELECT *
            FROM xmd_coin_exchange_rates
            ORDER BY currency_code
        `).all();

        const ratesMap = Object.fromEntries(
            savedRates.map(rate => [rate.currency_code, rate])
        );

        const previewCurrencies = ["NGN", "GHS", "ZAR", "USD"];

        const resultPlans = plans.map(plan => {
            const masterUsd = plan.usd_price_minor_units === null
                ? null
                : Number(plan.usd_price_minor_units) / 100;

            const previews = previewCurrencies.map(code => {
                const rate = code === "USD"
                    ? {
                        rate_per_usd: 1,
                        rate_date: "USD base",
                        source: "Master price"
                    }
                    : ratesMap[code];

                if (
                    !rate ||
                    !Number.isFinite(Number(rate.rate_per_usd)) ||
                    Number(rate.rate_per_usd) <= 0
                ) {
                    return {
                        currency_code: code,
                        currency_symbol: getXmdCurrencySymbol(code),
                        available: false,
                        formatted_price: "Exchange rate unavailable",
                        rate_date: null
                    };
                }

                const exponent = getXmdCurrencyExponent(code);
                const ratePerUsd = Number(rate.rate_per_usd);

                if (masterUsd === null) {
                    return {
                        currency_code: code,
                        currency_symbol: getXmdCurrencySymbol(code),
                        available: true,
                        price_available: false,
                        formatted_price: "Set USD master price",
                        rate_date: rate.rate_date,
                        source: rate.source,
                        exchange_rate: ratePerUsd,
                        currency_exponent: exponent
                    };
                }

                const multiplier = Math.pow(10, exponent);

                const localMinorUnits = Math.round(
                    masterUsd * ratePerUsd * multiplier
                );

                return {
                    currency_code: code,
                    currency_symbol: getXmdCurrencySymbol(code),
                    available: true,
                    price_available: true,
                    local_minor_units: localMinorUnits,
                    formatted_price: new Intl.NumberFormat("en", {
                        style: "currency",
                        currency: code,
                        minimumFractionDigits: exponent,
                        maximumFractionDigits: exponent
                    }).format(localMinorUnits / multiplier),
                    rate_date: rate.rate_date,
                    source: rate.source,
                    exchange_rate: ratePerUsd,
                    currency_exponent: exponent
                };
            });

            return {
                ...plan,
                previews
            };
        });

        res.json({
            success: true,
            plans: resultPlans,
            rates: savedRates,
            preview_currencies: previewCurrencies
        });

    } catch (error) {
        console.error("USD subscription pricing load error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load USD subscription pricing."
        });
    }
});

// Owner: Save one subscription plan's USD master price.
app.put("/api/admin/subscription-usd-pricing/:planId", requireOwner, (req, res) => {
    try {
        const planId = Number(req.params.planId);
        const usdPriceMinorUnits = Number(req.body?.usdPriceMinorUnits);
        const isActive = req.body?.isActive;

        if (!Number.isSafeInteger(planId) || planId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid subscription plan."
            });
        }

        if (
            !Number.isSafeInteger(usdPriceMinorUnits) ||
            usdPriceMinorUnits < 1
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid positive USD master price."
            });
        }

        if (typeof isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "Price availability must be true or false."
            });
        }

        const plan = db.prepare(`
            SELECT id, name
            FROM subscription_plans
            WHERE id = ?
        `).get(planId);

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: "Subscription plan not found."
            });
        }

        const previous = db.prepare(`
            SELECT *
            FROM subscription_plan_usd_prices
            WHERE plan_id = ?
        `).get(planId) || null;

        db.prepare(`
            INSERT INTO subscription_plan_usd_prices (
                plan_id,
                usd_price_minor_units,
                is_active,
                updated_at,
                updated_by
            )
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(plan_id) DO UPDATE SET
                usd_price_minor_units = excluded.usd_price_minor_units,
                is_active = excluded.is_active,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by
        `).run(
            planId,
            usdPriceMinorUnits,
            isActive ? 1 : 0,
            req.session.userId
        );

        const updated = db.prepare(`
            SELECT *
            FROM subscription_plan_usd_prices
            WHERE plan_id = ?
        `).get(planId);

        recordAdminAudit(
            req.session.userId,
            "subscription_usd_master_price_updated",
            null,
            JSON.stringify({
                planId,
                planName: plan.name,
                previous,
                updated
            })
        );

        res.json({
            success: true,
            message: "Subscription USD master price saved.",
            price: updated
        });

    } catch (error) {
        console.error("USD subscription price save error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to save the USD subscription price."
        });
    }
});
// Load master price and converted price previews.
app.get("/api/admin/xmd-coin-master-pricing", requireOwner, (req, res) => {
    try {
        const master = db.prepare(`
            SELECT
                coins_per_package,
                usd_price_minor_units,
                updated_at,
                updated_by
            FROM xmd_coin_master_pricing
            WHERE id = 1
        `).get();

        if (!master) {
            return res.status(404).json({
                success: false,
                message: "Global XMD Coin pricing configuration not found."
            });
        }

        const savedRates = db.prepare(`
            SELECT *
            FROM xmd_coin_exchange_rates
            ORDER BY currency_code
        `).all();

        const ratesMap = Object.fromEntries(
            savedRates.map(rate => [rate.currency_code, rate])
        );

        const masterUsd = master.usd_price_minor_units === null
            ? null
            : Number(master.usd_price_minor_units) / 100;

        const previewCurrencies = ["NGN", "GHS", "ZAR", "USD"];

        const previews = previewCurrencies.map(code => {
            const rate = code === "USD"
                ? { rate_per_usd: 1, rate_date: "USD base", source: "Master price" }
                : ratesMap[code];

            if (
                !rate ||
                !Number.isFinite(Number(rate.rate_per_usd)) ||
                Number(rate.rate_per_usd) <= 0
            ) {
                return {
                    currencyCode: code,
                    currencySymbol: getXmdCurrencySymbol(code),
                    available: false,
                    formattedPrice: "Exchange rate unavailable"
                };
            }

            const exponent = getXmdCurrencyExponent(code);
            const ratePerUsd = Number(rate.rate_per_usd);

            const preview = {
                currencyCode: code,
                currencySymbol: getXmdCurrencySymbol(code),
                available: true,
                ratePerUsd,
                rateDate: rate.rate_date,
                currencyExponent: exponent
            };

            if (masterUsd === null) {
                return {
                    ...preview,
                    priceAvailable: false,
                    formattedPrice: "Set USD master price"
                };
            }

            const multiplier = Math.pow(10, exponent);
            const localMinorUnits = Math.round(
                masterUsd * ratePerUsd * multiplier
            );

            return {
                ...preview,
                priceAvailable: true,
                localMinorUnits,
                formattedPrice: new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: code,
                    minimumFractionDigits: exponent,
                    maximumFractionDigits: exponent
                }).format(localMinorUnits / multiplier)
            };
        });

        res.json({
            success: true,
            master: {
                coinsPerPackage: master.coins_per_package,
                usdPriceMinorUnits: master.usd_price_minor_units,
                usdPrice: masterUsd,
                updatedAt: master.updated_at
            },
            previews,
            rates: savedRates
        });

    } catch (error) {
        console.error("Global XMD Coin pricing load error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load global XMD Coin pricing."
        });
    }
});

// Refresh daily reference exchange rates from Frankfurter.
app.post("/api/admin/xmd-coin-master-pricing/refresh-rates", requireOwner, async (req, res) => {
    try {
        const response = await fetch(
            "https://api.frankfurter.dev/v2/rates?base=USD",
            {
                method: "GET",
                headers: { "Accept": "application/json" },
                signal: AbortSignal.timeout(20000)
            }
        );

        if (!response.ok) {
            throw new Error("Frankfurter returned HTTP " + response.status);
        }

        const records = await response.json();

        if (!Array.isArray(records) || records.length < 3) {
            throw new Error("Frankfurter returned an unexpected exchange-rate response.");
        }

        const validRecords = records.filter(record =>
            record &&
            record.base === "USD" &&
            /^[A-Z]{3}$/.test(String(record.quote || "")) &&
            Number.isFinite(Number(record.rate)) &&
            Number(record.rate) > 0 &&
            /^\d{4}-\d{2}-\d{2}$/.test(String(record.date || ""))
        );

        const supportedCurrencyCodes = getSupportedCurrencyCodes();

        const supportedRecords = validRecords.filter(record =>
            supportedCurrencyCodes.includes(record.quote)
        );

        const availableCurrencies = new Set(
            supportedRecords.map(record => record.quote)
        );

        const missingCurrencies = supportedCurrencyCodes.filter(code =>
            code !== "USD" && !availableCurrencies.has(code)
        );

        if (missingCurrencies.length > 0) {
            throw new Error(
                "Missing supported currency rates: " +
                missingCurrencies.join(", ")
            );
        }

        if (supportedRecords.length === 0) {
            throw new Error("No supported fiat exchange rates were returned.");
        }

        const saveRates = db.transaction(() => {
            const upsert = db.prepare(`
                INSERT INTO xmd_coin_exchange_rates (
                    currency_code,
                    currency_symbol,
                    rate_per_usd,
                    rate_date,
                    source,
                    fetched_at
                )
                VALUES (?, ?, ?, ?, 'Frankfurter', CURRENT_TIMESTAMP)
                ON CONFLICT(currency_code) DO UPDATE SET
                    currency_symbol = excluded.currency_symbol,
                    rate_per_usd = excluded.rate_per_usd,
                    rate_date = excluded.rate_date,
                    source = excluded.source,
                    fetched_at = CURRENT_TIMESTAMP
            `);

            // USD is the identity/base currency.
            const usdDate =
                supportedRecords.find(record => record.quote === "NGN")?.date ||
                supportedRecords[0].date;

            upsert.run("USD", "$", 1, usdDate);

            for (const record of supportedRecords) {
                upsert.run(
                    record.quote,
                    getXmdCurrencySymbol(record.quote),
                    Number(record.rate),
                    record.date
                );
            }
        });

        saveRates();

        recordAdminAudit(
            req.session.userId,
            "xmd_coin_exchange_rates_refreshed",
            null,
            JSON.stringify({
                source: "Frankfurter",
                baseCurrency: "USD",
                ratesSaved: supportedRecords.length
            })
        );

        res.json({
            success: true,
            message: "USD exchange rates refreshed successfully.",
            source: "Frankfurter",
            ratesSaved: supportedRecords.length,
            rates: db.prepare(`
                SELECT currency_code, rate_per_usd, rate_date, fetched_at
                FROM xmd_coin_exchange_rates
                ORDER BY currency_code
            `).all()
        });

    } catch (error) {
        console.error("XMD Coin FX refresh error:", error);

        res.status(502).json({
            success: false,
            message: "Unable to refresh exchange rates. Previously saved rates were preserved."
        });
    }
});

// Save the single global USD master price.
app.put("/api/admin/xmd-coin-master-pricing", requireOwner, (req, res) => {
    try {
        const coinsPerPackage = Number(req.body?.coinsPerPackage);
        const usdPriceMinorUnits = Number(req.body?.usdPriceMinorUnits);

        if (!Number.isSafeInteger(coinsPerPackage) || coinsPerPackage < 1) {
            return res.status(400).json({
                success: false,
                message: "Coin package size must be a positive whole number."
            });
        }

        if (
            !Number.isSafeInteger(usdPriceMinorUnits) ||
            usdPriceMinorUnits < 1
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid USD master price in cents."
            });
        }

        const previous = db.prepare(`
            SELECT * FROM xmd_coin_master_pricing WHERE id = 1
        `).get();

        db.prepare(`
            UPDATE xmd_coin_master_pricing
            SET
                coins_per_package = ?,
                usd_price_minor_units = ?,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = ?
            WHERE id = 1
        `).run(
            coinsPerPackage,
            usdPriceMinorUnits,
            req.session.userId
        );

        const updated = db.prepare(`
            SELECT * FROM xmd_coin_master_pricing WHERE id = 1
        `).get();

        recordAdminAudit(
            req.session.userId,
            "xmd_coin_master_price_updated",
            null,
            JSON.stringify({
                previous,
                updated
            })
        );

        res.json({
            success: true,
            message: "Global USD master price saved successfully.",
            master: {
                coinsPerPackage: updated.coins_per_package,
                usdPriceMinorUnits: updated.usd_price_minor_units,
                usdPrice: updated.usd_price_minor_units / 100,
                updatedAt: updated.updated_at
            }
        });

    } catch (error) {
        console.error("Global XMD Coin pricing save error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to save global USD master price."
        });
    }
});

// Get all regional XMD Coin prices
app.get("/api/admin/regional-coin-prices", requireOwner, (req, res) => {
    try {
        const prices = db.prepare(`
            SELECT
                country_code,
                country_name,
                currency_code,
                currency_symbol,
                coins_per_package,
                price_minor_units,
                updated_at,
                updated_by
            FROM regional_coin_prices
            ORDER BY CASE country_code
    WHEN 'NG' THEN 1
    WHEN 'GH' THEN 2
    WHEN 'ZA' THEN 3
    WHEN 'US' THEN 4
    ELSE 5
END ASC
        `).all();

        res.json({
            success: true,
            prices
        });

    } catch (error) {
        console.error("Regional coin pricing error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load regional coin prices."
        });
    }
});


// Update a country's XMD Coin package price
app.put("/api/admin/regional-coin-prices/:countryCode", requireOwner, (req, res) => {
    try {
        const countryCode = String(req.params.countryCode || "").trim().toUpperCase();

        const currencyCode = String(req.body?.currencyCode || "").trim().toUpperCase();
        const currencySymbol = String(req.body?.currencySymbol || "").trim();
        const coinsPerPackage = Number(req.body?.coinsPerPackage);
        const priceMinorUnits = Number(req.body?.priceMinorUnits);

        if (!/^[A-Z]{2}$/.test(countryCode)) {
            return res.status(400).json({
                success: false,
                message: "Invalid country code."
            });
        }

        if (!/^[A-Z]{3}$/.test(currencyCode)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid three-letter currency code."
            });
        }

        if (!currencySymbol || currencySymbol.length > 10) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid currency symbol."
            });
        }

        if (!Number.isSafeInteger(coinsPerPackage) || coinsPerPackage < 1) {
            return res.status(400).json({
                success: false,
                message: "Coin package size must be a positive whole number."
            });
        }

        if (!Number.isSafeInteger(priceMinorUnits) || priceMinorUnits < 1) {
            return res.status(400).json({
                success: false,
                message: "Package price must be a positive amount in minor currency units."
            });
        }

        const existing = db.prepare(`
            SELECT *
            FROM regional_coin_prices
            WHERE country_code = ?
        `).get(countryCode);

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Country pricing record not found."
            });
        }

        db.prepare(`
            UPDATE regional_coin_prices
            SET
                currency_code = ?,
                currency_symbol = ?,
                coins_per_package = ?,
                price_minor_units = ?,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = ?
            WHERE country_code = ?
        `).run(
            currencyCode,
            currencySymbol,
            coinsPerPackage,
            priceMinorUnits,
            req.session.userId,
            countryCode
        );

        const updated = db.prepare(`
            SELECT *
            FROM regional_coin_prices
            WHERE country_code = ?
        `).get(countryCode);

        recordAdminAudit(
            req.session.userId,
            "regional_coin_price_updated",
            null,
            JSON.stringify({
                country: updated.country_name,
                previous: existing,
                updated
            })
        );

        res.json({
            success: true,
            message: "Regional XMD Coin price updated successfully.",
            price: updated
        });

    } catch (error) {
        console.error("Regional coin price update error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to update regional coin price."
        });
    }
});

// ==========================================
// OWNER REGIONAL SUBSCRIPTION PRICING
// ==========================================

app.get("/api/admin/regional-subscription-prices", requireOwner, (req, res) => {
    try {
        const countries = db.prepare(`
            SELECT
                country_code,
                country_name,
                currency_code,
                currency_symbol
            FROM regional_coin_prices
            ORDER BY CASE country_code
                WHEN 'NG' THEN 1
                WHEN 'GH' THEN 2
                WHEN 'ZA' THEN 3
                WHEN 'US' THEN 4
                ELSE 5
            END ASC
        `).all();

        const plans = db.prepare(`
            SELECT id, code, name, duration_days, is_active
            FROM subscription_plans
            ORDER BY duration_days ASC
        `).all();

        const prices = db.prepare(`
            SELECT *
            FROM regional_subscription_prices
            ORDER BY country_code, plan_id
        `).all();

        res.json({
            success: true,
            countries,
            plans,
            prices
        });

    } catch (error) {
        console.error("Regional subscription pricing load error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load regional subscription prices."
        });
    }
});

app.put("/api/admin/regional-subscription-prices/:countryCode/:planId", requireOwner, (req, res) => {
    try {
        const countryCode = String(req.params.countryCode || "").trim().toUpperCase();
        const planId = Number(req.params.planId);
        const priceMinorUnits = Number(req.body?.priceMinorUnits);
        const isActive = req.body?.isActive === true;

        if (!/^[A-Z]{2}$/.test(countryCode)) {
            return res.status(400).json({
                success: false,
                message: "Invalid country code."
            });
        }

        if (!Number.isSafeInteger(planId) || planId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid subscription plan."
            });
        }

        if (!Number.isSafeInteger(priceMinorUnits) || priceMinorUnits < 1) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid positive subscription price in minor currency units."
            });
        }

        const country = db.prepare(`
            SELECT country_code, country_name, currency_code, currency_symbol
            FROM regional_coin_prices
            WHERE country_code = ?
        `).get(countryCode);

        if (!country) {
            return res.status(404).json({
                success: false,
                message: "Country is not configured in OLU-XMD."
            });
        }

        const plan = db.prepare(`
            SELECT id, code, name
            FROM subscription_plans
            WHERE id = ?
        `).get(planId);

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: "Subscription plan not found."
            });
        }

        const existing = db.prepare(`
            SELECT *
            FROM regional_subscription_prices
            WHERE country_code = ? AND plan_id = ?
        `).get(countryCode, planId);

        const currencyExponent = existing
            ? existing.currency_exponent
            : 2;

        db.prepare(`
            INSERT INTO regional_subscription_prices (
                country_code,
                country_name,
                plan_id,
                currency_code,
                currency_symbol,
                currency_exponent,
                price_minor_units,
                is_active,
                updated_at,
                updated_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(country_code, plan_id)
            DO UPDATE SET
                country_name = excluded.country_name,
                currency_code = excluded.currency_code,
                currency_symbol = excluded.currency_symbol,
                currency_exponent = excluded.currency_exponent,
                price_minor_units = excluded.price_minor_units,
                is_active = excluded.is_active,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by
        `).run(
            country.country_code,
            country.country_name,
            plan.id,
            country.currency_code,
            country.currency_symbol,
            currencyExponent,
            priceMinorUnits,
            isActive ? 1 : 0,
            req.session.userId
        );

        const updated = db.prepare(`
            SELECT *
            FROM regional_subscription_prices
            WHERE country_code = ? AND plan_id = ?
        `).get(countryCode, planId);

        recordAdminAudit(
            req.session.userId,
            "regional_subscription_price_updated",
            null,
            JSON.stringify({
                country: country.country_name,
                plan: plan.name,
                previous: existing || null,
                updated
            })
        );

        res.json({
            success: true,
            message: "Regional subscription price saved successfully.",
            price: updated
        });

    } catch (error) {
        console.error("Regional subscription pricing update error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to update regional subscription price."
        });
    }
});
// Restore saved WhatsApp sessions after server restart
// Restore only completed WhatsApp sessions after server restart
async function restoreWhatsAppSessions() {
    const fs = require("fs");
    const { useMultiFileAuthState } = await import("@whiskeysockets/baileys");
    const users = db.prepare("SELECT id FROM users").all();

    console.log("Checking saved WhatsApp sessions...");

    for (const user of users) {
        try {
            const sessionKey = whatsappModule.getWhatsAppSessionKey(user.id);

            const sessionDirectory = path.join(
                __dirname,
                "sessions",
                sessionKey
            );

            if (!fs.existsSync(sessionDirectory)) continue;

            const { state } = await useMultiFileAuthState(sessionDirectory);

            if (!state.creds.registered) {
                console.log(
                    "Skipping incomplete WhatsApp session for customer:",
                    user.id
                );
                continue;
            }

            console.log("Restoring WhatsApp session for customer:", user.id);

            await whatsappModule.reconnectWhatsApp(user.id);

        } catch (error) {
            console.error(
                "Could not restore WhatsApp for customer:",
                user.id,
                error.message
            );
        }
    }
}

// ==========================================
// OLU-XMD OWNER HOSTING PACKAGE API V1
// ==========================================

// Owner: Load hosting packages and local-price previews.
app.get("/api/admin/hosting-packages", requireOwner, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT *
            FROM xmd_hosting_packages
            ORDER BY sort_order, id
        `).all();

        const savedRates = db.prepare(`
            SELECT currency_code, currency_symbol,
                   rate_per_usd, rate_date, source
            FROM xmd_coin_exchange_rates
        `).all();

        const rates = Object.fromEntries(
            savedRates.map(rate => [rate.currency_code, rate])
        );

        const previewCurrencies = ["NGN", "GHS", "ZAR", "USD"];

        const packages = rows.map(item => {
            const usdPrice = item.usd_price_minor_units === null
                ? null
                : Number(item.usd_price_minor_units) / 100;

            const localPrices = previewCurrencies.map(code => {
                const rate = code === "USD"
                    ? { rate_per_usd: 1, rate_date: "USD base" }
                    : rates[code];

                if (
                    usdPrice === null ||
                    !rate ||
                    !Number.isFinite(Number(rate.rate_per_usd)) ||
                    Number(rate.rate_per_usd) <= 0
                ) {
                    return {
                        currencyCode: code,
                        available: false,
                        formattedPrice: "Unavailable"
                    };
                }

                const exponent = getXmdCurrencyExponent(code);
                const multiplier = Math.pow(10, exponent);

                const minorUnits = Math.round(
                    usdPrice * Number(rate.rate_per_usd) * multiplier
                );

                return {
                    currencyCode: code,
                    available: true,
                    rateDate: rate.rate_date,
                    minorUnits,
                    formattedPrice: new Intl.NumberFormat("en", {
                        style: "currency",
                        currency: code,
                        minimumFractionDigits: exponent,
                        maximumFractionDigits: exponent
                    }).format(minorUnits / multiplier)
                };
            });

            return {
                ...item,
                usdPrice,
                localPrices
            };
        });

        res.json({
            success: true,
            packages,
            currencies: previewCurrencies
        });

    } catch (error) {
        console.error("Owner hosting package load error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load hosting packages."
        });
    }
});

// Owner: Save package configuration as a draft.
// Purchases remain disabled until hosting enforcement is operational.
app.put("/api/admin/hosting-packages/:id", requireOwner, (req, res) => {
    try {
        const id = Number(req.params.id);
        const name = String(req.body?.packageName || "").trim();

        const coins = Number(req.body?.coins);
        const usdPriceMinorUnits = Number(req.body?.usdPriceMinorUnits);
        const cpuMillicores = Number(req.body?.cpuMillicores);
        const ramMb = Number(req.body?.ramMb);
        const storageGb = Number(req.body?.storageGb);
        const botSlots = Number(req.body?.botSlots);
        const durationDays = Number(req.body?.durationDays);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid package ID."
            });
        }

        if (!name || name.length > 50) {
            return res.status(400).json({
                success: false,
                message: "Enter a package name of 1 to 50 characters."
            });
        }

        if (!Number.isSafeInteger(coins) || coins < 1) {
            return res.status(400).json({
                success: false,
                message: "Coin quantity must be a positive whole number."
            });
        }

        if (!Number.isSafeInteger(usdPriceMinorUnits) || usdPriceMinorUnits < 1) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid USD package price."
            });
        }

        if (!Number.isSafeInteger(cpuMillicores) || cpuMillicores < 1) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid CPU allocation in millicores."
            });
        }

        if (!Number.isSafeInteger(ramMb) || ramMb < 1) {
            return res.status(400).json({
                success: false,
                message: "RAM must be a positive whole number of MB."
            });
        }

        if (!Number.isSafeInteger(storageGb) || storageGb < 1) {
            return res.status(400).json({
                success: false,
                message: "Storage must be at least 1 GB."
            });
        }

        if (!Number.isSafeInteger(botSlots) || botSlots < 1) {
            return res.status(400).json({
                success: false,
                message: "Bot slots must be at least 1."
            });
        }

        if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
            return res.status(400).json({
                success: false,
                message: "Hosting duration must be between 1 and 3650 days."
            });
        }

        const previous = db.prepare(`
            SELECT * FROM xmd_hosting_packages WHERE id = ?
        `).get(id);

        if (!previous) {
            return res.status(404).json({
                success: false,
                message: "Hosting package not found."
            });
        }

        db.prepare(`
            UPDATE xmd_hosting_packages
            SET
                package_name = ?,
                coins = ?,
                usd_price_minor_units = ?,
                cpu_millicores = ?,
                ram_mb = ?,
                storage_gb = ?,
                bot_slots = ?,
                duration_days = ?,
                is_active = 0,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = ?
            WHERE id = ?
        `).run(
            name,
            coins,
            usdPriceMinorUnits,
            cpuMillicores,
            ramMb,
            storageGb,
            botSlots,
            durationDays,
            req.session.userId,
            id
        );

        const updated = db.prepare(`
            SELECT * FROM xmd_hosting_packages WHERE id = ?
        `).get(id);

        recordAdminAudit(
            req.session.userId,
            "hosting_package_draft_updated",
            null,
            JSON.stringify({ previous, updated })
        );

        res.json({
            success: true,
            message: "Package draft saved. Customer purchases remain disabled until hosting enforcement and checkout are ready.",
            package: updated,
            status: "draft"
        });

    } catch (error) {
        console.error("Owner hosting package save error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to save hosting package."
        });
    }
});


// ==========================================
// OLU-XMD CUSTOMER HOSTING PACKAGE CATALOGUE V1
// Read-only catalogue. Checkout and provisioning remain disabled.
// ==========================================

app.get("/api/hosting-packages", (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                message: "Please login first."
            });
        }

        const customer = db.prepare(`
            SELECT country_code, currency_code
            FROM users
            WHERE id = ?
        `).get(req.session.userId);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer account not found."
            });
        }

        const currencyCode = String(customer.currency_code || "NGN").toUpperCase();

        const packages = db.prepare(`
            SELECT
                id,
                package_code,
                package_name,
                coins,
                usd_price_minor_units,
                cpu_millicores,
                ram_mb,
                storage_gb,
                bot_slots,
                duration_days,
                is_active,
                sort_order
            FROM xmd_hosting_packages
            ORDER BY sort_order, id
        `).all();

        let exchangeRate = null;
        let rateDate = null;

        if (currencyCode === "USD") {
            exchangeRate = 1;
            rateDate = "USD base";
        } else {
            const savedRate = db.prepare(`
                SELECT rate_per_usd, rate_date
                FROM xmd_coin_exchange_rates
                WHERE currency_code = ?
            `).get(currencyCode);

            if (
                savedRate &&
                Number.isFinite(Number(savedRate.rate_per_usd)) &&
                Number(savedRate.rate_per_usd) > 0
            ) {
                exchangeRate = Number(savedRate.rate_per_usd);
                rateDate = savedRate.rate_date;
            }
        }

        const exponent = getXmdCurrencyExponent(currencyCode);
        const multiplier = Math.pow(10, exponent);

        const customerPackages = packages.map(item => {
            const usdPrice = item.usd_price_minor_units === null
                ? null
                : Number(item.usd_price_minor_units) / 100;

            const resourcesConfigured =
                Number.isSafeInteger(item.cpu_millicores) && item.cpu_millicores > 0 &&
                Number.isSafeInteger(item.ram_mb) && item.ram_mb > 0 &&
                Number.isSafeInteger(item.storage_gb) && item.storage_gb > 0 &&
                Number.isSafeInteger(item.bot_slots) && item.bot_slots > 0 &&
                Number.isSafeInteger(item.duration_days) && item.duration_days > 0;

            const priceConfigured =
                usdPrice !== null &&
                Number.isFinite(usdPrice) &&
                usdPrice > 0;

            const priceAvailable =
                priceConfigured && exchangeRate !== null;

            let localPriceMinorUnits = null;
            let formattedPrice = "To be configured";

            if (priceAvailable) {
                localPriceMinorUnits = Math.round(
                    usdPrice * exchangeRate * multiplier
                );

                formattedPrice = new Intl.NumberFormat("en", {
                    style: "currency",
                    currency: currencyCode,
                    minimumFractionDigits: exponent,
                    maximumFractionDigits: exponent
                }).format(localPriceMinorUnits / multiplier);
            } else if (priceConfigured) {
                formattedPrice = "Local price unavailable";
            }

            const packageConfigured =
                resourcesConfigured && priceConfigured;

            const availableForPurchase =
                Boolean(item.is_active) &&
                packageConfigured &&
                priceAvailable;

            return {
                id: item.id,
                code: item.package_code,
                name: item.package_name,
                coins: item.coins,
                usdPrice,
                currencyCode,
                localPriceMinorUnits,
                formattedPrice,
                exchangeRate,
                rateDate,
                cpuMillicores: item.cpu_millicores,
                cpuCores: item.cpu_millicores === null
                    ? null
                    : Number(item.cpu_millicores) / 1000,
                ramMb: item.ram_mb,
                storageGb: item.storage_gb,
                botSlots: item.bot_slots,
                durationDays: item.duration_days,
                resourcesConfigured,
                priceConfigured,
                availableForPurchase,
                status: availableForPurchase ? "Available" : "Coming Soon"
            };
        });

        res.json({
            success: true,
            currencyCode,
            countryCode: customer.country_code || null,
            checkoutAvailable: false,
            message: "Hosting packages are being prepared. Purchases are not yet enabled.",
            packages: customerPackages
        });

    } catch (error) {
        console.error("Customer hosting catalogue error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load hosting packages."
        });
    }
});

// Start server



app.get("/api/admin/channel-post-diagnostic", requireOwner, async (req, res) => {
  const startedAt = Date.now();
  try {
    const userId = String(req.query.userId || "").trim();
    if (!userId) return res.status(400).json({ success: false, error: "Supply userId" });

    const sock = whatsappModule.getWhatsAppSocket(userId);
    if (!sock) return res.status(404).json({ success: false, error: "No active socket for customer " + userId });

    const metadata = await sock.newsletterMetadata("invite", "0029VbAqiMi7YScvjZe81E3J");
    if (!metadata?.id) return res.status(404).json({ success: false, error: "Channel metadata not found" });

    const fetched = await sock.newsletterFetchMessages(metadata.id, 5);
    // POST114_MEDIA_DOWNLOAD_TEST
    const post114 = fetched.find(item => String(item.serverId) === "114");
    const media = post114?.message?.imageMessage;

    let mediaDownloadTest = {
      found: !!post114,
      success: false,
      mediaFields: media ? {
        keys: Object.keys(media),
        mediaKeyPresent: !!media.mediaKey,
        mediaKeyBytes: media.mediaKey?.length ?? 0,
        directPathPresent: !!media.directPath,
        urlPresent: !!media.url,
        fileEncSha256Present: !!media.fileEncSha256,
        fileSha256Present: !!media.fileSha256,
        fileLength: media.fileLength?.toString?.() ?? null,
        mimetype: media.mimetype ?? null
      } : null
    };

    if (media) {
      try {
        const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
        const stream = await downloadContentFromMessage({
          mediaKey: media.mediaKey,
          directPath: media.directPath,
          url: media.url
        }, "image");

        let downloadedBytes = 0;
        for await (const chunk of stream) {
          downloadedBytes += chunk.length;
        }

        mediaDownloadTest.success = downloadedBytes > 0;
        mediaDownloadTest.downloadedBytes = downloadedBytes;
      } catch (downloadError) {
        mediaDownloadTest.downloadError = downloadError.message;
      }
    }

    let directFetchTest = {
      attempted: false,
      success: false
    };

    if (media?.url) {
      directFetchTest.attempted = true;

      try {
        const response = await fetch(media.url, {
          signal: AbortSignal.timeout(15000)
        });

        const imageBuffer = Buffer.from(await response.arrayBuffer());

        directFetchTest = {
          attempted: true,
          success: response.ok && imageBuffer.length > 0,
          httpStatus: response.status,
          contentType: response.headers.get("content-type"),
          downloadedBytes: imageBuffer.length,
          expectedBytes: Number(media.fileLength || 0),
          jpegSignature: imageBuffer.length >= 3 &&
            imageBuffer[0] === 0xFF &&
            imageBuffer[1] === 0xD8 &&
            imageBuffer[2] === 0xFF,
          jpegEndMarker: imageBuffer.length >= 2 &&
            imageBuffer[imageBuffer.length - 2] === 0xFF &&
            imageBuffer[imageBuffer.length - 1] === 0xD9
        };
      } catch (error) {
        directFetchTest.error = error.message;
      }
    }

    const elapsedMs = Date.now() - startedAt;

    function inspect(node, depth = 0) {
      if (depth > 8) return "[max depth]";
      if (node == null) return null;
      if (Buffer.isBuffer(node) || node instanceof Uint8Array) {
        return { binary: true, byteLength: node.length };
      }
      if (Array.isArray(node)) {
        return node.slice(0, 10).map(x => inspect(x, depth + 1));
      }
      if (typeof node !== "object") {
        return typeof node === "string" ? node.slice(0, 300) : node;
      }
      const out = {};
      for (const [key, value] of Object.entries(node)) {
        if (/token|secret|password|auth|mediaKey/i.test(key)) continue;
        out[key] = inspect(value, depth + 1);
      }
      return out;
    }

    res.json({
      success: true,
      customerId: userId,
      channel: { id: metadata.id, name: metadata.name || null },
      fetch: {
        elapsedMs,
        responseStatus: fetched === undefined ? "undefined-no-response" : fetched === null ? "null-response" : "response-received",
        responseType: fetched === undefined ? "undefined" : fetched === null ? "null" : Array.isArray(fetched) ? "array" : typeof fetched
      },
      mediaDownloadTest,
      directFetchTest,
      rawPost114Diagnostic: globalThis.__OLUXMD_RAW_POST114_DIAGNOSTIC ?? null,
      responseTree: Array.isArray(fetched) ? fetched.map(item => ({
        keys: Object.keys(item || {}),
        id: item?.id ?? null,
        serverId: item?.serverId ?? null,
        type: item?.type ?? null,
        timestamp: item?.timestamp ?? null,
        messageKeys: item?.message ? Object.keys(item.message) : [],
        messageType: item?.message ? Object.keys(item.message).filter(k => item.message[k] != null) : [],
        postText: item?.message?.conversation ?? item?.message?.extendedTextMessage?.text ?? null,
        imageDetails: item?.message?.imageMessage ? {
          caption: item.message.imageMessage.caption ?? null,
          mimetype: item.message.imageMessage.mimetype ?? null,
          fileLength: item.message.imageMessage.fileLength?.toString?.() ?? null,
          width: item.message.imageMessage.width ?? null,
          height: item.message.imageMessage.height ?? null,
          thumbnailBytes: item.message.imageMessage.jpegThumbnail?.length ?? 0,
          hasMediaPath: !!item.message.imageMessage.directPath
        } : null,
        views: item?.views ?? null,
        forwards: item?.forwards ?? null,
        reactionsCount: item?.reactions?.length ?? 0
      })) : inspect(fetched)
    });
  } catch (error) {
    console.error("CHANNEL FETCH DIAGNOSTIC ERROR:", error);
    res.status(500).json({
      success: false,
      elapsedMs: Date.now() - startedAt,
      error: error.message
    });
  }
});


app.post("/api/admin/test-post114-forward", requireOwner, async (req, res) => {
  const userId = "1";
  let sendAttempted = false;

  if (globalThis.__OLUXMD_POST114_TEST_SENT) {
    return res.status(409).json({
      success: false,
      error: "The Post 114 test has already been sent during this server session."
    });
  }

  try {
    const sock = whatsappModule.getWhatsAppSocket(userId);

    if (!sock?.user?.id) {
      return res.status(404).json({
        success: false,
        error: "Customer 1 is not connected."
      });
    }

    globalThis.__OLUXMD_POST114_TEST_SENT = true;

    const metadata = await sock.newsletterMetadata(
      "invite",
      "0029VbAqiMi7YScvjZe81E3J"
    );

    if (!metadata?.id) throw new Error("Official Channel metadata not found.");

    const posts = await sock.newsletterFetchMessages(metadata.id, 5);
    const post = posts.find(item => String(item.serverId) === "114");
    const media = post?.message?.imageMessage;

    if (!media?.url) throw new Error("Post 114 image or media URL not found.");
    if (!media.caption) throw new Error("Post 114 caption not found.");

    const response = await fetch(media.url, {
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error("Post 114 image download failed: HTTP " + response.status);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    if (!imageBuffer.length) throw new Error("Downloaded image is empty.");

    const baileys = await import("@whiskeysockets/baileys");
    const recipient = baileys.jidNormalizedUser(sock.user.id);

    sendAttempted = true;

    const sent = await sock.sendMessage(recipient, {
      image: imageBuffer,
      caption: media.caption,
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: metadata.id,
          serverMessageId: 114,
          newsletterName: metadata.name || "OLU-XMD-BOT",
          contentType: 1
        }
      }
    });

    return res.json({
      success: true,
      customerId: userId,
      sourcePost: 114,
      imageBytes: imageBuffer.length,
      sentMessageId: sent?.key?.id || null,
      attribution: "Newsletter attribution metadata attached",
      note: "Check the receiving WhatsApp chat to confirm how attribution is displayed."
    });

  } catch (error) {
    if (!sendAttempted) globalThis.__OLUXMD_POST114_TEST_SENT = false;

    console.error("POST 114 TEST ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("OLU-XMD Panel started!");
    console.log(`Open http://localhost:${PORT}`);

    restoreWhatsAppSessions().catch(error => {
        console.error("WhatsApp startup recovery error:", error);
    });
});



















