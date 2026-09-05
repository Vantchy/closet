import { fetchCurrentWeather, getBrowserPosition } from "./weatherService.js";

const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75]);
const THUNDER_CODES = new Set([95, 96, 99]);
const FOG_CODES = new Set([45, 48]);

function getDisplayedRange(data) {
  const hasRange =
    Number.isFinite(data.todayMin) &&
    Number.isFinite(data.todayMax);

  if (hasRange) {
    const min = Math.min(Math.round(data.todayMin), Math.round(data.todayMax));
    const max = Math.max(Math.round(data.todayMin), Math.round(data.todayMax));
    return { min, max, hasRange: true };
  }

  const current = Number.isFinite(data.temperature)
    ? Math.round(data.temperature)
    : null;

  return current === null
    ? null
    : { min: current, max: current, hasRange: false };
}

function getOutfit(midpoint) {
  if (midpoint <= 0) return "厚羽绒+保暖裤";
  if (midpoint <= 5) return "羽绒服+毛衣+长裤";
  if (midpoint <= 10) return "厚外套+毛衣+长裤";
  if (midpoint <= 15) return "夹克/风衣+长裤";
  if (midpoint <= 19) return "薄外套+长袖+长裤";
  if (midpoint <= 23) return "薄外套+长裤";
  if (midpoint <= 27) return "短袖+薄长裤";
  if (midpoint <= 31) return "短袖+短裤";
  return "透气短袖+短裤";
}

function getWeatherHint(data) {
  const code = Number(data.weatherCode);
  const rain = Number(data.rain) || 0;
  const precipitation = Number(data.precipitation) || 0;
  const snowfall = Number(data.snowfall) || 0;

  if (THUNDER_CODES.has(code)) return "雷雨少外出";
  if (SNOW_CODES.has(code) || snowfall > 0) return "有雪防滑";
  if (RAIN_CODES.has(code) || rain > 0 || precipitation > 0) return "有雨带伞";
  if (FOG_CODES.has(code) || (Number(data.visibility) > 0 && Number(data.visibility) < 10000)) {
    return "有雾慢行";
  }
  if (Number(data.windSpeed) >= 28) return "风大加防风层";

  return "";
}

function getRangeHint(range) {
  if (!range.hasRange) return "";
  const difference = range.max - range.min;

  if (difference <= 4) return "温差小";
  if (difference >= 8) return "温差大，早晚加衣";
  return "早晚备外套";
}

function buildClothingAdvice(data) {
  const range = getDisplayedRange(data);

  if (!range) {
    return {
      text: "适宜：按体感分层穿搭",
      detail: "温度数据不足，暂时不能生成精确穿衣建议。"
    };
  }

  const midpoint = (range.min + range.max) / 2;
  const outfit = getOutfit(midpoint);
  const weatherHint = getWeatherHint(data);
  const rangeHint = getRangeHint(range);

  const hints = [weatherHint, rangeHint].filter(Boolean);
  const text = `适宜：${outfit}${hints.length ? ` · ${hints.join(" · ")}` : ""}`;

  const detail = range.hasRange
    ? `按页面显示的 ${range.min}–${range.max}°C 取中间值 ${midpoint}°C 判断基础穿搭；日内温差 ${range.max - range.min}°C。`
    : `今日最低/最高温缺失，按当前温度 ${range.min}°C 判断基础穿搭。`;

  return { text, detail };
}

export function mountWeatherController(store) {
  const summary = document.getElementById("roomWeatherSummary");
  const temperature = document.getElementById("roomWeatherTemperature");
  const condition = document.getElementById("roomWeatherCondition");
  const advice = document.getElementById("roomWeatherAdvice");

  let controller = null;

  function renderIdle() {
    temperature.textContent = "--°C";
    condition.textContent = "天气待获取";
    summary.dataset.status = "idle";
    summary.title = "点击窗帘获取当前天气";

    advice.textContent = "适宜：获取天气后显示";
    advice.title = "获取天气后显示穿衣建议";
  }

  function renderLoading() {
    // Do not animate or flash the curtain while weather is loading.
    // Only this tiny text changes.
    condition.textContent = "获取中…";
    summary.dataset.status = "loading";

    advice.textContent = "适宜：判断中…";
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

    const clothingAdvice = buildClothingAdvice(data);
    advice.textContent = clothingAdvice.text;
    advice.title = clothingAdvice.detail;
  }

  function renderError(message) {
    condition.textContent = "获取失败";
    summary.dataset.status = "error";
    summary.title = message;

    advice.textContent = "适宜：暂无法判断";
    advice.title = message;
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
