# CatVTON 接入

主仓库不直接复制 CatVTON 源码，而是通过 `server/providers/catvton.py` 调用外部 checkout。

## 为什么隔离

- CUDA / PyTorch / Detectron2 等依赖较重
- 模型权重大
- 能让前端两个分支完全不碰 AI 环境
- CatVTON 官方项目的代码、checkpoint 和 demo 使用 CC BY-NC-SA 4.0，官方说明为非商业用途

## 本地流程

在本项目外部克隆：

```bash
git clone https://github.com/Zheng-Chong/CatVTON.git
```

按 CatVTON 官方 README 建立 Python / CUDA 环境并安装它自己的 requirements。

再安装本项目后端依赖：

```bash
pip install -r server/requirements.txt
```

配置：

```bash
export TRYON_PROVIDER=catvton
export CATVTON_ROOT=/absolute/path/to/CatVTON
```

启动：

```bash
uvicorn server.app:app --reload --port 8000
```

前端：

```bash
npm install
npm run dev
```

## 当前 provider 默认参数

- 输出尺寸：768 × 1024
- precision：bf16
- inference steps：40
- CFG：2.5

可以通过环境变量调整：

- `CATVTON_WIDTH`
- `CATVTON_HEIGHT`
- `CATVTON_PRECISION`
- `CATVTON_STEPS`
- `CATVTON_CFG`
- `CATVTON_DEVICE`
- `CATVTON_SEED`

## 帽子

CatVTON 标准自动 mask 类型是 `upper / lower / overall`，因此帽子不要强行映射进去。

当前：
- 卡通人物继续用 2D overlay；
- 真实照片如果也要自动戴帽子，建议后续单独增加头部关键点检测和仿射/透视变换。
