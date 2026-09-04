import { fetchCurrentWeather, getBrowserPosition } from "./weatherService.js";

export function mountWeatherController(store) {
  const button = document.getElementById("weatherButton");
  const readout = document.getElementById("weatherReadout");
  const status = document.getElementById("weatherStatus");
  let controller = null;

  button.addEventListener("click", async () => {
    controller?.abort();
    controller = new AbortController();

    button.disabled = true;
    readout.textContent = "获取中…";
    status.textContent = "正在请求定位与当前天气。";

    store.setState(current => ({
      ...current,
      weather: { status: "loading", data: null, error: null }
    }));

    try {
      const coords = await getBrowserPosition();
      const data = await fetchCurrentWeather(coords, controller.signal);

      readout.textContent = `${data.description} ${Math.round(data.temperature)}°C`;
      status.textContent =
        `体感 ${Math.round(data.apparentTemperature)}°C · 湿度 ${data.humidity}% · 风速 ${data.windSpeed} km/h`;

      store.setState(current => ({
        ...current,
        weather: { status: "success", data, error: null }
      }));
    } catch (error) {
      if (error.name === "AbortError") return;

      readout.textContent = "获取失败";
      status.textContent = error.message;

      store.setState(current => ({
        ...current,
        weather: { status: "error", data: null, error: error.message }
      }));
    } finally {
      button.disabled = false;
    }
  });
}
