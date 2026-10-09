/** 山・森林・村・農地の64Chunkを固定座標でハッシュ化し、生成値の同一性を確認する。 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseProject } from "../packages/project-schema/src/index";
import { generateChunk } from "../packages/world-generator/src/index";
const source = parseProject(
  JSON.parse(readFileSync("demos/worlds/alpine-village.json", "utf8")),
).world.source;
if (source.kind !== "procedural") throw new Error("Expected procedural source");
const hash = createHash("sha256");
for (const chunkZ of [-14, -12, -8, -5, -3, -2, 0, 2])
  for (const chunkX of [-8, -4, -2, 0, 1, 3, 5, 8])
    hash.update(JSON.stringify(generateChunk({ ...source, chunkX, chunkZ })));
console.log(hash.digest("hex"));
