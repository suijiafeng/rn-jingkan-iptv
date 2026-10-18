import {
  buildFacetOptions,
  countryLabel,
  EMPTY_FACETS,
  facetLabel,
  isCountryCode,
  languageLabel,
  matchesChannelFacets,
  normalizeCountries,
  normalizeLanguages,
} from "../src/domain/channelFacets";
import { UNGROUPED } from "../src/domain/channelLabels";

describe("explicit channel facets", () => {
  it("accepts assigned ISO countries/territories and explicit names only", () => {
    expect(normalizeCountries("cn; US,中国；HK|UK / Japan;cn")).toEqual([
      "CN",
      "US",
      "HK",
      "GB",
      "JP",
    ]);
    expect(
      normalizeCountries("ZZ;AA;Unknown;https://cn.example/live;CCTV中文"),
    ).toEqual([]);
    expect(normalizeCountries(undefined)).toEqual([]);
    expect(isCountryCode("CN")).toBe(true);
    expect(isCountryCode("HK")).toBe(true);
    expect(isCountryCode("cn")).toBe(false);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });

  it("canonicalizes common language names, ISO aliases and explicit BCP 47 tags", () => {
    expect(
      normalizeLanguages("eng,中文;zh_hant_tw|日语;yue;en;French"),
    ).toEqual(["en", "zh", "zh-Hant-TW", "ja", "yue", "fr"]);
    expect(
      normalizeLanguages(
        "undefined;unknown;und;zz;xxx;en-ZZ;en-evil_%;<script>",
      ),
    ).toEqual([]);
    expect(normalizeLanguages(null)).toEqual([]);
    expect(normalizeLanguages("fil;ast;haw;de-DE-1996")).toEqual([
      "fil",
      "ast",
      "haw",
      "de-DE-1996",
    ]);
  });

  it("bounds and deduplicates metadata without unsafe separator values", () => {
    const countries = normalizeCountries("US;".repeat(1000) + "CN");
    expect(countries).toEqual(["US"]);
    expect(
      normalizeCountries("CN;US;JP;KR;CA;AU;GB;FR;DE;IT;ES;PT;RU;UA;BR;MX;ZA"),
    ).toHaveLength(16);
    expect(normalizeLanguages("en;en;en-US;en-US")).toEqual(["en", "en-US"]);
  });

  it("builds stable complete options with unlabelled values last", () => {
    const options = buildFacetOptions([
      {
        countries: ["CN", "US"],
        languages: ["zh", "en"],
        groupName: "新闻;少儿",
      },
      { countries: ["JP"], languages: ["ja"], groupName: "新闻" },
      { groupName: UNGROUPED },
    ]);
    expect(options.countries).toEqual(
      expect.arrayContaining(["CN", "US", "JP", ""]),
    );
    expect(options.languages).toEqual(
      expect.arrayContaining(["zh", "en", "ja", ""]),
    );
    expect(options.contents).toEqual(
      expect.arrayContaining(["新闻", "少儿", ""]),
    );
    expect(options.countries.at(-1)).toBe("");
    expect(options.languages.at(-1)).toBe("");
    expect(options.contents.at(-1)).toBe("");
    expect(buildFacetOptions([])).toEqual({
      countries: [],
      languages: [],
      contents: [],
    });
  });

  it("matches any value within a dimension and combines dimensions with AND", () => {
    const channel = {
      countries: ["CN", "US"],
      languages: ["zh", "en"],
      groupName: "新闻;少儿",
    };
    expect(matchesChannelFacets(channel, EMPTY_FACETS)).toBe(true);
    expect(
      matchesChannelFacets(channel, {
        country: "US",
        language: "en",
        content: "少儿",
      }),
    ).toBe(true);
    expect(
      matchesChannelFacets(channel, {
        country: "US",
        language: "ja",
        content: "少儿",
      }),
    ).toBe(false);
    expect(
      matchesChannelFacets(channel, { ...EMPTY_FACETS, country: "" }),
    ).toBe(false);
    expect(
      matchesChannelFacets(
        { groupName: UNGROUPED },
        { country: "", language: "", content: "" },
      ),
    ).toBe(true);
    expect(
      matchesChannelFacets(
        { groupName: UNGROUPED },
        { ...EMPTY_FACETS, content: UNGROUPED },
      ),
    ).toBe(true);
    expect(
      matchesChannelFacets(channel, { ...EMPTY_FACETS, country: "U" }),
    ).toBe(false);
  });

  it("labels all/unlabelled values and works without optional Intl.DisplayNames", () => {
    expect(facetLabel("country", null)).toBe("全部");
    expect(facetLabel("language", "")).toBe("未标注");
    expect(facetLabel("content", UNGROUPED)).toBe("未标注");
    expect(facetLabel("content", "新闻")).toBe("新闻");
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "DisplayNames");
    Object.defineProperty(Intl, "DisplayNames", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(countryLabel("CN")).toBe("中国");
      expect(countryLabel("IS")).toBe("IS");
      expect(languageLabel("en")).toBe("英语");
      expect(languageLabel("en-US")).toBe("en-US");
      expect(countryLabel("")).toBe("未标注");
    } finally {
      if (descriptor) Object.defineProperty(Intl, "DisplayNames", descriptor);
      else Reflect.deleteProperty(Intl, "DisplayNames");
    }
  });
});
