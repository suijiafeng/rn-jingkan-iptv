import {
  DEFAULT_COUNTRY_PREFERENCE,
  effectiveCountry,
  parseCountryPreference,
  regionBasis,
  resolveRegion,
  timeZoneCountry,
} from "../policy";

const china = { region: "CN", language: "zh", timeZone: "Asia/Shanghai" };

test("matching device region and a single-country time zone can recommend a country", () => {
  expect(resolveRegion(china)).toMatchObject({
    countryCode: "CN",
    source: "device",
  });
});

test("language alone never establishes the user's country", () => {
  expect(
    resolveRegion({ region: null, language: "zh", timeZone: "Etc/GMT-8" })
      .countryCode,
  ).toBeNull();
  expect(
    resolveRegion({ region: null, language: "ja", timeZone: "Asia/Tokyo" })
      .countryCode,
  ).toBeNull();
});

test.each([
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Africa/Nairobi",
  "Europe/Zurich",
  "America/Toronto",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/Amsterdam",
  "UTC",
  "Etc/GMT-8",
])(
  "shared or unrecognized time zone %s cannot act as a country vote",
  (zone) => {
    expect(timeZoneCountry(zone)).toBeNull();
  },
);

test("IP needs corroboration and configured conflicts fall back to all", () => {
  expect(resolveRegion(china, "CN")).toMatchObject({
    countryCode: "CN",
    source: "ip",
  });
  expect(resolveRegion(china, "US")).toMatchObject({
    countryCode: null,
    source: "conflict",
  });
  expect(
    resolveRegion({ region: null, language: "en", timeZone: null }, "US")
      .countryCode,
  ).toBeNull();
  expect(
    resolveRegion({ ...china, timeZone: "America/New_York" }, "CN").countryCode,
  ).toBeNull();
});

test("location is strong but a conflicting IP does not silently win", () => {
  expect(resolveRegion(china, null, "US")).toMatchObject({
    countryCode: "US",
    source: "location",
  });
  expect(resolveRegion(china, "CN", "US")).toMatchObject({
    countryCode: null,
    source: "conflict",
  });
  expect(resolveRegion(china, "US", "US")).toMatchObject({
    countryCode: "US",
    source: "location",
  });
});

test("invalid persisted fields are independently checked", () => {
  expect(
    parseCountryPreference({
      mode: "manual",
      countryCode: "",
      ipAllowed: "true",
      locationAllowed: true,
    }),
  ).toEqual({
    mode: "manual",
    countryCode: "",
    ipAllowed: false,
    locationAllowed: true,
  });
  expect(
    parseCountryPreference({ mode: "manual", countryCode: "ZZ", ipAllowed: 1 }),
  ).toEqual({ ...DEFAULT_COUNTRY_PREFERENCE, mode: "manual" });
  expect(
    parseCountryPreference({
      mode: "bad",
      countryCode: "CN",
      ipAllowed: false,
    }),
  ).toEqual({ ...DEFAULT_COUNTRY_PREFERENCE, countryCode: "CN" });
});

test("automatic selection requires source metadata; manual all and unmarked always win", () => {
  const detected = resolveRegion(china);
  expect(
    effectiveCountry(DEFAULT_COUNTRY_PREFERENCE, detected, ["", "US"]),
  ).toBeNull();
  expect(effectiveCountry(DEFAULT_COUNTRY_PREFERENCE, detected, ["CN"])).toBe(
    "CN",
  );
  expect(
    effectiveCountry(
      { ...DEFAULT_COUNTRY_PREFERENCE, mode: "manual", countryCode: null },
      detected,
      ["CN"],
    ),
  ).toBeNull();
  expect(
    effectiveCountry(
      { ...DEFAULT_COUNTRY_PREFERENCE, mode: "manual", countryCode: "" },
      detected,
      ["CN"],
    ),
  ).toBe("");
  expect(
    effectiveCountry(
      { ...DEFAULT_COUNTRY_PREFERENCE, mode: "manual", countryCode: "US" },
      detected,
      ["CN"],
    ),
  ).toBe("US");
});

test("the region basis says what the country rests on, in one short line", () => {
  const auto = DEFAULT_COUNTRY_PREFERENCE;
  const device = resolveRegion(china);
  expect(regionBasis(auto, device, "CN")).toBe("依据：手机地区与时区设置");
  expect(regionBasis(auto, device, null)).toBe(
    "识别为中国大陆，节目单中无该地区频道",
  );
  expect(regionBasis({ ...auto, mode: "manual" }, device, "US")).toBe(
    "手动选择",
  );
  for (const result of [
    device,
    resolveRegion(china, "US"),
    resolveRegion(china, "CN", "CN"),
    resolveRegion({ region: null, language: null, timeZone: null }),
  ])
    expect(result.message.length).toBeLessThanOrEqual(16);
});
