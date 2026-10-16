"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentPropsWithRef } from "react";
import styles from "./autogrow.module.css";

type Props = Omit<ComponentPropsWithRef<"textarea">, "rows">;

/**
 * Height (in px) for a border-box textarea whose content is `scrollHeight`
 * tall, or "" when it's empty (the caller then uses the one-line rows=1 size).
 * The CSS max-height caps the result; past it the box scrolls.
 */
export function autoGrowHeight(value: string, scrollHeight: number, borderTop: number, borderBottom: number): string {
  if (value === "" || !(scrollHeight > 0)) return "";
  return `${Math.ceil(scrollHeight + borderTop + borderBottom)}px`;
}

/**
 * A textarea that starts one line tall and grows (and shrinks) with its text,
 * animating each change of height, up to a cap after which it scrolls. Every
 * prop (including `ref`) passes through to the underlying <textarea>.
 *
 * The height is always measured here rather than with CSS `field-sizing: content`,
 * because a content-sized box has no explicit height for a transition to run between.
 */
export default function AutoGrowTextarea({ ref, className, onInput, value, ...rest }: Props) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const measured = useRef(false);

  const resize = useCallback((animate: boolean) => {
    const el = inner.current;
    if (!el) return;
    const from = el.style.height;
    // Collapsing to auto can shorten the page for a moment; keep the reader's place.
    const pageY = window.scrollY;

    // Measure with the transition off: at height auto a rows=1 textarea is exactly one line tall.
    el.style.transition = "none";
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    const oneLine = `${el.offsetHeight}px`;
    const to =
      autoGrowHeight(el.value, el.scrollHeight, parseFloat(style.borderTopWidth) || 0, parseFloat(style.borderBottomWidth) || 0) ||
      oneLine;

    // Hide the scrollbar until the cap is reached, so it doesn't flash while the box grows.
    const cap = parseFloat(style.maxHeight);
    el.dataset.capped = String(Number.isFinite(cap) && parseFloat(to) >= cap - 1);

    if (animate && from && from !== to) {
      el.style.height = from;
      void el.offsetHeight; // commit the old height so the transition has a start
      el.style.transition = "";
      el.style.height = to;
    } else {
      el.style.height = to;
      void el.offsetHeight;
      el.style.transition = "";
    }
    if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY);
  }, []);

  // Measure after every value change, including programmatic ones (e.g. a
  // "Try the demo example" fill). The first measurement doesn't animate.
  // Effects only, so server and client markup match.
  useLayoutEffect(() => {
    resize(measured.current);
    measured.current = true;
  }, [value, resize]);

  // Text rewraps whenever the box's own width changes (viewport, layout or font load).
  // Only width matters; resize() changes the height, so ignore height-only callbacks.
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize(false);
    });
    observer.observe(el);
    document.fonts?.ready.then(() => resize(false)).catch(() => {});
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
        if (value === undefined) resize(true);
      }}
    />
  );
}
