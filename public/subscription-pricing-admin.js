// ==========================================
// OWNER GLOBAL USD SUBSCRIPTION PRICING
// ==========================================

let subscriptionUsdPricingData = {
    plans: []
};

function escapeSubscriptionUsdHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

async function loadSubscriptionUsdPricing() {
    const message = document.getElementById("subscriptionUsdPricingMessage");
    const grid = document.getElementById("subscriptionUsdPlansGrid");

    if (!message || !grid) return;

    message.textContent = "Loading global USD subscription prices...";
    grid.innerHTML = "";

    try {
        const response = await fetch("/api/admin/subscription-usd-pricing", {
            credentials: "same-origin",
            cache: "no-store"
        });

        if (response.status === 401 || response.status === 403) {
            window.location.replace("/owner-login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Unable to load USD subscription prices."
            );
        }

        subscriptionUsdPricingData = {
            plans: Array.isArray(data.plans) ? data.plans : []
        };

        renderSubscriptionUsdPlans();

        message.textContent =
            "Loaded " + subscriptionUsdPricingData.plans.length +
            " subscription plans. Enter one USD master price for each plan.";

    } catch (error) {
        console.error("USD subscription pricing load error:", error);
        message.textContent =
            error.message || "Unable to load USD subscription prices.";
    }
}

function renderSubscriptionUsdPlans() {
    const grid = document.getElementById("subscriptionUsdPlansGrid");

    if (!grid) return;

    grid.innerHTML = "";

    if (subscriptionUsdPricingData.plans.length === 0) {
        grid.textContent = "No subscription plans were found.";
        return;
    }

    subscriptionUsdPricingData.plans.forEach(plan => {
        const planId = Number(plan.id);

        const hasPrice =
            plan.usd_price_minor_units !== null &&
            plan.usd_price_minor_units !== undefined;

        const usdAmount = hasPrice
            ? (Number(plan.usd_price_minor_units) / 100).toFixed(2)
            : "";

        const isActive = Number(plan.price_is_active ?? 1) === 1;

        const previews = Array.isArray(plan.previews)
            ? plan.previews
            : [];

        const previewHTML = previews.map(preview => {
            const currency = escapeSubscriptionUsdHTML(
                preview.currency_code
            );

            const formatted = escapeSubscriptionUsdHTML(
                preview.formatted_price || "Exchange rate unavailable"
            );

            const rateDate = preview.rate_date
                ? "Rate date: " + escapeSubscriptionUsdHTML(preview.rate_date)
                : "";

            return `
                <div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #334155;">
                    <span style="color:#cbd5e1;">${currency}</span>
                    <strong style="color:#fff;text-align:right;">${formatted}</strong>
                </div>
                ${rateDate ? `
                    <p style="margin:3px 0 7px;color:#64748b;font-size:11px;">
                        ${rateDate}
                    </p>
                ` : ""}
            `;
        }).join("");

        const card = document.createElement("div");

        card.style.cssText =
            "background:#111c35;border:1px solid #334155;border-radius:14px;padding:20px;";

        card.innerHTML = `
            <h3 style="margin:0 0 6px;color:#fff;font-size:18px;">
                ${escapeSubscriptionUsdHTML(plan.name)}
            </h3>

            <p style="margin:0 0 18px;color:#94a3b8;font-size:13px;">
                ${Number(plan.duration_days)} days
                · ${Number(plan.is_active) === 1 ? "Plan enabled" : "Plan disabled"}
            </p>

            <label for="subscriptionUsdPrice${planId}"
                   style="display:block;margin-bottom:7px;color:#e2e8f0;font-weight:600;">
                Master subscription price (USD)
            </label>

            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#fff;font-size:18px;font-weight:700;">$</span>
                <input
                    id="subscriptionUsdPrice${planId}"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value="${escapeSubscriptionUsdHTML(usdAmount)}"
                    placeholder="Enter USD price"
                    style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #475569;border-radius:9px;background:#0f172a;color:#fff;"
                />
            </div>

            <label style="display:flex;align-items:center;gap:9px;margin-top:17px;color:#e2e8f0;">
                <input
                    id="subscriptionUsdActive${planId}"
                    type="checkbox"
                    ${isActive ? "checked" : ""}
                />
                Enable this USD price
            </label>

            <div style="margin-top:20px;padding:14px;background:#0f172a;border-radius:10px;">
                <h4 style="margin:0 0 10px;color:#fff;font-size:14px;">
                    Local currency previews
                </h4>

                ${previewHTML || `
                    <p style="color:#94a3b8;font-size:13px;">
                        Save a USD price to preview converted amounts.
                    </p>
                `}
            </div>

            <button
                id="saveSubscriptionUsdPlan${planId}"
                type="button"
                onclick="saveSubscriptionUsdPrice(${planId})"
                style="width:100%;margin-top:18px;padding:12px;border:0;border-radius:9px;background:#3156D9;color:#fff;font-weight:700;cursor:pointer;"
            >
                Save USD Price
            </button>
        `;

        grid.appendChild(card);
    });
}

async function saveSubscriptionUsdPrice(planId) {
    const message = document.getElementById("subscriptionUsdPricingMessage");

    const plan = subscriptionUsdPricingData.plans.find(
        item => Number(item.id) === Number(planId)
    );

    const priceInput = document.getElementById(
        "subscriptionUsdPrice" + planId
    );

    const activeInput = document.getElementById(
        "subscriptionUsdActive" + planId
    );

    const saveButton = document.getElementById(
        "saveSubscriptionUsdPlan" + planId
    );

    if (!plan || !priceInput || !activeInput || !saveButton) {
        message.textContent = "Unable to find the selected subscription plan.";
        return;
    }

    const amount = priceInput.value.trim();

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        message.textContent =
            "Enter a valid USD price with no more than two decimal places.";
        return;
    }

    const usdPriceMinorUnits = Math.round(Number(amount) * 100);

    if (
        !Number.isSafeInteger(usdPriceMinorUnits) ||
        usdPriceMinorUnits < 1
    ) {
        message.textContent = "Enter a valid positive USD price.";
        return;
    }

    const isActive = activeInput.checked;

    message.textContent = "Saving " + plan.name + " USD master price...";

    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    try {
        const response = await fetch(
            "/api/admin/subscription-usd-pricing/" +
            encodeURIComponent(planId),
            {
                method: "PUT",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    usdPriceMinorUnits,
                    isActive
                })
            }
        );

        if (response.status === 401 || response.status === 403) {
            window.location.replace("/owner-login.html");
            return;
        }

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Unable to save the USD master price."
            );
        }

        message.textContent =
            plan.name + " USD master price saved. Refreshing previews...";

        await loadSubscriptionUsdPricing();

    } catch (error) {
        console.error("USD subscription price save error:", error);

        message.textContent =
            error.message || "Unable to save the USD master price.";

        saveButton.disabled = false;
        saveButton.textContent = "Save USD Price";
    }
}
