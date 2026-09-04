const initialState = {
  gender: "male",
  room: { wardrobeFocused: false },
  wardrobe: {
    activeCategory: null,
    selectedCategory: null,
    savedOutfits: { hat: null, top: null, coat: null, pants: null },
    lastConfirmed: null
  },
  photo: { file: null, url: null, name: null },
  weather: { status: "idle", data: null, error: null },
  tryOn: { status: "idle", resultUrl: null, error: null }
};

export function createStore() {
  let state = structuredClone(initialState);
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(updater) {
    const next = typeof updater === "function" ? updater(state) : updater;
    if (next) state = next;
    listeners.forEach(listener => listener(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}
