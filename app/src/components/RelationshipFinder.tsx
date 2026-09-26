import { PersonPicker } from "./PersonPicker";

interface PersonOption {
  name: string;
  label: string;
}

interface Props {
  open: boolean;
  people: PersonOption[];
  first: string;
  second: string;
  result: string;
  onFirst: (name: string) => void;
  onSecond: (name: string) => void;
  onClose: () => void;
  onFocus: (name: string) => void;
}

export function RelationshipFinder({
  open,
  people,
  first,
  second,
  result,
  onFirst,
  onSecond,
  onClose,
  onFocus,
}: Props) {
  if (!open) return null;

  return (
    <div className="relation-overlay" role="dialog" aria-modal="true" aria-labelledby="relation-title">
      <button className="relation-scrim" aria-label="Close relationship finder" onClick={onClose} />
      <div className="relation-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />
        <div className="relation-head">
          <div>
            <div className="relation-kicker">Lineage Tool</div>
            <h2 id="relation-title">Relationship Finder</h2>
          </div>
          <button className="relation-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="relation-pickers">
          <label className="relation-field">
            <span>Person A</span>
            <PersonPicker value={first} onChange={onFirst} people={people} placeholder="Search person A…" />
          </label>

          <label className="relation-field">
            <span>Person B</span>
            <PersonPicker value={second} onChange={onSecond} people={people} placeholder="Search person B…" />
          </label>
        </div>

        <div className="relation-result">{result || "Select two family members"}</div>

        <div className="relation-actions">
          <button disabled={!first} onClick={() => onFocus(first)}>
            Focus A
          </button>
          <button disabled={!second} onClick={() => onFocus(second)}>
            Focus B
          </button>
        </div>
      </div>
    </div>
  );
}
