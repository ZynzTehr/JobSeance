import { HONEYPOT_FIELD } from "@/lib/form-guard";

/**
 * A decoy input for the form bot guard. It sits off screen (not display:none,
 * which simple bots skip), out of the tab order and hidden from screen readers,
 * so only scripts that fill every field ever put a value in it.
 */
export default function HoneypotField() {
  return (
    <div aria-hidden="true" className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
      <label>
        Fax number (leave empty)
        <input name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

