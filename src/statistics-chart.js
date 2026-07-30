import { histogramBins, monthlyDiveCounts } from "./view-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function renderMonthlyHistogram(dives, from, to) {
  const section = document.createElement("section");
  section.className = "monthly-histogram";
  const heading = document.createElement("h3");
  heading.textContent = "Dives per month";
  const months = monthlyDiveCounts(dives, from, to);
  const svg = svgElement("svg", {
    viewBox: "0 0 480 120",
    role: "img",
    "aria-label": `Monthly histogram for ${dives.length} selected dive${
      dives.length === 1 ? "" : "s"
    } from ${from || "first dive"} to ${to || "last dive"}`,
  });
  const maxCount = months.reduce((maximum, item) => Math.max(maximum, item.count), 1);
  const plotLeft = 28;
  const plotRight = 472;
  const plotTop = 8;
  const plotBottom = 88;
  const slotWidth = (plotRight - plotLeft) / Math.max(1, months.length);
  const labelStep = Math.max(1, Math.ceil(months.length / 6));
  months.forEach((item, index) => {
    const height = (item.count / maxCount) * (plotBottom - plotTop);
    const bar = svgElement("rect", {
      x: plotLeft + index * slotWidth + Math.min(1.5, slotWidth * 0.1),
      y: plotBottom - height,
      width: Math.max(1, slotWidth - Math.min(3, slotWidth * 0.2)),
      height,
      class: "monthly-bar",
    });
    const title = svgElement("title");
    title.textContent = `${item.month}: ${item.count} dive${item.count === 1 ? "" : "s"}`;
    bar.append(title);
    svg.append(bar);
    if (index % labelStep === 0 || index === months.length - 1) {
      const label = svgElement("text", {
        x: plotLeft + (index + 0.5) * slotWidth,
        y: 106,
        "text-anchor": "middle",
        class: "selection-axis-label",
      });
      label.textContent = item.month;
      svg.append(label);
    }
  });
  svg.append(
    svgElement("line", {
      x1: plotLeft,
      x2: plotRight,
      y1: plotBottom,
      y2: plotBottom,
      class: "selection-axis",
    }),
  );
  section.append(heading, svg);
  return section;
}

function renderDiveTypeDonut(dives) {
  const section = document.createElement("section");
  section.className = "dive-type-summary";
  const heading = document.createElement("h3");
  heading.textContent = "Decompression Dives";
  const counts = [
    {
      key: "decompression",
      label: "Decompression",
      count: dives.filter((dive) => dive.decoDive === true).length,
    },
    {
      key: "no-decompression",
      label: "No-decompression",
      count: dives.filter((dive) => dive.decoDive === false).length,
    },
  ];
  counts.push({
    key: "unknown",
    label: "Unknown",
    count: dives.length - counts[0].count - counts[1].count,
  });

  const svg = svgElement("svg", {
    viewBox: "0 0 100 100",
    role: "img",
    "aria-label": `${counts[0].count} decompression, ${counts[1].count} no-decompression, and ${counts[2].count} unknown dives`,
  });
  svg.append(
    svgElement("circle", {
      cx: 50,
      cy: 50,
      r: 32,
      pathLength: 100,
      class: "donut-background",
    }),
  );
  let offset = 0;
  counts.forEach((item) => {
    if (!item.count) return;
    const percentage = (item.count / dives.length) * 100;
    const segment = svgElement("circle", {
      cx: 50,
      cy: 50,
      r: 32,
      pathLength: 100,
      "stroke-dasharray": `${percentage} ${100 - percentage}`,
      "stroke-dashoffset": -offset,
      transform: "rotate(-90 50 50)",
      class: `donut-segment donut-${item.key}`,
      role: "img",
      tabindex: "0",
    });
    const title = svgElement("title");
    title.textContent = `${item.count} ${item.label.toLowerCase()} dive${
      item.count === 1 ? "" : "s"
    }`;
    segment.setAttribute("aria-label", title.textContent);
    segment.append(title);
    svg.append(segment);
    offset += percentage;
  });
  const total = svgElement("text", {
    x: 50,
    y: 49,
    "text-anchor": "middle",
    class: "donut-total",
  });
  total.textContent = String(dives.length);
  const label = svgElement("text", {
    x: 50,
    y: 61,
    "text-anchor": "middle",
    class: "donut-label",
  });
  label.textContent = "dives";
  svg.append(total, label);

  const legend = document.createElement("ul");
  legend.className = "donut-legend";
  counts.forEach((item) => {
    if (!item.count) return;
    const entry = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `donut-key donut-${item.key}`;
    entry.append(swatch, document.createTextNode(`${item.label} ${item.count}`));
    legend.append(entry);
  });
  section.append(heading, svg, legend);
  return section;
}

