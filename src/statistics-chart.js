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
  divesForBin = () => [],
  onSelectDives = () => {},
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
    const barWidth = Math.max(1, slotWidth - outerGap * 2);
    const x = plotLeft + index * slotWidth;
    const allBar = svgElement("rect", {
      x: x + outerGap,
      y: plotBottom - allHeight,
      width: barWidth,
      height: allHeight,
      class: "histogram-bar histogram-bar-all",
    });
    const selectedBar = svgElement("rect", {
      x: x + outerGap,
      y: plotBottom - selectedHeight,
      width: barWidth,
      height: selectedHeight,
      class: "histogram-bar histogram-bar-selected",
    });
    const label = tooltipLabel(bin, index);
    const tooltipText = histogramTooltipText(label, bin.count, selectedBin.count);
    const binDives = divesForBin(bin, index);
    const hitArea = svgElement("rect", {
      x,
      y: plotTop,
      width: slotWidth,
      height: plotBottom - plotTop,
      class: "histogram-hit-area",
      tabindex: "0",
      role: "button",
      "aria-label": `${tooltipText} · Select these dives`,
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
    hitArea.addEventListener("click", () => onSelectDives(binDives));
    hitArea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelectDives(binDives);
    });
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

function renderMonthlyHistogram(dives, libraryDives, onSelectDives) {
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
    divesForBin: (bin) =>
      libraryDives.filter((dive) => dive.dateTime?.slice(0, 7) === bin.month),
    onSelectDives,
  });
  section.append(heading, svg, tooltip);
  return section;
}

function renderDiveTypeDonut(dives, libraryDives, onSelectDives) {
  const section = document.createElement("section");
  section.className = "dive-type-summary";
  const heading = document.createElement("h3");
  heading.textContent = "Decompression Dives";
  if (!libraryDives.length) {
    const empty = document.createElement("p");
    empty.textContent = "No data";
    section.append(heading, empty);
    return section;
  }
  const counts = [
    {
      key: "decompression",
      label: "Decompression",
      count: libraryDives.filter((dive) => dive.decoDive === true).length,
      selectedCount: dives.filter((dive) => dive.decoDive === true).length,
    },
    {
      key: "no-decompression",
      label: "No-decompression",
      count: libraryDives.filter((dive) => dive.decoDive === false).length,
      selectedCount: dives.filter((dive) => dive.decoDive === false).length,
    },
  ];
  counts.push({
    key: "unknown",
    label: "Unknown",
    count: libraryDives.length - counts[0].count - counts[1].count,
    selectedCount: dives.length - counts[0].selectedCount - counts[1].selectedCount,
  });

  const svg = svgElement("svg", {
    viewBox: "0 0 100 100",
    role: "img",
    "aria-label": `${counts[0].count} decompression, ${counts[1].count} no-decompression, and ${counts[2].count} unknown dives in the library; ${dives.length} selected`,
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
    const percentage = (item.count / libraryDives.length) * 100;
    const segment = svgElement("circle", {
      cx: 50,
      cy: 50,
      r: 32,
      pathLength: 100,
      "stroke-dasharray": `${percentage} ${100 - percentage}`,
      "stroke-dashoffset": -offset,
      transform: "rotate(-90 50 50)",
      class: `donut-segment donut-${item.key}`,
      role: "button",
      tabindex: "0",
    });
    const title = svgElement("title");
    title.textContent = `${item.label} · All dives: ${item.count} · Selected dives: ${item.selectedCount}`;
    segment.setAttribute("aria-label", title.textContent);
    segment.append(title);
    const matchingDives = libraryDives.filter((dive) => {
      if (item.key === "decompression") return dive.decoDive === true;
      if (item.key === "no-decompression") return dive.decoDive === false;
      return dive.decoDive !== true && dive.decoDive !== false;
    });
    segment.addEventListener("click", () => onSelectDives(matchingDives));
    segment.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelectDives(matchingDives);
    });
    svg.append(segment);
    if (item.selectedCount) {
      const selectedPercentage = (item.selectedCount / libraryDives.length) * 100;
      svg.append(
        svgElement("circle", {
          cx: 50,
          cy: 50,
          r: 32,
          pathLength: 100,
          "stroke-dasharray": `${selectedPercentage} ${100 - selectedPercentage}`,
          "stroke-dashoffset": -offset,
          transform: "rotate(-90 50 50)",
          class: "donut-selection-segment",
          "aria-hidden": "true",
        }),
      );
    }
    offset += percentage;
  });
  const total = svgElement("text", {
    x: 50,
    y: 49,
    "text-anchor": "middle",
    class: "donut-total",
  });
  total.textContent = String(libraryDives.length);
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
    entry.append(
      swatch,
      document.createTextNode(
        `${item.label} ${item.count}${item.selectedCount ? ` (${item.selectedCount} selected)` : ""}`,
      ),
    );
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
  allDives,
  valueForDive,
  onSelectDives,
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
    divesForBin: (bin, index) =>
      allDives.filter((dive) => {
        const value = valueForDive(dive);
        return (
          Number.isFinite(value) &&
          value >= bin.start &&
          (index === allBins.length - 1 ? value <= bin.end : value < bin.end)
        );
      }),
    onSelectDives,
  });
  section.append(heading, svg, tooltip);
  return section;
}

