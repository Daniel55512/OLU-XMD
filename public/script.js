console.log("OLU-XMD Dashboard loaded!");

// Show account links based on login session
async function updateAccountMenu() {
    const loginButton = document.getElementById("loginButton");
    const logoutButton = document.getElementById("logoutButton");
    const ownerPanelLink = document.getElementById("ownerPanelLink");
    const accountProfileName = document.getElementById("accountProfileName");
    const accountProfileEmail = document.getElementById("accountProfileEmail");

    try {
        const response = await fetch("/api/session", {
            credentials: "same-origin",
            cache: "no-store"
        });

        const result = await response.json();
        const loggedIn = response.ok && result.success && result.loggedIn;

        if (accountProfileName) {
            accountProfileName.textContent =
                loggedIn ? (result.name || "Customer") : "Not signed in";
        }

        if (accountProfileEmail) {
            accountProfileEmail.textContent =
                loggedIn ? (result.email || "") : "Log in to view your account";
        }

        if (loginButton) loginButton.style.display = loggedIn ? "none" : "";
        if (logoutButton) logoutButton.style.display = loggedIn ? "" : "none";

        if (ownerPanelLink) {
            const isOwner = loggedIn && result.role === "owner";

            ownerPanelLink.style.display = isOwner ? "" : "none";

            if (isOwner) {
                ownerPanelLink.textContent = "Owner Panel";
                ownerPanelLink.href = "admin.html";
            }
        }

        const welcomeMessage = document.getElementById("welcomeMessage");

        if (welcomeMessage && loggedIn && result.name) {
            welcomeMessage.textContent =
                "Welcome back, " + result.name + "! \u{1F44B}";
        }
    } catch (error) {
        if (loginButton) loginButton.style.display = "";
        if (accountProfileName) accountProfileName.textContent = "Account unavailable";
        if (accountProfileEmail) accountProfileEmail.textContent = "Please refresh the page";
        if (logoutButton) logoutButton.style.display = "none";

        if (ownerPanelLink) {
            ownerPanelLink.style.display = "";
            ownerPanelLink.textContent = "Owner Login";
            ownerPanelLink.href = "owner-login.html";
        }
    }
}

updateAccountMenu();

