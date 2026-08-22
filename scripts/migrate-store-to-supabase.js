import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataFile = path.join(root, "data", "store.json");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
}

if (!fs.existsSync(dataFile)) {
  console.log("No data/store.json file found; nothing to migrate.");
  process.exit(0);
}

const { lobbies = [] } = JSON.parse(fs.readFileSync(dataFile, "utf8"));
if (!lobbies.length) {
  console.log("No lobbies found; nothing to migrate.");
  process.exit(0);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const rows = lobbies.map((lobby) => ({
  id: lobby.id,
  state: lobby,
  created_at: lobby.createdAt || new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));
const { error } = await supabase.from("lobbies").upsert(rows, {
  onConflict: "id",
});

if (error) throw error;
console.log(`Migrated ${rows.length} ${rows.length === 1 ? "lobby" : "lobbies"}.`);