function renderDistribution({ title, unit, values, selectedDiveCount, lowerBound }) {
  const section = document.createElement("section");
  section.className = "distribution-chart";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const bins = histogramBins(values, 10, { lowerBound });
  if (!bins.length) {
    const empty = document.createElement("p");
    empty.textContent = "No data";
    section.append(heading, empty);
    return section;
  }

  const svg = svgElement("svg", {
    viewBox: "0 0 240 105",
    role: "img",
    "aria-label": `${title} distribution: ${values.length} of ${selectedDiveCount} selected dives have data`,
  });
  const plotLeft = 18;
  const plotRight = 234;
  const plotTop = 7;
  const plotBottom = 75;
  const slotWidth = (plotRight - plotLeft) / bins.length;
  const maxCount = bins.reduce((maximum, bin) => Math.max(maximum, bin.count), 1);
  bins.forEach((bin, index) => {
    const height = (bin.count / maxCount) * (plotBottom - plotTop);
    const bar = svgElement("rect", {
      x: plotLeft + index * slotWidth + 1,
      y: plotBottom - height,
      width: Math.max(1, slotWidth - 2),
      height,
      class: "distribution-bar",
    });
    const range =
      bin.start === bin.end
        ? `${bin.start.toFixed(1)} ${unit}`
        : `${bin.start.toFixed(1)}–${bin.end.toFixed(1)} ${unit}`;
    const tooltip = svgElement("title");
    tooltip.textContent = `${range}: ${bin.count} dive${bin.count === 1 ? "" : "s"}`;
    bar.append(tooltip);
    svg.append(bar);
  });
  svg.append(
    svgElement("line", {
      x1: plotLeft,
      x2: plotRight,
      y1: plotBottom,
      y2: plotBottom,
      class: "selection-axis",
    }),
  );
  const minimum = svgElement("text", {
    x: plotLeft,
    y: 94,
    "text-anchor": "start",
    class: "selection-axis-label",
  });
  minimum.textContent = `${bins[0].start.toFixed(1)} ${unit}`;
  const maximum = svgElement("text", {
    x: plotRight,
    y: 94,
    "text-anchor": "end",
    class: "selection-axis-label",
  });
  maximum.textContent = `${bins.at(-1).end.toFixed(1)} ${unit}`;
  svg.append(minimum, maximum);
  section.append(heading, svg);
  return section;
}

export function renderSelectionStatistics(container, dives, { from = "", to = "" } = {}) {
  container.replaceChildren();
  if (!dives.length) {
    const empty = document.createElement("p");
    empty.textContent = "Select dives to see statistics.";
    container.append(empty);
    return;
  }

  const overview = document.createElement("div");
  overview.className = "selection-overview";
  overview.append(renderMonthlyHistogram(dives, from, to), renderDiveTypeDonut(dives));

  const distributions = document.createElement("div");
  distributions.className = "selection-distributions";
  [
    {
      title: "Maximum depth",
      unit: "m",
      values: dives.map((dive) => dive.maxDepth).filter(Number.isFinite),
      selectedDiveCount: dives.length,
      lowerBound: 0,
    },
    {
      title: "Duration",
      unit: "min",
      values: dives
        .map((dive) => dive.durationSeconds)
        .filter(Number.isFinite)
        .map((duration) => duration / 60),
      selectedDiveCount: dives.length,
      lowerBound: 0,
    },
    {
      title: "Minimum temperature",
      unit: "°C",
      values: dives.map((dive) => dive.minTemperature).filter(Number.isFinite),
      selectedDiveCount: dives.length,
    },
    {
      title: "Maximum CNS",
      unit: "%",
      values: dives.map((dive) => dive.maxCns).filter(Number.isFinite),
      selectedDiveCount: dives.length,
      lowerBound: 0,
    },
    {
      title: "Maximum GF99",
      unit: "%",
      values: dives.map((dive) => dive.maxGf99).filter(Number.isFinite),
      selectedDiveCount: dives.length,
      lowerBound: 0,
    },
  ].forEach((definition) => distributions.append(renderDistribution(definition)));
  container.append(overview, distributions);
}
