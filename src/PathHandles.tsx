import { useRef } from "react";
import type { Item, PathNode, Point } from "./model";
export function PathHandles({
  item,
  change,
}: {
  item: Item;
  change: (nodes: PathNode[]) => void;
}) {
  const active = useRef<{ index: number; key: "in" | "out" | "node" } | null>(
    null,
  );
  const nodes = item.nodes!;
  return (
    <svg
      className="path-handles"
      width={item.w}
      height={item.h}
      onPointerMove={(e) => {
        if (!active.current) return;
        e.stopPropagation();
        const matrix = e.currentTarget.getScreenCTM();
        if (!matrix) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
          matrix.inverse(),
        );
        const pos = {
          x: Math.max(-400, Math.min(500, (p.x * 100) / item.w)),
          y: Math.max(-400, Math.min(500, (p.y * 100) / item.h)),
        };
        const { index, key } = active.current;
        change(
          nodes.map((n, i) =>
            i !== index
              ? n
              : key === "node"
                ? { ...n, ...pos }
                : { ...n, [key]: pos },
          ),
        );
      }}
      onPointerUp={() => (active.current = null)}
      onPointerCancel={() => (active.current = null)}
    >
      {nodes.map((n, i) => (
        <g key={i}>
          {(["in", "out", "node"] as const).map((key) => {
            const v: Point | undefined = key === "node" ? n : n[key];
            if (!v) return null;
            const cx = (v.x * item.w) / 100,
              cy = (v.y * item.h) / 100;
            return (
              <g key={key}>
                {key !== "node" && (
                  <line
                    x1={(n.x * item.w) / 100}
                    y1={(n.y * item.h) / 100}
                    x2={cx}
                    y2={cy}
                    stroke="#167884"
                    strokeWidth={2}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={key === "node" ? 8 : 6}
                  fill={key === "node" ? "#fff" : "#ffc866"}
                  stroke="#146779"
                  strokeWidth={3}
                  style={{ pointerEvents: "all", cursor: "crosshair" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    active.current = { index: i, key };
                  }}
                />
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
