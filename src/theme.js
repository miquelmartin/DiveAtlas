(() => {
  const storageKey = "diveatlas-theme";
  const choices = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const preview = new URLSearchParams(window.location.search).get("scoutTheme");
  const stored = localStorage.getItem(storageKey);
  let preference = choices.has(preview) && preview !== "system"
    ? preview
    : choices.has(stored)
      ? stored
      : "system";

  const apply = () => {
    const effective = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.setAttribute("data-theme", effective);
  };

  globalThis.diveAtlasTheme = {
    get preference() {
      return preference;
    },
    set(preferred) {
      preference = choices.has(preferred) ? preferred : "system";
      if (preference === "system") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, preference);
      apply();
    },
  };

  media.addEventListener?.("change", () => {
    if (preference === "system") apply();
  });
  apply();
})();
