import "../vendor/country-coder.js";

export const UNASSIGNED_COUNTRY = "International waters / unassigned";

export function inferCountry(latitude, longitude) {
  const region = globalThis.countryCoder.feature([longitude, latitude], { level: "territory" });
  return {
    country: region?.properties?.nameEn ?? UNASSIGNED_COUNTRY,
    countryCode: region?.properties?.iso1A2 ?? "",
  };
}

export function enrichMappingCountry(mapping) {
  if (mapping.country) return mapping;
  return { ...mapping, ...inferCountry(mapping.latitude, mapping.longitude) };
}
