import { createApp, h, ref } from "vue";
import "./styles/global.css";
import PlaylistList from "./components/PlaylistList.vue";
import NowPlayingCard from "./components/NowPlayingCard.vue";
import AppButton from "./components/AppButton.vue";
import AppToast from "./components/AppToast.vue";
import type { SessionSnapshot, Track } from "./types";

// Mock playlist: a few "played" tracks before the cursor, a "current"
// track at qid=4, and a few "upcoming" tracks. Includes one with full
// library metadata and one with only a label, to exercise the sub-line
// fallback.
const tracks: Track[] = [
  {
    qid: 1,
    label: "Stardust Reverie",
    author: "Yuyuko",
    album: "Touhou: Perfect Cherry Blossom",
    duration: 188,
    queuedByName: "alice",
    sourceUrl: "https://example.com/1",
  },
  {
    qid: 2,
    label: "Maple Wasteland",
    author: "ZUN",
    album: "Subterranean Animism",
    duration: 215,
    queuedByName: "bob",
  },
  {
    qid: 3,
    label: "Plain URL only — no metadata available for this one",
    sourceUrl: "https://example.com/3",
  },
  {
    qid: 4,
    label: "Bad Apple!! feat. nomico",
    author: "Alstroemeria Records",
    album: "Lovelight",
    duration: 219,
    queuedByName: "carol",
    sourceUrl: "https://example.com/4",
  },
  {
    qid: 5,
    label: "Night of Nights",
    author: "COOL&CREATE",
    album: "Patchwork",
    duration: 232,
    queuedByName: "dave",
  },
  {
    qid: 6,
    label: "Septette for the Dead Princess",
    author: "ZUN",
    duration: 197,
  },
  {
    qid: 7,
    label: "U.N. Owen Was Her?",
    author: "ZUN",
    album: "Embodiment of Scarlet Devil",
    duration: 173,
    queuedByName: "alice",
    sourceUrl: "https://example.com/7",
  },
];

const snap = ref<SessionSnapshot>({
  guildId: "preview",
  channelId: "1",
  paused: false,
  loop: "off",
  autoplay: true,
  autoplayFetchCount: 7,
  playlist: tracks,
  cursorQid: 4,
});

const pendingRemoveQids = ref<Set<number>>(new Set());
const pendingAdds = ref<string[]>([]);

function jump(qid: number) {
  snap.value = { ...snap.value, cursorQid: qid };
}

function dequeue(qid: number) {
  const next = new Set(pendingRemoveQids.value);
  next.add(qid);
  pendingRemoveQids.value = next;
  setTimeout(() => {
    snap.value = {
      ...snap.value,
      playlist: snap.value.playlist.filter((t) => t.qid !== qid),
    };
    const drop = new Set(pendingRemoveQids.value);
    drop.delete(qid);
    pendingRemoveQids.value = drop;
  }, 400);
}

function reorder(p: { qid: number; beforeQid: number | null }) {
  const list = snap.value.playlist.slice();
  const fromIdx = list.findIndex((t) => t.qid === p.qid);
  if (fromIdx === -1) return;
  const [moved] = list.splice(fromIdx, 1);
  const toIdx =
    p.beforeQid === null
      ? list.length
      : list.findIndex((t) => t.qid === p.beforeQid);
  list.splice(toIdx === -1 ? list.length : toIdx, 0, moved);
  snap.value = { ...snap.value, playlist: list };
}

createApp({
  setup() {
    return () =>
      h("div", { class: "app-wrap" }, [
        h("header", { class: "app-header" }, [
          h("h1", "📻 Karyl Radio"),
          h("span", { class: "mode" }, "playback session · preview"),
        ]),
        h(NowPlayingCard, {
          snap: snap.value,
          onPrev: () => console.log("prev"),
          onPause: (paused: boolean) =>
            (snap.value = { ...snap.value, paused }),
          onNext: () => console.log("next"),
          onStop: () => console.log("stop"),
          onLoop: (mode: "off" | "track" | "queue") =>
            (snap.value = { ...snap.value, loop: mode }),
          onAutoplay: (on: boolean) =>
            (snap.value = { ...snap.value, autoplay: on }),
        }),
        h("div", { class: "card" }, [
          h("div", { class: "row" }, [
            h("input", {
              class: "grow",
              placeholder: "Add to queue — preview only",
            }),
            h(AppButton, { type: "submit" }, () => "➕ Add"),
          ]),
        ]),
        h(
          "div",
          {
            class: "topbar",
            style: "margin: 1rem 0 0.5rem;",
          },
          [
            h(
              "span",
              { class: "muted" },
              `${snap.value.playlist.length} tracks in playlist`,
            ),
            h(
              AppButton,
              {
                variant: "ghost",
                size: "sm",
                onClick: () =>
                  (snap.value = {
                    ...snap.value,
                    playlist: snap.value.playlist.slice(
                      0,
                      snap.value.playlist.findIndex(
                        (t) => t.qid === snap.value.cursorQid,
                      ) + 1,
                    ),
                  }),
              },
              () => "Clear upcoming",
            ),
          ],
        ),
        h(PlaylistList, {
          playlist: snap.value.playlist,
          cursorQid: snap.value.cursorQid,
          pendingRemoveQids: pendingRemoveQids.value,
          pendingAdds: pendingAdds.value,
          onJump: jump,
          onDequeue: dequeue,
          onReorder: reorder,
        }),
        h(AppToast),
      ]);
  },
}).mount("#app");
