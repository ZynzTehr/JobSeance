"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiCallError } from "@/lib/ui";
import ui from "../components/ui.module.css";

// Client pieces of /admin. Every action goes through the admin API, which checks the role again.

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: "", error: false });
  async function submit(method: string, url: string, body: unknown, done: string) {
    setBusy(true);
    setStatus({ text: "", error: false });
    try {
      await api(method, url, body);
      setStatus({ text: done, error: false });
      router.refresh();
    } catch (e) {
      setStatus({ text: e instanceof ApiCallError ? e.message : "That didn't work.", error: true });
    } finally {
      setBusy(false);
    }
  }
  return { busy, status, submit };
}

function Status({ status }: { status: { text: string; error: boolean } }) {
  return (
    <p className={status.error ? ui.statusError : ui.statusOk} role="status">
      {status.text}
    </p>
  );
}

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export function PauseSwitch({ paused }: { paused: boolean }) {
  const { busy, status, submit } = useSubmit();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className={`${paused ? ui.primary : ui.danger} px-5 py-2.5`}
        disabled={busy}
        aria-busy={busy}
        onClick={() => submit("POST", "/api/v1/admin/ai-pause", { paused: !paused }, paused ? "AI resumed." : "AI paused. Other servers follow within a minute.")}
      >
        {paused ? "Resume AI" : "Pause all AI calls"}
      </button>
      <Status status={status} />
    </div>
  );
}

export function AddDiscovered({ d }: { d: { key: string; name: string; ats: string; board: string; host: string | null } }) {
  const { busy, status, submit } = useSubmit();
  const [name, setName] = useState(d.name);
  const [domains, setDomains] = useState("");
  const [hosts, setHosts] = useState("");
  const id = (f: string) => `${f}-${d.key}`;
  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          "POST",
          "/api/v1/companies",
          {
            name: name.trim(),
            officialDomains: list(domains),
            ats: d.ats,
            atsBoard: d.board,
            ...(d.host ? { atsHost: d.host } : {}),
            ...(list(hosts).length ? { careersHosts: list(hosts) } : {}),
          },
          "Added to the directory. Checks now count this board.",
        );
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Company name</span>
        <input id={id("name")} className={`${ui.input} px-3 py-2`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Official domains (checked by you)</span>
        <input id={id("domains")} className={`${ui.input} px-3 py-2`} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com" required />
      </label>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Careers hosts (optional)</span>
        <input id={id("hosts")} className={`${ui.input} px-3 py-2`} value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="careers.acme.com" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <button type="submit" className={`${ui.secondary} px-4 py-2`} disabled={busy} aria-busy={busy}>
          Add to directory
        </button>
        <button
          type="button"
          className={`${ui.ghost} px-3 py-2`}
          disabled={busy}
          onClick={() =>
            window.confirm("Dismiss this board as not the employer's? Checks won't show it for 90 days.") &&
            submit("POST", `/api/v1/admin/discoveries/${encodeURIComponent(d.key)}/dismiss`, {}, "Dismissed.")
          }
        >
          Not theirs: dismiss
        </button>
        <Status status={status} />
      </div>
    </form>
  );
}

export function CompanyHosts({ c }: { c: { slug: string; officialDomains: string[]; careersHosts: string[] } }) {
  const { busy, status, submit } = useSubmit();
  const [domains, setDomains] = useState(c.officialDomains.join(", "));
  const [hosts, setHosts] = useState(c.careersHosts.join(", "));
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit("PATCH", `/api/v1/companies/${c.slug}`, { officialDomains: list(domains), careersHosts: list(hosts) }, "Saved.");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Official domains</span>
        <input className={`${ui.input} px-3 py-2`} value={domains} onChange={(e) => setDomains(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Careers hosts</span>
        <input className={`${ui.input} px-3 py-2`} value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="none" />
      </label>
      <button type="submit" className={`${ui.secondary} px-4 py-2`} disabled={busy} aria-busy={busy}>
        Save
      </button>
      <div className="sm:col-span-3">
        <Status status={status} />
      </div>
    </form>
  );
}

export function FlagReview({ id, current }: { id: string; current: string }) {
  const { busy, status, submit } = useSubmit();
  const [choice, setChoice] = useState(current === "OPEN" ? "UNDER_REVIEW" : current);
  const [note, setNote] = useState("");
  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit("PATCH", `/api/v1/flags/${id}`, { status: choice, ...(note.trim() ? { resolutionNote: note.trim() } : {}) }, "Saved.");
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Status</span>
        <select className={`${ui.input} px-3 py-2`} value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="UNDER_REVIEW">Under review</option>
          <option value="UPHELD">Upheld (removes a reported report)</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Note (kept with the flag)</span>
        <input className={`${ui.input} px-3 py-2`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </label>
      <button type="submit" className={`${ui.secondary} px-4 py-2`} disabled={busy} aria-busy={busy}>
        Save
      </button>
      <div className="sm:col-span-3">
        <Status status={status} />
      </div>
    </form>
  );
}
