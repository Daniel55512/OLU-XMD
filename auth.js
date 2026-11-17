const bcrypt = require("bcryptjs");
const db = require("./database");
const { getCountryByCode } = require("./country-directory");

function registerUser(name, email, password, countryCode) {
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanCountryCode = String(countryCode || "").trim().toUpperCase();

    if (!cleanName || !cleanEmail || !password || !cleanCountryCode) {
        throw new Error("All fields are required.");
    }

    if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
    }

    const country = getCountryByCode(cleanCountryCode);

    if (!country) {
        throw new Error("Please select a supported country.");
    }

    const existingUser = db.prepare(
        "SELECT id FROM users WHERE email = ?"
    ).get(cleanEmail);

    if (existingUser) {
        throw new Error("This email is already registered.");
    }

    const hashedPassword = bcrypt.hashSync(password, 12);

    const createUser = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO users (name, email, password, country_code, currency_code)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            cleanName,
            cleanEmail,
            hashedPassword,
            country.countryCode,
            country.currencyCode
        );

        db.prepare(`
            INSERT INTO wallets (user_id, balance)
            VALUES (?, 0)
        `).run(result.lastInsertRowid);

        db.prepare(`
            INSERT INTO coin_wallets (user_id, balance)
            VALUES (?, 0)
        `).run(result.lastInsertRowid);

        return result.lastInsertRowid;
    });

    return createUser();
}

module.exports = { registerUser };
