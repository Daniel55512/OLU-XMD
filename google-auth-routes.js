"use strict";

const crypto = require("crypto");

const {
    verifyGoogleCredential,
    getGoogleIdentityBySubject,
    getUserByEmail,
    linkGoogleIdentity,
    createGoogleCustomer
} = require("./google-auth-service");

const { loginUser } = require("./login");
const db = require("./database");

function authError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save(error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function respondWithGoogleError(res, error) {
    const statusCodes = {
        GOOGLE_NOT_CONFIGURED: 503,
        INVALID_GOOGLE_TOKEN: 401,
        INVALID_GOOGLE_NONCE: 401,
        GOOGLE_NONCE_MISMATCH: 401,
        GOOGLE_NONCE_EXPIRED: 401,
        UNVERIFIED_GOOGLE_ACCOUNT: 401,
        COUNTRY_REQUIRED: 400,
        ACCOUNT_LINK_REQUIRED: 409,
        ACCOUNT_EMAIL_MISMATCH: 409,
        GOOGLE_IDENTITY_IN_USE: 409,
        ACCOUNT_ALREADY_LINKED: 409,
        GOOGLE_IDENTITY_ALREADY_LINKED: 409,
        ADMIN_GOOGLE_LINK_BLOCKED: 403,
        GOOGLE_PENDING_EXPIRED: 401
    };

    const status = statusCodes[error.code] || 500;

    if (status === 500) {
        console.error("Google authentication error:", error);
    }

    return res.status(status).json({
        success: false,
        code: error.code || "GOOGLE_SIGNIN_FAILED",
        message: status === 500
            ? "Google sign-in could not be completed. Please try again."
            : error.message
    });
}

async function consumeGoogleCredential(req, credential) {
    const stored = req.session.googleAuthNonce;

    // Consume the nonce once, whether the token succeeds or fails.
    delete req.session.googleAuthNonce;

    await saveSession(req);

    if (!stored || Date.now() > stored.expiresAt) {
        throw authError(
            "GOOGLE_NONCE_EXPIRED",
            "Your Google sign-in session expired. Please try again."
        );
    }

    try {
        return await verifyGoogleCredential(
            credential,
            stored.value
        );
    } catch (error) {
        if (error.code) throw error;

        throw authError(
            "INVALID_GOOGLE_TOKEN",
            "Google could not verify your sign-in. Please try again."
        );
    }
}

function getPendingProfile(req, key) {
    const pending = req.session[key];

    if (
        !pending ||
        !pending.profile ||
        Date.now() > pending.expiresAt
    ) {
        delete req.session[key];

        throw authError(
            "GOOGLE_PENDING_EXPIRED",
            "Your Google sign-in session expired. Please select your Google account again."
        );
    }

    return pending.profile;
}

async function savePendingProfile(req, key, profile) {
    req.session[key] = {
        profile,
        expiresAt: Date.now() + 10 * 60 * 1000
    };

    await saveSession(req);
}

function rejectAdminSession(req, res) {
    if (
        req.session.userId &&
        req.session.role !== "customer"
    ) {
        res.status(403).json({
            success: false,
            message:
                "Please use the separate Owner/Admin login."
        });

        return true;
    }

    return false;
}

function establishCustomerSession(req, res, user) {
    if (!user || user.role !== "customer") {
        return res.status(403).json({
            success: false,
            message:
                "Google sign-in is only available for customer accounts."
        });
    }

    req.session.regenerate(error => {
        if (error) {
            console.error("Google session creation error:", error);

            return res.status(500).json({
                success: false,
                message: "Unable to create your login session."
            });
        }

        req.session.userId = Number(user.id);
        req.session.role = "customer";

        req.session.save(saveError => {
            if (saveError) {
                console.error("Google session save error:", saveError);

                return res.status(500).json({
                    success: false,
                    message: "Unable to save your login session."
                });
            }

            try {
                db.prepare(`
                    INSERT INTO customer_activity
                        (user_id, event_type, details)
                    VALUES (?, 'login', 'Customer logged in with Google')
                `).run(Number(user.id));
            } catch (activityError) {
                console.error(
                    "Google login activity error:",
                    activityError.message
                );
            }

            return res.json({
                success: true,
                message: "Google sign-in successful!",
                user: {
                    id: Number(user.id),
                    name: user.name,
                    email: user.email,
                    role: "customer"
                }
            });
        });
    });
}

function registerGoogleAuthRoutes(app) {

    // Create a short-lived, session-bound nonce.
    app.get("/api/auth/google/nonce", async (req, res) => {
        try {
            if (!process.env.GOOGLE_CLIENT_ID) {
                return res.status(503).json({
                    success: false,
                    message: "Google sign-in is not configured."
                });
            }

            if (rejectAdminSession(req, res)) return;

            const nonce = crypto
                .randomBytes(32)
                .toString("base64url");

            req.session.googleAuthNonce = {
                value: nonce,
                expiresAt: Date.now() + 5 * 60 * 1000
            };

            await saveSession(req);

            return res.json({
                success: true,
                clientId: process.env.GOOGLE_CLIENT_ID,
                nonce
            });

        } catch (error) {
            console.error("Google nonce error:", error);

            return res.status(500).json({
                success: false,
                message: "Unable to start Google sign-in."
            });
        }
    });

    // Google sign-in and registration.
    app.post("/api/auth/google", async (req, res) => {
        try {
            if (rejectAdminSession(req, res)) return;

            const profile = await consumeGoogleCredential(
                req,
                req.body?.credential
            );

            // Returning linked Google customer.
            const linkedUser = getGoogleIdentityBySubject(
                profile.subject
            );

            if (linkedUser) {
                if (linkedUser.role !== "customer") {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Owner and Admin accounts must use the separate Owner login."
                    });
                }

                return establishCustomerSession(
                    req,
                    res,
                    linkedUser
                );
            }

            // Check for an existing email/password account.
            const existingUser = getUserByEmail(profile.email);

            if (existingUser) {
                if (existingUser.role !== "customer") {
                    return res.status(403).json({
                        success: false,
                        message:
                            "Owner and Admin accounts must use the separate Owner login."
                    });
                }

                await savePendingProfile(
                    req,
                    "pendingGoogleLink",
                    profile
                );

                return res.status(409).json({
                    success: false,
                    code: "ACCOUNT_LINK_REQUIRED",
                    message:
                        "An OLU-XMD account already uses this email. Enter your existing account password to link Google."
                });
            }

            // New customers select their country once.
            await savePendingProfile(
                req,
                "pendingGoogleSignup",
                profile
            );

            return res.json({
                success: false,
                code: "COUNTRY_REQUIRED",
                message:
                    "Select your country to finish creating your OLU-XMD account."
            });

        } catch (error) {
            return respondWithGoogleError(res, error);
        }
    });

    // Complete a new Google registration.
    app.post("/api/auth/google/complete", async (req, res) => {
        try {
            if (rejectAdminSession(req, res)) return;

            const profile = getPendingProfile(
                req,
                "pendingGoogleSignup"
            );

            const countryCode = String(
                req.body?.countryCode || ""
            ).trim().toUpperCase();

            if (!countryCode) {
                return res.status(400).json({
                    success: false,
                    code: "COUNTRY_REQUIRED",
                    message: "Please select your country."
                });
            }

            const user = createGoogleCustomer(
                profile,
                countryCode
            );

            delete req.session.pendingGoogleSignup;

            return establishCustomerSession(
                req,
                res,
                user
            );

        } catch (error) {
            return respondWithGoogleError(res, error);
        }
    });

    // Link an existing customer account after password confirmation.
    app.post("/api/auth/google/link", async (req, res) => {
        try {
            if (rejectAdminSession(req, res)) return;

            const profile = getPendingProfile(
                req,
                "pendingGoogleLink"
            );

            const password = String(
                req.body?.password || ""
            );

            if (!password) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter your existing OLU-XMD password."
                });
            }

            const user = loginUser(
                profile.email,
                password
            );

            if (user.role !== "customer") {
                return res.status(403).json({
                    success: false,
                    message:
                        "Owner and Admin accounts cannot be linked through customer Google sign-in."
                });
            }

            const linkedUser = linkGoogleIdentity(
                user.id,
                profile
            );

            delete req.session.pendingGoogleLink;

            return establishCustomerSession(
                req,
                res,
                linkedUser
            );

        } catch (error) {
            if (error.message === "Invalid email or password.") {
                return res.status(401).json({
                    success: false,
                    message:
                        "The OLU-XMD password is incorrect. Please try again."
                });
            }

            return respondWithGoogleError(res, error);
        }
    });
}

module.exports = { registerGoogleAuthRoutes };
