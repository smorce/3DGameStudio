import type { Part } from "../../project-schema/src/index";
import { labels } from "../../machine-system/src/index";
export function EasyPalette({
  onAdd,
  activeKind,
  disabled = false,
}: {
  onAdd: (kind: Part["definitionId"]) => void;
  disabled?: boolean;
  activeKind?: Part["definitionId"];
}) {
  const icons = ["▱", "◉", "⌁", "⚙", "➤", "↔", "▣", "↶"];
  return (
    <nav className="palette" aria-label="パーツをえらぶ">
      {(
        [
          "Panel",
          "Wheel",
          "Suspension",
          "Motor",
          "Thruster",
          "Hinge",
          "Block",
          "Steering",
        ] as const
      ).map((kind, i) => (
        <button
          aria-pressed={activeKind === kind}
          className={activeKind === kind ? "active" : ""}
          disabled={disabled}
          key={kind}
          onClick={() => onAdd(kind)}
        >
          <span>{icons[i]}</span>
          {labels[kind]}
        </button>
      ))}
    </nav>
  );
}
