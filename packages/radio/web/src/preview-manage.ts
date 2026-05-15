import { createApp, h } from "vue";
import "./styles/global.css";
import ManageView from "./views/ManageView.vue";
import AppToast from "./components/AppToast.vue";
import type { LibraryTrack } from "./types";

// Stand-alone preview of the ManageView edit-track flow. All HTTP calls
// the SPA would normally make are intercepted by a fake `fetch` so this
// page runs without any bot/plugin auth — used both for manual visual
// review and for Playwright assertions on the modal state machine.

window.__PLUGIN_BASE__ = "";

const tracks: LibraryTrack[] = [
  {
    id: "trk-a",
    title: "Stardust Reverie",
    author: "Yuyuko",
    album: "Touhou: Perfect Cherry Blossom",
    duration: 188,
    sizeBytes: 4_800_000,
    coverUrl: "/preview-covers/a.svg",
    sourceUrl: "https://example.com/a",
    filename: "stardust.opus",
    addedBy: "preview",
    addedAt: 1_700_000_000_000,
  },
  {
    id: "trk-b",
    title: "Night of Nights",
    author: "COOL&CREATE",
    album: "Patchwork",
    duration: 232,
    sizeBytes: 6_200_000,
    coverUrl: "/preview-covers/b.svg",
    sourceUrl: "https://example.com/b",
    filename: "night.opus",
    addedBy: "preview",
    addedAt: 1_700_000_000_000,
  },
  {
    id: "trk-c",
    title: "Bad Apple!! feat. nomico",
    author: "Alstroemeria Records",
    album: "Lovelight",
    duration: 219,
    sizeBytes: 5_900_000,
    sourceUrl: "https://example.com/c",
    filename: "badapple.opus",
    addedBy: "preview",
    addedAt: 1_700_000_000_000,
  },
];

// Inline SVGs as data URIs for the seed covers so the preview is fully
// self-contained.
const inlineCover = (text: string, color: string): string =>
  `data:image/svg+xml;utf8,` +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>
      <rect width='96' height='96' fill='${color}'/>
      <text x='50%' y='55%' text-anchor='middle' font-size='14' fill='white' font-family='sans-serif'>${text}</text>
    </svg>`,
  );

const coverFor: Record<string, string> = {
  "/preview-covers/a.svg": inlineCover("A", "#5865f2"),
  "/preview-covers/b.svg": inlineCover("B", "#047857"),
};
for (const t of tracks) {
  if (t.coverUrl && coverFor[t.coverUrl]) t.coverUrl = coverFor[t.coverUrl];
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
  const method = (init?.method || "GET").toUpperCase();

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (url.includes("/api/tracks") && method === "GET") {
    return json({ tracks });
  }
  const patchMatch = url.match(/\/api\/tracks\/([^/]+)$/);
  if (patchMatch && method === "PATCH") {
    const id = decodeURIComponent(patchMatch[1]);
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const t = tracks.find((x) => x.id === id);
    if (t) Object.assign(t, body);
    return json({ track: t });
  }
  const uploadMatch = url.match(/\/api\/tracks\/([^/]+)\/cover$/);
  if (uploadMatch && method === "POST") {
    const id = decodeURIComponent(uploadMatch[1]);
    const t = tracks.find((x) => x.id === id);
    if (t) {
      // Pretend we received the file and now serve it under a fresh URL.
      t.coverUrl = inlineCover("NEW", "#b91c1c") + `#${Date.now()}`;
    }
    return json({ track: t });
  }
  if (url.endsWith("/api/tracks/download") && method === "POST") {
    return json({ alreadyExisted: false });
  }
  // Fallback: pass through (shouldn't normally happen in preview).
  return originalFetch(input, init);
};

createApp({
  setup() {
    return () =>
      h("div", { class: "app-wrap" }, [
        h("header", { class: "app-header" }, [
          h("h1", "📻 Karyl Radio"),
          h("span", { class: "mode" }, "admin · library · preview"),
        ]),
        h(ManageView),
        h(AppToast),
      ]);
  },
}).mount("#app");
