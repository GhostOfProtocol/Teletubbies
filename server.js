import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

export default function keepAlive() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ KeepAlive server running on port ${PORT}`);
  });

  setInterval(() => {
    fetch("https://teletubbies.onrender.com/")
      .then((res) => console.log(`✅ Self-ping: ${res.status}`))
      .catch((err) => console.error("❌ Self-ping failed:", err.message));
  }, 4 * 60 * 1000); // every 4 minutes
}
