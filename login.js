const bcrypt = require("bcryptjs");
const db = require("./database");

function loginUser(email, password) {
    const cleanEmail = email.trim().toLowerCase();

    const user = db.prepare(
        "SELECT id, name, email, password FROM users WHERE email = ?"
    ).get(cleanEmail);

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
        email: user.email
    };
}

module.exports = { loginUser };