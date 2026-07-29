const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

export function profilePath(samples, width, height, padding = 32) {
  if (!samples.length) return "";
  const maxTime = Math.max(...samples.map((sample) => sample.time), 1);
  const maxDepth = Math.max(...samples.map((sample) => sample.depth), 1);
  return samples
    .map((sample, index) => {
      const x = padding + (sample.time / maxTime) * (width - padding * 2);
      const y = padding + (sample.depth / maxDepth) * (height - padding * 2);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function renderProfileChart(container, samples) {
  container.replaceChildren();
  if (!samples?.length) {
    container.textContent = "No profile samples are available.";
    return;
  }
  const width = 720;
  const height = 280;
  const padding = 32;
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "Depth over dive time",
  });
  const path = svgElement("path", {
    d: `${profilePath(samples, width, height, padding)} L${width - padding},${padding} L${padding},${padding} Z`,
    class: "profile-area",
  });
  const line = svgElement("path", {
    d: profilePath(samples, width, height, padding),
    class: "profile-line",
  });
  const cursor = svgElement("line", {
    x1: padding,
    x2: padding,
    y1: padding,
    y2: height - padding,
    class: "profile-cursor",
    hidden: "true",
  });
  const tooltip = document.createElement("output");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("aria-live", "polite");
  svg.append(path, line, cursor);
  container.append(svg, tooltip);

  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const duration = Math.max(samples.at(-1).time, 1);
    const targetTime = ratio * duration;
    const sample = samples.reduce((best, current) =>
      Math.abs(current.time - targetTime) < Math.abs(best.time - targetTime) ? current : best,
    );
    const x = padding + (sample.time / duration) * (width - padding * 2);
    cursor.setAttribute("x1", x);
    cursor.setAttribute("x2", x);
    cursor.removeAttribute("hidden");
    tooltip.value = `${Math.round(sample.time / 60)} min · ${sample.depth.toFixed(1)} m${
      Number.isFinite(sample.temperature) ? ` · ${sample.temperature.toFixed(1)} °C` : ""
    }`;
  });
  svg.addEventListener("pointerleave", () => cursor.setAttribute("hidden", "true"));
}
