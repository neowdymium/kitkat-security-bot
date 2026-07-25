# 🛡️ KITKAT (Project Sentinel) — Advanced Discord Moderation & Voice Security Bot

A modular, highly secure, production-ready Discord moderation bot built with **TypeScript**, **Node.js**, and **discord.js v14**.

Designed for high-control server management, featuring dynamic automod filters, a custom internal authorization engine, session-bound voice channel locking, and specialized anti-raid protections.

---

## ✨ Features Overview

### 🎙️ 1. Advanced Voice Channel Security & Guard System

- **`/vclock` & `/vcunlock`:** Locks the initiator's current voice channel for `@everyone`.
- **Discord Guard (`/guard` & `/unguard`):** Active enforcement that immediately disconnects unauthorized users attempting to join a guarded VC—**even if those users are Server Admins/Moderators**.
- **Voice Session Whitelisting (`/whitelist` / `/unwhitelist`):** Allows the command initiator to grant specific users access to join their locked or guarded voice channel.
- **`ARCH` Override System:** Users on the `ARCH` list automatically bypass all voice locks and guards. When an `ARCH` member joins, all barriers drop specifically for them while remaining locked for others. Requires a developer security code to claim.
- **Voice Temp-Kick (`/tempkick <@user> <duration>`):** Disconnects a user from VC and temporarily prevents them from rejoining any voice channel for the specified time (e.g., `180s`, `10m`) without banning them from the server. Automatically lifts when the timer expires.

### 🛡️ 2. Administrative Moderation & Role Control

- **`/mute` & `/unmute`:** Applies or removes Discord's native timeout system with human-readable durations (`10m`, `1h`, `1d`).
- **`/deafen` & `/undeafen`:** Server deafens or undeafens a user in a voice channel.
- **`/setnick`:** Changes a target member's server nickname.
- **`/role assign` & `/role remove`:** Dynamically assigns or revokes server roles from members.
- **`/transfer`:** Instantly transfers a user from their current voice channel to another specified voice channel.

### 🤖 3. Custom Internal Permission Engine (`/perm`)

- Operates independently of standard Discord server role hierarchies.
- **`/perm add <@user> scope:all`:** Grants a user access to execute all bot commands.
- **`/perm add <@user> scope:<commands>`:** Grants granular access to specific command subsets (e.g., `vclock`, `guard`, `mute`).
- Allows server managers to grant bot execution power to specific individuals without giving them full Discord Administrator permissions.

### 🤖 4. Interactive Broadcast (`/tell`)

- **`/tell channel:#text-channel message:<text>`:** Sends a formatted announcement directly from the bot.
- Masks the sender's identity in public chat while logging the command initiator in the private staff audit channel.

### 🚫 5. Dynamic Automod & Anti-Raid Engine

- **Dynamic Content Filtering (`/blocktext` & `/blocklink`):** Add or remove banned phrases and URL domains on-the-fly without restarting the bot.
- **Anti-Spam & Duplicate Protection:** Detects rapid repetitive messages from single users and applies automatic temporary timeouts.
- **Anti-Raid / Anti-Nuke Engine:** Monitors cross-user duplicate message broadcasts within a 5-second sliding window. Deletes raid spam instantly and mitigates incoming attack bots.
- **Spam Exemption (`/spam allow`):** Whitelists trusted users, integration webhooks, or secondary bots so their automated messages aren't flagged as spam.

### ⚙️ 6. System Configuration & Logging (`/config` & `/help`)

- **`/config logging channel:#channel`:** Sets a permanent server log channel for violation alerts, sanctions, and audit entries.
- **`/config dm_alerts <true|false>`:** Toggles whether rule breakers receive direct message notifications upon receiving sanctions.
- **`/help`:** Generates an interactive, categorized embed menu listing commands, options, and required permission scopes.

---

## 📁 Directory Structure

```text
├── src/
│   ├── commands/                # Slash Command Modules
│   │   ├── moderation/          # /mute, /tempkick, /setnick, /deafen, /perm, /role, /tell,
│   │   |                         /config, /blocktext, /blocklink, /spam
│   │   └── voice/               # /vclock, /guard, /whitelist, /transfer
│   │
│   ├── events/                  # Discord Event Listeners
│   │   ├── interactionCreate.ts
│   │   ├── messageCreate.ts     # Anti-Spam & Word Filter Engine
│   │   ├── ready.ts
│   │   └── voiceStateUpdate.ts  # Voice Guard & Temp-Kick Enforcement
│   ├── handlers/                # Dynamic Command & Event Loaders
│   │   ├── commandHandler.ts
│   │   └── eventHandler.ts
│   ├── middleware/              # Middleware for Commands and Events
│   │   ├── config.ts
│   │   ├── database.ts
│   │   └── index.ts
│   ├── config.ts                # Configuration Loader
│   └── index.ts                 # Bot Entrypoint
├── .env                         # Environment Variables (Keep Private!)
├── package-lock.json
├── package.json
└── tsconfig.json
