# 智能衣柜 — 三人协作重构版

这是从 v7 单文件原型拆出的可协作工程。

## 已完成

- Vite 前端模块化
- 保留 v7 房间 / 衣柜 / 人物 / 衣物格交互
- 本地照片上传已接入
- 当前天气已接入：浏览器定位 + Open-Meteo
- AI 试穿统一为 `/api/try-on`
- FastAPI 后端包含：
  - `mock` provider：没有 GPU 也能先联调
  - `catvton` provider：连接外部 CatVTON checkout
- 三个新方向分别放入独立 feature 目录，便于三人开分支

## 目录

```text
src/
  core/
  data/
  features/
    upload/       # A
    weather/      # B
    tryon/        # C 的前端
    wardrobe/
    room/
  assets/
  styles/

server/
  app.py
  providers/
    mock.py
    catvton.py

docs/
  TEAM_SPLIT.md
  API_CONTRACTS.md
  CATVTON_INTEGRATION.md
  THIRD_PARTY.md
```

## 启动前端

```bash
npm install
npm run dev
```

## 不需要 GPU 的端到端联调

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
TRYON_PROVIDER=mock uvicorn server.app:app --reload --port 8000
```

上传人物照片，在衣柜里确认上衣 / 外套 / 裤子，即可点击 AI 试穿。

`mock` provider 会返回原人物图并写入 MOCK 标记，用来验证：
前端文件上传 -> FastAPI -> 图片响应 -> 前端展示

真正 CatVTON 接入请看 `docs/CATVTON_INTEGRATION.md`。


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
