"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const interval = window.setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onChange);
  };
}

const localHour = () => new Date().getHours();
// Keep the server and first client render consistent until local time is available.
const serverHour = () => null;

export default function Greeting({ username }: { username: string | null }) {
  const hour = useSyncExternalStore(subscribe, localHour, serverHour);
  const message = hour === null ? "Hello" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return <>{message}{username ? `, ${username}` : ""}</>;
}
