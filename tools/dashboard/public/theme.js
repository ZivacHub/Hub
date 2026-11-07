// Runs before the page paints so there is no flash. Light is the default (D20); the choice is remembered if storage works.
try {
  const saved = localStorage.getItem("hub-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
} catch { /* storage blocked: stay on light */ }