// OLU-XMD GLOBAL SIDEBAR NAVIGATION
(function () {
    const storageKey = "oluXmdSidebarCollapsed";

    function initSidebar() {
        const menuLinks = document.querySelectorAll(".sidebar a");
        const toggle = document.getElementById("desktopSidebarToggle");

        function updateToggle() {
            const collapsed = document.body.classList.contains(
                "desktop-sidebar-collapsed"
            );

            if (toggle) {
                toggle.textContent = collapsed ? ">" : "<";
                toggle.setAttribute("aria-expanded", String(!collapsed));
                toggle.setAttribute(
                    "aria-label",
                    collapsed ? "Show navigation" : "Hide navigation"
                );
                toggle.title = collapsed ? "Show sidebar" : "Hide sidebar";
            }
        }

        if (window.innerWidth > 768) {
            document.body.classList.toggle(
                "desktop-sidebar-collapsed",
                localStorage.getItem(storageKey) === "true"
            );
        }

        if (toggle && !toggle.dataset.sidebarReady) {
            toggle.dataset.sidebarReady = "true";

            toggle.addEventListener("click", function () {
                const collapsed = document.body.classList.toggle(
                    "desktop-sidebar-collapsed"
                );

                localStorage.setItem(storageKey, String(collapsed));
                updateToggle();
            });
        }

        updateToggle();

        menuLinks.forEach(link => {
            if (link.dataset.sidebarReady) return;
            link.dataset.sidebarReady = "true";

            link.addEventListener("click", function (event) {
                const destination = this.getAttribute("href");

                if (!destination || destination === "#") {
                    event.preventDefault();
                }

                if (window.innerWidth > 768) {
                    document.body.classList.add(
                        "desktop-sidebar-collapsed"
                    );
                    localStorage.setItem(storageKey, "true");
                    updateToggle();
                }
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initSidebar, {
            once: true
        });
    } else {
        initSidebar();
    }
})();

// Load customer wallet balance
async function loadDashboardWallet() {
    const balanceElement =
        document.getElementById("dashboardBalance");

    const transactionsElement =
        document.getElementById("recentTransactions");

    try {
        const response = await fetch("/api/wallet");
        const result = await response.json();

        if (!response.ok) {
            if (balanceElement) {
                balanceElement.textContent = "Login required";
            }

            if (transactionsElement) {
                transactionsElement.textContent =
                    "Please login first.";
            }

            return;
        }

        if (balanceElement) {
            balanceElement.textContent =
                String(result.currencySymbol || result.currencyCode || "NGN") + " " + (Number(result.balance || 0) / 100).toFixed(2);
        }

        if (transactionsElement) {
            transactionsElement.innerHTML = "";

            const transactions = Array.isArray(result.transactions)
                ? result.transactions
                : [];

            if (transactions.length === 0) {
                transactionsElement.textContent =
                    "No transactions yet.";
            } else {
                transactions.slice(0, 3).forEach(transaction => {
                    const item = document.createElement("p");

                    item.textContent =
                        transaction.type + " - " +
                        String(result.currencySymbol || result.currencyCode || "NGN") + " " +
                        (Number(transaction.amount || 0) / 100).toFixed(2) +
                        " \u2014 " +
                        String(transaction.status || "pending").toUpperCase(); 

                    transactionsElement.appendChild(item);
                });
            }
        }

    } catch (error) {
        console.error("Dashboard wallet error:", error);

        if (balanceElement) {
            balanceElement.textContent = "Unable to load";
        }

        if (transactionsElement) {
            transactionsElement.textContent =
                "Could not load transactions.";
        }
    }
}

loadDashboardWallet();
// Load live WhatsApp connection status
async function loadBotStatus() {
    const statusElement = document.getElementById("botStatus");
    const headerStatus = document.getElementById("botHeaderStatus");

    if (!statusElement) return;

    try {
        const response = await fetch("/api/whatsapp/status");
        const result = await response.json();

        const labels = {
            connected: "Bot Online",
            connecting: "Bot Connecting",
            disconnected: "Bot Offline",
            stopped: "Bot Offline",
            unavailable: "Bot Unavailable"
        };

        const status = response.ok
            ? (labels[result.status] || "Bot Unavailable")
            : "Bot Unavailable";

        statusElement.textContent = status;

        if (headerStatus) {
            headerStatus.textContent = String.fromCharCode(9679) + " " + status;
        }
    } catch (error) {
        console.error("Bot status error:", error);
        statusElement.textContent = "Bot Unavailable";

        if (headerStatus) {
            headerStatus.textContent = String.fromCharCode(9679) + " Bot Unavailable";
        }
    }
}
async function loadConnectedNumber() {
    const numberElement = document.getElementById("connectedNumber");

    if (!numberElement) return;

    try {
        const response = await fetch("/api/whatsapp/number");
        const result = await response.json();

        numberElement.textContent =
            result.success && result.number
                ? result.number
                : "Not connected";

    } catch (error) {
        console.error("WhatsApp number error:", error);
        numberElement.textContent = "Unable to load";
    }
}
loadConnectedNumber();
setInterval(loadConnectedNumber, 5000);
loadBotStatus();
setInterval(loadBotStatus, 5000);
// Load public server status
async function loadSystemStatus() {
    const systemStatus = document.getElementById("systemStatus");

    if (!systemStatus) return;

    try {
        const response = await fetch("/api/server/status", {
            cache: "no-store"
        });
        const result = await response.json();

        systemStatus.textContent =
            response.ok && result.status === "online"
                ? String.fromCharCode(9679) + " Server Online"
                : String.fromCharCode(9679) + " Server Offline";
    } catch (error) {
        systemStatus.textContent = String.fromCharCode(9679) + " Server Offline";
    }
}

loadSystemStatus();
setInterval(loadSystemStatus, 5000);
// RECONNECT SAVED WHATSAPP
const reconnectButton = document.getElementById("reconnectWhatsAppBtn");
const connectionMessage = document.getElementById("connectionMessage");

if (reconnectButton) {
    reconnectButton.addEventListener("click", async () => {
        reconnectButton.disabled = true;
        reconnectButton.textContent = "Reconnecting...";

        if (connectionMessage) {
            connectionMessage.textContent = "Starting WhatsApp reconnection...";
        }

        try {
            const response = await fetch("/api/whatsapp/reconnect", {
                method: "POST"
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Reconnection failed.");
            }

            if (connectionMessage) {
                connectionMessage.textContent =
                    "Reconnection started. Please wait for WhatsApp to connect.";
            }

            setTimeout(loadBotStatus, 3000);
            setTimeout(loadConnectedNumber, 3000);

        } catch (error) {
            if (connectionMessage) {
                connectionMessage.textContent = error.message;
            }
        } finally {
            reconnectButton.disabled = false;
            reconnectButton.textContent = "Reconnect Saved WhatsApp";
        }
    });
}
// Load customer subscription status on My Bot page
async function loadBotSubscription() {
    const subscriptionElement =
        document.getElementById("botSubscription");

    if (!subscriptionElement) return;

    try {
        const response = await fetch("/api/subscription/me");
        const result = await response.json();

        if (!response.ok || !result.success) {
            subscriptionElement.textContent = "Unable to load";
            return;
        }

        subscriptionElement.textContent = result.accessAllowed
            ? "PREMIUM ACTIVE"
            : "FREE PLAN";

    } catch (error) {
        console.error("Subscription status error:", error);
        subscriptionElement.textContent = "Unable to load";
    }
}

loadBotSubscription();

// Customer logout - ends login session only
const logoutButton = document.getElementById("logoutButton");

if (logoutButton) {
    logoutButton.addEventListener("click", async (event) => {
        event.preventDefault();

        try {
            const response = await fetch("/api/logout", {
                method: "POST"
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Logout failed.");
            }

            window.location.href = "login.html";

        } catch (error) {
            alert(error.message || "Could not log out.");
        }
    });
}



// OLU-XMD DASHBOARD WHATSAPP ONBOARDING
(function () {
    const pairButton = document.getElementById("dashboardPairButton");
    const reconnectButton = document.getElementById("dashboardReconnectButton");
    const phoneInput = document.getElementById("dashboardPhoneNumber");
    const message = document.getElementById("dashboardConnectionMessage");
    const codeDisplay = document.getElementById("dashboardPairingCode");
    const statusDisplay = document.getElementById("dashboardConnectionStatus");

    if (!pairButton || !reconnectButton) return;

    let actionRunning = false;

    async function refreshDashboardWhatsAppStatus() {
        try {
            const response = await fetch("/api/whatsapp/status", {
                cache: "no-store"
            });
            const result = await response.json();

            const labels = {
                connected: "Connected",
                connecting: "Connecting...",
                disconnected: "Disconnected",
                stopped: "Bot Stopped",
                unavailable: "Not Connected"
            };

            const status = response.ok
                ? (labels[result.status] || "Unavailable")
                : "Unavailable";

            if (statusDisplay) {
                statusDisplay.textContent = status;
            }

            if (message &&
                message.textContent === "Checking your WhatsApp connection...") {
                message.textContent = result.status === "connected"
                    ? "Your WhatsApp is connected successfully."
                    : result.status === "connecting"
                        ? "Your saved WhatsApp session is connecting..."
                        : "Enter your WhatsApp number to get started, or reconnect a saved session.";
            }
        } catch (error) {
            if (statusDisplay) {
                statusDisplay.textContent = "Unable to check";
            }
        }
    }

    pairButton.addEventListener("click", async function () {
        if (actionRunning) return;

        const phoneNumber = phoneInput.value.trim();

        if (!phoneNumber) {
            message.textContent = "Please enter your WhatsApp number with country code.";
            phoneInput.focus();
            return;
        }

        actionRunning = true;
        pairButton.disabled = true;
        reconnectButton.disabled = true;
        pairButton.textContent = "Generating Code...";
        message.textContent = "Requesting your WhatsApp pairing code...";
        codeDisplay.textContent = "";

        try {
            const response = await fetch("/api/whatsapp/pair", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ phoneNumber })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Unable to generate pairing code.");
            }

            codeDisplay.textContent = result.pairingCode || "";
            message.textContent =
                "Pairing code generated. Open WhatsApp, go to Linked Devices, select Link a Device, then Link with phone number, and enter the code.";

            refreshDashboardWhatsAppStatus();

        } catch (error) {
            message.textContent = error.message;

            if (error.message.toLowerCase().includes("already registered")) {
                message.textContent += " Please use Reconnect Saved WhatsApp instead.";
            }
        } finally {
            actionRunning = false;
            pairButton.disabled = false;
            reconnectButton.disabled = false;
            pairButton.textContent = "Generate Pairing Code";
        }
    });

    reconnectButton.addEventListener("click", async function () {
        if (actionRunning) return;

        actionRunning = true;
        reconnectButton.disabled = true;
        pairButton.disabled = true;
        reconnectButton.textContent = "Reconnecting...";
        message.textContent = "Reconnecting your saved WhatsApp session...";
        codeDisplay.textContent = "";

        try {
            const response = await fetch("/api/whatsapp/reconnect", {
                method: "POST"
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "WhatsApp reconnection failed.");
            }

            message.textContent =
                "Reconnection started. Your WhatsApp connection status will update automatically.";

            setTimeout(refreshDashboardWhatsAppStatus, 3000);
            setTimeout(loadBotStatus, 3000);
            setTimeout(loadConnectedNumber, 3000);

        } catch (error) {
            message.textContent = error.message;
        } finally {
            actionRunning = false;
            reconnectButton.disabled = false;
            pairButton.disabled = false;
            reconnectButton.textContent = "Reconnect Saved WhatsApp";
        }
    });

    refreshDashboardWhatsAppStatus();
    setInterval(refreshDashboardWhatsAppStatus, 5000);
})();/* OLU-XMD MOBILE NAVIGATION - UPDATED */
(function () {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    const profileMenu = document.querySelector(".profile-menu");
    const profileTrigger = document.querySelector(".profile-trigger");
    const header = document.querySelector(".header");

    const overlay = document.createElement("div");
    overlay.className = "mobile-nav-overlay";
    document.body.appendChild(overlay);

    let menuTrigger = profileTrigger;

    if (!menuTrigger && header) {
        menuTrigger = document.createElement("button");
        menuTrigger.type = "button";
        menuTrigger.className = "mobile-menu-trigger";
        menuTrigger.setAttribute("aria-label", "Open navigation");
        menuTrigger.innerHTML = "&#9776;";
        header.insertBefore(menuTrigger, header.firstChild);
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mobile-sidebar-close";
    closeButton.setAttribute("aria-label", "Close navigation");
    closeButton.textContent = "×";
    sidebar.insertBefore(closeButton, sidebar.firstChild);

    if (profileMenu) {
        const accountLinks = profileMenu.querySelector(".profile-dropdown");

        if (accountLinks) {
            const accountSection = document.createElement("div");
            accountSection.className = "mobile-account-section";

            const heading = document.createElement("p");
            heading.textContent = "MY ACCOUNT";
            accountSection.appendChild(heading);

            while (accountLinks.firstChild) {
                accountSection.appendChild(accountLinks.firstChild);
            }

            sidebar.appendChild(accountSection);
        }
    }

    function openSidebar() {
        if (window.innerWidth > 768) return;
        sidebar.classList.add("mobile-open");
        overlay.classList.add("visible");
        document.body.classList.add("mobile-menu-active");
    }

    function closeSidebar() {
        sidebar.classList.remove("mobile-open");
        overlay.classList.remove("visible");
        document.body.classList.remove("mobile-menu-active");
    }

    if (menuTrigger) {
        menuTrigger.addEventListener("click", function (event) {
            if (window.innerWidth > 768) return;
            event.preventDefault();
            event.stopPropagation();

            if (sidebar.classList.contains("mobile-open")) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    closeButton.addEventListener("click", closeSidebar);
    overlay.addEventListener("click", closeSidebar);

    sidebar.addEventListener("click", function (event) {
        if (event.target.closest("a")) closeSidebar();
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeSidebar();
    });

    window.addEventListener("resize", function () {
        if (window.innerWidth > 768) closeSidebar();
    });
})();

// OLU-XMD PENDING WHATSAPP NUMBER HANDOFF
(function () {
    try {
        const pendingNumber = sessionStorage.getItem(
            "oluXmdPendingWhatsAppNumber"
        );

        const phoneInput = document.getElementById(
            "dashboardPhoneNumber"
        );

        if (!pendingNumber || !phoneInput) return;

        if (!phoneInput.value.trim()) {
            phoneInput.value = pendingNumber;
        }

        sessionStorage.removeItem("oluXmdPendingWhatsAppNumber");

        const message = document.getElementById(
            "dashboardConnectionMessage"
        );

        if (message) {
            message.textContent =
                "Your WhatsApp number is ready. You can now generate your pairing code.";
        }
    } catch (error) {
        console.warn("WhatsApp number handoff error:", error);
    }
})();
