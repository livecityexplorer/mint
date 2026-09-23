import React, { useState, useMemo, useEffect } from 'react';
import { 
  Film, 
  Tv, 
  Search, 
  Star, 
  Play, 
  Info, 
  Clock, 
  Calendar, 
  X, 
  Filter,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Layers,
  Check,
  Globe,
  Loader2,
  Video,
  User
} from 'lucide-react';
import { VodItem, VodEpisode, Channel, PlayerSettings } from '../types';
import { normalizeGroupName, groupSeriesEpisodes } from '../utils/m3uParser';
import { 
  fetchTmdbDetails, 
  fetchTmdbById, 
  getUserDeviceLanguage, 
  SUPPORTED_METADATA_LANGUAGES,
  TmdbMetadata 
} from '../services/tmdbService';

interface VodBrowserProps {
  type: 'movie' | 'series';
  items: VodItem[];
  settings?: PlayerSettings;
  onPlayMedia: (channel: Channel) => void;
  onOpenPlaylists: () => void;
}

const ITEMS_PER_PAGE = 48;

export const VodBrowser: React.FC<VodBrowserProps> = ({
  type,
  items,
  settings,
  onPlayMedia,
  onOpenPlaylists,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'rating' | 'year' | 'name'>('rating');
  const [selectedItem, setSelectedItem] = useState<VodItem | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // TMDB Metadata states
  const [tmdbData, setTmdbData] = useState<TmdbMetadata | null>(null);
  const [isLoadingTmdb, setIsLoadingTmdb] = useState<boolean>(false);
  const [activeLanguage, setActiveLanguage] = useState<string>(settings?.metadataLanguage || 'auto');
  const [showTrailerModal, setShowTrailerModal] = useState<boolean>(false);

  // Group search & modal states
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  // Sync active language when settings change
  useEffect(() => {
    if (settings?.metadataLanguage) {
      setActiveLanguage(settings.metadataLanguage);
    }
  }, [settings?.metadataLanguage]);

  // Fetch TMDB metadata whenever selectedItem or activeLanguage changes
  useEffect(() => {
    if (!selectedItem) {
      setTmdbData(null);
      setIsLoadingTmdb(false);
      setShowTrailerModal(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingTmdb(true);

    const loadMetadata = async () => {
      try {
        let meta: TmdbMetadata | null = null;
        const targetLanguage = activeLanguage === 'auto' ? getUserDeviceLanguage() : activeLanguage;

        // 1. If item has TMDB ID, query by ID
        if (selectedItem.tmdbId) {
          meta = await fetchTmdbById(
            selectedItem.tmdbId,
            type === 'series' ? 'tv' : 'movie',
            settings?.tmdbApiKey,
            targetLanguage
          );
        }

        // 2. Query by cleaned title and year
        if (!meta) {
          meta = await fetchTmdbDetails(
            selectedItem.title || selectedItem.name,
            type === 'series' ? 'tv' : 'movie',
            selectedItem.year ? String(selectedItem.year) : undefined,
            settings?.tmdbApiKey,
            targetLanguage
          );
        }

        if (!isCancelled) {
          setTmdbData(meta);
        }
      } catch (err) {
        console.warn('Failed to load TMDB details:', err);
      } finally {
        if (!isCancelled) {
          setIsLoadingTmdb(false);
        }
      }
    };

    loadMetadata();

    return () => {
      isCancelled = true;
    };
  }, [selectedItem, activeLanguage, settings?.tmdbApiKey, type]);

  // Process items: automatically group series episodes if type is series
  const processedItems = useMemo(() => {
    if (type === 'series') {
      return groupSeriesEpisodes(items);
    }
    return items;
  }, [items, type]);

  // Loading state for Xtream series episodes
  const [isLoadingXcEpisodes, setIsLoadingXcEpisodes] = useState<boolean>(false);

  // Auto-fetch Xtream Codes series episodes if opened item has xcDetails or seriesId
  useEffect(() => {
    if (!selectedItem || selectedItem.type !== 'series') return;
    const xc = selectedItem.xcDetails;
    const sId = selectedItem.seriesId || selectedItem.streamId;

    if (xc && sId && (!selectedItem.episodes || selectedItem.episodes.length <= 1)) {
      let isCancelled = false;
      setIsLoadingXcEpisodes(true);

      const fetchSeriesInfo = async () => {
        try {
          const encBase = encodeURIComponent(xc.serverUrl);
          const encUser = encodeURIComponent(xc.username);
          const encPass = encodeURIComponent(xc.password);
          const res = await fetch(
            `/api/xc/action?serverUrl=${encBase}&username=${encUser}&password=${encPass}&action=get_series_info&series_id=${sId}`
          );
          const data = await res.json();
          if (isCancelled || !data) return;

          const allEps: VodEpisode[] = [];
          if (data.episodes && typeof data.episodes === 'object') {
            Object.entries(data.episodes).forEach(([sKey, epList]: [string, any]) => {
              if (Array.isArray(epList)) {
                epList.forEach((ep: any) => {
                  const sNum = parseInt(sKey, 10) || ep.season || 1;
                  const eNum = parseInt(ep.episode_num, 10) || 1;
                  const ext = ep.container_extension || 'mp4';
                  const streamUrl = `${xc.serverUrl}/series/${encodeURIComponent(xc.username)}/${encodeURIComponent(xc.password)}/${ep.id}.${ext}`;
                  allEps.push({
                    id: `xc-ep-${ep.id}`,
                    title: ep.title || `S${sNum} E${eNum}`,
                    seasonNum: sNum,
                    episodeNum: eNum,
                    streamUrl,
                    plot: ep.info?.plot || ep.plot || '',
                    duration: ep.info?.duration || (ep.info?.duration_secs ? `${Math.round(ep.info.duration_secs / 60)}m` : '45m'),
                    rating: ep.info?.rating || undefined,
                    containerExtension: ext,
                    cover: ep.info?.movie_image || ep.cover,
                    airDate: ep.info?.air_date || ep.air_date,
                  });
                });
              }
            });
          }

          if (allEps.length > 0) {
            allEps.sort((a, b) => a.seasonNum - b.seasonNum || a.episodeNum - b.episodeNum);
            const seasonsCount = Math.max(...allEps.map(e => e.seasonNum), 1);
            setSelectedItem(prev => prev ? {
              ...prev,
              episodes: allEps,
              seasonsCount,
              plot: data.info?.plot || prev.plot,
              cast: data.info?.cast || prev.cast,
              director: data.info?.director || prev.director,
              genre: data.info?.genre || prev.genre,
              backdrop: data.info?.backdrop_path?.[0] || prev.backdrop,
              rating: data.info?.rating ? String(data.info.rating) : prev.rating,
            } : null);
          }
        } catch (err) {
          console.warn('Failed to load Xtream series info:', err);
        } finally {
          if (!isCancelled) {
            setIsLoadingXcEpisodes(false);
          }
        }
      };

      fetchSeriesInfo();
      return () => {
        isCancelled = true;
      };
    }
  }, [selectedItem?.id]);

  // Extract distinct groups with counts
  const groupsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < processedItems.length; i++) {
      const item = processedItems[i];
      const g = normalizeGroupName(item.group || item.categoryName || 'General');
      counts[g] = (counts[g] || 0) + 1;
    }

    const list = Object.entries(counts).map(([name, count]) => ({ name, count }));
    list.sort((a, b) => b.count - a.count);
    return [{ name: 'All', count: processedItems.length }, ...list];
  }, [processedItems]);

  // Filtered groups for modal/selector search
  const filteredGroupsList = useMemo(() => {
    if (!groupSearchQuery.trim()) return groupsWithCounts;
    const q = groupSearchQuery.toLowerCase().trim();
    return groupsWithCounts.filter(g => g.name.toLowerCase().includes(q));
  }, [groupsWithCounts, groupSearchQuery]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let result = processedItems;

    // Filter by group (exact normalized case-insensitive match)
    if (selectedGroup !== 'All') {
      const target = normalizeGroupName(selectedGroup).toLowerCase();
      result = result.filter(
        (i) => normalizeGroupName(i.group || i.categoryName || 'General').toLowerCase() === target
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          (i.genre && i.genre.toLowerCase().includes(q)) ||
          (i.cast && i.cast.toLowerCase().includes(q)) ||
          (i.director && i.director.toLowerCase().includes(q)) ||
          (i.year && String(i.year).includes(q))
      );
    }

    // Sort items
    result = [...result].sort((a, b) => {
      if (sortBy === 'rating') {
        const rA = typeof a.rating === 'number' ? a.rating : parseFloat(String(a.rating || '0'));
        const rB = typeof b.rating === 'number' ? b.rating : parseFloat(String(b.rating || '0'));
        return rB - rA;
      }
      if (sortBy === 'year') {
        const yA = parseInt(String(a.year || '0'), 10);
        const yB = parseInt(String(b.year || '0'), 10);
        return yB - yA;
      }
      return a.title.localeCompare(b.title);
    });

    return result;
  }, [processedItems, selectedGroup, searchQuery, sortBy]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredItems, currentPage]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGroup, searchQuery, sortBy]);

  const handlePlayMovie = (item: VodItem) => {
    const chId = item.id || `vod-movie-${item.streamId || Math.random()}`;
    const virtualChannel: Channel = {
      id: chId,
      num: 1,
      name: item.title,
      group: item.group || 'Movies (VOD)',
      logo: item.poster || item.logo || '',
      streamUrl: item.streamUrl || '',
      currentProgram: {
        id: `prog-${chId}`,
        channelId: chId,
        title: item.title,
        description: item.plot || 'Feature Film On-Demand',
        start: new Date(),
        end: new Date(Date.now() + 2 * 3600 * 1000),
        category: item.genre || 'Movie',
        rating: item.rating ? String(item.rating) : undefined,
      },
    };
    onPlayMedia(virtualChannel);
  };

  const handlePlayEpisode = (seriesItem: VodItem, ep: VodEpisode) => {
    const epList = seriesItem.episodes && seriesItem.episodes.length > 0 ? seriesItem.episodes : [ep];
    const currentIndex = epList.findIndex(
      (e) => e.id === ep.id || (e.seasonNum === ep.seasonNum && e.episodeNum === ep.episodeNum)
    );
    const chId = ep.id || `vod-ep-${seriesItem.id}-${ep.seasonNum}-${ep.episodeNum}`;

    const virtualChannel: Channel = {
      id: chId,
      num: 1,
      name: `${seriesItem.title} - S${ep.seasonNum}E${ep.episodeNum}`,
      group: seriesItem.group || 'TV Series',
      logo: ep.cover || seriesItem.poster || seriesItem.logo || '',
      streamUrl: ep.streamUrl || '',
      seriesContext: {
        seriesId: seriesItem.seriesId || seriesItem.streamId || seriesItem.id,
        seriesTitle: seriesItem.title,
        poster: seriesItem.poster || seriesItem.logo,
        backdrop: seriesItem.backdrop,
        group: seriesItem.group,
        episodes: epList,
        currentEpisodeIndex: currentIndex >= 0 ? currentIndex : 0,
        seasonsCount: seriesItem.seasonsCount || 1,
        xcDetails: seriesItem.xcDetails,
      },
      currentProgram: {
        id: `prog-${chId}`,
        channelId: chId,
        title: `${seriesItem.title} • S${ep.seasonNum}E${ep.episodeNum}: ${ep.title}`,
        description: ep.plot || seriesItem.plot || `Season ${ep.seasonNum}, Episode ${ep.episodeNum}`,
        start: new Date(),
        end: new Date(Date.now() + 3600 * 1000),
        category: seriesItem.genre || 'Series',
        rating: ep.rating ? String(ep.rating) : undefined,
      },
    };
    onPlayMedia(virtualChannel);
  };

  const deviceLanguageCode = getUserDeviceLanguage();

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121316] overflow-hidden">
      {/* Top Filter & Search Bar */}
      <div className="p-4 bg-[#171920] border-b border-[#242732] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 flex-shrink-0">
        {/* Left: Group category quick pills & Browse All Button */}
        <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar py-1">
          {groupsWithCounts.slice(0, 5).map((g) => {
            const active = selectedGroup === g.name;
            return (
              <button
                key={g.name}
                onClick={() => setSelectedGroup(g.name)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1.5 ${
                  active
                    ? 'bg-[#87cf3e] text-[#121316] shadow-sm'
                    : 'bg-[#1e222b] text-[#9ca3af] hover:text-white hover:bg-[#272c38]'
                }`}
              >
                <span>{g.name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${active ? 'bg-black/20 text-[#121316]' : 'bg-[#121419] text-[#787f90]'}`}>
                  {g.count}
                </span>
              </button>
            );
          })}

          {groupsWithCounts.length > 5 && (
            <button
              onClick={() => setIsGroupModalOpen(true)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1 border ${
                selectedGroup !== 'All' && !groupsWithCounts.slice(0, 5).some(g => g.name === selectedGroup)
                  ? 'bg-[#87cf3e]/15 text-[#87cf3e] border-[#87cf3e]/40'
                  : 'bg-[#1e222b] text-[#9ca3af] border-[#2d3240] hover:text-white hover:bg-[#272c38]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>
                {selectedGroup !== 'All' && !groupsWithCounts.slice(0, 5).some(g => g.name === selectedGroup)
                  ? `Group: ${selectedGroup}`
                  : `All Groups (${groupsWithCounts.length})`}
              </span>
            </button>
          )}
        </div>

        {/* Right: Search + Sort controls */}
        <div className="flex items-center space-x-3">
          {/* Search Box */}
          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#787f90]" />
            <input
              type="text"
              placeholder={`Search ${type === 'movie' ? 'movies' : 'series'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 bg-[#1e222b] border border-[#2d3240] rounded-xl text-xs text-white placeholder-[#6b7280] focus:outline-none focus:border-[#87cf3e]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort Selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 bg-[#1e222b] border border-[#2d3240] rounded-xl text-xs text-[#b8bdc8] focus:outline-none focus:border-[#87cf3e] cursor-pointer"
          >
            <option value="rating">Top Rated</option>
            <option value="year">Newest Release</option>
            <option value="name">Alphabetical</option>
          </select>
        </div>
      </div>

      {/* Main Grid Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-[#1b1e27] border border-[#2c3240] flex items-center justify-center mb-4 text-[#87cf3e]">
              {type === 'movie' ? <Film className="w-8 h-8" /> : <Tv className="w-8 h-8" />}
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              No {type === 'movie' ? 'movies' : 'series'} found
            </h3>
            <p className="text-xs text-[#828898] max-w-sm mb-6">
              {items.length === 0 
                ? `No VOD content detected in your playlist. Connect a playlist with VOD or Xtream Codes server.`
                : `No items matched your search query or group filter.`}
            </p>
            {items.length === 0 && (
              <button
                onClick={onOpenPlaylists}
                className="px-4 py-2 rounded-xl bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold text-xs shadow-md transition"
              >
                Open Playlist Manager
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Grid of Posters */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {paginatedItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="group relative bg-[#171920] border border-[#252a35] hover:border-[#87cf3e] rounded-xl overflow-hidden cursor-pointer transition transform hover:-translate-y-1 hover:shadow-xl flex flex-col"
                >
                  {/* Poster Thumbnail */}
                  <div className="aspect-[2/3] w-full bg-[#1b1e26] relative overflow-hidden">
                    {item.poster || item.logo ? (
                      <img
                        src={item.poster || item.logo}
                        alt={item.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center text-[#5a6170]">
                        <Film className="w-8 h-8 mb-2 opacity-50" />
                        <span className="text-[10px] font-bold line-clamp-2">{item.title}</span>
                      </div>
                    )}

                    {/* Rating Badge */}
                    {item.rating && (
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm border border-white/10 text-[10px] font-bold text-[#ffd43b] flex items-center space-x-1">
                        <Star className="w-2.5 h-2.5 fill-[#ffd43b]" />
                        <span>{item.rating}</span>
                      </div>
                    )}

                    {/* Year Badge */}
                    {item.year && (
                      <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur-sm border border-white/10 text-[10px] font-medium text-[#d1d5db]">
                        {item.year}
                      </div>
                    )}

                    {/* Hover Overlay Play Icon */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-[#87cf3e] flex items-center justify-center text-[#121316] shadow-lg transform group-hover:scale-110 transition">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  {/* Card Title & Group Info */}
                  <div className="p-2.5 flex-1 flex flex-col justify-between">
                    <h4 className="text-xs font-bold text-[#e1e4ea] group-hover:text-[#87cf3e] transition line-clamp-1">
                      {item.title}
                    </h4>
                    <span className="text-[10px] text-[#6d7382] truncate mt-1">
                      {item.group || item.categoryName || 'General'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pt-4 flex items-center justify-between border-t border-[#232733] text-xs text-[#8c92a0]">
                <div>
                  Showing <strong>{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> to{' '}
                  <strong>{Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)}</strong> of{' '}
                  <strong>{filteredItems.length}</strong> items
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg bg-[#1a1d24] border border-[#2b303d] disabled:opacity-40 hover:bg-[#252934] transition text-white"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="px-3 py-1 rounded bg-[#1a1d24] border border-[#2b303d] text-white font-mono">
                    {currentPage} / {totalPages}
                  </span>

                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="p-1.5 rounded-lg bg-[#1a1d24] border border-[#2b303d] disabled:opacity-40 hover:bg-[#252934] transition text-white"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Group Selection Modal */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#171920] border border-[#2c3240] rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#252a35] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Filter className="w-4 h-4 text-[#87cf3e]" />
                <h3 className="text-sm font-bold text-white">Select Category / Group</h3>
              </div>
              <button
                onClick={() => setIsGroupModalOpen(false)}
                className="p-1 text-[#787f90] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search filter in modal */}
            <div className="p-3 border-b border-[#252a35] bg-[#14161c]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="text"
                  placeholder="Search groups..."
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#1b1e26] border border-[#2d3240] rounded-xl text-xs text-white placeholder-[#6b7280] focus:outline-none focus:border-[#87cf3e]"
                  autoFocus
                />
              </div>
            </div>

            {/* Group List */}
            <div className="p-3 overflow-y-auto flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredGroupsList.map((g) => {
                const active = selectedGroup === g.name;
                return (
                  <button
                    key={g.name}
                    onClick={() => {
                      setSelectedGroup(g.name);
                      setIsGroupModalOpen(false);
                    }}
                    className={`p-2.5 rounded-xl text-left text-xs font-semibold transition flex items-center justify-between ${
                      active
                        ? 'bg-[#87cf3e] text-[#121316]'
                        : 'bg-[#1e222c] text-[#cfd4e0] hover:bg-[#272c38] hover:text-white'
                    }`}
                  >
                    <span className="truncate pr-2">{g.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${active ? 'bg-black/20 text-[#121316]' : 'bg-[#14161c] text-[#7f8698]'}`}>
                      {g.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TMDB Details & Playback Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#171920] border border-[#2c3240] rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">
            {/* Modal Hero Banner */}
            <div className="relative h-60 md:h-80 w-full bg-[#1b1e27] overflow-hidden flex-shrink-0">
              <img
                src={
                  tmdbData?.backdropUrl ||
                  selectedItem.backdrop ||
                  tmdbData?.posterUrl ||
                  selectedItem.poster ||
                  selectedItem.logo ||
                  'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200&auto=format&fit=crop&q=80'
                }
                alt={tmdbData?.title || selectedItem.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#171920] via-[#171920]/60 to-transparent" />

              {/* Close Button */}
              <button
                onClick={() => setSelectedItem(null)}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 border border-white/20 flex items-center justify-center text-white transition z-10"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Banner Info */}
              <div className="absolute bottom-4 left-6 right-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-[#87cf3e] text-[#121316] text-xs font-bold">
                      {selectedItem.type === 'movie' ? 'FEATURE FILM' : 'SERIES'}
                    </span>
                    {(tmdbData?.year || selectedItem.year) && (
                      <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 text-xs font-semibold text-white">
                        {tmdbData?.year || selectedItem.year}
                      </span>
                    )}
                    {(tmdbData?.rating || selectedItem.rating) && (
                      <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 text-xs font-bold text-[#ffd43b] flex items-center gap-1">
                        <Star className="w-3 h-3 fill-[#ffd43b]" />
                        <span>{tmdbData?.rating || selectedItem.rating} TMDB</span>
                        {tmdbData?.voteCount && (
                          <span className="text-[10px] text-[#b0b5c2] font-normal">
                            ({tmdbData.voteCount})
                          </span>
                        )}
                      </span>
                    )}
                    {(tmdbData?.duration || selectedItem.duration) && (
                      <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 text-xs text-[#cfd4e0] flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-[#87cf3e]" />
                        <span>{tmdbData?.duration || selectedItem.duration}</span>
                      </span>
                    )}
                    <span className="text-xs text-[#9ea4b5]">{selectedItem.group}</span>
                  </div>

                  <h2 className="text-2xl md:text-3xl font-black text-white leading-tight">
                    {tmdbData?.title || selectedItem.title}
                  </h2>

                  {/* Localized original title or tagline */}
                  {tmdbData?.originalTitle && tmdbData.originalTitle !== (tmdbData.title || selectedItem.title) && (
                    <div className="text-xs text-[#8c92a2] italic">
                      Original title: {tmdbData.originalTitle}
                    </div>
                  )}

                  {tmdbData?.tagline && (
                    <p className="text-xs text-[#87cf3e] italic line-clamp-1">
                      "{tmdbData.tagline}"
                    </p>
                  )}
                </div>

                {/* Direct Play / Trailer Buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {tmdbData?.trailerYoutubeKey && (
                    <button
                      onClick={() => setShowTrailerModal(true)}
                      className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-[#20232c] hover:bg-[#2b303d] text-white border border-[#3b4152] font-semibold text-xs shadow-md transition"
                    >
                      <Video className="w-4 h-4 text-[#ff6b6b]" />
                      <span>Watch Trailer</span>
                    </button>
                  )}

                  {selectedItem.type === 'movie' ? (
                    <button
                      onClick={() => {
                        handlePlayMovie(selectedItem);
                        setSelectedItem(null);
                      }}
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-[#87cf3e] hover:bg-[#99ea48] text-[#121316] font-bold text-sm shadow-lg shadow-[#87cf3e]/30 transition transform hover:scale-105"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Watch Movie</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const firstEp = selectedItem.episodes?.[0] || {
                          id: 'ep-default',
                          title: `${selectedItem.title} - Episode 1`,
                          seasonNum: 1,
                          episodeNum: 1,
                          streamUrl: selectedItem.streamUrl,
                        };
                        handlePlayEpisode(selectedItem, firstEp);
                        setSelectedItem(null);
                      }}
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-[#87cf3e] hover:bg-[#99ea48] text-[#121316] font-bold text-sm shadow-lg shadow-[#87cf3e]/30 transition transform hover:scale-105"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Play Series</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 flex-1">
              {/* Language Toolbar & TMDB Info Status */}
              <div className="bg-[#121419] p-3 rounded-xl border border-[#232631] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2 text-[#8c92a2]">
                  <Globe className="w-4 h-4 text-[#87cf3e]" />
                  <span>Display Language:</span>
                  <span className="font-semibold text-white">
                    {SUPPORTED_METADATA_LANGUAGES.find(l => l.code === activeLanguage)?.name || activeLanguage}
                  </span>
                  {activeLanguage === 'auto' && (
                    <span className="px-1.5 py-0.2 rounded bg-[#87cf3e]/20 text-[#87cf3e] text-[10px] font-mono">
                      {deviceLanguageCode}
                    </span>
                  )}
                </div>

                {/* Quick language switch dropdown */}
                <div className="flex items-center space-x-2">
                  <select
                    value={activeLanguage}
                    onChange={(e) => setActiveLanguage(e.target.value)}
                    className="px-2.5 py-1 bg-[#1c1f28] border border-[#2c3240] rounded-lg text-xs text-[#e1e5ee] focus:outline-none focus:border-[#87cf3e] cursor-pointer"
                  >
                    {SUPPORTED_METADATA_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name} {lang.code === 'auto' ? `(${deviceLanguageCode})` : ''}
                      </option>
                    ))}
                  </select>

                  {(isLoadingTmdb || isLoadingXcEpisodes) && (
                    <div className="flex items-center space-x-1 text-[#87cf3e] text-[11px]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{isLoadingXcEpisodes ? 'Loading Episodes...' : 'Fetching TMDB...'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Plot Synopsis (Enriched from TMDB in Device Language) */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#757c8d] flex items-center justify-between">
                  <span>Synopsis &amp; Storyline</span>
                  {tmdbData && (
                    <span className="text-[10px] text-[#87cf3e] font-normal flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      TMDB Enriched ({tmdbData.language || activeLanguage})
                    </span>
                  )}
                </h4>
                <p className="text-sm text-[#d0d5e0] leading-relaxed">
                  {tmdbData?.overview ||
                    selectedItem.plot ||
                    'High definition on-demand feature ready for instant playback.'}
                </p>
              </div>

              {/* Genres badges */}
              {((tmdbData?.genres && tmdbData.genres.length > 0) || selectedItem.genre) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(tmdbData?.genres || [selectedItem.genre!]).map((g, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#1e222c] text-[#87cf3e] border border-[#2b303d]"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Cast & Crew Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#252a35] text-xs">
                {(tmdbData?.director || selectedItem.director) && (
                  <div>
                    <span className="text-[#6d7382] block">Director / Creator:</span>
                    <span className="font-semibold text-[#e1e5ee]">
                      {tmdbData?.director || selectedItem.director}
                    </span>
                  </div>
                )}
                {(tmdbData?.cast || selectedItem.cast) && (
                  <div>
                    <span className="text-[#6d7382] block">Starring:</span>
                    <span className="font-semibold text-[#e1e5ee]">
                      {tmdbData?.cast || selectedItem.cast}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-[#6d7382] block">Stream Container:</span>
                  <span className="font-semibold text-[#e1e5ee] uppercase">
                    {selectedItem.containerExtension || 'HLS / MP4 Stream'}
                  </span>
                </div>
              </div>

              {/* Cast Members with Photos (if returned from TMDB) */}
              {tmdbData?.castList && tmdbData.castList.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-[#252a35]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#757c8d]">
                    Featured Cast
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {tmdbData.castList.slice(0, 5).map((actor, idx) => (
                      <div
                        key={idx}
                        className="bg-[#14161c] border border-[#232630] rounded-xl p-2.5 flex items-center space-x-2.5"
                      >
                        <div className="w-10 h-10 rounded-lg bg-[#20232c] overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {actor.profileUrl ? (
                            <img
                              src={actor.profileUrl}
                              alt={actor.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-5 h-5 text-[#5d6474]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold text-[#e1e5ee] truncate">{actor.name}</h5>
                          {actor.character && (
                            <p className="text-[10px] text-[#757c8d] truncate">{actor.character}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TV Series Season & Episode List */}
              {selectedItem.type === 'series' && (
                <div className="space-y-4 pt-4 border-t border-[#252a35]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#87cf3e]" />
                      <span>Episodes ({selectedItem.episodes?.length || 1})</span>
                      {isLoadingXcEpisodes && (
                        <span className="text-xs text-[#87cf3e] font-normal flex items-center gap-1 ml-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Fetching server episodes...
                        </span>
                      )}
                    </h4>

                    {/* Season selector */}
                    {(() => {
                      const epList = selectedItem.episodes || [];
                      const seasonsSet = new Set<number>();
                      epList.forEach(e => seasonsSet.add(e.seasonNum || 1));
                      if (selectedItem.seasonsCount && selectedItem.seasonsCount > 1) {
                        for (let s = 1; s <= selectedItem.seasonsCount; s++) seasonsSet.add(s);
                      }
                      const seasons = Array.from(seasonsSet).sort((a, b) => a - b);
                      if (seasons.length <= 1) return null;

                      return (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => setSelectedSeason(0)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                              selectedSeason === 0
                                ? 'bg-[#87cf3e] text-[#121316]'
                                : 'bg-[#20232c] text-[#8e95a5] hover:text-white'
                            }`}
                          >
                            All Seasons
                          </button>
                          {seasons.map((sNum) => (
                            <button
                              key={sNum}
                              onClick={() => setSelectedSeason(sNum)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                                selectedSeason === sNum
                                  ? 'bg-[#87cf3e] text-[#121316]'
                                  : 'bg-[#20232c] text-[#8e95a5] hover:text-white'
                              }`}
                            >
                              Season {sNum}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Episodes List */}
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {(() => {
                      const allEps = selectedItem.episodes || [
                        {
                          id: 'ep-default',
                          title: `${selectedItem.title} - Episode 1`,
                          seasonNum: 1,
                          episodeNum: 1,
                          streamUrl: selectedItem.streamUrl,
                          duration: '45m',
                          rating: selectedItem.rating
                        }
                      ];
                      const displayedEps = selectedSeason === 0
                        ? allEps
                        : allEps.filter(ep => (ep.seasonNum || 1) === selectedSeason);
                      const finalEps = displayedEps.length > 0 ? displayedEps : allEps;

                      return finalEps.map((ep) => (
                        <div
                          key={ep.id}
                          className="bg-[#1e222c] border border-[#2b303d] hover:border-[#87cf3e]/60 rounded-xl p-3 flex items-center justify-between gap-4 transition group"
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-[#272c38] flex flex-col items-center justify-center font-bold text-xs text-[#87cf3e] flex-shrink-0">
                              <span className="text-[9px] text-[#717787] uppercase font-mono">S{ep.seasonNum || 1}</span>
                              <span>E{ep.episodeNum}</span>
                            </div>
                            <div className="min-w-0">
                              <h5 className="text-xs font-bold text-white group-hover:text-[#87cf3e] transition truncate">
                                {ep.title}
                              </h5>
                              {ep.plot && (
                                <p className="text-[11px] text-[#787f90] line-clamp-1 mt-0.5">
                                  {ep.plot}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center space-x-3 flex-shrink-0">
                            {ep.duration && (
                              <span className="text-[11px] text-[#717787] flex items-center gap-1 font-mono">
                                <Clock className="w-3 h-3" />
                                <span>{ep.duration}</span>
                              </span>
                            )}

                            <button
                              onClick={() => {
                                handlePlayEpisode(selectedItem, ep);
                                setSelectedItem(null);
                              }}
                              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold text-xs transition shadow-sm"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Play</span>
                            </button>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* YouTube Trailer Video Modal */}
      {showTrailerModal && tmdbData?.trailerYoutubeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in">
          <div className="bg-[#171920] border border-[#2d3240] rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col">
            <div className="p-4 bg-[#121419] border-b border-[#252834] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Video className="w-4 h-4 text-[#ff6b6b]" />
                <h3 className="text-sm font-bold text-white">
                  Official Trailer: {tmdbData.title}
                </h3>
              </div>
              <button
                onClick={() => setShowTrailerModal(false)}
                className="p-1 rounded-lg text-[#7c8392] hover:text-white hover:bg-[#20232c]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video w-full bg-black">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${tmdbData.trailerYoutubeKey}?autoplay=1&rel=0`}
                title="Trailer"
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
