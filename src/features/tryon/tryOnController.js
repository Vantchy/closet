import { runTryOn } from "./tryOnService.js";

export function mountTryOnController(store) {
  const button = document.getElementById("tryOnButton");
  const status = document.getElementById("tryOnStatus");
  const result = document.getElementById("tryOnResult");

  let resultObjectUrl = null;
  let controller = null;

  function refresh(state) {
    const clothing = state.wardrobe.lastConfirmed;
    const hasPhoto = Boolean(state.photo.file);
    const supported = Boolean(clothing?.tryOnType);

    button.disabled =
      !(hasPhoto && clothing && supported) ||
      state.tryOn.status === "loading";

    if (clothing?.category === "hat") {
      status.textContent =
        "帽子暂时继续使用 2D 自适应叠加；CatVTON 标准自动遮罩类别主要是 upper / lower / overall。";
    } else if (!hasPhoto) {
      status.textContent = "先上传人物照片，再在衣柜中确认一件衣物。";
    } else if (!clothing) {
      status.textContent = "照片已就绪；请在衣柜中确认一件衣物。";
    } else if (supported && state.tryOn.status !== "loading") {
      status.textContent = `已就绪：${clothing.label}。`;
    }
  }

  store.subscribe(refresh);
  refresh(store.getState());

  button.addEventListener("click", async () => {
    const state = store.getState();
    const clothing = state.wardrobe.lastConfirmed;
    if (!state.photo.file || !clothing?.tryOnType) return;

    controller?.abort();
    controller = new AbortController();

    button.disabled = true;
    status.textContent = "AI 试穿处理中…";

    store.setState(current => ({
      ...current,
      tryOn: { status: "loading", resultUrl: null, error: null }
    }));

    try {
      const blob = await runTryOn({
        personFile: state.photo.file,
        clothing,
        signal: controller.signal
      });

      if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
      resultObjectUrl = URL.createObjectURL(blob);

      result.src = resultObjectUrl;
      result.classList.add("is-visible");
      status.textContent = "生成完成。";

      store.setState(current => ({
        ...current,
        tryOn: { status: "success", resultUrl: resultObjectUrl, error: null }
      }));
    } catch (error) {
      if (error.name === "AbortError") return;

      status.textContent = error.message;
      store.setState(current => ({
        ...current,
        tryOn: { status: "error", resultUrl: null, error: error.message }
      }));
    }
  });
}
