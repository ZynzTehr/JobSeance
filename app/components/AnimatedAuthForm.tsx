"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./AnimatedAuthForm.module.css";

export type AuthValues =
  | { mode: "login"; username: string; password: string }
  | { mode: "signup"; username: string; email: string; password: string };

type Props = {
  /** Connect this callback to your authentication provider or API. Throw an Error to show its message. */
  onAuthenticate?: (values: AuthValues) => void | Promise<void>;
  /** Which side the card opens on (`/signup` opens Register). */
  initialMode?: Mode;
  /** A message to show on load, e.g. after a failed Google or GitHub sign-in. */
  initialStatus?: string;
  /** Social sign-in buttons; each one shows only when its provider is configured. */
  oauth?: { google: boolean; github: boolean };
  /** Shown just below the card, e.g. the age and Terms notice. */
  footer?: ReactNode;
};

type Mode = AuthValues["mode"];

function ProviderIcon({ provider }: { provider: "google" | "github" }) {
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"
      />
    </svg>
  );
}

function OAuthButtons({ oauth, active }: { oauth: NonNullable<Props["oauth"]>; active: boolean }) {
  const providers = (["google", "github"] as const).filter((p) => oauth[p]);
  if (providers.length === 0) return null;
  return (
    <div className={`${styles.oauth} ${styles.animate}`}>
      <span className={styles.oauthDivider}>or continue with</span>
      <div className={styles.oauthRow}>
        {providers.map((p) => (
          <a key={p} className={styles.oauthButton} href={`/api/auth/${p}`} tabIndex={active ? 0 : -1}>
            <ProviderIcon provider={p} />
            {p === "google" ? "Google" : "GitHub"}
          </a>
        ))}
      </div>
    </div>
  );
}

function Icon({ name }: { name: "user" | "email" | "lock" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "user" && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      )}
      {name === "email" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      )}
      {name === "lock" && (
        <>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
        </>
      )}
    </svg>
  );
}

export default function AnimatedAuthForm({
  onAuthenticate,
  initialMode = "login",
  initialStatus = "",
  oauth = { google: false, github: false },
  footer,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const hasOAuth = oauth.google || oauth.github;
  const loginUsername = useRef<HTMLInputElement>(null);
  const signupUsername = useRef<HTMLInputElement>(null);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setStatus("");
    // Wait for the new form's disabled state to update before focusing it.
    requestAnimationFrame(() => {
      const input = nextMode === "login" ? loginUsername : signupUsername;
      input.current?.focus({ preventScroll: true });
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, formMode: Mode) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    const credentials = {
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    };
    const values: AuthValues =
      formMode === "signup"
        ? { ...credentials, mode: "signup", email: String(data.get("email") ?? "").trim() }
        : { ...credentials, mode: "login" };

    if (!onAuthenticate) {
      setStatus("Demo only. Connect onAuthenticate to enable authentication.");
      return;
    }

    setPending(true);
    setStatus("");
    try {
      await onAuthenticate(values);
      setStatus("Signed in. Taking you to your dashboard…");
    } catch (error) {
      setStatus(
        error instanceof Error && error.message ? error.message : "We couldn’t complete your request. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.stage}>
      <section
        className={`${styles.card} ${mode === "signup" ? styles.signup : ""} ${hasOAuth ? styles.withOAuth : ""}`}
        aria-label="Account access"
      >
        <div className={styles.diagonal} aria-hidden="true" />

        <form
          className={`${styles.form} ${styles.loginForm}`}
          aria-label="Login"
          aria-hidden={mode !== "login"}
          aria-busy={mode === "login" && pending}
          onSubmit={(event) => handleSubmit(event, "login")}
        >
          <fieldset disabled={mode !== "login" || pending}>
            <legend className={styles.srOnly}>Login credentials</legend>
            <h1 className={styles.animate}>Login</h1>
            <label className={`${styles.field} ${styles.animate}`}>
              <input
                ref={loginUsername}
                name="username"
                type="text"
                autoComplete="username"
                placeholder=" "
                required
                pattern=".*\S.*"
              />
              <span>Username</span>
              <Icon name="user" />
            </label>
            <label className={`${styles.field} ${styles.animate}`}>
              <input name="password" type="password" autoComplete="current-password" placeholder=" " required />
              <span>Password</span>
              <Icon name="lock" />
            </label>
            <button className={`${styles.submit} ${styles.animate}`} type="submit">
              {pending && mode === "login" ? "Logging in…" : "Login"}
            </button>
            <OAuthButtons oauth={oauth} active={mode === "login"} />
            <p className={`${styles.switch} ${styles.animate}`}>
              Don’t have an account?{" "}
              <button type="button" onClick={() => switchMode("signup")} tabIndex={mode === "login" ? 0 : -1}>
                Sign up
              </button>
            </p>
          </fieldset>
        </form>

        <div className={`${styles.welcome} ${styles.loginWelcome}`} aria-hidden={mode !== "login"}>
          <h2 className={styles.animate}>WELCOME<br /> BACK!</h2>
          <p className={styles.animate}>We’re so happy to have you with us again. If you need anything, we are here to help.</p>
        </div>

        <form
          className={`${styles.form} ${styles.signupForm}`}
          aria-label="Register"
          aria-hidden={mode !== "signup"}
          aria-busy={mode === "signup" && pending}
          onSubmit={(event) => handleSubmit(event, "signup")}
        >
          <fieldset disabled={mode !== "signup" || pending}>
            <legend className={styles.srOnly}>Registration details</legend>
            <h1 className={styles.animate}>Register</h1>
            <label className={`${styles.field} ${styles.animate}`}>
              <input
                ref={signupUsername}
                name="username"
                type="text"
                autoComplete="username"
                placeholder=" "
                required
                maxLength={20}
                pattern="[A-Za-z0-9_]{3,20}"
                title="3–20 letters, numbers or underscores"
              />
              <span>Username</span>
              <Icon name="user" />
            </label>
            <label className={`${styles.field} ${styles.animate}`}>
              <input name="email" type="email" autoComplete="email" placeholder=" " required />
              <span>Email</span>
              <Icon name="email" />
            </label>
            <label className={`${styles.field} ${styles.animate}`}>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder=" "
                minLength={15}
                maxLength={64}
                title="15–64 characters"
                required
              />
              <span>Password (15+ characters)</span>
              <Icon name="lock" />
            </label>
            <button className={`${styles.submit} ${styles.animate}`} type="submit">
              {pending && mode === "signup" ? "Creating account…" : "Register"}
            </button>
            <OAuthButtons oauth={oauth} active={mode === "signup"} />
            <p className={`${styles.switch} ${styles.animate}`}>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")} tabIndex={mode === "signup" ? 0 : -1}>
                Sign in
              </button>
            </p>
          </fieldset>
        </form>

        <div className={`${styles.welcome} ${styles.signupWelcome}`} aria-hidden={mode !== "signup"}>
          <h2 className={styles.animate}>WELCOME!</h2>
          <p className={styles.animate}>We’re delighted to have you here. If you need any assistance, feel free to reach out.</p>
        </div>
      </section>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
      {footer}
    </main>
  );
}
