import "./styles/scene.css";
import { createStore } from "./core/store.js";
import { renderRoomScene } from "./features/room/roomView.js";
import { mountCurtainController } from "./features/room/curtainController.js";
import { mountWardrobeController } from "./features/wardrobe/wardrobeController.js";
import { mountPhotoUpload } from "./features/upload/photoUpload.js";
import { mountWeatherController } from "./features/weather/weatherController.js";
import { mountTryOnController } from "./features/tryon/tryOnController.js";

const root = document.getElementById("app");
const store = createStore();

renderRoomScene(root);

// 舞台自适应：场景内容按 2048×1152 舞台坐标绘制（与房间原图同比例），
// 这里按视口宽度整体等比缩放，保证不同窗口/屏幕看到的构图完全一致。
const STAGE_WIDTH = 2048;
const sceneEl = document.getElementById("scene");
const stageEl = document.getElementById("stage");

function fitStageToViewport() {
  const scale = sceneEl.clientWidth / STAGE_WIDTH;
  stageEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

fitStageToViewport();
window.addEventListener("resize", fitStageToViewport);

const weatherController = mountWeatherController(store);
mountCurtainController(store, {
  requestWeather: weatherController.refresh
});
mountWardrobeController(store);
mountPhotoUpload(store);
mountTryOnController(store);

if (import.meta.env.DEV) {
  window.__WARDROBE_STORE__ = store;
}
