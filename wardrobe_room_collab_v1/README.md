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

## Git 基线

```text
main
└── develop
    ├── feature/photo-upload
    ├── feature/weather
    └── feature/catvton
```

建议先把这个版本作为共同 baseline，再分别开分支。
