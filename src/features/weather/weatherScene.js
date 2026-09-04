const WEATHER_SCENES = {
  haze: {
    key: "haze",
    label: "霾",
    src: "/src/assets/weather/haze.png"
  },
  fog: {
    key: "fog",
    label: "雾",
    src: "/src/assets/weather/fog.png"
  },
  snow: {
    key: "snow",
    label: "雪",
    src: "/src/assets/weather/snow.png"
  },
  rain: {
    key: "rain",
    label: "雨",
    src: "/src/assets/weather/rain.png"
  },
  overcast: {
    key: "overcast",
    label: "阴",
    src: "/src/assets/weather/overcast.png"
  },
  cloudy: {
    key: "cloudy",
    label: "多云",
    src: "/src/assets/weather/cloudy.png"
  },
  sunny: {
    key: "sunny",
    label: "晴",
    src: "/src/assets/weather/sunny.png"
  }
};

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const RAIN_CODES = new Set([
  51, 53, 55, 56, 57,
  61, 63, 65, 66, 67,
  80, 81, 82,
  95, 96, 99
]);
const FOG_CODES = new Set([45, 48]);

export function selectWeatherScene(weather) {
  const code = Number(weather.weatherCode);
  const snowfall = Number(weather.snowfall ?? 0);
  const rain = Number(weather.rain ?? 0);
  const precipitation = Number(weather.precipitation ?? 0);
  const visibility = Number(weather.visibility);
  const cloudCover = Number(weather.cloudCover);

  // More specific phenomena take priority over cloud cover.
  if (SNOW_CODES.has(code) || snowfall > 0) {
    return WEATHER_SCENES.snow;
  }

  if (RAIN_CODES.has(code) || rain > 0 || precipitation > 0) {
    return WEATHER_SCENES.rain;
  }

  if (FOG_CODES.has(code)) {
    return WEATHER_SCENES.fog;
  }

  // Open-Meteo's WMO code has fog but no dedicated "haze" code.
  // Low visibility without an explicit fog code is treated as haze for this UI.
  if (Number.isFinite(visibility) && visibility > 0 && visibility < 10000) {
    return WEATHER_SCENES.haze;
  }

  if (code === 3 || (Number.isFinite(cloudCover) && cloudCover >= 85)) {
    return WEATHER_SCENES.overcast;
  }

  if (
    code === 1 ||
    code === 2 ||
    (Number.isFinite(cloudCover) && cloudCover >= 30)
  ) {
    return WEATHER_SCENES.cloudy;
  }

  return WEATHER_SCENES.sunny;
}

export function getWeatherScene(key) {
  return WEATHER_SCENES[key] ?? null;
}
