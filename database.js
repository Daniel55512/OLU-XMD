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
`);// SUBSCRIPTION PLANS
db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        price_kobo INTEGER,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

// SUBSCRIPTION PAYMENTS
db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        reference TEXT NOT NULL UNIQUE,
        amount_kobo INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        authorization_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        verified_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    )
`);

// CUSTOMER SUBSCRIPTIONS
db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        payment_id INTEGER NOT NULL UNIQUE,
        starts_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
        FOREIGN KEY (payment_id) REFERENCES subscription_payments(id)
    )
`);

// INITIAL SUBSCRIPTION PLANS
db.exec(`
    INSERT OR IGNORE INTO subscription_plans
        (code, name, duration_days, price_kobo, is_active)
    VALUES
        ('weekly', '7-Day Plan', 7, NULL, 0),
        ('monthly', '30-Day Plan', 30, NULL, 0),
        ('quarterly', '90-Day Plan', 90, NULL, 0),
        ('yearly', 'Yearly Plan', 365, NULL, 0)
`);// ACTIVATE SUBSCRIPTION PLANS AND SET PRICES
db.prepare(`
    UPDATE subscription_plans
    SET price_kobo = ?, is_active = 1
    WHERE code = ?
`).run(100000, "weekly");

db.prepare(`
    UPDATE subscription_plans
    SET price_kobo = ?, is_active = 1
    WHERE code = ?
`).run(300000, "monthly");

db.prepare(`
    UPDATE subscription_plans
    SET price_kobo = ?, is_active = 1
    WHERE code = ?
`).run(700000, "quarterly");

db.prepare(`
    UPDATE subscription_plans
    SET price_kobo = ?, is_active = 1
    WHERE code = ?
`).run(2000000, "yearly");
console.log("OLU-XMD database is ready!");
// AUTO REPLY SETTINGS
db.exec(`
    CREATE TABLE IF NOT EXISTS auto_reply_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 0,
        default_reply TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

// AUTO REPLY KEYWORDS
db.exec(`
    CREATE TABLE IF NOT EXISTS auto_reply_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, keyword)
    )
`);


// XMD COIN WALLETS
db.exec(`
    CREATE TABLE IF NOT EXISTS coin_wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    INSERT OR IGNORE INTO coin_wallets (user_id, balance)
    SELECT id, 0 FROM users;

    CREATE TABLE IF NOT EXISTS admin_users (
        user_id INTEGER PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('owner', 'staff_admin')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS coin_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('purchase', 'owner_grant', 'owner_deduction')),
        amount INTEGER NOT NULL CHECK(amount > 0),
        reference TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'completed',
        reason TEXT,
        admin_user_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (admin_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_user_id INTEGER,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_user_id) REFERENCES users(id),
        FOREIGN KEY (target_user_id) REFERENCES users(id)
    );

    INSERT OR IGNORE INTO admin_users (user_id, role)
    VALUES (1, 'owner');
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        user_id INTEGER PRIMARY KEY,
        session_key TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS xmd_coin_payment_intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        gateway TEXT NOT NULL DEFAULT 'payvessel',
        reference TEXT NOT NULL UNIQUE,
        coins INTEGER NOT NULL CHECK(coins > 0),
        currency_code TEXT NOT NULL,
        amount_minor_units INTEGER NOT NULL CHECK(amount_minor_units > 0),
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'paid', 'failed', 'abandoned', 'cancelled')),
        checkout_url TEXT,
        provider_transaction_id TEXT,
        failure_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        paid_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_xmd_coin_payment_user
        ON xmd_coin_payment_intents(user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_xmd_coin_payment_status
        ON xmd_coin_payment_intents(status, created_at);
`);module.exports = db;
// CUSTOM COMMANDS
db.exec(`
    CREATE TABLE IF NOT EXISTS custom_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, command)
    )
`);



// REGIONAL XMD COIN PRICING
const userColumns = db.pragma("table_info(users)").map(column => column.name);

if (!userColumns.includes("country_code")) {
    db.exec("ALTER TABLE users ADD COLUMN country_code TEXT");
}

if (!userColumns.includes("currency_code")) {
    db.exec("ALTER TABLE users ADD COLUMN currency_code TEXT");
}

const coinTransactionColumns = db.pragma("table_info(coin_transactions)")
    .map(column => column.name);

if (!coinTransactionColumns.includes("currency_code")) {
    db.exec("ALTER TABLE coin_transactions ADD COLUMN currency_code TEXT");
}

if (!coinTransactionColumns.includes("purchase_amount_minor_units")) {
    db.exec("ALTER TABLE coin_transactions ADD COLUMN purchase_amount_minor_units INTEGER");
}

