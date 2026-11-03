const Database = require("better-sqlite3");

const db = new Database("olu-xmd.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Users
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

// Wallets
db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        balance INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

// Wallet transactions
db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);
// Welcomed WhatsApp contacts
db.exec(`
    CREATE TABLE IF NOT EXISTS welcomed_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        contact_jid TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, contact_jid)
    )
`);
console.log("OLU-XMD database is ready!");

module.exports = db;