import { PersonPicker } from "./PersonPicker";

interface PersonOption {
  name: string;
  label: string;
}

interface Props {
  open: boolean;
  people: PersonOption[];
  value: string | null;
  onChange: (name: string | null) => void;
  onClose: () => void;
}

export function BranchFilter({ open, people, value, onChange, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="branch-overlay" role="dialog" aria-modal="true" aria-labelledby="branch-title">
      <button className="branch-scrim" aria-label="Close branch filter" onClick={onClose} />
      <div className="branch-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />
        <div className="branch-head">
          <div>
            <div className="branch-kicker">Tree View</div>
            <h2 id="branch-title">Branch Filter</h2>
          </div>
          <button className="branch-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <label className="branch-field">
          <span>Show Branch From</span>
          <PersonPicker
            value={value ?? ""}
            onChange={(name) => onChange(name || null)}
            people={people}
            emptyLabel="Full family tree"
          />
        </label>

        <div className="branch-actions">
          <button onClick={() => onChange(null)} disabled={!value}>
            Clear Filter
          </button>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
