import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const permanentEditsFile = fileURLToPath(new URL("./src/data/permanent-edits.json", import.meta.url));

function familyEditsWriter(): Plugin {
  return {
    name: "family-edits-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__family_tree_edits", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body);
            const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
            await mkdir(dirname(permanentEditsFile), { recursive: true });
            await writeFile(permanentEditsFile, formatted, "utf8");
            server.watcher.add(permanentEditsFile);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown save error";
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, message }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [familyEditsWriter(), react(), tailwindcss()],
});
