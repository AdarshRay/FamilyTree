import { Particles } from "./Particles";

/** Shared obsidian/reactor backdrop — used by the tree canvas, login, and dashboard. */
export function AmbientStage() {
  return (
    <div className="stage">
      <div className="bg-layer bg-radial" />
      <div className="bg-layer bg-reactor">
        <div className="reactor-spin">
          <span className="reactor-blade cyan" />
          <span className="reactor-blade violet" />
        </div>
      </div>
      <div className="bg-layer bg-grid" />
      <div className="bg-layer bg-floor" />
      <Particles />
      <div className="bg-layer bg-scan" />
      <div className="bg-layer bg-sweep" />
      <div className="bg-layer bg-vignette" />
    </div>
  );
}
