"use strict";

const { OAuth2Client } = require("google-auth-library");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("./database");
const { getCountryByCode } = require("./country-directory");

const googleClient = new OAuth2Client();

function authError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Verify Google's signed ID token on the server.
async function verifyGoogleCredential(idToken, expectedNonce) {
    const credential = String(idToken || "").trim();

    if (!credential || credential.length > 12000) {
        throw authError(
            "INVALID_GOOGLE_TOKEN",
            "A valid Google sign-in credential is required."
        );
    }

    if (
        typeof expectedNonce !== "string" ||
        expectedNonce.length < 20
    ) {
        throw authError(
            "INVALID_GOOGLE_NONCE",
            "Your sign-in session expired. Please try again."
        );
    }

    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();

    if (!clientId) {
        throw authError(
            "GOOGLE_NOT_CONFIGURED",
            "Google sign-in is not configured."
        );
    }

    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: clientId
    });

    const payload = ticket.getPayload();

    if (
        !payload ||
        !payload.sub ||
        !payload.email ||
        payload.email_verified !== true
    ) {
        throw authError(
            "UNVERIFIED_GOOGLE_ACCOUNT",
            "Google could not verify this account's email address."
        );
    }

    if (
        typeof payload.nonce !== "string" ||
        payload.nonce !== expectedNonce
    ) {
        throw authError(
            "GOOGLE_NONCE_MISMATCH",
            "Google sign-in verification failed. Please try again."
        );
    }

    return {
        subject: String(payload.sub),
        email: String(payload.email).trim().toLowerCase(),
        name: String(
            payload.name || payload.email.split("@")[0]
        ).trim().slice(0, 100),
        emailVerified: true
    };
}
// Find a customer using Google's permanent subject identifier.
function getGoogleIdentityBySubject(subject) {
    return db.prepare(`
        SELECT
            u.id,
            u.name,
            u.email,
            COALESCE(a.role, 'customer') AS role
        FROM oauth_identities oi
        JOIN users u ON u.id = oi.user_id
        LEFT JOIN admin_users a ON a.user_id = u.id
        WHERE oi.provider = 'google'
          AND oi.provider_subject = ?
    `).get(String(subject));
}

// Find an existing OLU-XMD account by email.
function getUserByEmail(email) {
    return db.prepare(`
        SELECT
            u.id,
            u.name,
            u.email,
            COALESCE(a.role, 'customer') AS role
        FROM users u
        LEFT JOIN admin_users a ON a.user_id = u.id
        WHERE LOWER(u.email) = ?
    `).get(String(email).trim().toLowerCase());
}

// Safely connect Google to an existing customer account.
// The caller must verify the customer's existing password first.
function linkGoogleIdentity(userId, profile) {
    const user = getUserByEmail(profile.email);

    if (!user || Number(user.id) !== Number(userId)) {
        throw authError(
            "ACCOUNT_EMAIL_MISMATCH",
            "The Google email does not match the existing account."
        );
    }

    if (user.role !== "customer") {
        throw authError(
            "ADMIN_GOOGLE_LINK_BLOCKED",
            "Owner and Admin accounts must use the separate Owner login."
        );
    }

    const existingIdentity = getGoogleIdentityBySubject(profile.subject);

    if (existingIdentity) {
        if (Number(existingIdentity.id) === Number(userId)) {
            return user;
        }

        throw authError(
            "GOOGLE_IDENTITY_IN_USE",
            "This Google account is already linked to another OLU-XMD account."
        );
    }

    const identityForUser = db.prepare(`
        SELECT id
        FROM oauth_identities
        WHERE user_id = ? AND provider = 'google'
    `).get(Number(userId));

    if (identityForUser) {
        throw authError(
            "ACCOUNT_ALREADY_LINKED",
            "This OLU-XMD account already has a Google identity linked."
        );
    }

    const saveIdentity = db.transaction(() => {
        db.prepare(`
            INSERT INTO oauth_identities (
                user_id,
                provider,
                provider_subject,
                email,
                email_verified
            )
            VALUES (?, 'google', ?, ?, 1)
        `).run(
            Number(userId),
            profile.subject,
            profile.email
        );
    });

    saveIdentity();

    return getUserByEmail(profile.email);
}

// Create a new customer and all required wallets atomically.
function createGoogleCustomer(profile, countryCode) {
    const cleanCountryCode = String(countryCode || "")
        .trim()
        .toUpperCase();

    const country = getCountryByCode(cleanCountryCode);

    if (!country) {
        throw authError(
            "COUNTRY_REQUIRED",
            "Please select a supported country."
        );
    }

    if (getUserByEmail(profile.email)) {
        throw authError(
            "ACCOUNT_LINK_REQUIRED",
            "An OLU-XMD account already uses this email. Verify your existing account password to link Google."
        );
    }

    // Google-only accounts receive a random password hash.
    // Customers cannot use this random value to sign in.
    const randomPassword = crypto.randomBytes(48).toString("base64url");
    const passwordHash = bcrypt.hashSync(randomPassword, 12);

    const createAccount = db.transaction(() => {
        const existingUser = getUserByEmail(profile.email);

        if (existingUser) {
            throw authError(
                "ACCOUNT_LINK_REQUIRED",
                "An OLU-XMD account already uses this email. Verify your existing account password to link Google."
            );
        }

        const existingIdentity = getGoogleIdentityBySubject(profile.subject);

        if (existingIdentity) {
            throw authError(
                "GOOGLE_IDENTITY_ALREADY_LINKED",
                "This Google account is already linked. Please sign in again."
            );
        }

        const result = db.prepare(`
            INSERT INTO users (
                name,
                email,
                password,
                country_code,
                currency_code
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            profile.name,
            profile.email,
            passwordHash,
            country.countryCode,
            country.currencyCode
        );

        const userId = Number(result.lastInsertRowid);

        db.prepare(`
            INSERT INTO wallets (user_id, balance)
            VALUES (?, 0)
        `).run(userId);

        db.prepare(`
            INSERT INTO coin_wallets (user_id, balance)
            VALUES (?, 0)
        `).run(userId);

        db.prepare(`
            INSERT INTO oauth_identities (
                user_id,
                provider,
                provider_subject,
                email,
                email_verified
            )
            VALUES (?, 'google', ?, ?, 1)
        `).run(
            userId,
            profile.subject,
            profile.email
        );

        return userId;
    });

    const userId = createAccount();

    return {
        id: userId,
        name: profile.name,
        email: profile.email,
        role: "customer"
    };
}

module.exports = {
    verifyGoogleCredential,
    getGoogleIdentityBySubject,
    getUserByEmail,
    linkGoogleIdentity,
    createGoogleCustomer
};

