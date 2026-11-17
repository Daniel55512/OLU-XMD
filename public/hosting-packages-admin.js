"use strict";

(function () {
    const grid = document.getElementById("hostingPackagesAdminGrid");
    const message = document.getElementById("hostingPackagesAdminMessage");

    if (!grid || !message) return;

    function makeField(parent, definition, value) {
        const wrapper = document.createElement("label");
        wrapper.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:inherit;";

        const caption = document.createElement("span");
        caption.textContent = definition.label;

        const input = document.createElement("input");
        input.type = definition.type || "number";
        input.dataset.field = definition.key;
        input.value = value === null || value === undefined ? "" : String(value);
        input.required = true;

        if (definition.type !== "text") {
            input.min = definition.min || "1";
            input.step = definition.step || "1";
        } else {
            input.maxLength = 50;
        }

        input.style.cssText = "width:100%;box-sizing:border-box;padding:10px;border:1px solid #465AA8;border-radius:7px;background:#fff;color:#172052;";

        wrapper.append(caption, input);
        parent.appendChild(wrapper);
        return input;
    }

    function makeCard(item) {
        const card = document.createElement("article");
        card.className = "panel";
        card.style.cssText = "margin:0;padding:18px;border:1px solid #465AA8;";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;";

        const title = document.createElement("h3");
        title.textContent = item.package_name;
        title.style.margin = "0";

        const status = document.createElement("span");
        status.textContent = "DRAFT";
        status.style.cssText = "background:#FFF3D6;color:#805500;padding:5px 9px;border-radius:20px;font-size:11px;font-weight:800;";

        header.append(title, status);
        card.appendChild(header);

        const code = document.createElement("p");
        code.textContent = item.package_code + " · Not available for purchase";
        code.style.cssText = "font-size:12px;color:#64748b;margin:8px 0 15px;";
        card.appendChild(code);

        const fields = document.createElement("div");
        fields.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:12px;";

        makeField(fields, {
            key: "packageName",
            label: "Package name",
            type: "text"
        }, item.package_name);

        makeField(fields, {
            key: "coins",
            label: "XMD Coins",
            min: "1"
        }, item.coins);

        makeField(fields, {
            key: "usdPrice",
            label: "USD master price ($)",
            min: "0.01",
            step: "0.01"
        }, item.usdPrice === null ? "" : Number(item.usdPrice).toFixed(2));

        makeField(fields, {
            key: "cpuVcpu",
            label: "CPU (vCPU)",
            min: "0.001",
            step: "0.001"
        }, item.cpu_millicores === null ? "" : Number(item.cpu_millicores) / 1000);

        makeField(fields, {
            key: "ramMb",
            label: "RAM (MB)",
            min: "1"
        }, item.ram_mb);

        makeField(fields, {
            key: "storageGb",
            label: "Storage (GB)",
            min: "1"
        }, item.storage_gb);

        makeField(fields, {
            key: "botSlots",
            label: "Bot slots",
            min: "1"
        }, item.bot_slots);

        makeField(fields, {
            key: "durationDays",
            label: "Hosting duration (days)",
            min: "1"
        }, item.duration_days);

        card.appendChild(fields);

        const previewTitle = document.createElement("h4");
        previewTitle.textContent = "Local price previews";
        previewTitle.style.margin = "18px 0 8px";
        card.appendChild(previewTitle);

        const preview = document.createElement("div");
        preview.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";

        (item.localPrices || []).forEach(price => {
            const chip = document.createElement("span");
            chip.textContent = price.currencyCode + ": " + price.formattedPrice;
            chip.style.cssText = "padding:6px 9px;background:#eef2ff;color:#24366F;border-radius:7px;font-size:12px;";
            preview.appendChild(chip);
        });

        card.appendChild(preview);

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Save package draft";
        button.style.cssText = "margin-top:16px;background:#132563;color:#fff;padding:11px 16px;border:0;border-radius:7px;cursor:pointer;width:100%;font-weight:700;";

        const feedback = document.createElement("p");
        feedback.setAttribute("role", "status");
        feedback.style.cssText = "font-size:12px;margin:10px 0 0;";

        button.addEventListener("click", async function () {
            const value = key => card.querySelector('[data-field="' + key + '"]').value.trim();

            const packageName = value("packageName");
            const coins = Number(value("coins"));
            const usd = Number(value("usdPrice"));
            const cpuVcpu = Number(value("cpuVcpu"));
            const cpuMillicores = Math.round(cpuVcpu * 1000);
            const ramMb = Number(value("ramMb"));
            const storageGb = Number(value("storageGb"));
            const botSlots = Number(value("botSlots"));
            const durationDays = Number(value("durationDays"));
            const usdPriceMinorUnits = Math.round(usd * 100);

            if (
                !packageName ||
                packageName.length > 50 ||
                !Number.isSafeInteger(coins) || coins < 1 ||
                !Number.isFinite(usd) || usd <= 0 ||
                !Number.isSafeInteger(usdPriceMinorUnits) || usdPriceMinorUnits < 1 ||
                !Number.isFinite(cpuVcpu) || cpuVcpu <= 0 ||
                !Number.isSafeInteger(cpuMillicores) || cpuMillicores < 1 ||
                !Number.isSafeInteger(ramMb) || ramMb < 1 ||
                !Number.isSafeInteger(storageGb) || storageGb < 1 ||
                !Number.isSafeInteger(botSlots) || botSlots < 1 ||
                !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650
            ) {
                feedback.textContent = "Check all fields. Enter valid positive values.";
                feedback.style.color = "#b91c1c";
                return;
            }

            button.disabled = true;
            button.textContent = "Saving draft...";
            feedback.textContent = "";

            try {
                const response = await fetch("/api/admin/hosting-packages/" + item.id, {
                    method: "PUT",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        packageName,
                        coins,
                        usdPriceMinorUnits,
                        cpuMillicores,
                        ramMb,
                        storageGb,
                        botSlots,
                        durationDays
                    })
                });

                if (response.status === 401 || response.status === 403) {
                    window.location.replace("/owner-login.html");
                    return;
                }

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.message || "Unable to save package.");
                }

                feedback.textContent = result.message;
                feedback.style.color = "#166534";
                await loadPackages();

            } catch (error) {
                feedback.textContent = error.message || "Unable to save package.";
                feedback.style.color = "#b91c1c";
            } finally {
                button.disabled = false;
                button.textContent = "Save package draft";
            }
        });

        card.append(button, feedback);
        return card;
    }

    async function loadPackages() {
        message.textContent = "Loading Owner package settings...";
        grid.replaceChildren();

        try {
            const response = await fetch("/api/admin/hosting-packages", {
                credentials: "same-origin",
                cache: "no-store"
            });

            if (response.status === 401 || response.status === 403) {
                window.location.replace("/owner-login.html");
                return;
            }

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Unable to load packages.");
            }

            if (!Array.isArray(result.packages) || result.packages.length === 0) {
                message.textContent = "No hosting packages found.";
                return;
            }

            result.packages.forEach(item => {
                grid.appendChild(makeCard(item));
            });

            message.textContent =
                "Five package records loaded. All remain drafts and unavailable for customer purchase.";

        } catch (error) {
            message.textContent = error.message || "Unable to load package settings.";
        }
    }

    loadPackages();
})();