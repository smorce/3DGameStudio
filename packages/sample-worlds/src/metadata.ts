export interface SampleWorldMetadata {
  id: string;
  name: string;
  shortDescription: string;
  icon: string;
  tags: string[];
  recommendedMachine: "car" | "plane" | "boat";
  sortOrder: number;
}

const metadata: SampleWorldMetadata[] = [
  {
    id: "starter-grassland",
    name: "はじまりの草原",
    shortDescription: "くるまで緩やかな丘を自由に走ろう",
    icon: "🌱",
    tags: ["grassland", "free-drive"],
    recommendedMachine: "car",
    sortOrder: 1,
  },
  {
    id: "airfield",
    name: "飛行場",
    shortDescription: "ひこうきで滑走路から空へ",
    icon: "✈️",
    tags: ["grassland", "flight"],
    recommendedMachine: "plane",
    sortOrder: 2,
  },
  {
    id: "tropical-archipelago",
    name: "南国の群島",
    shortDescription: "ボートで白い砂浜と5つの島をめぐろう",
    icon: "🌴",
    tags: ["tropical", "boat"],
    recommendedMachine: "boat",
    sortOrder: 3,
  },
  {
    id: "toy-islands",
    name: "おもちゃの5島",
    shortDescription: "おもちゃの群島で5つの島をたんけんしよう",
    icon: "🏝️",
    tags: ["temperate", "explore"],
    recommendedMachine: "car",
    sortOrder: 4,
  },
  {
    id: "mountain-island",
    name: "山岳島",
    shortDescription: "山腹道路を登り、観測所と展望地点へ",
    icon: "⛰️",
    tags: ["alpine", "climb"],
    recommendedMachine: "car",
    sortOrder: 5,
  },
  {
    id: "desert-island",
    name: "砂漠",
    shortDescription: "砂丘と前哨基地をつなぐ道でジャンプ",
    icon: "🌵",
    tags: ["desert", "jump"],
    recommendedMachine: "car",
    sortOrder: 6,
  },
  {
    id: "snow-island",
    name: "雪山",
    shortDescription: "雪の峠を登り、山頂の観測施設へ",
    icon: "❄️",
    tags: ["snow", "climb"],
    recommendedMachine: "car",
    sortOrder: 7,
  },
  {
    id: "race-island",
    name: "レースアイランド",
    shortDescription: "チェックポイントを通って島を一周",
    icon: "🏁",
    tags: ["temperate", "race"],
    recommendedMachine: "car",
    sortOrder: 8,
  },
];
export const sampleWorldCatalog: readonly SampleWorldMetadata[] = metadata.sort(
  (a, b) => a.sortOrder - b.sortOrder,
);
export const findSampleWorld = (id: string) =>
  sampleWorldCatalog.find((world) => world.id === id);
