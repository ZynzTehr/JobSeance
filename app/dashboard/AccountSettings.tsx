"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import ui from "../components/ui.module.css";
import { passwordRules } from "@/lib/auth/password-rules";
import { api, ApiCallError } from "@/lib/ui";
import styles from "./dashboard.module.css";

type AccountUser = { username: string | null; email: string; emailVerifiedAt: string | Date | null; providers: string[] };
type Saved = { user: { username: string | null; email: string }; verificationSent?: boolean };

const PROVIDER_LABEL: Record<string, string> = { GOOGLE: "Google", GITHUB: "GitHub" };

/** One form's values, field errors, status line and pending flag. */
function useAccountForm<V extends Record<string, string>>(empty: V) {
  const router = useRouter();
  const [values, setValues] = useState(empty);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent, method: string, url: string, body: unknown, done: (saved: Saved) => string) {
    event.preventDefault();
    setBusy(true);
    setFields({});
    setStatus({ text: "", error: false });
    try {
      const saved = await api<Saved>(method, url, body);
      setValues(empty);
      setStatus({ text: done(saved), error: false });
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("That didn't work. Please try again.", 0);
      setFields(err.fields);
      setStatus({ text: err.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  const bind = (name: keyof V & string) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues({ ...values, [name]: e.target.value }),
    error: fields[name],
  });

  return { values, status, busy, submit, bind };
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string; error?: string; describedBy?: string };

function Field({ id, label, hint, error, describedBy, ...input }: FieldProps) {
  const described = [hint && `${id}-hint`, describedBy, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className={ui.label}>
        {label}
      </label>
      <input
        id={id}
        className={`${ui.input} mt-2 w-full px-3 py-2.5`}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className={`${ui.small} mt-1.5`}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={`${ui.fieldError} mt-1.5`}>
          {error}
        </p>
      )}
    </div>
  );
}

function Status({ status }: { status: { text: string; error: boolean } }) {
  return (
    <p className={status.error ? ui.statusError : ui.statusOk} role="status">
      {status.text}
    </p>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button type="submit" className={`${ui.primary} px-5 py-2.5`} disabled={busy} aria-busy={busy}>
      {busy ? "Saving…" : label}
    </button>
  );
}

function UsernameForm({ username }: { username: string }) {
  const form = useAccountForm({ username: "", currentPassword: "" });
  return (
    <form
      aria-labelledby="change-username-heading"
      className={`${styles.panel} flex flex-col gap-4 p-4 sm:p-5`}
      onSubmit={(e) =>
        form.submit(e, "PATCH", "/api/v1/me", form.values, ({ user }) => `Username changed. Log in as ${user.username} from now on.`)
      }
    >
      <div>
        <h3 id="change-username-heading" className={ui.h3}>
          Username
        </h3>
        <p className={`${ui.small} mt-1`}>Currently {username}. You log in with your username, so use the new one next time.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="settings-username"
          label="New username"
          hint="3–20 letters, numbers or underscores."
          autoComplete="username"
          maxLength={100}
          {...form.bind("username")}
        />
        <Field id="settings-username-password" label="Current password" type="password" autoComplete="current-password" {...form.bind("currentPassword")} />
      </div>
      <div className="flex flex-col items-start gap-2">
        <SubmitButton busy={form.busy} label="Change username" />
        <Status status={form.status} />
      </div>
    </form>
  );
}

