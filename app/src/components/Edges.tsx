import type { Edge } from "../lib/layout";

/** All connectors (marriage links + parent→child buses) in one SVG layer. */
export function Edges({ edges, width, height }: { edges: Edge[]; width: number; height: number }) {
  return (
    <svg className="edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {edges.map((e, i) => (
        <path key={i} d={e.d} className={["edge", e.gender === "f" ? "edge-f" : ""].filter(Boolean).join(" ")} />
      ))}
    </svg>
  );
}
