import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import connectDB from "./db.js";
import { seedIfEmpty } from "./seed.js";

const PORT = process.env.PORT || 4000;

(async () => {
  await connectDB();
  await seedIfEmpty();
  app.listen(PORT, () => {
    console.log(`kynq gift API running on http://localhost:${PORT} (${process.env.NODE_ENV || "development"})`);
  });
})();

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});
