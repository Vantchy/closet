# 三人并行开发分工

## 先冻结的公共接口

三个人开分支前，先把以下文件视为“接口合同”：

- `src/core/store.js`
- `src/data/clothing.js`
- `server/app.py` 的 `/api/try-on` 请求格式

除非三人一致同意，否则功能分支不要直接改这些合同。

## A：本地照片与前端应用壳

建议分支：`feature/photo-upload`

负责：

- 本地照片选择、类型/大小校验、预览、清理对象 URL
- 隐私提示和错误状态
- `store.photo` 对接
- 后续：裁剪、旋转、人物照片质量提示

主要文件：

- `src/features/upload/**`
- `src/features/room/roomView.js`
- `.integration-*` 样式

尽量不要改：

- `server/providers/**`
- `src/features/weather/**`
- `src/features/tryon/**`

## B：天气与穿搭建议

建议分支：`feature/weather`

负责：

- 浏览器 Geolocation 权限与错误处理
- Open-Meteo 当前天气请求
- WMO 天气码映射
- `store.weather`
- 下一阶段：温度 / 降水 / 风速 -> 穿搭推荐

主要文件：

- `src/features/weather/**`

推荐逻辑以后新建：

- `src/features/recommendation/**`

天气模块不要直接修改衣柜 DOM，只输出状态 / 推荐结果。

## C：CatVTON / AI 试穿

建议分支：`feature/catvton`

负责：

- GPU / CUDA / CatVTON 外部仓库
- `server/providers/catvton.py`
- FastAPI 的性能、队列、超时和错误处理
- `src/features/tryon/**`
- 人物照片 + 衣物图片 -> 试穿结果图

类别映射：

- 上衣 -> `upper`
- 外套 -> `upper`
- 裤子 -> `lower`
- 帽子 -> 不交给 CatVTON；保留现有 2D overlay，或以后接头部关键点模块

## 合并顺序

建议：

```text
main
└── develop
    ├── feature/photo-upload
    ├── feature/weather
    └── feature/catvton
```

本重构版本先进入 `develop`，三个人都从同一 commit 开分支。

每天至少一次把 `develop` 同步回各自 feature branch。

建议提交粒度：

- `feat(upload): validate local image`
- `feat(weather): fetch current conditions`
- `feat(tryon): initialize CatVTON provider`
- `fix(tryon): handle lower-body mask`
- `docs(api): update try-on contract`
