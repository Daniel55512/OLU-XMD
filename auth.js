const bcrypt = require("bcryptjs");
const db = require("./database");

function registerUser(name, email, password) {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !password) {
        throw new Error("All fields are required.");
    }

    if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
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
            INSERT INTO users (name, email, password)
            VALUES (?, ?, ?)
        `).run(cleanName, cleanEmail, hashedPassword);

        db.prepare(`
            INSERT INTO wallets (user_id, balance)
            VALUES (?, 0)
        `).run(result.lastInsertRowid);

        return result.lastInsertRowid;
    });

    return createUser();
}

module.exports = { registerUser };