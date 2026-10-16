"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentPropsWithRef } from "react";
import styles from "./autogrow.module.css";

type Props = Omit<ComponentPropsWithRef<"textarea">, "rows">;

/**
 * Height (in px) for a border-box textarea whose content is `scrollHeight`
 * tall, or "" to fall back to the one-line rows=1 size when it is empty.
 * The CSS max-height caps the result; past it the box scrolls.
 */
export function autoGrowHeight(value: string, scrollHeight: number, borderTop: number, borderBottom: number): string {
  if (value === "" || !(scrollHeight > 0)) return "";
  return `${Math.ceil(scrollHeight + borderTop + borderBottom)}px`;
}

function supportsFieldSizing(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
}

/**
 * A textarea that starts one line tall and grows as its text wraps onto more
 * lines, up to a cap after which it scrolls. Uses CSS `field-sizing: content`
 * where supported, and measures scrollHeight everywhere else. Every prop
 * (including `ref`) passes through to the underlying <textarea>.
 */
export default function AutoGrowTextarea({ ref, className, onInput, value, ...rest }: Props) {
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el || supportsFieldSizing()) return;
    // Collapsing to auto can shorten the page for a moment; keep the reader's place.
    const pageY = window.scrollY;
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    el.style.height = autoGrowHeight(
      el.value,
      el.scrollHeight,
      parseFloat(style.borderTopWidth) || 0,
      parseFloat(style.borderBottomWidth) || 0,
    );
    if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY);
  }, []);

  // Measure after every value change, including programmatic ones (e.g. a
  // "Try the demo example" fill). Effects only, so server and client markup match.
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  // Text rewraps whenever the box's own width changes (viewport, layout or font load).
  // Only width matters; resize() changes the height, so ignore height-only callbacks.
  useEffect(() => {
    const el = inner.current;
    if (!el || supportsFieldSizing() || typeof ResizeObserver === "undefined") return;
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(el);
    document.fonts?.ready.then(resize).catch(() => {});
    return () => observer.disconnect();
  }, [resize]);

  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      inner.current = node;
      if (typeof ref === "function") {
        const cleanup = ref(node);
        if (typeof cleanup === "function") return cleanup;
        return () => {
          ref(null);
        };
      }
      if (ref) {
        ref.current = node;
        return () => {
          ref.current = null;
        };
      }
    },
    [ref],
  );

  return (
    <textarea
      {...rest}
      ref={setRef}
      rows={1}
      value={value}
      className={className ? `${className} ${styles.autogrow}` : styles.autogrow}
      onInput={(e) => {
        onInput?.(e);
        // Uncontrolled use: no value prop change to trigger the effect.
        if (value === undefined) resize();
      }}
    />
  );
}
