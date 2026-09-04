import "./styles/scene.css";
import { createStore } from "./core/store.js";
import { renderRoomScene } from "./features/room/roomView.js";
import { mountWardrobeController } from "./features/wardrobe/wardrobeController.js";
import { mountPhotoUpload } from "./features/upload/photoUpload.js";
import { mountWeatherController } from "./features/weather/weatherController.js";
import { mountTryOnController } from "./features/tryon/tryOnController.js";

const root = document.getElementById("app");
const store = createStore();

renderRoomScene(root);
mountWardrobeController(store);
mountPhotoUpload(store);
mountWeatherController(store);
mountTryOnController(store);

if (import.meta.env.DEV) {
  window.__WARDROBE_STORE__ = store;
}
