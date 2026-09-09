import type { Vec3 } from "../../project-schema/src/index";
export type Quat = [number, number, number, number];
export function quaternion(e: Vec3): Quat {
  const [x, y, z] = e.map((n) => n / 2),
    a = Math.cos(x),
    b = Math.sin(x),
    c = Math.cos(y),
    d = Math.sin(y),
    f = Math.cos(z),
    g = Math.sin(z);
  return [
    b * c * f + a * d * g,
    a * d * f - b * c * g,
    a * c * g + b * d * f,
    a * c * f - b * d * g,
  ];
}
export function multiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function rotate(v: Vec3, q: Quat): Vec3 {
  const r = multiply(multiply(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
}

export function euler([x, y, z, w]: Quat): Vec3 {
  const sine = Math.max(-1, Math.min(1, 2 * (x * z + y * w)));
  if (Math.abs(sine) > 0.9999999)
    return [
      Math.atan2(2 * (x * w + y * z), 1 - 2 * (x * x + z * z)),
      Math.asin(sine),
      0,
    ];
  return [
    Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(Math.max(-1, Math.min(1, 2 * (x * z + y * w)))),
    Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z)),
  ];
}
