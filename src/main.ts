import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { startApp } from "./ui/app";
import "./styles/app.css";

async function setupNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0A0A0A" });
  } catch {
    /* web preview */
  }
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
  });
}

void (async () => {
  await setupNative();
  const host = document.getElementById("app");
  if (!host) throw new Error("#app missing");
  await startApp(host);
})();