/** Emails a fresh verification link to the current address (POST /api/v1/me/verify-email). Only while email is on. */
function SendVerification() {
  const [status, setStatus] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setStatus({ text: "", error: false });
    try {
      const reply = await api<{ message: string }>("POST", "/api/v1/me/verify-email", {});
      setStatus({ text: reply.message, error: false });
    } catch (e) {
      const err = e instanceof ApiCallError ? e : new ApiCallError("That didn't work. Please try again.", 0);
      setStatus({ text: err.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={`${ui.secondary} px-4 py-2`} onClick={send} disabled={busy} aria-busy={busy}>
        {busy ? "Sending…" : "Send verification email"}
      </button>
      <Status status={status} />
    </div>
  );
}

function EmailForm({ email, verified, emailOn }: { email: string; verified: boolean; emailOn: boolean }) {
  const form = useAccountForm({ email: "", currentPassword: "" });
  return (
    <form
      aria-labelledby="change-email-heading"
      className={`${styles.panel} flex flex-col gap-4 p-4 sm:p-5`}
      onSubmit={(e) =>
        form.submit(e, "PATCH", "/api/v1/me", form.values, ({ user, verificationSent }) =>
          verificationSent
            ? `Email changed to ${user.email}. We sent it a link to verify it.`
            : `Email changed to ${user.email}. It isn't verified.`,
        )
      }
    >
      <div>
        <h3 id="change-email-heading" className={ui.h3}>
          Email
        </h3>
        <p className={`${ui.small} mt-1`}>
          Currently {email}
          {verified ? " (verified)" : " (not verified)"}.{" "}
          {emailOn
            ? "A new address gets a link to verify it."
            : <>We can&rsquo;t send email yet, so a new address isn&rsquo;t verified either.</>}
        </p>
      </div>
      {emailOn && !verified && <SendVerification />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="settings-email" label="New email" type="email" autoComplete="email" maxLength={254} {...form.bind("email")} />
        <Field id="settings-email-password" label="Current password" type="password" autoComplete="current-password" {...form.bind("currentPassword")} />
      </div>
      <div className="flex flex-col items-start gap-2">
        <SubmitButton busy={form.busy} label="Change email" />
        <Status status={form.status} />
      </div>
    </form>
  );
}

function PasswordForm({ username }: { username: string }) {
  const form = useAccountForm({ currentPassword: "", newPassword: "" });
  const rules = passwordRules(form.values.newPassword);
  return (
    <form
      aria-labelledby="change-password-heading"
      className={`${styles.panel} flex flex-col gap-4 p-4 sm:p-5`}
      onSubmit={(e) =>
        form.submit(e, "POST", "/api/v1/me/password", form.values, () => "Password changed. Every other device is now signed out.")
      }
    >
      <div>
        <h3 id="change-password-heading" className={ui.h3}>
          Password
        </h3>
        <p className={`${ui.small} mt-1`}>Changing it signs you out on every other device and stops any copied API token.</p>
      </div>
      {/* Lets password managers file the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="settings-password-current" label="Current password" type="password" autoComplete="current-password" {...form.bind("currentPassword")} />
        <div className="flex flex-col gap-3">
          <Field
            id="settings-password-new"
            label="New password"
            type="password"
            autoComplete="new-password"
            maxLength={1000}
            describedBy="settings-password-rules"
            {...form.bind("newPassword")}
          />
          <ul id="settings-password-rules" className="flex flex-col gap-1.5" aria-label="Password requirements">
            {rules.map((rule) => (
              <li key={rule.id} className={`${styles.rule} flex items-center gap-2`} data-met={rule.met}>
                <svg className={`${styles.check} h-3.5 w-3.5 shrink-0`} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                <span>{rule.label}</span>
                <span className="sr-only">{rule.met ? " (done)" : " (not yet)"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-col items-start gap-2">
        <SubmitButton busy={form.busy} label="Change password" />
        <Status status={form.status} />
      </div>
    </form>
  );
}

export default function AccountSettings({ user, emailOn }: { user: AccountUser; emailOn: boolean }) {
  // username and passwordHash are set together, so no username means a Google or GitHub-only account.
  if (user.username === null) {
    const providers = user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(" or ") || "Google or GitHub";
    return (
      <div className={`${styles.panel} flex flex-col gap-2 p-4 sm:p-5`}>
        <p className={styles.term}>Email</p>
        <p className={styles.value}>{user.email}</p>
        <p className={ui.small}>
          This address comes from your {providers} sign-in, and your account has no password, so it can&rsquo;t be changed here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <UsernameForm username={user.username} />
      <EmailForm email={user.email} verified={user.emailVerifiedAt !== null} emailOn={emailOn} />
      <PasswordForm username={user.username} />
    </div>
  );
}