function scatterTooltipText(dive) {
  const identity = Number.isFinite(dive.number) ? `Dive ${dive.number}` : "Dive";
  const place = [dive.location, dive.site].filter(Boolean).join(" · ");
  return `${identity}${place ? ` · ${place}` : ""} · ${(dive.durationSeconds / 60).toFixed(
    1,
  )} min · ${dive.maxDepth.toFixed(1)} m`;
}

function renderDepthDurationScatter(
  dives,
  libraryDives,
  durationMaximum,
  depthMaximum,
  onSelectDives,
) {
  const section = document.createElement("section");
  section.className = "depth-duration-scatter scatter-chart";
  const heading = document.createElement("h3");
  heading.textContent = "Depth vs duration";
  const valid = (dive) =>
    Number.isFinite(dive.durationSeconds) && Number.isFinite(dive.maxDepth);
  const allPoints = libraryDives.filter(valid);
  const selectedPoints = dives.filter(valid);
  if (!allPoints.length) {
    const empty = document.createElement("p");
    empty.textContent = "No data";
    section.append(heading, empty);
    return section;
  }

  const svg = svgElement("svg", {
    viewBox: "0 0 480 150",
    role: "img",
    "aria-label": `Depth versus duration scatter plot for ${allPoints.length} library dives and ${selectedPoints.length} selected dives`,
  });
  const tooltip = document.createElement("output");
  tooltip.className = "scatter-tooltip";
  tooltip.hidden = true;
  const plot = { left: 34, right: 474, top: 6, bottom: 116 };
  const durationDomain = Math.max(1, durationMaximum);
  const depthDomain = Math.max(1, depthMaximum);
  const coordinates = (dive) => ({
    x:
      plot.left +
      (dive.durationSeconds / 60 / durationDomain) * (plot.right - plot.left),
    y: plot.top + (dive.maxDepth / depthDomain) * (plot.bottom - plot.top),
  });
  const renderPoint = (dive, selected, interactive = true) => {
    const { x, y } = coordinates(dive);
    const group = svgElement("g", {
      class: selected ? "scatter-point-group-selected" : "scatter-point-group-all",
    });
    const point = svgElement("circle", {
      cx: x,
      cy: y,
      r: 2.25,
      class: selected ? "scatter-point scatter-point-selected" : "scatter-point scatter-point-all",
    });
    if (!interactive) {
      group.append(point);
      svg.append(group);
      return;
    }
    const tooltipText = scatterTooltipText(dive);
    const hitArea = svgElement("circle", {
      cx: x,
      cy: y,
      r: 8,
      class: "scatter-hit-area",
      tabindex: "0",
      role: "button",
      "aria-label": `${tooltipText} · Select this dive`,
    });
    const title = svgElement("title");
    title.textContent = tooltipText;
    hitArea.append(title);
    const showTooltip = () => {
      tooltip.textContent = tooltipText;
      tooltip.style.left = `${Math.max(10, Math.min(90, (x / 480) * 100))}%`;
      tooltip.style.top = `${Math.max(18, (y / 150) * 100)}%`;
      tooltip.hidden = false;
    };
    const hideTooltip = () => {
      tooltip.hidden = true;
    };
    hitArea.addEventListener("pointerenter", showTooltip);
    hitArea.addEventListener("pointerleave", hideTooltip);
    hitArea.addEventListener("focus", showTooltip);
    hitArea.addEventListener("blur", hideTooltip);
    hitArea.addEventListener("click", () => onSelectDives([dive]));
    hitArea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelectDives([dive]);
    });
    group.append(point, hitArea);
    svg.append(group);
  };

  svg.append(
    svgElement("line", {
      x1: plot.left,
      x2: plot.right,
      y1: plot.bottom,
      y2: plot.bottom,
      class: "selection-axis",
    }),
    svgElement("line", {
      x1: plot.left,
      x2: plot.left,
      y1: plot.top,
      y2: plot.bottom,
      class: "selection-axis",
    }),
  );
  allPoints.forEach((dive) => renderPoint(dive, false));
  selectedPoints.forEach((dive) => renderPoint(dive, true, false));
  [
    { x: plot.left, y: 130, text: "0", anchor: "start" },
    {
      x: plot.right,
      y: 130,
      text: `${durationMaximum.toFixed(1)} min`,
      anchor: "end",
    },
    {
      x: plot.left - 5,
      y: plot.bottom + 3,
      text: `${depthMaximum.toFixed(1)} m`,
      anchor: "end",
      className: "scatter-axis-y-label",
    },
    {
      x: plot.left - 5,
      y: plot.top + 3,
      text: "0 m",
      anchor: "end",
      className: "scatter-axis-y-label",
    },
  ].forEach(({ x, y, text, anchor, className = "" }) => {
    const label = svgElement("text", {
      x,
      y,
      "text-anchor": anchor,
      class: `selection-axis-label ${className}`.trim(),
    });
    label.textContent = text;
    svg.append(label);
  });
  const xLabel = svgElement("text", {
    x: (plot.left + plot.right) / 2,
    y: 145,
    "text-anchor": "middle",
    class: "scatter-axis-title",
  });
  xLabel.textContent = "Duration";
  const yLabel = svgElement("text", {
    x: 9,
    y: (plot.top + plot.bottom) / 2,
    "text-anchor": "middle",
    transform: `rotate(-90 9 ${(plot.top + plot.bottom) / 2})`,
    class: "scatter-axis-title",
  });
  yLabel.textContent = "Depth";
  svg.append(xLabel, yLabel);
  section.append(heading, svg, tooltip);
  return section;
}

