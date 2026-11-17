const fs = require("fs");
const path = require("path");

const plugins = new Map();

function loadPlugins() {
    plugins.clear();

    const pluginFiles = fs.readdirSync(__dirname)
        .filter(file => file.endsWith(".js") && file !== "index.js");

    for (const file of pluginFiles) {
        try {
            const pluginPath = path.join(__dirname, file);

            delete require.cache[require.resolve(pluginPath)];

            const plugin = require(pluginPath);

            if (!plugin.name || typeof plugin.execute !== "function") {
                console.log(`Invalid plugin: ${file}`);
                continue;
            }

            const commandNames = [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])];
            for (const commandName of commandNames) {
                const normalizedName = String(commandName).toLowerCase();
                if (plugins.has(normalizedName)) {
                    console.log('Plugin command conflict: ' + normalizedName + ' (' + file + ')');
                    continue;
                }
                plugins.set(normalizedName, plugin);
            }
            console.log('Loaded plugin: ' + plugin.name + ' (' + commandNames.length + ' commands)');
            console.log(`Loaded plugin: ${plugin.name}`);
        } catch (error) {
            console.error(`Plugin error (${file}):`, error.message);
        }
    }

    return plugins;
}

function getPlugin(name) {
    return plugins.get(name.toLowerCase());
}

module.exports = {
    loadPlugins,
    getPlugin,
    plugins
};