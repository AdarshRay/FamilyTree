import { Avatar } from "./Avatar";
import { GEN_LABEL, type Person } from "../data/family";
import type { PersonEntry } from "../lib/layout";
import { effectiveFields, type Overrides } from "../lib/store";

interface Props {
  entry: PersonEntry;
  overrides: Overrides;
  onClose: () => void;
  onSelect: (name: string) => void;
  onShowBranch?: (name: string) => void;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

/** Stable pseudo-ID for flavor (e.g. SM-3F9A2C). */
function idHash(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
}

function HoloRel({
  label,
  people,
  overrides,
  onSelect,
  empty,
}: {
  label: string;
  people: Person[];
  overrides: Overrides;
  onSelect: (n: string) => void;
  empty: string;
}) {
  return (
    <div className="hc-relgroup">
      <div className="hc-rellabel">{label}</div>
      {people.length ? (
        <div className="hc-relchips">
          {people.map((pp) => {
            const eff = effectiveFields(pp, overrides[pp.name]);
            return (
              <button
                key={pp.name}
                className={"hc-chip" + (eff.gender === "f" ? " f" : "")}
                onClick={() => onSelect(pp.name)}
              >
                {eff.name}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="hc-relempty">{empty}</div>
      )}
    </div>
  );
}

/** Iron-Man / JARVIS style holographic dossier that materializes over the tree. */
export function HoloCard({ entry, overrides, onClose, onSelect, onShowBranch }: Props) {
  const p = entry.person;
  const eff = effectiveFields(p, overrides[p.name]);
  const displayPerson = { ...p, name: eff.name, gender: eff.gender };
  const profile: [string, string][] = (
    [
      ["Born", eff.dob],
      ["Birthplace", eff.birthplace],
      ["Occupation", eff.occupation],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <div className="holo-overlay">
      <div className="holo-scrim" onClick={onClose} />
      <div className="holo-grid" />

      {/* keyed by name so each new person re-materializes */}
      <div className="holo-card" role="dialog" aria-label={eff.name} key={p.name}>
        <span className="hc-corner tl" />
        <span className="hc-corner tr" />
        <span className="hc-corner bl" />
        <span className="hc-corner br" />

        <div className="holo-topbar">
          <span className="hc-tag">
            <i className="hc-dot" /> Lineage Dossier
          </span>
          <span className="hc-id">ID · SM-{idHash(p.name)}</span>
          {onShowBranch && (
            <button
              className="hc-branch-btn"
              onClick={() => onShowBranch(p.name)}
              aria-label="Show Branch"
              title="Show Branch"
            >
              ⌁
            </button>
          )}
          <button className="hc-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="holo-body">
          <div className="holo-portrait">
            <svg className="hc-reticle" viewBox="0 0 200 200" aria-hidden="true">
              <g className="hc-ring-rot">
                <circle cx="100" cy="100" r="94" className="hc-r-dash" />
              </g>
              <circle cx="100" cy="100" r="82" className="hc-r-thin" />
              <path
                className="hc-tick"
                d="M100 4 V16 M100 184 V196 M4 100 H16 M184 100 H196"
              />
            </svg>
            <div className="holo-photo">
              <Avatar
                person={displayPerson}
                photoFile={eff.photoFile}
                photoData={eff.photoData}
                photoStoragePath={eff.photoStoragePath}
                photoX={eff.photoX}
                photoY={eff.photoY}
                photoZoom={eff.photoZoom}
              />
            </div>
            <div className="hc-sweep" />
          </div>

          <div className="holo-info">
            <div className="hc-name">{eff.name}</div>
            <div className="hc-gen">
              ◇ Generation {ROMAN[entry.gen] ?? entry.gen + 1} · {GEN_LABEL[entry.gen]}
            </div>

            {profile.length > 0 && (
              <div className="hc-profile">
                {profile.map(([k, v]) => (
                  <div className="hc-kv" key={k}>
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
            )}

            {eff.notes && <div className="hc-note">{eff.notes}</div>}
          </div>
        </div>

        <div className="holo-rels">
          <HoloRel
            label={entry.spouses.length > 1 ? "Spouses" : "Spouse"}
            people={entry.spouses}
            overrides={overrides}
            onSelect={onSelect}
            empty="—"
          />
          <HoloRel
            label="Parents"
            people={entry.parents}
            overrides={overrides}
            onSelect={onSelect}
            empty="Root of lineage"
          />
          <HoloRel label="Children" people={entry.children} overrides={overrides} onSelect={onSelect} empty="—" />
        </div>
      </div>
    </div>
  );
}
