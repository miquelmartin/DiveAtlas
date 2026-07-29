export function filterDives(dives, filters) {
  const query = filters.search.trim().toLowerCase();
  return dives.filter((dive) => {
    const date = dive.dateTime?.slice(0, 10) ?? "";
    return (
      (!filters.location || dive.location === filters.location) &&
      (!filters.site || dive.site === filters.site) &&
      (!filters.from || date >= filters.from) &&
      (!filters.to || date <= filters.to) &&
      (!query ||
        [dive.number, dive.location, dive.site, dive.region, dive.dateTime]
          .join(" ")
          .toLowerCase()
          .includes(query))
    );
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
