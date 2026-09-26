import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PersonOption {
  name: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  people: PersonOption[];
  placeholder?: string;
  /** Text shown for the "no selection" state, e.g. "Full family tree". */
  emptyLabel?: string;
}

/**
 * Type-to-filter person picker — replaces a plain <select>, which is
 * painful to scroll through once the tree has 80+ names.
 *
 * The dropdown list is rendered into a portal (document.body) rather than
 * inline, because every place this is used (Relationship Finder, Branch
 * Filter, True Rename) sits inside a modal with `overflow-y: auto` — an
 * inline absolutely-positioned list would get silently clipped by that
 * scroll boundary. The portal is positioned from the input's live
 * bounding rect instead.
 */
export function PersonPicker({ value, onChange, people, placeholder, emptyLabel }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = people.find((p) => p.name === value);

  useEffect(() => {
    // Reflect the current selection into the text box whenever it's closed.
    if (!open) setQuery(selected ? selected.label : "");
  }, [value, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const reposition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Any scroll (including inside a scrollable modal ancestor) or resize
    // can move the input relative to the viewport — keep the portal glued to it.
    const onScrollOrResize = () => reposition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as HTMLElement)?.closest?.(".ppicker-list")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (q ? people.filter((p) => p.label.toLowerCase().includes(q)) : people).slice(0, 40);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="ppicker" ref={rootRef}>
      <input
        ref={inputRef}
        className="ppicker-input"
        value={open ? query : selected ? selected.label : ""}
        placeholder={placeholder ?? emptyLabel ?? "Search a person…"}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHi(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (matches[hi]) pick(matches[hi].name);
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="ppicker-clear"
          aria-label="Clear selection"
          onClick={() => {
            onChange("");
            setQuery("");
          }}
        >
          ✕
        </button>
      )}
      {open &&
        rect &&
        createPortal(
          <div
            className="ppicker-list"
            role="listbox"
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
          >
            {emptyLabel && !q && (
              <button
                type="button"
                className={"ppicker-opt" + (!value ? " active" : "")}
                onClick={() => pick("")}
              >
                {emptyLabel}
              </button>
            )}
            {matches.length === 0 && <div className="ppicker-empty">No matches</div>}
            {matches.map((p, i) => (
              <button
                type="button"
                key={p.name}
                className={"ppicker-opt" + (i === hi ? " hi" : "") + (p.name === value ? " active" : "")}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(p.name)}
              >
                {p.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
