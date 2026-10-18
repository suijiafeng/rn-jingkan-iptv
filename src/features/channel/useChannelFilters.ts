import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelFacetSelection } from "../../domain/channelFacets";
import type { ListTab } from "./ChannelListParts";

/** What each list tab remembers when the user leaves it. */
export interface ListFilters {
  sourceId: string;
  group: string | null;
  language: string | null;
  search: string;
}

const CLEARED: ListFilters = {
  sourceId: "",
  group: null,
  language: null,
  search: "",
};

/**
 * The one filter state shared by the channel page and the player's channel
 * sheet. Country lives in the region preference; this only remembers a
 * temporary "show every country" bypass (locating the playing channel),
 * tied to the preference it was made under.
 */
export function useChannelFilters() {
  const [filters, setFilters] = useState<ListFilters>(CLEARED);
  // The search actually queried: typing settles for 250 ms first.
  const [query, setQuery] = useState("");
  const [countryBypass, setCountryBypass] = useState<string | null>(null);
  const saved = useRef<Partial<Record<ListTab, ListFilters>>>({});
  useEffect(() => {
    const id = setTimeout(() => setQuery(filters.search.trim()), 250);
    return () => clearTimeout(id);
  }, [filters.search]);

  const setSearch = useCallback((search: string) => {
    setFilters((f) => ({ ...f, search }));
  }, []);
  const clearSearch = useCallback(() => {
    setFilters((f) => ({ ...f, search: "" }));
    setQuery("");
  }, []);
  const setSource = useCallback((sourceId: string) => {
    setFilters((f) => ({ ...f, sourceId, group: null, language: null }));
  }, []);
  const setFacets = useCallback((selection: ChannelFacetSelection) => {
    setFilters((f) => ({
      ...f,
      group: selection.content,
      language: selection.language,
    }));
  }, []);
  /** Back to everything (country is the caller's to reset or bypass). */
  const reset = useCallback(() => {
    setFilters(CLEARED);
    setQuery("");
  }, []);
  /** Remember the filters of the tab being left; restore those of the next. */
  const switchTab = useCallback(
    (from: ListTab | null, to: ListTab | null) => {
      if (from)
        saved.current[from] =
          from === "all" ? filters : { ...CLEARED, search: filters.search };
      if (!to) return;
      const next = saved.current[to];
      const restored =
        to === "all"
          ? (next ?? CLEARED)
          : { ...CLEARED, search: next?.search ?? "" };
      setFilters(restored);
      setQuery(restored.search.trim());
    },
    [filters],
  );
  /** A deleted source must not stay selected, shown or remembered. */
  const forgetSource = useCallback((sourceId: string) => {
    for (const key of Object.keys(saved.current) as ListTab[]) {
      const tabFilters = saved.current[key];
      if (tabFilters?.sourceId === sourceId)
        saved.current[key] = {
          ...tabFilters,
          sourceId: "",
          group: null,
          language: null,
        };
    }
    setFilters((f) =>
      f.sourceId === sourceId
        ? { ...f, sourceId: "", group: null, language: null }
        : f,
    );
  }, []);
  const forgetSaved = useCallback(() => {
    saved.current = {};
  }, []);
  return {
    ...filters,
    query,
    countryBypass,
    setCountryBypass,
    setSearch,
    clearSearch,
    setSource,
    setFacets,
    reset,
    switchTab,
    forgetSource,
    forgetSaved,
  };
}
