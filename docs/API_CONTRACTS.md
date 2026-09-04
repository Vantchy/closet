# API / State 合同

## Frontend state

核心字段：

```js
{
  photo: { file, url, name },
  weather: { status, data, error },
  wardrobe: { savedOutfits, lastConfirmed },
  tryOn: { status, resultUrl, error }
}
```

原则：upload / weather / try-on 互相通过 store 通信，不直接读写对方 DOM。

## POST /api/try-on

类型：`multipart/form-data`

字段：

- `person`: 人物照片
- `garment`: 衣物照片
- `category`: `upper | lower | overall`

响应：

- 成功：`image/png`
- 失败：`{ "detail": "..." }`

前端映射：

- 上衣 -> `upper`
- 外套 -> `upper`
- 裤子 -> `lower`
- 帽子 -> 当前不交给 CatVTON

## 本地照片隐私边界

用户选择照片以后只通过 `URL.createObjectURL()` 本地预览。

只有用户点击“AI 试穿”时，人物照片才发送到 `VITE_TRYON_API_BASE` 指向的后端。
