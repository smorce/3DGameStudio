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

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const alpha = Math.min(1, Math.max(0, t));
  return [
    a[0] + (b[0] - a[0]) * alpha,
    a[1] + (b[1] - a[1]) * alpha,
    a[2] + (b[2] - a[2]) * alpha,
  ];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  const alpha = Math.min(1, Math.max(0, t));
  let bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const x = a[0] + (bx - a[0]) * alpha,
      y = a[1] + (by - a[1]) * alpha,
      z = a[2] + (bz - a[2]) * alpha,
      w = a[3] + (bw - a[3]) * alpha,
      length = Math.hypot(x, y, z, w) || 1;
    return [x / length, y / length, z / length, w / length];
  }
  const theta = Math.acos(Math.min(1, dot)),
    sin = Math.sin(theta) || 1,
    w1 = Math.sin((1 - alpha) * theta) / sin,
    w2 = Math.sin(alpha * theta) / sin;
  return [
    a[0] * w1 + bx * w2,
    a[1] * w1 + by * w2,
    a[2] * w1 + bz * w2,
    a[3] * w1 + bw * w2,
  ];
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
