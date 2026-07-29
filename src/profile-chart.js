const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

export function profilePath(
  samples,
  width,
  height,
  padding = 32,
  maxTime = Math.max(...samples.map((sample) => sample.time), 1),
  maxDepth = Math.max(...samples.map((sample) => sample.depth), 1),
) {
  if (!samples.length) return "";
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
  const series = samples?.[0]?.samples
    ? samples.filter((item) => item.samples?.length)
    : samples?.length
      ? [{ label: "Dive profile", samples }]
      : [];
  if (!series.length) {
    container.textContent = "No profile samples are available.";
    return;
  }
  const width = 720;
  const height = 280;
  const padding = 42;
  const plotRight = width - padding;
  const plotBottom = height - padding;
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${series.length} depth profile${series.length === 1 ? "" : "s"} over dive time`,
  });
  let maxTime = 1;
  let maxDepth = 1;
  series.forEach((item) => {
    item.samples.forEach((sample) => {
      if (sample.time > maxTime) maxTime = sample.time;
      if (sample.depth > maxDepth) maxDepth = sample.depth;
    });
  });
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const x = padding + ratio * (plotRight - padding);
    const y = padding + ratio * (plotBottom - padding);
    const depthLabel = svgElement("text", {
      x: padding - 6,
      y: y + 4,
      "text-anchor": "end",
      class: "profile-axis-label",
    });
    const timeLabel = svgElement("text", {
      x,
      y: plotBottom + 18,
      "text-anchor": "middle",
      class: "profile-axis-label",
    });
    depthLabel.textContent = `${(ratio * maxDepth).toFixed(0)} m`;
    timeLabel.textContent = `${Math.round((ratio * maxTime) / 60)} min`;
    svg.append(
      svgElement("line", {
        x1: padding,
        x2: plotRight,
        y1: y,
        y2: y,
        class: "profile-grid",
      }),
      depthLabel,
      svgElement("line", {
        x1: x,
        x2: x,
        y1: padding,
        y2: plotBottom,
        class: "profile-grid",
      }),
      timeLabel,
    );
  }
  if (series.length === 1) {
    svg.append(
      svgElement("path", {
        d: `${profilePath(series[0].samples, width, height, padding, maxTime, maxDepth)} L${width - padding},${padding} L${padding},${padding} Z`,
        class: "profile-area",
      }),
    );
  }
  series.forEach((item, index) => {
    svg.append(
      svgElement("path", {
        d: profilePath(item.samples, width, height, padding, maxTime, maxDepth),
        class: `profile-line profile-series-${index % 4}`,
      }),
    );
  });
  const cursor = svgElement("line", {
    x1: padding,
    x2: padding,
    y1: padding,
    y2: plotBottom,
    class: "profile-cursor",
    hidden: "true",
  });
  const tooltip = document.createElement("output");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("aria-live", "polite");
  svg.append(cursor);
  const legend = document.createElement("ul");
  legend.className = "profile-legend";
  series.slice(0, 6).forEach((item, index) => {
    const entry = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `profile-swatch profile-series-${index % 4}`;
    entry.append(swatch, document.createTextNode(item.label));
    legend.append(entry);
  });
  if (series.length > 6) {
    const remaining = document.createElement("li");
    remaining.textContent = `+${series.length - 6} more`;
    legend.append(remaining);
  }
  container.append(svg, legend, tooltip);

  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
    const ratio = Math.max(0, Math.min(1, (svgX - padding) / (plotRight - padding)));
    const targetTime = ratio * maxTime;
    const nearest = series.map((item) => ({
      label: item.label,
      sample: item.samples.reduce((best, current) =>
        Math.abs(current.time - targetTime) < Math.abs(best.time - targetTime) ? current : best,
      ),
    }));
    const x = padding + ratio * (width - padding * 2);
    cursor.setAttribute("x1", x);
    cursor.setAttribute("x2", x);
    cursor.removeAttribute("hidden");
    tooltip.value = nearest
      .map(
        ({ label, sample }) =>
          `${label}: ${Math.round(sample.time / 60)} min · ${sample.depth.toFixed(1)} m${
            Number.isFinite(sample.temperature) ? ` · ${sample.temperature.toFixed(1)} °C` : ""
          }`,
      )
      .join(" | ");
  });
  svg.addEventListener("pointerleave", () => cursor.setAttribute("hidden", "true"));
}
