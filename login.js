const bcrypt = require("bcryptjs");
const db = require("./database");

function loginUser(email, password) {
    const cleanEmail = email.trim().toLowerCase();

    const user = db.prepare(`
        SELECT
            users.id,
            users.name,
            users.email,
            users.password,
            COALESCE(admin_users.role, 'customer') AS role
        FROM users
        LEFT JOIN admin_users
            ON users.id = admin_users.user_id
        WHERE users.email = ?
    `).get(cleanEmail);

    if (!user) {
        throw new Error("Invalid email or password.");
    }

    const passwordMatches = bcrypt.compareSync(
        password,
        user.password
    );

    if (!passwordMatches) {
        throw new Error("Invalid email or password.");
    }

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
    };
}

module.exports = { loginUser };