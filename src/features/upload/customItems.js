// 自定义衣物（用户通过衣物格"＋"上传的本地图片）注册表。
// 故意不放进 core/store.js：store 是三人冻结的接口合同，
// 这份状态只属于上传功能，通过事件通知衣柜格刷新。

export const MAX_CUSTOM_ITEMS = 11; // 12 格衣物格 - 1 个默认衣物格

const customItems = {
  hat: [],
  top: [],
  coat: [],
  pants: []
};

let nextId = 1;

export function getCustomItems(category) {
  return customItems[category] ?? [];
}

export function canAddCustomItem(category) {
  return (customItems[category]?.length ?? 0) < MAX_CUSTOM_ITEMS;
}

export function addCustomItem(category, { name, url }) {
  if (!customItems[category] || !canAddCustomItem(category)) return null;

  const item = {
    id: `custom_${category}_${nextId}`,
    category,
    label: name,
    image: url,
    description: "本地自定义衣物。",
    tryOnType: null
  };
  nextId += 1;
  customItems[category].push(item);

  window.dispatchEvent(
    new CustomEvent("custom-items:changed", { detail: { category } })
  );
  return item;
}

// 原地更新某件自定义衣物的图片（预览面板"旋转"按钮用）。
// 故意不派发 custom-items:changed：那个事件会取消预览并重置衣物格，
// 而旋转时需要保持预览打开，由 wardrobeController 自行同步缩略图与试穿图层。
// 注意：savedOutfits 里保存的是同一件 item 对象的引用，改 image 字段即可全局一致。
export function updateCustomItemImage(category, id, url) {
  const item = customItems[category]?.find(entry => entry.id === id);
  if (!item) return null;
  item.image = url;
  return item;
}

// 删除自定义衣物（预览面板"删除"按钮用）。
// 若这件衣物正被穿着，调用方需先清理 store 中的引用再调用本函数。
// 派发 custom-items:changed 后，监听方会取消预览并重建衣物格（＋格回退）。
export function removeCustomItem(category, id) {
  const list = customItems[category];
  if (!list) return false;

  const index = list.findIndex(entry => entry.id === id);
  if (index === -1) return false;

  const [removed] = list.splice(index, 1);
  window.dispatchEvent(
    new CustomEvent("custom-items:changed", { detail: { category } })
  );
  if (removed?.image) URL.revokeObjectURL(removed.image);
  return true;
}