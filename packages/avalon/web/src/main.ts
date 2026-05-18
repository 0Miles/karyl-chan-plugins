import { createApp, defineComponent, h } from "vue";

// WebUI placeholder — the real admin SPA is built in a later commit
// (issue #46 in the task list). For the v0.1 ship the plugin's HTTP
// surface still serves a one-screen "WebUI coming soon" so a 404
// doesn't scare the operator if they hit the proxy URL.
const App = defineComponent({
  name: "AvalonAdminPlaceholder",
  render() {
    return h(
      "div",
      {
        style: {
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
          color: "#2a3",
        },
      },
      [
        h("h1", "Avalon Admin"),
        h("p", "WebUI coming in the next iteration. Bot is healthy."),
      ],
    );
  },
});

createApp(App).mount("#app");
