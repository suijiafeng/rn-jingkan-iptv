import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { Repository } from "../../data/repository";
import type { Channel, Source } from "../../domain/types";
import {
  buildFacetOptions,
  contentOptions,
  EMPTY_FACET_OPTIONS,
  type ChannelFacetOptions,
} from "../../domain/channelFacets";
import {
  effectiveCountry,
  useRegionPreference,
} from "../region/useRegionPreference";
import { createScrollRestore } from "../channel/scrollRestore";
import type { Tab } from "../channel/ChannelListParts";
import type { ChannelListItem } from "./channelListItems";

// A screenful is shown first; the rest of a 10k-row list follows in a second
// read so switching tabs or filters does not wait for the whole table.
const FIRST_PAGE = 40;

type RegionPreference = ReturnType<typeof useRegionPreference>;

/**
 * Reads the channel page from SQLite whenever the tab or a filter changes,
 * and keeps each tab's scroll position across tab switches.
 */
export function useChannelListData({
  repo,
  tab,
  sourceId,
  group,
  language,
  query,
  region,
  countryKey,
  countryBypassed,
}: {
  repo: Repository | null;
  tab: Tab;
  sourceId: string;
  group: string | null;
  language: string | null;
  query: string;
  region: RegionPreference;
  countryKey: string;
  countryBypassed: boolean;
}) {
  const [loadedRequest, setLoadedRequest] = useState<{
      tab: Tab;
      sourceId: string;
      group: string | null;
      language: string | null;
      countryKey: string;
      countryBypassed: boolean;
      query: string;
    } | null>(null),
    [listError, setListError] = useState(""),
    [sources, setSources] = useState<Source[]>([]),
    [channels, setChannels] = useState<Channel[]>([]),
    // Matching rows while the remainder of a paged list is still loading.
    [channelTotal, setChannelTotal] = useState<number | null>(null),
    [recent, setRecent] = useState<Channel[]>([]),
    [facets, setFacets] = useState<ChannelFacetOptions>(EMPTY_FACET_OPTIONS),
    [revision, setRevision] = useState(0);
  // Drives the header overlay from the list's native scroll events.
  const [scrollY] = useState(() => new Animated.Value(0));
  const loadGeneration = useRef(0);
  const restoreFrame = useRef<number | null>(null);
  const listRef = useRef<FlatList<ChannelListItem>>(null),
    tabOffsets = useRef<Partial<Record<Tab, number>>>({}),
    restoreTab = useRef<Tab | null>(null),
    // Resolves to the complete current list (the play queue) once loaded.
    fullList = useRef<Promise<Channel[]>>(Promise.resolve([])),
    listSettled = useRef(true),
    [scrollRestore] = useState(createScrollRestore);
  // Read by async handlers that must act on the tab shown when they finish.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const changed = useCallback(() => setRevision((current) => current + 1), []);

  // Re-sent each frame until the list reports the offset (see scrollRestore).
  const restoreOffset = useCallback(
    (target: number) => {
      if (restoreFrame.current !== null)
        cancelAnimationFrame(restoreFrame.current);
      const send = (offset: number | null) => {
        restoreFrame.current = null;
        if (offset === null) return;
        listRef.current?.scrollToOffset({ offset, animated: false });
        if (scrollRestore.pending())
          restoreFrame.current = requestAnimationFrame(() =>
            send(scrollRestore.retry()),
          );
      };
      send(scrollRestore.request(target));
    },
    [scrollRestore],
  );
  const loadRequest = useMemo(
    () => ({
      repo,
      tab,
      sourceId,
      group,
      language,
      countryKey,
      countryBypassed,
      query,
      revision,
    }),
    [
      repo,
      tab,
      sourceId,
      group,
      language,
      countryKey,
      countryBypassed,
      query,
      revision,
    ],
  );
  const listLoading = loadedRequest !== loadRequest;

  // Native-driven: moves the header overlay without a JS listener.
  const onListScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        // Only the restore watches the offset here; saving waits for a drag.
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) =>
          scrollRestore.scrolled(event.nativeEvent.contentOffset.y),
      }),
    [scrollY, scrollRestore],
  );
  const hasCurrentList =
    loadedRequest?.tab === tab &&
    loadedRequest.sourceId === sourceId &&
    loadedRequest.group === group &&
    loadedRequest.language === language &&
    loadedRequest.countryKey === countryKey &&
    loadedRequest.countryBypassed === countryBypassed &&
    loadedRequest.query === query;

  useEffect(() => {
    if (!repo || !region.ready) return;
    let active = true;
    let layoutFrame: number | null = null;
    const loadId = ++loadGeneration.current;
    const current = () => active && loadId === loadGeneration.current;
    scrollRestore.cancel();
    const restoring = restoreTab.current === tab;
    // Restoring a scroll offset needs every row laid out, so read it whole.
    const paged = !(restoring && (tabOffsets.current[tab] ?? 0) > 0);
    listSettled.current = false;
    let settle!: (rows: Channel[]) => void;
    const settled = new Promise<Channel[]>((resolve) => (settle = resolve));
    fullList.current = settled;
    const load = async () => {
      const facetRows =
        tab === "all" ? await repo.listFacetRows(sourceId || undefined) : [];
      if (!current()) return;
      const baseFacets =
        tab === "all" ? buildFacetOptions(facetRows) : EMPTY_FACET_OPTIONS;
      const selectedCountry = countryBypassed
        ? null
        : effectiveCountry(
            region.preference,
            region.result,
            baseFacets.countries,
          );
      const nextFacets =
        tab === "all"
          ? {
              ...baseFacets,
              contents: contentOptions(facetRows, {
                country: selectedCountry,
                language,
                content: group,
              }),
            }
          : EMPTY_FACET_OPTIONS;
      const filter = {
        mode: tab === "settings" ? ("all" as const) : tab,
        sourceId: tab === "all" ? sourceId || undefined : undefined,
        groupName: tab === "all" ? (group ?? undefined) : undefined,
        country: tab === "all" ? (selectedCountry ?? undefined) : undefined,
        language: tab === "all" ? (language ?? undefined) : undefined,
        search: query,
      };
      const [nextSources, firstRows, recentRows] = await Promise.all([
        repo.listSources(),
        repo.listChannels(paged ? { ...filter, limit: FIRST_PAGE } : filter),
        repo.listChannels({ mode: "recent" }),
      ]);
      if (!current()) return;
      const partial = paged && firstRows.length === FIRST_PAGE;
      const total = partial ? await repo.countChannels(filter) : null;
      if (!current()) return;
      setListError("");
      setSources(nextSources);
      setChannels(firstRows);
      setChannelTotal(total);
      setFacets(nextFacets);
      setRecent(recentRows);
      setLoadedRequest(loadRequest);
      if (restoring) {
        restoreTab.current = null;
        const offset = tabOffsets.current[tab] ?? 0;
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = null;
          if (current()) restoreOffset(offset);
        });
      }
      if (!partial) return firstRows;
      const remainingRows = await repo.listChannels({
        ...filter,
        offset: FIRST_PAGE,
      });
      if (!current()) return firstRows;
      const allRows = [...firstRows, ...remainingRows];
      setChannels((shown) =>
        // Keep local patches (favorite, forgotten recent) made meanwhile.
        shown.length === firstRows.length
          ? [...shown, ...remainingRows]
          : allRows,
      );
      setChannelTotal(null);
      return allRows;
    };
    void load()
      .catch(() => {
        if (!current()) return;
        setListError("读取失败，资料仍在本机");
        setLoadedRequest(loadRequest);
      })
      .then((rows) => {
        if (current()) listSettled.current = true;
        settle(rows ?? []);
      });
    return () => {
      active = false;
      scrollRestore.cancel();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      if (restoreFrame.current !== null)
        cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = null;
    };
  }, [
    repo,
    tab,
    sourceId,
    group,
    language,
    countryBypassed,
    query,
    revision,
    loadRequest,
    region.ready,
    region.preference,
    region.result,
    scrollRestore,
    restoreOffset,
  ]);

  /** The next read of `target` starts at the top instead of its saved offset. */
  const scrollToTopOnNextLoad = (target: Tab) => {
    tabOffsets.current[target] = 0;
    restoreTab.current = target;
  };

  /** The next read of `target` restores its saved offset. */
  const restoreOnNextLoad = (target: Tab) => {
    restoreTab.current = target;
  };

  /** After "清空全部" every tab starts from the top. */
  const forgetTabOffsets = () => {
    tabOffsets.current = {};
  };

  /** Records where a tab was when a drag or fling settles. */
  const saveTabOffset = (offsetY: number) => {
    if (!listLoading && scrollRestore.scrolled(offsetY))
      tabOffsets.current[tab] = offsetY;
  };

  return {
    changed,
    tabRef,
    listError,
    listLoading,
    hasCurrentList,
    sources,
    setSources,
    channels,
    setChannels,
    channelTotal,
    recent,
    setRecent,
    facets,
    scrollY,
    listRef,
    fullList,
    listSettled,
    scrollRestore,
    onListScroll,
    scrollToTopOnNextLoad,
    restoreOnNextLoad,
    forgetTabOffsets,
    saveTabOffset,
  };
}

export type ChannelListData = ReturnType<typeof useChannelListData>;
