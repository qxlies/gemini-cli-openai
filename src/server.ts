import dotenv from "dotenv";
dotenv.config();

import { serve } from "@hono/node-server";
import app from "./index.js";

const port = 8787;
console.log(`Server is running on port ${port}`);

serve({
	fetch: (req) => app.fetch(req, process.env),
	port,
});