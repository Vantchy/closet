const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

const WMO_LABELS = new Map([
  [0, "晴"], [1, "大致晴朗"], [2, "局部多云"], [3, "阴"],
  [45, "有雾"], [48, "雾凇"],
  [51, "毛毛雨"], [53, "毛毛雨"], [55, "较强毛毛雨"],
  [61, "小雨"], [63, "中雨"], [65, "大雨"],
  [71, "小雪"], [73, "中雪"], [75, "大雪"],
  [80, "阵雨"], [81, "阵雨"], [82, "强阵雨"],
  [95, "雷暴"], [96, "雷暴伴冰雹"], [99, "强雷暴伴冰雹"]
]);

export function describeWeather(code) {
  return WMO_LABELS.get(code) ?? `天气代码 ${code}`;
}

export function getBrowserPosition() {
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("当前浏览器不支持定位。"));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }),
      error => reject(new Error(
        error.code === error.PERMISSION_DENIED
          ? "定位权限被拒绝。"
          : "无法获取当前位置。"
      )),
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000
      }
    );
  });
}

export async function fetchCurrentWeather({ latitude, longitude }, signal) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m"
    ].join(","),
    timezone: "auto"
  });

  const response = await fetch(`${WEATHER_URL}?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`天气服务返回 ${response.status}`);
  }

  const payload = await response.json();
  const current = payload.current;

  return {
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    weatherCode: current.weather_code,
    description: describeWeather(current.weather_code),
    timezone: payload.timezone
  };
}
