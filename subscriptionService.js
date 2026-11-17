const db = require("./database");

// GET CUSTOMER SUBSCRIPTION STATUS
function getSubscriptionStatus(userId) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Invalid customer ID.");
    }

    const subscription = db.prepare(`
        SELECT
            s.id,
            s.user_id,
            s.starts_at,
            s.expires_at,
            s.status,
            p.name AS plan_name,
            p.code AS plan_code,
            p.duration_days
        FROM subscriptions s
        JOIN subscription_plans p
            ON p.id = s.plan_id
        WHERE s.user_id = ?
        ORDER BY s.id DESC
        LIMIT 1
    `).get(id);

    if (!subscription) {
        return {
            hasSubscription: false,
            status: "not_started",
            accessAllowed: false,
            subscription: null
        };
    }

    const startTime = Date.parse(subscription.starts_at);
    const expiryTime = Date.parse(subscription.expires_at);
    const now = Date.now();

    let status = subscription.status;

    if (!Number.isFinite(startTime) ||
        !Number.isFinite(expiryTime)) {
        status = "invalid";
    } else if (expiryTime <= now && status === "active") {
        db.prepare(`
            UPDATE subscriptions
            SET status = 'expired'
            WHERE id = ?
        `).run(subscription.id);

        status = "expired";
    } else if (startTime > now && status === "active") {
        status = "scheduled";
    }

    const accessAllowed =
        status === "active" &&
        startTime <= now &&
        expiryTime > now;

    return {
        hasSubscription: true,
        status,
        accessAllowed,
        subscription
    };
}

// CHECK WHETHER CUSTOMER CAN USE PAID FEATURES
function hasActiveSubscription(userId) {
    return getSubscriptionStatus(userId).accessAllowed;
}

module.exports = {
    getSubscriptionStatus,
    hasActiveSubscription
};