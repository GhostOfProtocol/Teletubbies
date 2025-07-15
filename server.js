// === server.js for Render === import express from "express"; import fetch from "node-fetch";

const app = express();

app.get("/", (_, res) => { res.status(200).send("✅ Bot is alive and running!"); });

export default function keepAlive() { const PORT = process.env.PORT || 3000; app.listen(PORT, () => { console.log(✅ KeepAlive server running on port ${PORT}); });

// Self-ping every 4 minutes using the deployed Render URL

setInterval(() => { const url = "https://teletubbies.onrender.com"; // Your public Render web service URL fetch(url) .then((res) => console.log(✅ Self-ping: ${res.status})) .catch((err) => console.error("❌ Self-ping failed:", err.message)); }, 4 * 60 * 1000); // Every 4 minutes }