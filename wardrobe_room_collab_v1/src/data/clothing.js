export const CLOTHING = {
  pants: {
    id: "pants_green_001",
    category: "pants",
    label: "裤子",
    image: "/src/assets/clothing_pants.png",
    description: "浅绿色长裤。",
    tryOnType: "lower"
  },
  coat: {
    id: "coat_cardigan_cream_001",
    category: "coat",
    label: "外套",
    image: "/src/assets/clothing_coat.png",
    description: "米白色针织开衫外套。",
    tryOnType: "upper"
  },
  top: {
    id: "top_shirt_blue_001",
    category: "top",
    label: "上衣",
    image: "/src/assets/clothing_top.png",
    description: "浅蓝色长袖衬衫。",
    tryOnType: "upper"
  },
  hat: {
    id: "hat_bucket_beige_001",
    category: "hat",
    label: "帽子",
    image: "/src/assets/clothing_hat.png",
    description: "米色渔夫帽。",
    tryOnType: null
  }
};

export function getClothing(category) {
  return CLOTHING[category] ?? null;
}
