import { histogramBins, monthlyDiveCounts } from "./view-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function histogramTooltipText(label, allCount, selectedCount) {
  return `${label} · All dives: ${allCount} · Selected dives: ${selectedCount}`;
}

function renderLayeredHistogram({
  allBins,
  selectedBins,
  ariaLabel,
  tooltipLabel,
  axisLabels,
}) {
  const svg = svgElement("svg", {
    viewBox: "0 0 480 110",
    role: "img",
    "aria-label": ariaLabel,
  });
  const tooltip = document.createElement("output");
  tooltip.className = "histogram-tooltip";
  tooltip.hidden = true;
  const plotLeft = 2;
  const plotRight = 478;
  const plotTop = 6;
  const plotBottom = 80;
  const slotWidth = (plotRight - plotLeft) / allBins.length;
  const maxCount = Math.max(
    1,
    ...allBins.map((bin) => bin.count),
    ...selectedBins.map((bin) => bin.count),
  );

  allBins.forEach((bin, index) => {
    const selectedBin = selectedBins[index];
    const allHeight = (bin.count / maxCount) * (plotBottom - plotTop);
    const selectedHeight = (selectedBin.count / maxCount) * (plotBottom - plotTop);
    const outerGap = Math.min(1, slotWidth * 0.04);
    const allBarWidth = Math.max(1, slotWidth - outerGap * 2);
    const selectedBarWidth = Math.max(1, allBarWidth * 0.56);
    const x = plotLeft + index * slotWidth;
    const allBar = svgElement("rect", {
      x: x + outerGap,
      y: plotBottom - allHeight,
      width: allBarWidth,
      height: allHeight,
      class: "histogram-bar histogram-bar-all",
    });
    const selectedBar = svgElement("rect", {
      x: x + (slotWidth - selectedBarWidth) / 2,
      y: plotBottom - selectedHeight,
      width: selectedBarWidth,
      height: selectedHeight,
      class: "histogram-bar histogram-bar-selected",
    });
    const label = tooltipLabel(bin, index);
    const tooltipText = histogramTooltipText(label, bin.count, selectedBin.count);
    const hitArea = svgElement("rect", {
      x,
      y: plotTop,
      width: slotWidth,
      height: plotBottom - plotTop,
      class: "histogram-hit-area",
      tabindex: "0",
      role: "img",
      "aria-label": tooltipText,
    });
    const title = svgElement("title");
    title.textContent = tooltipText;
    hitArea.append(title);
    const showTooltip = () => {
      tooltip.textContent = tooltipText;
      tooltip.style.left = `${Math.max(10, Math.min(90, ((index + 0.5) / allBins.length) * 100))}%`;
      tooltip.hidden = false;
    };
    const hideTooltip = () => {
      tooltip.hidden = true;
    };
    hitArea.addEventListener("pointerenter", showTooltip);
    hitArea.addEventListener("pointerleave", hideTooltip);
    hitArea.addEventListener("focus", showTooltip);
    hitArea.addEventListener("blur", hideTooltip);
    svg.append(allBar, selectedBar, hitArea);
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
  axisLabels.forEach(({ position, text, anchor = "middle" }) => {
    const label = svgElement("text", {
      x: plotLeft + position * (plotRight - plotLeft),
      y: 100,
      "text-anchor": anchor,
      class: "selection-axis-label",
    });
    label.textContent = text;
    svg.append(label);
  });
  return { svg, tooltip };
}

function renderMonthlyHistogram(dives, libraryDives) {
  const section = document.createElement("section");
  section.className = "monthly-histogram histogram-chart";
  const heading = document.createElement("h3");
  heading.textContent = "Dives per month";
  const allMonths = monthlyDiveCounts(libraryDives, "", "");
  const effectiveFrom = allMonths[0]?.month || "";
  const effectiveTo = allMonths.at(-1)?.month || "";
  const selectedMonths = monthlyDiveCounts(dives, effectiveFrom, effectiveTo);
  const labelStep = Math.max(1, Math.ceil(allMonths.length / 6));
  const axisLabels = allMonths
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => index % labelStep === 0 || index === allMonths.length - 1)
    .map(({ item, index }) => ({
      position: (index + 0.5) / allMonths.length,
      text: item.month,
    }));
  const { svg, tooltip } = renderLayeredHistogram({
    allBins: allMonths,
    selectedBins: selectedMonths,
    ariaLabel: `Monthly histogram for ${libraryDives.length} library dives and ${dives.length} selected dives from ${effectiveFrom || "first dive"} to ${effectiveTo || "last dive"}`,
    tooltipLabel: (bin) => bin.month,
    axisLabels,
  });
  section.append(heading, svg, tooltip);
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

function renderDistribution({
  title,
  unit,
  selectedValues,
  allValues,
  selectedDiveCount,
  libraryDiveCount,
  lowerBound,
  upperBound,
}) {
  const section = document.createElement("section");
  section.className = "distribution-chart histogram-chart";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const allBins = histogramBins(allValues, 20, { lowerBound, upperBound });
  if (!allBins.length) {
    const empty = document.createElement("p");
    empty.textContent = "No data";
    section.append(heading, empty);
    return section;
  }
  const domain = {
    lowerBound: allBins[0].start,
    upperBound: allBins.at(-1).end,
  };
  const selectedHistogram = histogramBins(selectedValues, 20, domain);
  const selectedBins = selectedHistogram.length
    ? selectedHistogram
    : allBins.map((bin) => ({ ...bin, count: 0 }));
  const formatRange = (bin) =>
    bin.start === bin.end
      ? `${bin.start.toFixed(1)} ${unit}`
      : `${bin.start.toFixed(1)}–${bin.end.toFixed(1)} ${unit}`;
  const { svg, tooltip } = renderLayeredHistogram({
    allBins,
    selectedBins,
    ariaLabel: `${title} distribution: ${allValues.length} of ${libraryDiveCount} library dives and ${selectedValues.length} of ${selectedDiveCount} selected dives have data`,
    tooltipLabel: formatRange,
    axisLabels: [
      { position: 0, text: `${allBins[0].start.toFixed(1)} ${unit}`, anchor: "start" },
      { position: 1, text: `${allBins.at(-1).end.toFixed(1)} ${unit}`, anchor: "end" },
    ],
  });
  section.append(heading, svg, tooltip);
  return section;
}

export function renderSelectionStatistics(
  container,
  dives,
  { libraryDives = dives } = {},
) {
  container.replaceChildren();
  if (!dives.length) {
    const empty = document.createElement("p");
    empty.textContent = "Select dives to see statistics.";
    container.append(empty);
    return;
  }

  const maximum = (key, fallback, transform = (value) => value) =>
    Math.max(
      fallback,
      ...libraryDives.map((dive) => transform(dive[key])).filter(Number.isFinite),
    );
  const depthMaximum = maximum("maxDepth", 0);
  const durationMaximum = maximum("durationSeconds", 0, (value) => value / 60);
  const cnsMaximum = maximum("maxCns", 100);
  const gf99Maximum = maximum("maxGf99", 100);
  const values = (divesToRead, key, transform = (value) => value) =>
    divesToRead.map((dive) => transform(dive[key])).filter(Number.isFinite);
  const legend = document.createElement("div");
  legend.className = "histogram-legend";
  [
    ["histogram-key-all", "All dives"],
    ["histogram-key-selected", "Selected dives"],
  ].forEach(([className, label]) => {
    const item = document.createElement("span");
    const swatch = document.createElement("span");
    swatch.className = `histogram-key ${className}`;
    item.append(swatch, document.createTextNode(label));
    legend.append(item);
  });
  const charts = document.createElement("div");
  charts.className = "selection-grid";
  charts.append(
    renderMonthlyHistogram(dives, libraryDives),
    renderDiveTypeDonut(dives),
  );
  [
    {
      title: "Maximum depth",
      unit: "m",
      selectedValues: values(dives, "maxDepth"),
      allValues: values(libraryDives, "maxDepth"),
      selectedDiveCount: dives.length,
      libraryDiveCount: libraryDives.length,
      lowerBound: 0,
      upperBound: depthMaximum,
    },
    {
      title: "Duration",
      unit: "min",
      selectedValues: values(dives, "durationSeconds", (duration) => duration / 60),
      allValues: values(libraryDives, "durationSeconds", (duration) => duration / 60),
      selectedDiveCount: dives.length,
      libraryDiveCount: libraryDives.length,
      lowerBound: 0,
      upperBound: durationMaximum,
    },
    {
      title: "Minimum temperature",
      unit: "°C",
      selectedValues: values(dives, "minTemperature"),
      allValues: values(libraryDives, "minTemperature"),
      selectedDiveCount: dives.length,
      libraryDiveCount: libraryDives.length,
    },
    {
      title: "Maximum CNS",
      unit: "%",
      selectedValues: values(dives, "maxCns"),
      allValues: values(libraryDives, "maxCns"),
      selectedDiveCount: dives.length,
      libraryDiveCount: libraryDives.length,
      lowerBound: 0,
      upperBound: cnsMaximum,
    },
    {
      title: "Maximum GF99",
      unit: "%",
      selectedValues: values(dives, "maxGf99"),
      allValues: values(libraryDives, "maxGf99"),
      selectedDiveCount: dives.length,
      libraryDiveCount: libraryDives.length,
      lowerBound: 0,
      upperBound: gf99Maximum,
    },
  ].forEach((definition) => charts.append(renderDistribution(definition)));
  container.append(legend, charts);
}
