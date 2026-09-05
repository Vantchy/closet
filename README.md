# 智能衣柜 — 三人协作重构版

这是从 v7 单文件原型拆出的可协作工程。

## 已完成

- Vite 前端模块化
- 保留 v7 房间 / 衣柜 / 人物 / 衣物格交互
- 本地照片上传已接入
- 当前天气已接入：浏览器定位 + Open-Meteo
- 三个新方向分别放入独立 feature 目录，便于三人开分支

## 目录

```text
src/
  core/
  data/
  features/
    upload/       # A
    weather/      # B
    tryon2d/      # 2D 试穿
    wardrobe/
    room/
  assets/
  styles/

docs/
  TEAM_SPLIT.md
  CURTAIN_WEATHER.md
  THIRD_PARTY.md
```

## 启动前端

```bash
npm install
npm run dev
```

## v3 新增：点击窗帘获取天气并显示窗外景色

- 房间背景替换为“无窗外景色”版本
- 窗帘位置按参考图重新调整：两片紧靠、上移到木支架、覆盖窗户
- 去除天气自动打开 / 自动关闭窗帘的逻辑
- 窗帘默认关闭
- 点击窗帘时：
  1. 获取浏览器位置
  2. 请求 Open-Meteo 当前天气
  3. 成功后选择对应的窗外天气图片
  4. 预加载图片
  5. 拉开窗帘
- 获取失败时不会拉开窗帘
- 已打开后再次点击窗帘会刷新天气和窗外景色，不会自动关闭
- 支持：霾 / 雾 / 雪 / 雨 / 阴 / 多云 / 晴
- 动画仍然是纯 CSS，不需要 GPU

主要代码：

```text
src/features/room/curtainController.js
src/features/weather/weatherController.js
src/features/weather/weatherScene.js
src/features/weather/weatherService.js
docs/CURTAIN_WEATHER.md
```

## Git 基线

```text
main
└── develop
    ├── feature/photo-upload
    ├── feature/weather
    └── feature/catvton
```

建议先把这个版本作为共同 baseline，再分别开分支。


## v4 调整

- 窗外天气贴图上移并收紧到窗户透明区域。
- 点击窗帘请求天气时，窗帘本身不再闪烁。
- 人物图层明确高于窗户 / 窗外景色 / 窗帘。
- 窗框仍然高于窗外景色。
- 删除左侧“当前天气”卡片。
- 天气成功获取后，仅在衣柜右上方、窗帘左侧显示 `温度 + 天气`。


## v5 调整

- 窗帘继续上移，并覆盖窗户上方的木横杆。
- 窗外天气贴图 viewport 略微扩大，贴图本身放大到 `scale(1.16)`，同时取景继续上移，确保透明窗格完全被景色覆盖。
- 天气显示改为“今日最低–最高温度 + 天气”，例如 `12–20°C · 多云`。
- 温度/天气显示整体左移、下移，位置改到左侧架子的右下方、衣柜上方。
- 今日温度范围来自 Open-Meteo daily：
  - `temperature_2m_min`
  - `temperature_2m_max`
