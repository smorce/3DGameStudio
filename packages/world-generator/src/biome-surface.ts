import { seedUnit } from "./seed";
export interface BiomeSurfaceProfile {
  id: string;
  underwaterColor: string;
  shoreColor: string;
  lowlandColors: string[];
  highlandColor: string;
  rockColor: string;
  snowColor?: string;
  snowLine?: number;
  shoreMaxHeight: number;
  highlandMinHeight: number;
}
// v1は保存済みBakeの外観を固定するため変更せず、新版を追加する。
const profile = (
  id: string,
  shoreColor: string,
  lowlandColors: string[],
  highlandColor: string,
  rockColor: string,
  snowLine?: number,
): BiomeSurfaceProfile => ({
  id,
  underwaterColor: "#487e89",
  shoreColor,
  lowlandColors,
  highlandColor,
  rockColor,
  shoreMaxHeight: 1.5,
  highlandMinHeight: 38,
  ...(snowLine === undefined ? {} : { snowLine, snowColor: "#f2f7fa" }),
});
export const biomeSurfaceProfilesV1: Record<string, BiomeSurfaceProfile> = {
  temperate: profile(
    "temperate",
    "#d9c994",
    ["#7cab68", "#89b772", "#739e61"],
    "#76856c",
    "#92918a",
  ),
  grassland: profile(
    "grassland",
    "#d9c994",
    ["#8cbb70", "#95bf78"],
    "#789769",
    "#92918a",
  ),
  tropical: profile(
    "tropical",
    "#f3e5bd",
    ["#58ad73", "#70bc81"],
    "#528c69",
    "#93958c",
  ),
  alpine: profile(
    "alpine",
    "#b8b7a5",
    ["#84947d", "#748774"],
    "#939b9c",
    "#828b91",
    78,
  ),
  desert: profile(
    "desert",
    "#efd49a",
    ["#d8ae69", "#dfbb7d", "#c8985b"],
    "#ba8053",
    "#a66d49",
  ),
  snow: profile(
    "snow",
    "#becbd1",
    ["#b8c6ce", "#ced9df"],
    "#dde6ec",
    "#93a3b0",
    24,
  ),
};
export const biomeSurfaceCatalog: Readonly<
  Record<number, Readonly<Record<string, BiomeSurfaceProfile>>>
> = {
  1: biomeSurfaceProfilesV1,
};
export function biomeSurfaceProfiles(version = 1) {
  const profiles = biomeSurfaceCatalog[version];
  if (!profiles)
    throw new Error(`Unsupported biome profile version: ${version}`);
  return profiles;
}
export function biomeSurfaceColor(
  biome: string,
  height: number,
  slope: number,
  x: number,
  z: number,
  seed: number,
  biomeProfileVersion = 1,
) {
  const profiles = biomeSurfaceProfiles(biomeProfileVersion);
  const p = profiles[biome] ?? profiles.temperate;
  if (height < -1.2) return p.underwaterColor;
  if (height < p.shoreMaxHeight) return p.shoreColor;
  if (p.snowLine !== undefined && height >= p.snowLine) return p.snowColor!;
  if (slope > 42) return p.rockColor;
  if (height >= p.highlandMinHeight) return p.highlandColor;
  return p.lowlandColors[
    Math.floor(
      seedUnit(seed, "surface", `${Math.floor(x)},${Math.floor(z)}`) *
        p.lowlandColors.length,
    )
  ];
}
