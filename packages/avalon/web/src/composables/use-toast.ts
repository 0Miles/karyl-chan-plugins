import { ref } from "vue";

/**
 * Tiny module-level toast bus. Singletons because the page only ever
 * shows one toast at a time; sharing one ref keeps deeply-nested
 * components (modals, tab views) from each having to wire their own
 * channel. Identical shape to radio/web's useToast so the visual
 * pattern stays consistent between plugins.
 */
export type ToastKind = "ok" | "error" | "info";

interface ToastState {
  message: string;
  kind: ToastKind;
  visible: boolean;
}

const state = ref<ToastState>({ message: "", kind: "info", visible: false });
let timer: number | undefined;

function show(message: string, kind: ToastKind): void {
  state.value = { message, kind, visible: true };
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    state.value = { ...state.value, visible: false };
  }, 3200);
}

export function useToast() {
  return {
    state,
    toast: (msg: string, kind: ToastKind = "info") => show(msg, kind),
    ok: (msg: string) => show(msg, "ok"),
    error: (msg: string) => show(msg, "error"),
  };
}
