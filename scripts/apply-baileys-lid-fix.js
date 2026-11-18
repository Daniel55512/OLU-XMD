const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const packageFile = path.join(
    root,
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "package.json"
);
const target = path.join(
    root,
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "lib",
    "Socket",
    "messages-send.js"
);

if (!fs.existsSync(packageFile) || !fs.existsSync(target)) {
    throw new Error("Required Baileys files were not found.");
}

const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));

if (pkg.version !== "7.0.0-rc14") {
    throw new Error(
        "Unexpected Baileys version: " + pkg.version +
        ". This repair is intended for 7.0.0-rc14."
    );
}

let source = fs.readFileSync(target, "utf8");

if (
    !source.includes("const assertSessions = async (jids, force) =>") ||
    !source.includes("if (!force) {") ||
    !source.includes("validateSession(jid)")
) {
    throw new Error("Unexpected Baileys session implementation.");
}

function applyReplacement(input, original, replacement, label) {
    const oldCount = input.split(original).length - 1;
    const newCount = input.split(replacement).length - 1;

    if (oldCount === 1 && newCount === 0) {
        console.log("Applying: " + label);
        return input.replace(original, replacement);
    }

    if (oldCount === 0 && newCount === 1) {
        console.log("Already applied: " + label);
        return input;
    }

    throw new Error("Unexpected match count for: " + label);
}

source = applyReplacement(
    source,
    "await assertSessions(lids, true);",
    "await assertSessions(lids);",
    "LID session refresh correction"
);

source = applyReplacement(
    source,
    "// Force-refresh sessions for newly mapped LIDs to align identity addressing",
    "// Ensure sessions without forcing refresh of existing valid sessions",
    "LID session comment correction"
);

fs.writeFileSync(target, source, "utf8");

console.log("Baileys LID repair verified for version " + pkg.version);