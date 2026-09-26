import { Avatar } from "./Avatar";
import { CARD_W, CARD_H, type CardBox } from "../lib/layout";
import { effectiveFields, type PersonOverride } from "../lib/store";

interface Props {
  card: CardBox;
  selectedName: string | null;
  matchNames: Set<string> | null;
  override?: PersonOverride;
  isFounder?: boolean;
  /** null = no hover active; otherwise the set of names on the hovered lineage */
  lineage?: Set<string> | null;
}

/**
 * A glowing lineage node. Selection/pan is handled centrally by the
 * viewport pointer handlers (this card just exposes `data-name`), which
 * keeps click-vs-drag disambiguation in a single place.
 */
export function PersonCard({
  card,
  selectedName,
  matchNames,
  override,
  isFounder,
  lineage,
}: Props) {
  const p = card.person;
  const eff = effectiveFields(p, override);
  const displayPerson = { ...p, name: eff.name, gender: eff.gender };
  const gender = eff.gender;
  const isSel = selectedName === p.name;
  const searchDim = matchNames !== null && !matchNames.has(p.name);
  const onLineage = lineage != null && lineage.has(p.name);
  const lineageDim = lineage != null && !lineage.has(p.name);
  const cls = [
    "card",
    gender === "f" ? "f" : "",
    card.isInLaw ? "inlaw" : "",
    isSel ? "sel" : "",
    isFounder ? "founder" : "",
    onLineage ? "kin" : "",
    searchDim || lineageDim ? "dim" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const role = isFounder ? "❖ Founder" : eff.occupation ? eff.occupation : card.relationLabel ?? "◈ Lineage";

  return (
    <div className="node" style={{ left: card.x, top: card.y, width: CARD_W, height: CARD_H }}>
      {isFounder && (
        <span className="crown" aria-hidden="true">
          ♛
        </span>
      )}
      <div className={cls} data-name={p.name}>
        <span className="corner c-tl" />
        <span className="corner c-tr" />
        <span className="corner c-bl" />
        <span className="corner c-br" />
        <div className="photo-wrap">
          <Avatar
            person={displayPerson}
            photoFile={eff.photoFile}
            photoData={eff.photoData}
            photoStoragePath={eff.photoStoragePath}
            photoX={eff.photoX}
            photoY={eff.photoY}
            photoZoom={eff.photoZoom}
          />
          <div className="scanline" />
        </div>
        <div className="name-bar">
          <div className="nm">{eff.name}</div>
          <div className="role">{role}</div>
        </div>
      </div>
    </div>
  );
}