db.exec(`
    CREATE TABLE IF NOT EXISTS regional_coin_prices (
        country_code TEXT PRIMARY KEY,
        country_name TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        currency_symbol TEXT NOT NULL,
        coins_per_package INTEGER NOT NULL DEFAULT 50,
        price_minor_units INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    INSERT OR IGNORE INTO regional_coin_prices
        (country_code, country_name, currency_code, currency_symbol, coins_per_package, price_minor_units)
    VALUES
        ('NG', 'Nigeria', 'NGN', '?', 50, 70000),
        ('GH', 'Ghana', 'GHS', 'GH?', 50, NULL),
        ('ZA', 'South Africa', 'ZAR', 'R', 50, NULL),
        ('US', 'United States', 'USD', '$', 50, NULL);
`);

console.log("Regional XMD Coin pricing schema is ready.");
// Correct legacy regional coin currency symbols once.
db.prepare(`
    UPDATE regional_coin_prices
    SET currency_symbol = CASE country_code
        WHEN 'NG' THEN ?
        WHEN 'GH' THEN ?
        ELSE currency_symbol
    END
    WHERE
        (country_code = 'NG' AND currency_symbol IN ('?', 'â‚¦'))
        OR
        (country_code = 'GH' AND currency_symbol = 'GH?')
`).run("\u20A6", "GH\u20B5");


// ==========================================
// GLOBAL USD MASTER PRICING AND FX SNAPSHOTS
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS xmd_coin_master_pricing (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        coins_per_package INTEGER NOT NULL DEFAULT 50
            CHECK(coins_per_package > 0),
        usd_price_minor_units INTEGER
            CHECK(usd_price_minor_units IS NULL OR usd_price_minor_units > 0),
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    INSERT OR IGNORE INTO xmd_coin_master_pricing (
        id, coins_per_package, usd_price_minor_units
    ) VALUES (1, 50, NULL);

    CREATE TABLE IF NOT EXISTS xmd_coin_exchange_rates (
        currency_code TEXT PRIMARY KEY,
        currency_symbol TEXT NOT NULL,
        rate_per_usd REAL NOT NULL CHECK(rate_per_usd > 0),
        rate_date TEXT NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);

// Preserve the exact USD price and exchange-rate snapshot for each purchase.
const xmdCoinSnapshotColumns = {
    coin_transactions: [
        ["base_currency_code", "TEXT"],
        ["base_amount_minor_units", "INTEGER"],
        ["exchange_rate", "REAL"],
        ["exchange_rate_date", "TEXT"],
        ["exchange_rate_source", "TEXT"],
        ["currency_exponent", "INTEGER"]
    ],
    xmd_coin_payment_intents: [
        ["base_currency_code", "TEXT"],
        ["base_amount_minor_units", "INTEGER"],
        ["exchange_rate", "REAL"],
        ["exchange_rate_date", "TEXT"],
        ["exchange_rate_source", "TEXT"],
        ["currency_exponent", "INTEGER"]
    ]
};

for (const [tableName, columns] of Object.entries(xmdCoinSnapshotColumns)) {
    const existingColumns = db.pragma(`table_info(${tableName})`)
        .map(column => column.name);

    for (const [columnName, columnType] of columns) {
        if (!existingColumns.includes(columnName)) {
            db.exec(
                `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`
            );
        }
    }
}

console.log("Global USD XMD Coin pricing schema is ready.");
// REGIONAL SUBSCRIPTION PRICING
db.exec("\nCREATE TABLE IF NOT EXISTS regional_subscription_prices (\n    country_code TEXT NOT NULL,\n    country_name TEXT NOT NULL,\n    plan_id INTEGER NOT NULL,\n    currency_code TEXT NOT NULL,\n    currency_symbol TEXT NOT NULL,\n    currency_exponent INTEGER NOT NULL DEFAULT 2,\n    price_minor_units INTEGER,\n    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),\n    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,\n    updated_by INTEGER,\n    PRIMARY KEY (country_code, plan_id),\n    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),\n    FOREIGN KEY (updated_by) REFERENCES users(id)\n);\n\nINSERT OR IGNORE INTO regional_subscription_prices (\n    country_code, country_name, plan_id,\n    currency_code, currency_symbol, currency_exponent,\n    price_minor_units\n)\nSELECT\n    'NG', 'Nigeria', id,\n    'NGN', '₦', 2,\n    price_kobo\nFROM subscription_plans;\n");
console.log("Regional subscription pricing schema is ready.");
// ==========================================
// GLOBAL USD SUBSCRIPTION MASTER PRICING
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS subscription_plan_usd_prices (
        plan_id INTEGER PRIMARY KEY,
        usd_price_minor_units INTEGER
            CHECK (
                usd_price_minor_units IS NULL OR
                usd_price_minor_units > 0
            ),
        is_active INTEGER NOT NULL DEFAULT 1
            CHECK (is_active IN (0, 1)),
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
    )
`);

console.log("Global USD subscription pricing schema is ready.");
db.exec("CREATE TABLE IF NOT EXISTS customer_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, event_type TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))"); db.exec("CREATE INDEX IF NOT EXISTS idx_customer_activity_user ON customer_activity(user_id, created_at)");


// ==========================================
// OLU-XMD COMBINED HOSTING PACKAGE SCHEMA V1
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS xmd_hosting_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_code TEXT NOT NULL UNIQUE,
        package_name TEXT NOT NULL,
        coins INTEGER NOT NULL CHECK(coins > 0),
        usd_price_minor_units INTEGER
            CHECK(usd_price_minor_units IS NULL OR usd_price_minor_units > 0),
        cpu_millicores INTEGER
            CHECK(cpu_millicores IS NULL OR cpu_millicores > 0),
        ram_mb INTEGER
            CHECK(ram_mb IS NULL OR ram_mb > 0),
        storage_gb INTEGER
            CHECK(storage_gb IS NULL OR storage_gb > 0),
        bot_slots INTEGER
            CHECK(bot_slots IS NULL OR bot_slots >= 0),
        duration_days INTEGER NOT NULL DEFAULT 30
            CHECK(duration_days > 0),
        is_active INTEGER NOT NULL DEFAULT 0
            CHECK(is_active IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    INSERT OR IGNORE INTO xmd_hosting_packages
        (package_code, package_name, coins, duration_days, is_active, sort_order)
    VALUES
        ('STARTER', 'Starter', 50, 30, 0, 1),
        ('BASIC', 'Basic', 100, 30, 0, 2),
        ('STANDARD', 'Standard', 150, 30, 0, 3),
        ('PRO', 'Pro', 200, 30, 0, 4),
        ('PREMIUM', 'Premium', 500, 30, 0, 5);

    CREATE INDEX IF NOT EXISTS idx_xmd_hosting_packages_active
        ON xmd_hosting_packages(is_active, sort_order);

    CREATE TABLE IF NOT EXISTS hosting_entitlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        package_id INTEGER,
        payment_reference TEXT NOT NULL UNIQUE,
        package_code_snapshot TEXT NOT NULL,
        package_name_snapshot TEXT NOT NULL,
        coins_included INTEGER NOT NULL CHECK(coins_included > 0),
        currency_code TEXT NOT NULL,
        paid_amount_minor_units INTEGER NOT NULL CHECK(paid_amount_minor_units > 0),
        base_currency_code TEXT NOT NULL DEFAULT 'USD',
        base_amount_minor_units INTEGER NOT NULL CHECK(base_amount_minor_units > 0),
        exchange_rate REAL,
        cpu_millicores INTEGER NOT NULL CHECK(cpu_millicores > 0),
        ram_mb INTEGER NOT NULL CHECK(ram_mb > 0),
        storage_gb INTEGER NOT NULL CHECK(storage_gb > 0),
        bot_slots INTEGER NOT NULL CHECK(bot_slots >= 0),
        duration_days INTEGER NOT NULL CHECK(duration_days > 0),
        status TEXT NOT NULL DEFAULT 'pending_provisioning'
            CHECK(status IN (
                'pending_provisioning',
                'active',
                'provisioning_failed',
                'suspended',
                'expired',
                'cancelled'
            )),
        provisioning_status TEXT NOT NULL DEFAULT 'not_started'
            CHECK(provisioning_status IN (
                'not_started',
                'pending',
                'provisioned',
                'failed',
                'stopped'
            )),
        starts_at TEXT,
        expires_at TEXT,
        provisioned_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (package_id) REFERENCES xmd_hosting_packages(id),
        FOREIGN KEY (payment_reference)
            REFERENCES xmd_coin_payment_intents(reference)
    );

    CREATE INDEX IF NOT EXISTS idx_hosting_entitlements_user
        ON hosting_entitlements(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_hosting_entitlements_expiry
        ON hosting_entitlements(status, expires_at);
`);

