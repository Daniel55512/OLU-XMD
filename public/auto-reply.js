const premiumLock = document.getElementById("premiumLock");
const autoReplyContent = document.getElementById("autoReplyContent");
const autoEnabled = document.getElementById("autoEnabled");
const autoStatus = document.getElementById("autoStatus");
const defaultReply = document.getElementById("defaultReply");
const autoMessage = document.getElementById("autoMessage");
const keywordInput = document.getElementById("keyword");
const keywordResponse = document.getElementById("keywordResponse");
const keywordList = document.getElementById("keywordList");
const keywordCount = document.getElementById("keywordCount");

let keywords = [];

function showMessage(message, isError = false) {
    autoMessage.textContent = message;
    autoMessage.style.color = isError ? "#B91C1C" : "#16834D";
}

async function loadAutoReply() {
    try {
        const response = await fetch("/api/auto-reply");

        if (response.status === 403) {
            premiumLock.style.display = "block";
            autoReplyContent.style.display = "none";
            return;
        }

        if (response.status === 401) {
            window.location.href = "login.html";
            return;
        }

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to load Auto Reply.");
        }

        premiumLock.style.display = "none";
        autoReplyContent.style.display = "block";

        autoEnabled.checked = result.settings.enabled === 1;
        autoStatus.textContent = autoEnabled.checked ? "ON" : "OFF";
        defaultReply.value = result.settings.default_reply || "";

        keywords = result.keywords || [];
        displayKeywords();

    } catch (error) {
        showMessage(error.message, true);
    }
}

function displayKeywords() {
    keywordList.innerHTML = "";

    keywordCount.textContent = `${keywords.length} / 20 keywords`;

    if (keywords.length === 0) {
        keywordList.textContent = "No keyword replies added yet.";
        return;
    }

    keywords.forEach(item => {
        const container = document.createElement("div");
        container.className = "keyword-item";

        const details = document.createElement("div");

        const title = document.createElement("strong");
        title.textContent = item.keyword;

        const reply = document.createElement("p");
        reply.textContent = item.response;

        details.appendChild(title);
        details.appendChild(reply);

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-keyword";
        deleteButton.textContent = "Delete";

        deleteButton.addEventListener("click", () => {
            deleteKeyword(item.id);
        });

        container.appendChild(details);
        container.appendChild(deleteButton);

        keywordList.appendChild(container);
    });
}

async function saveSettings() {
    try {
        const response = await fetch("/api/auto-reply", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                enabled: autoEnabled.checked,
                defaultReply: defaultReply.value.trim()
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to save settings.");
        }

        showMessage("Auto Reply settings saved successfully.");

    } catch (error) {
        showMessage(error.message, true);
    }
}

async function addKeyword() {
    const keyword = keywordInput.value.trim();
    const responseText = keywordResponse.value.trim();

    if (!keyword || !responseText) {
        showMessage("Enter both a keyword and its reply.", true);
        return;
    }

    if (keywords.length >= 20) {
        showMessage("You can only add 20 keywords.", true);
        return;
    }

    try {
        const response = await fetch("/api/auto-reply/keywords", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                keyword,
                response: responseText
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to add keyword.");
        }

        keywordInput.value = "";
        keywordResponse.value = "";

        showMessage("Keyword added successfully.");
        await loadAutoReply();

    } catch (error) {
        showMessage(error.message, true);
    }
}

async function deleteKeyword(id) {
    if (!confirm("Are you sure you want to delete this keyword?")) {
        return;
    }

    try {
        const response = await fetch(`/api/auto-reply/keywords/${id}`, {
            method: "DELETE"
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to delete keyword.");
        }

        showMessage("Keyword deleted successfully.");
        await loadAutoReply();

    } catch (error) {
        showMessage(error.message, true);
    }
}

autoEnabled.addEventListener("change", () => {
    autoStatus.textContent = autoEnabled.checked ? "ON" : "OFF";
    saveSettings();
});

document.getElementById("saveAutoReply").addEventListener("click", saveSettings);
document.getElementById("addKeyword").addEventListener("click", addKeyword);

loadAutoReply();