import { selectWeatherScene } from "../weather/weatherScene.js";

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = () => reject(new Error("窗外天气图片加载失败。"));
    image.src = src;
  });
}

export function mountCurtainController(store, { requestWeather }) {
  const zone = document.getElementById("windowCurtainZone");
  const weatherImage = document.getElementById("windowWeatherScene");

  if (!zone || !weatherImage) {
    throw new Error("Curtain/weather window elements are missing from roomView.");
  }

  let requesting = false;

  function updateRoom(patch) {
    store.setState(current => ({
      ...current,
      room: {
        ...current.room,
        ...patch
      }
    }));
  }

  function renderOpen(open) {
    zone.classList.toggle("is-open", open);
    zone.setAttribute("aria-pressed", String(open));
    zone.setAttribute(
      "aria-label",
      open ? "刷新天气和窗外景色" : "获取天气并打开窗帘"
    );
    zone.title = open
      ? "点击重新获取天气并刷新窗外景色"
      : "点击获取当前天气并打开窗帘";
  }

  function setScene(scene) {
    weatherImage.src = scene.src;
    weatherImage.alt = `${scene.label}天气的窗外景色`;
    weatherImage.classList.add("is-visible");

    updateRoom({
      weatherScene: scene.key
    });
  }

  function setOpen(open) {
    renderOpen(open);
    updateRoom({ curtainOpen: open });
  }

  async function requestWeatherAndOpen() {
    if (requesting) return;

    requesting = true;
    zone.disabled = true;

    try {
      const weather = await requestWeather?.({ source: "curtain" });

      // Failed geolocation / network request: keep the current curtain state.
      if (!weather) return;

      const scene = selectWeatherScene(weather);
      await preloadImage(scene.src);

      setScene(scene);

      // Only a successful weather request opens the curtain.
      if (!store.getState().room.curtainOpen) {
        // Let the scenery render just before the fabric moves away.
        requestAnimationFrame(() => setOpen(true));
      }
    } catch (error) {
      console.error(error);
    } finally {
      requesting = false;
      zone.disabled = false;
    }
  }

  zone.addEventListener("click", event => {
    event.stopPropagation();
    void requestWeatherAndOpen();
  });

  // Always start closed; weather does not automatically open or close it.
  renderOpen(false);
  updateRoom({
    curtainOpen: false,
    weatherScene: null
  });

  return {
    requestWeatherAndOpen,
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    }
  };
}