// Preserve package details on each payment intent.
// These snapshots ensure later Owner edits cannot change past purchases.
const xmdHostingIntentColumns = [
    ["package_id", "INTEGER"],
    ["package_code_snapshot", "TEXT"],
    ["package_name_snapshot", "TEXT"],
    ["hosting_cpu_millicores", "INTEGER"],
    ["hosting_ram_mb", "INTEGER"],
    ["hosting_storage_gb", "INTEGER"],
    ["hosting_bot_slots", "INTEGER"],
    ["hosting_duration_days", "INTEGER"]
];

const xmdHostingExistingColumns = db
    .pragma("table_info(xmd_coin_payment_intents)")
    .map(column => column.name);

for (const [columnName, columnType] of xmdHostingIntentColumns) {
    if (!xmdHostingExistingColumns.includes(columnName)) {
        db.exec(
            `ALTER TABLE xmd_coin_payment_intents ADD COLUMN ${columnName} ${columnType}`
        );
    }
}

console.log("OLU-XMD combined hosting package schema is ready.");

// ==========================================
// GOOGLE OAUTH IDENTITY STORAGE
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL
            CHECK(provider IN ('google')),
        provider_subject TEXT NOT NULL,
        email TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0
            CHECK(email_verified IN (0, 1)),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(provider, provider_subject),
        UNIQUE(user_id, provider)
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_identities_user
        ON oauth_identities(user_id);
`);

console.log("OLU-XMD Google OAuth identity schema is ready.");

