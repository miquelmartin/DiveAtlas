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
  if (!bounds) return dives;
  return dives.filter((dive) => {
    const mapping = mappings.get(dive.mappingKey);
    if (!mapping) return true;
    if (mapping.latitude < bounds.south || mapping.latitude > bounds.north) {
      return false;
    }
    return bounds.west <= bounds.east
      ? mapping.longitude >= bounds.west && mapping.longitude <= bounds.east
      : mapping.longitude >= bounds.west || mapping.longitude <= bounds.east;
  });
}
