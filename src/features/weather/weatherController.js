import { fetchCurrentWeather, getBrowserPosition } from "./weatherService.js";

export function mountWeatherController(store) {
  const summary = document.getElementById("roomWeatherSummary");
  const temperature = document.getElementById("roomWeatherTemperature");
  const condition = document.getElementById("roomWeatherCondition");

  let controller = null;

  function renderIdle() {
    temperature.textContent = "--°C";
    condition.textContent = "天气待获取";
    summary.dataset.status = "idle";
    summary.title = "点击窗帘获取当前天气";
  }

  function renderLoading() {
    // Do not animate or flash the curtain while weather is loading.
    // Only this tiny text changes.
    condition.textContent = "获取中…";
    summary.dataset.status = "loading";
  }

  function renderSuccess(data) {
    const hasRange =
      Number.isFinite(data.todayMin) &&
      Number.isFinite(data.todayMax);

    temperature.textContent = hasRange
      ? `${Math.round(data.todayMin)}–${Math.round(data.todayMax)}°C`
      : `${Math.round(data.temperature)}°C`;

    condition.textContent = data.description;
    summary.dataset.status = "success";
    summary.title =
      `体感 ${Math.round(data.apparentTemperature)}°C · ` +
      `湿度 ${data.humidity}% · 风速 ${data.windSpeed} km/h`;
  }

  function renderError(message) {
    condition.textContent = "获取失败";
    summary.dataset.status = "error";
    summary.title = message;
  }

  async function refresh() {
    controller?.abort();
    controller = new AbortController();

    renderLoading();

    store.setState(current => ({
      ...current,
      weather: { status: "loading", data: null, error: null }
    }));

    try {
      const coords = await getBrowserPosition();
      const data = await fetchCurrentWeather(coords, controller.signal);

      renderSuccess(data);

      store.setState(current => ({
        ...current,
        weather: { status: "success", data, error: null }
      }));

      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        return null;
      }

      renderError(error.message);

      store.setState(current => ({
        ...current,
        weather: { status: "error", data: null, error: error.message }
      }));

      return null;
    }
  }

  renderIdle();

  return { refresh };
}
