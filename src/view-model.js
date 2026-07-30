export function filterDives(dives, filters) {
  const query = (filters.search ?? "").trim().toLowerCase();
  const minDepth = Number(filters.minDepth) || 0;
  const minDurationSeconds = (Number(filters.minDuration) || 0) * 60;
  return dives.filter((dive) => {
    const date = dive.dateTime?.slice(0, 10) ?? "";
    const dateRangeActive = Boolean(filters.from || filters.to);
    return (
      (!filters.location || dive.location === filters.location) &&
      (!filters.site || dive.site === filters.site) &&
      (!dateRangeActive ||
        (Boolean(date) &&
          (!filters.from || date >= filters.from) &&
          (!filters.to || date <= filters.to))) &&
      (!minDepth || (Number.isFinite(dive.maxDepth) && dive.maxDepth >= minDepth)) &&
      (!minDurationSeconds ||
        (Number.isFinite(dive.durationSeconds) && dive.durationSeconds >= minDurationSeconds)) &&
      (!query ||
        [dive.number, dive.location, dive.site, dive.region, dive.dateTime]
          .join(" ")
          .toLowerCase()
          .includes(query))
    );
  });
}

function compareValues(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortDives(dives, field = "number", direction = "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...dives].sort((left, right) => {
    const comparison = compareValues(left[field], right[field]) * multiplier;
    return comparison || compareValues(right.number, left.number);
  });
}

export function filterDivesToBounds(dives, mappings, bounds) {
  return dives.filter((dive) => {
    const mapping = mappings.get(dive.mappingKey);
    if (!mapping) return false;
    if (!bounds) return true;
    if (mapping.latitude < bounds.south || mapping.latitude > bounds.north) {
      return false;
    }
    return bounds.west <= bounds.east
      ? mapping.longitude >= bounds.west && mapping.longitude <= bounds.east
      : mapping.longitude >= bounds.west || mapping.longitude <= bounds.east;
  });
}

export function monthlyDiveCounts(dives, from, to) {
  const diveMonths = dives
    .map((dive) => dive.dateTime?.slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month));
  const sortedDiveMonths = [...diveMonths].sort();
  const firstMonth = from?.slice(0, 7) || sortedDiveMonths[0];
  const lastMonth = to?.slice(0, 7) || sortedDiveMonths.at(-1);
  if (!firstMonth || !lastMonth) return [];

  const [firstYear, firstMonthNumber] = firstMonth.split("-").map(Number);
  const [lastYear, lastMonthNumber] = lastMonth.split("-").map(Number);
  const monthCount =
    (lastYear - firstYear) * 12 + lastMonthNumber - firstMonthNumber + 1;
  if (monthCount <= 0) return [];

  const counts = new Map(diveMonths.map((month) => [month, 0]));
  diveMonths.forEach((month) => counts.set(month, (counts.get(month) ?? 0) + 1));
  return Array.from({ length: monthCount }, (_, index) => {
    const monthIndex = firstMonthNumber - 1 + index;
    const year = firstYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    return { month: key, count: counts.get(key) ?? 0 };
  });
}

export function histogramBins(values, requestedBins = 10) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return [];
  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  if (minimum === maximum) {
    return [{ start: minimum, end: maximum, count: finiteValues.length }];
  }

  const binCount = Math.max(1, Math.min(requestedBins, finiteValues.length));
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: minimum + index * width,
    end: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    count: 0,
  }));
  finiteValues.forEach((value) => {
    const index = Math.min(Math.floor((value - minimum) / width), binCount - 1);
    bins[index].count += 1;
  });
  return bins;
}
