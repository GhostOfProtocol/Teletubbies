import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import axios from "axios";
import keepAlive from "./server.js";

// === ENVIRONMENT CHECK ===
const requiredEnv = [
  "BOT_TOKEN",
  "TRACKED_USER_ID",
  "ALERT_USER_ID",
  "CHANNEL_DISCORD_ACTIVITY",
  "CHANNEL_STEAM_ALERTS",
  "CHANNEL_COMPARISON",
  "STEAM_API_KEY",
  "STEAM_ID"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
  }
}

// === CONFIGURATION ===
const TOKEN = process.env.BOT_TOKEN;
const TRACKED_USER_ID = process.env.TRACKED_USER_ID;
const ALERT_USER_ID = process.env.ALERT_USER_ID;
const CHANNEL_DISCORD_ACTIVITY = process.env.CHANNEL_DISCORD_ACTIVITY;
const CHANNEL_STEAM_ALERTS = process.env.CHANNEL_STEAM_ALERTS;
const CHANNEL_COMPARISON = process.env.CHANNEL_COMPARISON;
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// === STATE TRACKERS ===
let lastStatus = null;
let lastGame = null;
let lastSteamGame = null;
let steamGameStartTime = null;
let lastSuspiciousGame = null;
let lastSuspiciousTime = 0;
let discordOnlineSince = null;

// === GET STEAM STATUS ===
async function getSteamStatus() {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${STEAM_ID}`,
    );
    const player = res.data.response.players[0];
    if (!player) return null;

    return {
      online: player.personastate !== 0,
      game: player.gameextrainfo || null,
      steamName: player.personaname,
      avatar: player.avatarfull,
    };
  } catch (err) {
    console.error("❌ STEAM API error:", err.message);
    return null;
  }
}

// === DISCORD READY ===
client.once("ready", () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);

  const nowStr = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const activityChannel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);

  if (activityChannel) {
    const onlineEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setDescription("✅ **BOT ONLINE**")
      .setFooter({ text: nowStr });
    activityChannel.send({ embeds: [onlineEmbed] }).catch(console.error);
  }

  // === STEAM MONITOR LOOP ===
  setInterval(async () => {
    try {
      const steam = await getSteamStatus();
      const user = await client.users.fetch(TRACKED_USER_ID).catch(() => null);
      const steamChannel = client.channels.cache.get(CHANNEL_STEAM_ALERTS);
      const compareChannel = client.channels.cache.get(CHANNEL_COMPARISON);

      if (!steam || !user || !steamChannel || !compareChannel) return;

      const discordStatus = user?.presence?.status || "offline";
      const nowStr = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

      if (steam.online && steam.game && steam.game !== lastSteamGame) {
        steamGameStartTime = Date.now();
        lastSteamGame = steam.game;

        const embed = new EmbedBuilder()
          .setColor(0xfa8072)
          .setDescription(`🎮 **Steam Game Launched:** ${steam.game}\n<@${ALERT_USER_ID}>`)
          .setFooter({ text: nowStr });

        steamChannel.send({ embeds: [embed] }).catch(console.error);
      }

      if (!steam.game && lastSteamGame && steamGameStartTime) {
        const playedMs = Date.now() - steamGameStartTime;
        const mins = Math.floor(playedMs / 60000);
        const hrs = Math.floor(mins / 60);
        const durationStr =
          hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins} minute${mins !== 1 ? "s" : ""}`;

        const stopEmbed = new EmbedBuilder()
          .setColor(0x999999)
          .setDescription(`🛑 **Stopped playing:** ${lastSteamGame}\nPlayed for **${durationStr}**`)
          .setFooter({ text: nowStr });

        steamChannel.send({ embeds: [stopEmbed] }).catch(console.error);
        steamGameStartTime = null;
        lastSteamGame = null;
      }

      const nowTime = Date.now();
      const cooldownPassed = nowTime - lastSuspiciousTime > 30 * 60 * 1000;

      const isSuspicious = discordStatus === "offline" && (steam.online || steam.game);
      if (isSuspicious && (steam.game !== lastSuspiciousGame || cooldownPassed)) {
        const embed = new EmbedBuilder()
          .setColor(0xffaa00)
          .setDescription(`⚠️ **Suspicious**\nSteam: ${steam.game || "online"}\nDiscord: ${discordStatus.toUpperCase()}\n<@${ALERT_USER_ID}>`)
          .setFooter({ text: nowStr });

        compareChannel.send({ embeds: [embed] }).catch(console.error);
        lastSuspiciousGame = steam.game;
        lastSuspiciousTime = nowTime;
      }
    } catch (err) {
      console.error("❌ STEAM loop failed:", err);
    }
  }, 60000);
});

// === DISCORD PRESENCE UPDATE ===
client.on("presenceUpdate", (_, newPresence) => {
  if (!newPresence || newPresence.userId !== TRACKED_USER_ID) return;

  const member = newPresence.member;
  const status = newPresence.status || "offline";
  const nowStr = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const channel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);
  const game = (newPresence.activities || []).find((a) => a.type === 0);

  if (status !== lastStatus) {
    if (["online", "idle", "dnd"].includes(status)) {
      discordOnlineSince = new Date();
    }

    if (status === "offline" && discordOnlineSince) {
      const timeOnlineMs = new Date() - discordOnlineSince;
      const mins = Math.floor(timeOnlineMs / 60000);
      const hrs = Math.floor(mins / 60);
      const durationStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;

      const embed = new EmbedBuilder()
        .setColor(0x999999)
        .setDescription(`📴 **Went offline**\nWas online for **${durationStr}**`)
        .setFooter({ text: nowStr });

      channel?.send({ embeds: [embed] }).catch(console.error);
      discordOnlineSince = null;
    }

    lastStatus = status;

    if (status !== "offline") {
      const embed = new EmbedBuilder()
        .setColor(status === "online" ? 0x00ff00 : status === "idle" ? 0xffcc00 : 0xff0000)
        .setDescription(`📶 **Status:** ${status.toUpperCase()}`)
        .setFooter({ text: nowStr });

      channel?.send({ embeds: [embed] }).catch(console.error);
    }
  }

  if (game?.name !== lastGame) {
    if (lastGame) {
      const embed = new EmbedBuilder()
        .setColor(0xff5555)
        .setDescription(`🛑 **Stopped playing:** ${lastGame}`)
        .setFooter({ text: nowStr });
      channel?.send({ embeds: [embed] }).catch(console.error);
    }

    if (game) {
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setDescription(`🎮 **Now Playing:** ${game.name}`)
        .setFooter({ text: nowStr });
      channel?.send({ embeds: [embed] }).catch(console.error);
    }

    lastGame = game?.name || null;
  }
});

// === ERROR HANDLERS ===
process.on("unhandledRejection", (err) => console.error("🔴 Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("🔴 Uncaught exception:", err));
client.on("error", (err) => console.error("🔴 Discord client error:", err));
client.on("disconnect", () => console.warn("⚠️ Bot disconnected"));
client.on("reconnecting", () => console.info("🔁 Reconnecting..."));
client.on("resume", () => console.log("✅ Connection resumed"));
client.on("warn", (warn) => console.warn("⚠️ Warning:", warn));

// === START BOT ===
keepAlive();

client.login(TOKEN).catch((err) => {
  console.error("❌ Discord login failed:", err);
});