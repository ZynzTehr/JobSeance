"use client";

import { useState, type FormEvent } from "react";
import AutoGrowTextarea from "../components/AutoGrowTextarea";
import ui from "../components/ui.module.css";
import styles from "./api-docs.module.css";

const METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

/** Sends a real request from the browser. A pasted token goes in the Authorization header; otherwise your session cookie is used. */
export default function TryIt() {
  const [method, setMethod] = useState<(typeof METHODS)[number]>("GET");
  const [path, setPath] = useState("/api/v1/companies/bramblecloud");
  const [token, setToken] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ status: string; text: string } | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!path.startsWith("/api/")) {
      setOut({ status: "Not sent", text: "Paths must start with /api/." });
      return;
    }
    setBusy(true);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
      if (method !== "GET") headers["Content-Type"] = "application/json";
      const response = await fetch(path, { method, headers, body: method === "GET" ? undefined : body || "{}" });
      const raw = await response.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {}
      setOut({ status: `${response.status} ${response.statusText} · ${Math.round(performance.now() - started)} ms`, text: text || "(empty body)" });
    } catch {
      setOut({ status: "Network error", text: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div>
          <label htmlFor="try-method" className={ui.label}>
            Method
          </label>
          <select
            id="try-method"
            className={`${ui.input} mt-2 w-full py-2.5 pl-3 pr-12`}
            value={method}
            onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}
          >
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="try-path" className={ui.label}>
            Path
          </label>
          <input id="try-path" className={`${ui.input} ${styles.mono} mt-2 w-full px-3 py-2.5`} value={path} onChange={(e) => setPath(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="try-token" className={ui.label}>
          Bearer token <span className={ui.small}>(optional; from POST /api/auth/login)</span>
        </label>
        <input
          id="try-token"
          className={`${ui.input} ${styles.mono} mt-2 w-full px-3 py-2.5`}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="eyJhbGciOi…"
        />
      </div>
      {method !== "GET" && (
        <div>
          <label htmlFor="try-body" className={ui.label}>
            JSON body
          </label>
          <AutoGrowTextarea
            id="try-body"
            className={`${ui.input} ${styles.mono} mt-2 w-full px-3 py-2.5`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='{"kind": "company_role", "company": "bramblecloud", "role": "Data Analyst"}'
          />
        </div>
      )}
      <div>
        <button id="try-send" type="submit" className={`${ui.primary} px-6 py-2.5`} disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </div>
      {out && (
        <div aria-live="polite">
          <p className={`${styles.status} mb-2`}>{out.status}</p>
          <pre className={`${ui.code} max-h-96 overflow-auto p-4`}>{out.text}</pre>
        </div>
      )}
    </form>
  );
}
