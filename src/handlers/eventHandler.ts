import { Client } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dynamically loads all event listeners from the events/ folder.
 * Binds them to the client depending on whether they are one-time or recurring events.
 * 
 * @param client The Discord Client instance
 */
export async function loadEvents(client: Client): Promise<void> {
  const eventsPath = path.resolve(__dirname, '../events');

  // Verify the events directory exists
  if (!fs.existsSync(eventsPath)) {
    console.error(`[Loader Error]: Events directory not found at ${eventsPath}`);
    return;
  }

  const eventFiles = fs.readdirSync(eventsPath).filter(
    (file) => file.endsWith('.ts') || file.endsWith('.js')
  );

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    
    try {
      // Convert Windows absolute path to a valid file:// URL for dynamic import in Node ESM
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);
      
      // Support both default export or named Event exports
      const event = module.default || module.Event || module;

      if (event && 'name' in event && 'execute' in event) {
        if (event.once) {
          // Binds one-time event execution (e.g. ready event)
          client.once(event.name, (...args) => event.execute(...args, client));
        } else {
          // Binds recurring events (e.g. messageCreate, voiceStateUpdate)
          client.on(event.name, (...args) => event.execute(...args, client));
        }
        console.log(`[Event Loader]: Loaded event listener for "${event.name}"`);
      } else {
        console.warn(`[Event Loader Warning]: The event at ${filePath} is missing a required "name" or "execute" property.`);
      }
    } catch (error) {
      console.error(`[Event Loader Error]: Failed to load event at ${filePath}:`, error);
    }
  }

  console.log(`[Event Loader]: Finished loading ${eventFiles.length} event modules.`);
}
