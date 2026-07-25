import { Client, Collection } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extend the discord.js Client type to include commands Collection in typescript
declare module 'discord.js' {
  interface Client {
    commands: Collection<string, any>;
  }
}

/**
 * Dynamically loads and registers slash commands from subdirectories in the commands/ folder.
 * Uses pathToFileURL to ensure compatibility with Windows file paths in ESM environment.
 * 
 * @param client The Discord Client instance
 */
export async function loadCommands(client: Client): Promise<void> {
  client.commands = new Collection();
  const commandsPath = path.resolve(__dirname, '../commands');

  // Verify the commands directory exists
  if (!fs.existsSync(commandsPath)) {
    console.error(`[Loader Error]: Commands directory not found at ${commandsPath}`);
    return;
  }

  // Read subdirectories inside the commands directory
  const categories = fs.readdirSync(commandsPath);

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    
    // Skip if it's not a directory
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(categoryPath).filter(
      (file) => file.endsWith('.ts') || file.endsWith('.js')
    );

    for (const file of commandFiles) {
      const filePath = path.join(categoryPath, file);
      
      try {
        // Convert Windows absolute path to a valid file:// URL for dynamic import in Node ESM
        const fileUrl = pathToFileURL(filePath).href;
        const module = await import(fileUrl);
        let loadedAny = false;

        // Iterate through all exported members of the module to support both
        // single default/named exports and multiple named exports per file.
        for (const key of Object.keys(module)) {
          const exportItem = module[key];
          if (
            exportItem && 
            typeof exportItem === 'object' && 
            'data' in exportItem && 
            'execute' in exportItem
          ) {
            exportItem.category = category;
            client.commands.set(exportItem.data.name, exportItem);
            console.log(`[Command Loader]: Loaded /${exportItem.data.name} (Category: ${category})`);
            loadedAny = true;
          }
        }

        // If it's a default export that is a command itself and wasn't loaded
        if (!loadedAny && module.default && 'data' in module.default && 'execute' in module.default) {
          const command = module.default;
          command.category = category;
          client.commands.set(command.data.name, command);
          console.log(`[Command Loader]: Loaded /${command.data.name} (Category: ${category})`);
          loadedAny = true;
        }

        if (!loadedAny) {
          console.warn(`[Command Loader Warning]: The file at ${filePath} does not export any valid command (missing "data" or "execute").`);
        }
      } catch (error) {
        console.error(`[Command Loader Error]: Failed to load command at ${filePath}:`, error);
      }
    }
  }

  console.log(`[Command Loader]: Finished loading ${client.commands.size} commands.`);
}