export function renderSelectionStatistics(
  container,
  dives,
  { libraryDives = dives, onSelectDives = () => {} } = {},
) {
  container.replaceChildren();

  const maximum = (key, fallback, transform = (value) => value) =>
    Math.max(
      fallback,
      ...libraryDives
        .map((dive) => dive[key])
        .filter(Number.isFinite)
        .map(transform)
        .filter(Number.isFinite),
    );
  const depthMaximum = maximum("maxDepth", 0);
  const durationMaximum = maximum("durationSeconds", 0, (value) => value / 60);
  const cnsMaximum = maximum("maxCns", 100);
  const gf99Maximum = maximum("maxGf99", 100);
  const values = (divesToRead, key, transform = (value) => value) =>
    divesToRead
      .map((dive) => dive[key])
      .filter(Number.isFinite)
      .map(transform)
      .filter(Number.isFinite);
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
  const charts = [
    renderMonthlyHistogram(dives, libraryDives, onSelectDives),
    renderDiveTypeDonut(dives, libraryDives, onSelectDives),
  ];
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
      allDives: libraryDives,
      valueForDive: (dive) => dive.maxDepth,
      onSelectDives,
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
      allDives: libraryDives,
      valueForDive: (dive) =>
        Number.isFinite(dive.durationSeconds) ? dive.durationSeconds / 60 : null,
      onSelectDives,
    },
    {
      title: "Minimum temperature",
      unit: "°C",
      selectedValues: values(dives, "minTemperature"),
      allValues: values(libraryDives, "minTemperature"),
      selectedDiveCount: dives.length,
      libraryDiveCount: libraryDives.length,
      allDives: libraryDives,
      valueForDive: (dive) => dive.minTemperature,
      onSelectDives,
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
      allDives: libraryDives,
      valueForDive: (dive) => dive.maxCns,
      onSelectDives,
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
      allDives: libraryDives,
      valueForDive: (dive) => dive.maxGf99,
      onSelectDives,
    },
  ].forEach((definition) => charts.push(renderDistribution(definition)));
  charts.push(
    renderDepthDurationScatter(
      dives,
      libraryDives,
      durationMaximum,
      depthMaximum,
      onSelectDives,
    ),
  );
  container.append(...charts, legend);
}
