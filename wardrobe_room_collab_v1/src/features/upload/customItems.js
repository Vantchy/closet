// 自定义衣物（用户通过衣物格“＋”上传的本地图片）注册表。
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
