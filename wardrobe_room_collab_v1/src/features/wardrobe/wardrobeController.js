import { CLOTHING, getClothing } from "../../data/clothing.js";
import { getCustomItems } from "../upload/customItems.js";

export function mountWardrobeController(store) {
  const scene = document.getElementById("scene");
  const wardrobe = document.getElementById("wardrobe");
  const character = document.getElementById("character");
  const switcher = document.getElementById("genderSwitch");
  const genderButtons = [...document.querySelectorAll(".gender-btn")];
  const categoryButtons = [...document.querySelectorAll(".category-btn")];
  const itemGridPanel = document.getElementById("itemGridPanel");
  const selectionActions = document.getElementById("selectionActions");
  const cancelSelectionBtn = document.getElementById("cancelSelectionBtn");
  const confirmSelectionBtn = document.getElementById("confirmSelectionBtn");
  const takeOffBtn = document.getElementById("takeOffBtn");
  const profilePreview = document.getElementById("profilePreview");
  const profileContent = document.getElementById("profileContent");
  const profileEditBtn = document.getElementById("profileEditBtn");

  const characterAssets = {
    male: {
      character: "/src/assets/character_male.png",
      wardrobe: "/src/assets/wardrobe_male.png",
      altCharacter: "男生角色",
      altWardrobe: "男生衣柜，点击放大查看"
    },
    female: {
      character: "/src/assets/character_female.png",
      wardrobe: "/src/assets/wardrobe_female.png",
      altCharacter: "女生角色",
      altWardrobe: "女生衣柜，点击放大查看"
    }
  };

  const wearableLayers = {
    pants: document.getElementById("wearable-pants"),
    top: document.getElementById("wearable-top"),
    coat: document.getElementById("wearable-coat"),
    hat: document.getElementById("wearable-hat")
  };

  let previewState = null;

  function mutateStore(mutator) {
    store.setState(current => {
      const next = {
        ...current,
        room: { ...current.room },
        wardrobe: {
          ...current.wardrobe,
          savedOutfits: { ...current.wardrobe.savedOutfits }
        }
      };
      mutator(next);
      return next;
    });
  }

  function setGender(gender) {
    const nextAsset = characterAssets[gender];
    switcher.dataset.gender = gender;
    wardrobe.style.opacity = "0";
    character.style.opacity = "0";

    setTimeout(() => {
      wardrobe.src = nextAsset.wardrobe;
      wardrobe.alt = nextAsset.altWardrobe;
      character.src = nextAsset.character;
      character.alt = nextAsset.altCharacter;

      genderButtons.forEach(btn => {
        btn.setAttribute("aria-pressed", String(btn.dataset.gender === gender));
      });

      mutateStore(next => { next.gender = gender; });

      requestAnimationFrame(() => {
        wardrobe.style.opacity = "1";
        character.style.opacity = "1";
      });
    }, 120);
  }

  genderButtons.forEach(btn => {
    btn.addEventListener("click", () => setGender(btn.dataset.gender));
  });

  function setWearable(category, src) {
    const layer = wearableLayers[category];
    if (!layer) return;

    if (src) {
      layer.src = src;
      layer.classList.add("is-visible");
    } else {
      layer.removeAttribute("src");
      layer.classList.remove("is-visible");
    }
  }

  function restoreSavedWearable(category) {
    const saved = store.getState().wardrobe.savedOutfits[category];
    setWearable(category, saved?.image ?? null);
  }

  function clearSelectionUI() {
    itemGridPanel
      .querySelectorAll(".item-slot--filled.is-selected")
      .forEach(slot => slot.classList.remove("is-selected"));
    selectionActions.classList.remove("is-visible");
    takeOffBtn.hidden = true;
    profilePreview.classList.remove("is-visible");
    profileContent.removeAttribute("contenteditable");
    profileEditBtn.textContent = "修改";
  }

  function cancelPreview() {
    if (previewState) {
      restoreSavedWearable(previewState.category);
      previewState = null;
    }
    clearSelectionUI();
    mutateStore(next => { next.wardrobe.selectedCategory = null; });
  }

  function confirmPreview() {
    if (!previewState) return;

    const item = previewState.item;
    setWearable(previewState.category, item.image);

    mutateStore(next => {
      next.wardrobe.savedOutfits[previewState.category] = item;
      next.wardrobe.lastConfirmed = item;
      next.wardrobe.selectedCategory = null;
    });

    previewState = null;
    clearSelectionUI();
  }

  // 脱下 = 穿上的逆操作：图层清空、savedOutfits 恢复为 null
  function takeOffPreview() {
    if (!previewState) return;

    const { category, item } = previewState;
    setWearable(category, null);

    mutateStore(next => {
      if (next.wardrobe.savedOutfits[category] === item) {
        next.wardrobe.savedOutfits[category] = null;
      }
      if (next.wardrobe.lastConfirmed === item) {
        next.wardrobe.lastConfirmed = null;
      }
      next.wardrobe.selectedCategory = null;
    });

    previewState = null;
    clearSelectionUI();
  }

  function beginPreview(category, slot, item = null) {
    if (previewState) cancelPreview();

    const previewItem = item ?? getClothing(category);
    if (!previewItem) return;

    previewState = { category, item: previewItem };
    setWearable(category, previewItem.image);

    itemGridPanel
      .querySelectorAll(".item-slot--filled")
      .forEach(other => other.classList.remove("is-selected"));
    slot.classList.add("is-selected");

    profileContent.textContent = `衣物分类：${previewItem.label}\n${previewItem.description}`;
    selectionActions.classList.add("is-visible");
    profilePreview.classList.add("is-visible");

    // 只有预览的正是当前穿着的这件，才提供“脱下”
    takeOffBtn.hidden =
      store.getState().wardrobe.savedOutfits[category] !== previewState.item;

    mutateStore(next => { next.wardrobe.selectedCategory = category; });
  }

  function renderItemGrid(category) {
    const item = CLOTHING[category];
    itemGridPanel.innerHTML = "";

    const clothingSlot = document.createElement("button");
    clothingSlot.type = "button";
    clothingSlot.className = "item-slot item-slot--filled";
    clothingSlot.setAttribute("aria-label", `${item.label}衣物`);
    clothingSlot.innerHTML =
      `<img class="item-thumb" src="${item.image}" alt="${item.label}" draggable="false" />`;
    clothingSlot.addEventListener("click", event => {
      event.stopPropagation();
      beginPreview(category, clothingSlot);
    });
    itemGridPanel.appendChild(clothingSlot);

    getCustomItems(category).forEach(customItem => {
      const customSlot = document.createElement("button");
      customSlot.type = "button";
      customSlot.className = "item-slot item-slot--filled";
      customSlot.setAttribute("aria-label", `${customItem.label}衣物`);
      customSlot.innerHTML =
        `<img class="item-thumb" src="${customItem.image}" alt="${customItem.label}" draggable="false" />`;
      customSlot.addEventListener("click", event => {
        event.stopPropagation();
        beginPreview(category, customSlot, customItem);
      });
      itemGridPanel.appendChild(customSlot);
    });

    const usedSlots = 1 + getCustomItems(category).length;
    const hasAddSlot = usedSlots < 12;

    if (hasAddSlot) {
      const addSlot = document.createElement("button");
      addSlot.type = "button";
      addSlot.className = "item-slot add-slot";
      addSlot.setAttribute("aria-label", "添加衣物");
      addSlot.textContent = "＋";
      addSlot.addEventListener("click", event => {
        event.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("upload:request", { detail: { category } })
        );
      });
      itemGridPanel.appendChild(addSlot);
    }

    for (let i = usedSlots + (hasAddSlot ? 1 : 0); i < 12; i += 1) {
      const emptySlot = document.createElement("div");
      emptySlot.className = "item-slot";
      itemGridPanel.appendChild(emptySlot);
    }
  }

  function resetWardrobeTools() {
    cancelPreview();
    categoryButtons.forEach(btn => btn.setAttribute("aria-pressed", "false"));
    itemGridPanel.classList.remove("is-visible");
    mutateStore(next => { next.wardrobe.activeCategory = null; });
  }

  function enterWardrobeFocus() {
    scene.classList.add("is-zoomed");
    resetWardrobeTools();
    mutateStore(next => { next.room.wardrobeFocused = true; });
  }

  function exitWardrobeFocus() {
    cancelPreview();
    scene.classList.remove("is-zoomed");
    categoryButtons.forEach(btn => btn.setAttribute("aria-pressed", "false"));
    itemGridPanel.classList.remove("is-visible");

    mutateStore(next => {
      next.room.wardrobeFocused = false;
      next.wardrobe.activeCategory = null;
    });
  }

  wardrobe.addEventListener("click", event => {
    event.stopPropagation();
    if (!scene.classList.contains("is-zoomed")) enterWardrobeFocus();
  });

  categoryButtons.forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();

      if (previewState) cancelPreview();

      categoryButtons.forEach(other => {
        other.setAttribute("aria-pressed", String(other === btn));
      });

      renderItemGrid(btn.dataset.category);
      itemGridPanel.classList.add("is-visible");
      mutateStore(next => { next.wardrobe.activeCategory = btn.dataset.category; });
    });
  });

  itemGridPanel.addEventListener("click", event => event.stopPropagation());

  window.addEventListener("custom-items:changed", event => {
    const category = event.detail?.category;
    if (!category || store.getState().wardrobe.activeCategory !== category) return;

    if (previewState) cancelPreview();
    renderItemGrid(category);
    itemGridPanel.classList.add("is-visible");
  });

  selectionActions.addEventListener("click", event => event.stopPropagation());
  profilePreview.addEventListener("click", event => event.stopPropagation());
  switcher.addEventListener("click", event => event.stopPropagation());

  cancelSelectionBtn.addEventListener("click", event => {
    event.stopPropagation();
    cancelPreview();
  });

  takeOffBtn.addEventListener("click", event => {
    event.stopPropagation();
    takeOffPreview();
  });

  confirmSelectionBtn.addEventListener("click", event => {
    event.stopPropagation();
    confirmPreview();
  });

  profileEditBtn.addEventListener("click", event => {
    event.stopPropagation();
    const editing = profileContent.getAttribute("contenteditable") === "true";

    if (editing) {
      profileContent.removeAttribute("contenteditable");
      profileEditBtn.textContent = "修改";
    } else {
      profileContent.setAttribute("contenteditable", "true");
      profileContent.focus();
      profileEditBtn.textContent = "完成";
    }
  });

  scene.addEventListener("click", event => {
    if (!scene.classList.contains("is-zoomed")) return;

    const clickedControl = event.target.closest(
      "#wardrobe, .wardrobe-tools, .gender-switch, .integration-dock"
    );
    if (clickedControl) return;

    exitWardrobeFocus();
  });

  window.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !scene.classList.contains("is-zoomed")) return;
    if (previewState) cancelPreview();
    else exitWardrobeFocus();
  });
}
