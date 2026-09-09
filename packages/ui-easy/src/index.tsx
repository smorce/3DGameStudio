import type { Part } from "../../project-schema/src/index";
import { labels } from "../../machine-system/src/index";
export function EasyPalette({
  onAdd,
  disabled = false,
}: {
  onAdd: (kind: Part["definitionId"]) => void;
  disabled?: boolean;
}) {
  const icons = ["▱", "◉", "⚙", "➤", "↔", "◈", "▣", "↶"];
  return (
    <nav className="palette" aria-label="パーツをえらぶ">
      {(
        [
          "Panel",
          "Wheel",
          "Motor",
          "Thruster",
          "Hinge",
          "Wing",
          "Block",
          "Steering",
        ] as const
      ).map((kind, i) => (
        <button disabled={disabled} key={kind} onClick={() => onAdd(kind)}>
          <span>{icons[i]}</span>
          {labels[kind]}
        </button>
      ))}
    </nav>
  );
}
