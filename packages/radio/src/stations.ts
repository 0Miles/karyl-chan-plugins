/**
 * Curated list of free, no-license-required internet radio streams.
 *
 * All entries here are direct mp3 / aac / ogg streams (no HLS,
 * because @discordjs/voice + ffmpeg-static handles plain HTTP audio
 * streams more reliably). SomaFM is the safe default — they
 * explicitly allow non-commercial bot redistribution; BBC and FIP are
 * publicly streamed by the broadcasters themselves.
 *
 * If you add a station here, verify the URL serves content-type
 * audio/* directly (curl -I) before shipping.
 */
export interface Station {
  key: string;
  name: string;
  description: string;
  url: string;
}

export const STATIONS: Station[] = [
  {
    key: "chill",
    name: "SomaFM Groove Salad",
    description: "Ambient / downtempo electronica",
    url: "https://ice2.somafm.com/groovesalad-128-mp3",
  },
  {
    key: "lofi",
    name: "SomaFM Drone Zone",
    description: "Ambient drone / soundscape",
    url: "https://ice4.somafm.com/dronezone-128-mp3",
  },
  {
    key: "jazz",
    name: "SomaFM Sonic Universe",
    description: "Ambient / world / jazz fusion",
    url: "https://ice4.somafm.com/sonicuniverse-128-mp3",
  },
  {
    key: "indie",
    name: "SomaFM Indie Pop Rocks",
    description: "Indie pop / rock",
    url: "https://ice2.somafm.com/indiepop-128-mp3",
  },
  {
    key: "synthwave",
    name: "SomaFM DEF CON Radio",
    description: "Synthwave / cyberpunk",
    url: "https://ice2.somafm.com/defcon-128-mp3",
  },
  {
    key: "classical",
    name: "SomaFM Black Rock FM",
    description: "Burning Man classical / ambient",
    url: "https://ice2.somafm.com/brfm-128-mp3",
  },
  {
    key: "metal",
    name: "SomaFM Metal Detector",
    description: "Heavy / progressive metal",
    url: "https://ice2.somafm.com/metal-128-mp3",
  },
  {
    key: "folk",
    name: "SomaFM Folk Forward",
    description: "Indie folk / Americana",
    url: "https://ice2.somafm.com/folkfwd-128-mp3",
  },
];

export function findStation(key: string): Station | null {
  const norm = key.trim().toLowerCase();
  return STATIONS.find((s) => s.key === norm) ?? null;
}
