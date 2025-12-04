import { secrets } from "bun";

/*
	keep-alive.ts
	- Pings PROD and STAGE Supabase projects to keep them awake.
	- Reads credentials from environment variables (GitHub Secrets) or prompts locally.
	- Uses Bun 1.3+ native features (fetch, Bun.env, secrets API).

	Usage:
	- Local: bun run keep-alive.ts (prompts for missing PROD/STAGE keys; saves to OS keychain)
	- CI: set env vars SUPABASE_PROD_URL, SUPABASE_PROD_KEY, SUPABASE_STAGE_URL, SUPABASE_STAGE_KEY
*/

type Project = {
  name: "PROD" | "STAGE";
  url: string;
  key: string;
};

const TIMEOUT_MS = 10000;
const SECRET_SERVICE = "campuscup.cron-jobs.supabase";

const getOrPrompt = async (envKey: string): Promise<string | null> => {
  // Prefer environment variable (GitHub Secrets in CI)
  const fromEnv = Bun.env[envKey];
  if (fromEnv) return fromEnv;

  // Try Bun.secrets for local keychain storage
  try {
    const stored = await secrets.get({ service: SECRET_SERVICE, name: envKey });
    if (stored) return stored;
  } catch (err) {
    console.error(`Error accessing secrets for ${envKey}:`, err);
  }

  // Interactive prompt (only on TTY)
  if (process.stdin.isTTY) {
    try {
      const entered = prompt(`Enter ${envKey}`);
      if (entered) {
        try {
          // Save to Bun.secrets for future local runs
          await secrets.set({
            service: SECRET_SERVICE,
            name: envKey,
            value: entered,
          });
          return entered;
        } catch (err) {
          return entered;
        }
      }
    } catch (err) {
      console.error(`Error prompting for ${envKey}:`, err);
    }
  }
  return null;
};

const readConfig = async (): Promise<Project[]> => {
  const projects: Project[] = [];

  const prodUrl = await getOrPrompt("SUPABASE_PROD_URL");
  const prodKey = await getOrPrompt("SUPABASE_PROD_KEY");
  if (prodUrl && prodKey)
    projects.push({
      name: "PROD",
      url: prodUrl,
      key: prodKey,
    });

  // Load STAGE project
  const stageUrl = await getOrPrompt("SUPABASE_STAGE_URL");
  const stageKey = await getOrPrompt("SUPABASE_STAGE_KEY");
  if (stageUrl && stageKey)
    projects.push({
      name: "STAGE",
      url: stageUrl,
      key: stageKey,
    });

  return projects;
};

// Write (insert) into heartbeat table
const writeHeartbeat = async (
  project: Project
): Promise<boolean> => {
  const url = `${project.url.replace(/\/$/, "")}/rest/v1/heartbeat`;
  // determine write key: prefer explicit writeKey, else fallback to project.key
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${project.key}`,
        apikey: project.key,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ created_at: new Date().toISOString() }),
      signal: controller.signal,
    });
    const ok = res.status >= 200 && res.status < 300;
    const ms = Date.now() - start;
    if (ok) {
      const body = await res.json().catch(() => null);
      console.log(
        `[${new Date().toISOString()}] [${project.name}] write ok status=${
          res.status
        } time=${ms}ms body=${JSON.stringify(body)}`
      );
    } else {
      console.warn(
        `[${new Date().toISOString()}] [${project.name}] write failed status=${
          res.status
        } time=${ms}ms`
      );
    }
    return ok;
  } catch (err) {
    const ms = Date.now() - start;
    console.error(
      `[${new Date().toISOString()}] [${
        project.name
      }] write error time=${ms}ms: ${err}`
    );
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};

async function main() {
  const projects = await readConfig();
  if (projects.length === 0) {
    console.error(
      "Error: No projects configured. Set SUPABASE_PROD_URL/KEY and/or SUPABASE_STAGE_URL/KEY."
    );
    process.exit(1);
  }

  const results = await Promise.all(
    projects.map((p) => writeHeartbeat(p))
  );

  const succeeded = results.filter(Boolean).length;
  console.log(`Summary: ${succeeded}/${results.length} succeeded`);

  if (succeeded === 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
