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
  const heading = document.createElement("h2");
  heading.className = "profile-chart-title";
  heading.textContent = "Depth Profile";
  container.append(heading);
  const profileSeries = samples?.[0]?.samples
    ? samples
    : samples?.length
      ? [{ label: "Dive profile", samples }]
      : [];
  const series = profileSeries.filter((item) => item.samples?.length);
  const unavailableCount = profileSeries.length - series.length;
  if (!series.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = unavailableCount
      ? `No profile samples are available for the selected dive${
          unavailableCount === 1 ? "" : "s"
        }.`
      : "No profile samples are available.";
    container.append(empty);
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
  const hoverPoint = svgElement("circle", {
    cx: padding,
    cy: padding,
    r: 4,
    class: "profile-hover-point",
    hidden: "true",
  });
  const tooltip = document.createElement("output");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("aria-live", "polite");
  tooltip.hidden = true;
  svg.append(hoverPoint);
  container.append(svg, tooltip);
  if (unavailableCount) {
    const unavailable = document.createElement("p");
    unavailable.className = "profile-unavailable";
    unavailable.textContent = `${unavailableCount} selected dive${
      unavailableCount === 1 ? "" : "s"
    } ${unavailableCount === 1 ? "has" : "have"} no profile samples.`;
    container.append(unavailable);
  }

  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
    const svgY = ((event.clientY - bounds.top) / bounds.height) * height;
    const ratio = Math.max(0, Math.min(1, (svgX - padding) / (plotRight - padding)));
    const targetTime = ratio * maxTime;
    const nearest = series.reduce((best, dive) => {
      const samplesByTime = dive.samples;
      let low = 0;
      let high = samplesByTime.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (samplesByTime[middle].time < targetTime) low = middle + 1;
        else high = middle;
      }
      const consider = (index) => {
        const sample = samplesByTime[index];
        const x = padding + (sample.time / maxTime) * (width - padding * 2);
        const y = padding + (sample.depth / maxDepth) * (height - padding * 2);
        const distance = (x - svgX) ** 2 + (y - svgY) ** 2;
        if (!best || distance < best.distance) {
          best = { dive, sample, x, y, distance };
        }
        return (x - svgX) ** 2;
      };
      for (let index = low; index < samplesByTime.length; index += 1) {
        const horizontalDistance = consider(index);
        if (best && horizontalDistance > best.distance) break;
      }
      for (let index = low - 1; index >= 0; index -= 1) {
        const horizontalDistance = consider(index);
        if (best && horizontalDistance > best.distance) break;
      }
      return best;
    }, null);
    hoverPoint.setAttribute("cx", nearest.x);
    hoverPoint.setAttribute("cy", nearest.y);
    hoverPoint.removeAttribute("hidden");
    const item = document.createElement("span");
    const number =
      nearest.dive.number ??
      nearest.dive.label.replace(/^Dive\s+/, "").split(" · ")[0];
    item.textContent = `Dive ${number} · ${
      nearest.dive.location ?? "Unknown location"
    } · ${nearest.dive.site ?? "Unknown site"} · ${nearest.sample.depth.toFixed(
      1,
    )} m · ${(nearest.sample.time / 60).toFixed(1)} min`;
    tooltip.replaceChildren(item);
    const containerBounds = container.getBoundingClientRect();
    tooltip.hidden = false;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(
      6,
      Math.min(event.clientX - containerBounds.left + 12, containerBounds.width - tooltipWidth - 6),
    )}px`;
    tooltip.style.top = `${Math.max(
      6,
      Math.min(event.clientY - containerBounds.top + 12, containerBounds.height - tooltipHeight - 6),
    )}px`;
  });
  svg.addEventListener("pointerleave", () => {
    hoverPoint.setAttribute("hidden", "true");
    tooltip.hidden = true;
  });
}
