import { labels } from "../../machine-system/src/index";
import {
  MAX_MOTOR_TARGET_ANGULAR_VELOCITY,
  uid,
  type Machine,
  type Part,
  type Vec3,
} from "../../project-schema/src/index";
import type { Command } from "../../command-system/src/index";
export function MachineInspector({
  machine,
  selected,
  onSelect,
  execute,
  advanced = false,
}: {
  machine?: Machine;
  selected?: string;
  onSelect: (id: string) => void;
  execute: (command: Command) => void;
  advanced?: boolean;
}) {
  const part = machine?.parts.find((a) => a.id === selected);
  if (!machine) return null;
  const transformKeys =
    part?.definitionId === "Panel"
      ? (["position", "rotation"] as const)
      : (["position", "rotation", "scale"] as const);
  const patch = (p: Partial<Omit<Part, "id" | "definitionId">>) =>
    part &&
    execute({
      type: "part.update",
      machineId: machine.id,
      partId: part.id,
      patch: p,
    });
  return (
    <>
      <section>
        <h3>{advanced ? "Hierarchy" : "パーツの一覧"}</h3>
        <strong>▾ {machine.name}</strong>
        <div className="part-tree">
          {machine.parts.map((p, i) => (
            <button
              className={p.id === selected ? "selected" : ""}
              key={p.id}
              onClick={() => onSelect(p.id)}
            >
              ◈ {labels[p.definitionId]}{" "}
              <small>{String(i + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </div>
      </section>
      {part && (
        <section>
          <h3>{advanced ? "Inspector" : "パーツをくわしく"}</h3>
          <p>{labels[part.definitionId]}</p>
          {transformKeys.map((key) => (
            <div key={key}>
              <h4>
                {{ position: "位置", rotation: "回転", scale: "大きさ" }[key]}
              </h4>
              <div className="vector">
                {part.transform[key].map((v, i) => (
                  <label key={i}>
                    {"XYZ"[i]}
                    <input
                      aria-label={`${key} ${"XYZ"[i]}`}
                      type="number"
                      step={key === "scale" ? 0.1 : 0.25}
                      value={Math.round(v * 100) / 100}
                      onChange={(e) => {
                        const value = [...part.transform[key]] as Vec3;
                        value[i] = Number(e.target.value);
                        patch({
                          transform: { ...part.transform, [key]: value },
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          {advanced && part.definitionId === "Panel" && (
            <label className="field">
              厚さ
              <input
                aria-label="Panel thickness"
                type="number"
                min="0.02"
                max="1"
                step="0.01"
                value={part.physics.size[1]}
                onChange={(e) =>
                  patch({
                    physics: {
                      ...part.physics,
                      size: [
                        part.physics.size[0],
                        Number(e.target.value),
                        part.physics.size[2],
                      ],
                    },
                  })
                }
              />
            </label>
          )}
          {part.definitionId === "Motor" && !advanced ? (
            <>
              <label className="field">
                回転の速さ
                <input
                  aria-label="回転の速さ"
                  type="range"
                  min="0"
                  max={MAX_MOTOR_TARGET_ANGULAR_VELOCITY}
                  step="0.5"
                  value={part.actuator.targetAngularVelocity}
                  onChange={(e) =>
                    patch({
                      actuator: {
                        ...part.actuator,
                        targetAngularVelocity: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                力強さ
                <input
                  aria-label="力強さ"
                  type="range"
                  min="0"
                  max="1000"
                  step="10"
                  value={part.actuator.motorTorque}
                  onChange={(e) =>
                    patch({
                      actuator: {
                        ...part.actuator,
                        motorTorque: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </>
          ) : (
            part.definitionId !== "Motor" && (
              <label className="field">
                はやさ
                <input
                  aria-label="はやさ"
                  type="range"
                  min="0"
                  max="1000"
                  step="10"
                  value={part.actuator.motorTorque}
                  onChange={(e) =>
                    patch({
                      actuator: {
                        ...part.actuator,
                        motorTorque: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            )
          )}
          <label className="field">
            まがりやすさ
            <input
              aria-label="まがりやすさ"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={part.actuator.steering}
              onChange={(e) =>
                patch({
                  actuator: {
                    ...part.actuator,
                    steering: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label className="field">
            モーター
            <input
              aria-label="モーター有効"
              type="checkbox"
              checked={part.actuator.enabled}
              onChange={(e) =>
                patch({
                  actuator: { ...part.actuator, enabled: e.target.checked },
                })
              }
            />
          </label>
          {advanced && (
            <>
              <h4>Physics</h4>
              {(["mass", "friction", "restitution"] as const).map((key) => (
                <label className="field" key={key}>
                  {key}
                  <input
                    aria-label={key}
                    type="number"
                    step="0.01"
                    value={part.physics[key]}
                    onChange={(e) =>
                      patch({
                        physics: {
                          ...part.physics,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
              {part.definitionId === "Motor" ? (
                <>
                  <label className="field">
                    最大トルク（N·m）
                    <input
                      aria-label="最大トルク"
                      type="number"
                      min="0"
                      max="10000"
                      value={part.actuator.motorTorque}
                      onChange={(e) =>
                        patch({
                          actuator: {
                            ...part.actuator,
                            motorTorque: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    目標角速度（rad/s）
                    <input
                      aria-label="目標角速度"
                      type="number"
                      min="0"
                      max={MAX_MOTOR_TARGET_ANGULAR_VELOCITY}
                      step="0.1"
                      value={part.actuator.targetAngularVelocity}
                      onChange={(e) =>
                        patch({
                          actuator: {
                            ...part.actuator,
                            targetAngularVelocity: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </>
              ) : (
                <label className="field">
                  motorTorque
                  <input
                    aria-label="motorTorque"
                    type="number"
                    value={part.actuator.motorTorque}
                    onChange={(e) =>
                      patch({
                        actuator: {
                          ...part.actuator,
                          motorTorque: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
              <label className="field">
                Collider
                <select
                  aria-label="Collider"
                  value={part.physics.collider}
                  onChange={(e) =>
                    patch({
                      physics: {
                        ...part.physics,
                        collider: e.target.value as "box" | "cylinder",
                      },
                    })
                  }
                >
                  <option value="box">Box</option>
                  <option value="cylinder">Cylinder</option>
                </select>
              </label>
            </>
          )}
          <h4>接続</h4>
          {machine.connections
            .filter((c) => c.a === part.id || c.b === part.id)
            .map((c) => (
              <div key={c.id} className="connection">
                {advanced ? (
                  <div>
                    <select
                      aria-label="Joint type"
                      value={c.type}
                      onChange={(e) =>
                        execute({
                          type: "part.connection.update",
                          machineId: machine.id,
                          connectionId: c.id,
                          patch: {
                            type: e.target.value as "fixed" | "revolute",
                          },
                        })
                      }
                    >
                      <option value="fixed">Fixed</option>
                      <option value="revolute">Revolute</option>
                    </select>
                    <label className="field">
                      Damping
                      <input
                        aria-label="Joint damping"
                        type="number"
                        step="0.1"
                        value={c.damping}
                        onChange={(e) =>
                          execute({
                            type: "part.connection.update",
                            machineId: machine.id,
                            connectionId: c.id,
                            patch: { damping: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                    <div className="vector">
                      {c.axis.map((v, i) => (
                        <label key={i}>
                          軸 {"XYZ"[i]}
                          <input
                            aria-label={`Joint axis ${"XYZ"[i]}`}
                            type="number"
                            value={v}
                            onChange={(e) => {
                              const axis = [...c.axis] as Vec3;
                              axis[i] = Number(e.target.value);
                              execute({
                                type: "part.connection.update",
                                machineId: machine.id,
                                connectionId: c.id,
                                patch: { axis },
                              });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span>接続済み</span>
                )}
                <button
                  onClick={() =>
                    execute({
                      type: "part.disconnect",
                      machineId: machine.id,
                      connectionId: c.id,
                    })
                  }
                >
                  はずす
                </button>
              </div>
            ))}
          {machine.parts.filter((p) => p.id !== part.id).length > 0 &&
            !machine.connections.some((c) => c.b === part.id) && (
              <button
                onClick={() => {
                  const parent = machine.parts.find((p) => p.id !== part.id)!;
                  execute({
                    type: "part.connect",
                    machineId: machine.id,
                    connection: {
                      id: uid(),
                      a: parent.id,
                      b: part.id,
                      connectorA: parent.connectors[0].id,
                      connectorB: part.connectors[0].id,
                      type:
                        part.definitionId === "Wheel" ? "revolute" : "fixed",
                      axis: [1, 0, 0],
                      damping: 0.2,
                    },
                  });
                }}
              >
                車体につなぐ
              </button>
            )}
        </section>
      )}
    </>
  );
}
