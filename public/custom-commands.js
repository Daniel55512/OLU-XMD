const premiumLock = document.getElementById("premiumLock");
const commandContent = document.getElementById("commandContent");
const commandName = document.getElementById("commandName");
const commandResponse = document.getElementById("commandResponse");
const commandList = document.getElementById("commandList");
const commandCount = document.getElementById("commandCount");
const commandMessage = document.getElementById("commandMessage");
const saveCommandButton = document.getElementById("saveCommand");
const cancelEditButton = document.getElementById("cancelEdit");

let commands = [];
let editingId = null;

function showMessage(message, isError = false) {
    commandMessage.textContent = message;
    commandMessage.style.color = isError ? "#B91C1C" : "#16834D";
}

function resetForm() {
    editingId = null;
    commandName.disabled = false;
    commandName.value = "";
    commandResponse.value = "";
    saveCommandButton.textContent = "Add Command";
    cancelEditButton.style.display = "none";
}

async function loadCommands() {
    try {
        const response = await fetch("/api/custom-commands");

        if (response.status === 403) {
            premiumLock.style.display = "block";
            commandContent.style.display = "none";
            return;
        }

        if (response.status === 401) {
            window.location.href = "login.html";
            return;
        }

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to load commands.");
        }

        premiumLock.style.display = "none";
        commandContent.style.display = "block";

        commands = result.commands || [];
        displayCommands();

    } catch (error) {
        showMessage(error.message, true);
    }
}

function displayCommands() {
    commandList.innerHTML = "";
    commandCount.textContent = `${commands.length} / 20 commands`;

    if (commands.length === 0) {
        commandList.textContent = "You have not created any custom commands yet.";
        return;
    }

    commands.forEach(item => {
        const container = document.createElement("div");
        container.className = "saved-command";

        const details = document.createElement("div");

        const title = document.createElement("strong");
        title.textContent = "." + item.command;

        const reply = document.createElement("p");
        reply.textContent = item.response;

        details.appendChild(title);
        details.appendChild(reply);

        const actions = document.createElement("div");
        actions.className = "command-actions";

        const editButton = document.createElement("button");
        editButton.className = "edit-command";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => startEdit(item));

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-command";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteCommand(item.id));

        actions.appendChild(editButton);
        actions.appendChild(deleteButton);

        container.appendChild(details);
        container.appendChild(actions);
        commandList.appendChild(container);
    });
}

function startEdit(item) {
    editingId = item.id;
    commandName.value = item.command;
    commandName.disabled = true;
    commandResponse.value = item.response;
    saveCommandButton.textContent = "Save Changes";
    cancelEditButton.style.display = "inline-block";
    commandName.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function saveCommand() {
    const name = commandName.value.trim().toLowerCase();
    const responseText = commandResponse.value.trim();

    if (!/^[a-z][a-z0-9_-]{0,29}$/.test(name)) {
        showMessage("Use a command starting with a letter. Only letters, numbers, hyphens and underscores are allowed.", true);
        return;
    }

    if (!responseText) {
        showMessage("Enter a response message.", true);
        return;
    }

    if (!editingId && commands.length >= 20) {
        showMessage("You can only create 20 custom commands.", true);
        return;
    }

    try {
        const editing = editingId !== null;

        const response = await fetch(
            editing ? `/api/custom-commands/${editingId}` : "/api/custom-commands",
            {
                method: editing ? "PUT" : "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(
                    editing
                        ? { response: responseText }
                        : { command: name, response: responseText }
                )
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to save command.");
        }

        showMessage(editing ? "Command updated successfully." : "Command created successfully.");
        resetForm();
        await loadCommands();

    } catch (error) {
        showMessage(error.message, true);
    }
}

async function deleteCommand(id) {
    if (!confirm("Are you sure you want to delete this command?")) {
        return;
    }

    try {
        const response = await fetch(`/api/custom-commands/${id}`, {
            method: "DELETE"
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to delete command.");
        }

        showMessage("Command deleted successfully.");
        await loadCommands();

    } catch (error) {
        showMessage(error.message, true);
    }
}

saveCommandButton.addEventListener("click", saveCommand);
cancelEditButton.addEventListener("click", resetForm);

loadCommands();
