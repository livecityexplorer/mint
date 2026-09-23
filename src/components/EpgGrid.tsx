import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Play, 
  Clock, 
  Star, 
  Tv, 
  Sparkles, 
  Filter, 
  Plus, 
  Layers, 
  Search, 
  X, 
  Check, 
  Radio,
  History,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Channel, EpgProgram, EpgSourceInfo, RecentlyWatchedItem } from '../types';
import { normalizeGroupName } from '../utils/m3uParser';
import { ChannelLogo } from './ChannelLogo';
import { enrichChannelsWithLogos } from '../services/logoService';
import { generateScheduleForChannel } from '../data/sampleChannels';
import { 
  fetchEpgFromUrl, 
  matchChannelsWithEpg, 
  fetchXtreamEpg, 
  extractXcDetailsFromChannel 
} from '../services/epgService';

const EPG_COUNTRY_PRESETS = [
  { name: 'Global Multi-Source EPG', region: 'Global', url: 'https://epgshare01.online/epgshare01/epg_ripper_ALL_SOURCES1.xml.gz' },
  { name: 'United States & Canada', region: 'US / CA', url: 'https://epgshare01.online/epgshare01/epg_ripper_US1.xml.gz' },
  { name: 'United Kingdom & Ireland', region: 'UK / IE', url: 'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz' },
  { name: 'France (TNT & Satellite)', region: 'FR', url: 'https://epg.pw/xmltv/epg_FR.xml.gz' },
  { name: 'Germany / Austria / Swiss', region: 'DE / AT / CH', url: 'https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz' },
  { name: 'Spain & Portugal', region: 'ES / PT', url: 'https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz' },
  { name: 'Italy', region: 'IT', url: 'https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz' },
  { name: 'Latin America & Brazil', region: 'LATAM', url: 'https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz' },
  { name: 'Arabic / Middle East', region: 'MENA', url: 'https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz' },
];

interface EpgGridProps {
  channels: Channel[];
  schedules: Record<string, EpgProgram[]>;
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  onSelectProgram: (program: EpgProgram, channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  onOpenPlaylists?: () => void;
  epgSourceInfo?: EpgSourceInfo | null;
  recentlyWatched?: RecentlyWatchedItem[];
  onRemoveRecentlyWatched?: (channelId: string) => void;
  onClearRecentlyWatched?: () => void;
  onUpdateChannels?: (channels: Channel[]) => void;
  onUpdateSchedules?: (newSchedules: Record<string, EpgProgram[]>, sourceInfo: { sourceName: string; totalPrograms: number }) => void;
}

const PIXELS_PER_MINUTE = 4.5; // 30 mins = 135px, 60 mins = 270px
const ROW_HEIGHT = 64; // Height of each channel row in px
const OVERSCAN = 6; // Extra buffer rows above and below viewport

export const EpgGrid: React.FC<EpgGridProps> = ({
  channels,
  schedules,
  currentChannel,
  onSelectChannel,
  onSelectProgram,
  onToggleFavorite,
  selectedCategory,
  setSelectedCategory,
  onOpenPlaylists,
  epgSourceInfo,
  recentlyWatched = [],
  onRemoveRecentlyWatched,
  onClearRecentlyWatched,
  onUpdateChannels,
  onUpdateSchedules,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [inspectedProgram, setInspectedProgram] = useState<{ program: EpgProgram; channel: Channel } | null>(null);

  // EPG Quick Sync Modal State
  const [isEpgSyncModalOpen, setIsEpgSyncModalOpen] = useState(false);
  const [customEpgUrl, setCustomEpgUrl] = useState('');
  const [isSyncingEpg, setIsSyncingEpg] = useState(false);
  const [epgSyncStatus, setEpgSyncStatus] = useState<string | null>(null);

  // Quick EPG sync handler
  const handleQuickSyncEpg = async (url: string, name: string) => {
    if (!url.trim()) return;
    setIsSyncingEpg(true);
    setEpgSyncStatus(`Fetching & parsing ${name}...`);
    try {
      const epgPayload = await fetchEpgFromUrl(url.trim());
      if (!epgPayload || epgPayload.totalPrograms === 0) {
        throw new Error('No broadcast listings found in this XMLTV file.');
      }
      const { schedules: matchedSch, matchedCount } = matchChannelsWithEpg(channels, epgPayload);
      if (onUpdateSchedules) {
        onUpdateSchedules(matchedSch, {
          sourceName: name,
          totalPrograms: epgPayload.totalPrograms,
        });
      }
      setEpgSyncStatus(`Success! Loaded ${epgPayload.totalPrograms.toLocaleString()} programs, matched ${matchedCount} of ${channels.length} channels.`);
      setTimeout(() => {
        setIsEpgSyncModalOpen(false);
        setEpgSyncStatus(null);
      }, 1800);
    } catch (err: any) {
      setEpgSyncStatus(`EPG sync failed: ${err.message}`);
    } finally {
      setIsSyncingEpg(false);
    }
  };

  // Logo enrichment and feedback state
  const [isEnrichingLogos, setIsEnrichingLogos] = useState(false);
  const [logoToast, setLogoToast] = useState<string | null>(null);

  // Compute logo coverage statistics
  const logoStats = useMemo(() => {
    const withLogo = channels.filter(
      (c) => Boolean(c.tvgLogo || (c.logo && c.logo.startsWith('http') && !c.logo.includes('ui-avatars')))
    ).length;
    return {
      withLogo,
      total: channels.length,
      pct: channels.length > 0 ? Math.round((withLogo / channels.length) * 100) : 0,
    };
  }, [channels]);

  // Handler to enrich missing channel logos
  const handleEnrichLogos = () => {
    if (!onUpdateChannels || isEnrichingLogos) return;
    setIsEnrichingLogos(true);
    try {
      const { updatedChannels, enrichedCount } = enrichChannelsWithLogos(channels);
      if (enrichedCount > 0) {
        onUpdateChannels(updatedChannels);
        setLogoToast(`Enriched ${enrichedCount} channel logos from TV Guide & IPTV database!`);
      } else {
        setLogoToast(`All channels have logos or no new matches found.`);
      }
    } catch (err: any) {
      setLogoToast('Failed to enrich logos: ' + err.message);
    } finally {
      setIsEnrichingLogos(false);
      setTimeout(() => setLogoToast(null), 4000);
    }
  };

  // Recently watched section collapse state
  const [isRecentShelfCollapsed, setIsRecentShelfCollapsed] = useState(false);

  // Group search & modal states
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  // Relative timestamp formatter helper
  const formatRelativeTime = (timestamp: number): string => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Virtual scrolling state
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(700);

  // Update clock every 15 seconds
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Compute reference start time: 1.5 hours before current time, rounded to nearest 30 mins
  const timelineStart = useMemo(() => {
    const d = new Date(currentTime);
    d.setMinutes(d.getMinutes() - 90);
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
    return d;
  }, [currentTime.getDate(), currentTime.getHours()]);

  // Timeline slots: 18 slots of 30 minutes each (9 hours total span)
  const timeSlots = useMemo(() => {
    const slots: Date[] = [];
    const base = new Date(timelineStart);
    for (let i = 0; i < 18; i++) {
      slots.push(new Date(base.getTime() + i * 30 * 60 * 1000));
    }
    return slots;
  }, [timelineStart]);

  // Extract distinct groups with counts (normalized, trimmed)
  const { categoryCounts, categories } = useMemo(() => {
    const counts: Record<string, number> = {};
    let favCount = 0;

    for (let i = 0; i < channels.length; i++) {
      const c = channels[i];
      const g = normalizeGroupName(c.group || 'General');
      counts[g] = (counts[g] || 0) + 1;
      if (c.isFavorite) favCount++;
    }

    const uniqueGroups = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const recentCount = recentlyWatched.length;
    const catCounts: Record<string, number> = { 
      ...counts, 
      'Recently Watched': recentCount,
      Favorites: favCount, 
      All: channels.length 
    };

    const initialCategories: string[] = ['All'];
    if (recentCount > 0) {
      initialCategories.push('Recently Watched');
    }
    initialCategories.push('Favorites');

    return {
      categoryCounts: catCounts,
      categories: [...initialCategories, ...uniqueGroups],
    };
  }, [channels, recentlyWatched.length]);

  // Filter groups for dropdown / search
  const filteredCategories = useMemo(() => {
    if (!groupSearchQuery.trim()) return categories;
    const q = groupSearchQuery.toLowerCase().trim();
    return categories.filter(c => c.toLowerCase().includes(q));
  }, [categories, groupSearchQuery]);

  // Filter channels by selected category (exact normalized case-insensitive match)
  const filteredChannels = useMemo(() => {
    if (selectedCategory === 'All') return channels;
    if (selectedCategory === 'Favorites') return channels.filter(c => c.isFavorite);
    if (selectedCategory === 'Recently Watched') {
      if (!recentlyWatched || recentlyWatched.length === 0) return [];
      const channelMap = new Map(channels.map(c => [c.id, c]));
      return recentlyWatched
        .map(item => channelMap.get(item.channelId) || item.channel)
        .filter(Boolean);
    }
    const target = normalizeGroupName(selectedCategory).toLowerCase();
    return channels.filter(c => normalizeGroupName(c.group || 'General').toLowerCase() === target);
  }, [channels, selectedCategory, recentlyWatched]);

  // Track container height for virtualization
  useEffect(() => {
    const updateHeight = () => {
      if (gridContainerRef.current) {
        setContainerHeight(gridContainerRef.current.clientHeight || 700);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Handle virtual scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Reset scroll when category changes
  useEffect(() => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollTop = 0;
    }
    setScrollTop(0);
  }, [selectedCategory]);

  // Virtual slice calculations
  const totalChannels = filteredChannels.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + (OVERSCAN * 2);
  const endIndex = Math.min(totalChannels, startIndex + visibleCount);

  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(startIndex, endIndex);
  }, [filteredChannels, startIndex, endIndex]);

  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (totalChannels - endIndex) * ROW_HEIGHT);

  // Calculate position of current time indicator
  const currentMinutesFromStart = Math.max(0, (currentTime.getTime() - timelineStart.getTime()) / (60 * 1000));
  const currentIndicatorLeft = currentMinutesFromStart * PIXELS_PER_MINUTE;

  // Auto-scroll horizontally to "Now" on first render
  const scrollToNow = () => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollTo({
        left: Math.max(0, currentIndicatorLeft - 200),
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    scrollToNow();
  }, [timelineStart]);

  // Default inspection on first channel's current program
  useEffect(() => {
    if (!inspectedProgram && filteredChannels.length > 0) {
      const first = filteredChannels[0];
      const progList = schedules[first.id] || [];
      const current = progList.find(p => p.start <= currentTime && p.end >= currentTime) || progList[0];
      if (current) {
        setInspectedProgram({ program: current, channel: first });
      }
    }
  }, [filteredChannels, schedules, inspectedProgram, currentTime]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121316] overflow-hidden">
      {/* Category selector & Action Bar */}
      <div className="px-4 py-2.5 bg-[#17191e] border-b border-[#242730] flex items-center justify-between gap-3 overflow-x-auto select-none">
        <div className="flex items-center space-x-2 flex-nowrap">
          {/* Group Dropdown Selector */}
          <div className="flex items-center space-x-1.5 bg-[#1e2129] border border-[#2d323f] rounded-lg px-2.5 py-1 text-xs text-[#a4aab8] flex-shrink-0">
            <Filter className="w-3.5 h-3.5 text-[#87cf3e]" />
            <span className="text-[11px] text-[#787f90]">Group:</span>
            <select
              id="select-group-dropdown"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer text-xs max-w-[200px]"
            >
              <option value="All" className="bg-[#1e2129]">
                All Groups ({channels.length} ch)
              </option>
              {recentlyWatched.length > 0 && (
                <option value="Recently Watched" className="bg-[#1e2129]">
                  🕒 Recently Watched ({recentlyWatched.length})
                </option>
              )}
              <option value="Favorites" className="bg-[#1e2129]">
                ★ Favorites ({categoryCounts.Favorites || 0})
              </option>
              {categories.filter(c => c !== 'All' && c !== 'Favorites' && c !== 'Recently Watched').map((cat) => (
                <option key={cat} value={cat} className="bg-[#1e2129]">
                  {cat} ({categoryCounts[cat] || 0})
                </option>
              ))}
            </select>
          </div>

          {/* Browse Groups Button (opens modal for 1000+ groups) */}
          <button
            onClick={() => setIsGroupModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-[#1e2129] hover:bg-[#262b36] border border-[#2c313e] text-xs font-semibold text-[#87cf3e] flex items-center gap-1.5 flex-shrink-0 transition"
            title="Browse all channel groups"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Browse Groups ({Math.max(0, categories.length - (recentlyWatched.length > 0 ? 3 : 2))})</span>
          </button>

          {/* Active Group Reset button */}
          {selectedCategory !== 'All' && (
            <button
              onClick={() => setSelectedCategory('All')}
              className="px-2 py-1 rounded-lg bg-[#272b36] hover:bg-[#323745] text-xs text-[#a3a9b7] hover:text-white flex items-center gap-1 transition flex-shrink-0 border border-[#373d4d]"
              title="Reset group filter to All"
            >
              <X className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}

          {/* Quick Filter Pills (Top 8 groups) */}
          <div className="flex items-center space-x-1 flex-nowrap">
            {categories.slice(0, 8).map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  id={`cat-filter-${cat.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition flex items-center gap-1.5 ${
                    active
                      ? 'bg-[#87cf3e] text-[#121316] font-semibold shadow-sm'
                      : 'bg-[#1e2129] text-[#9ca1af] hover:text-[#e3e5e8] hover:bg-[#272b35] border border-[#2b2f3a]'
                  }`}
                >
                  {cat === 'Recently Watched' ? (
                    <>
                      <History className="w-3 h-3 text-[#87cf3e]" />
                      <span>Recents</span>
                    </>
                  ) : cat === 'Favorites' ? (
                    <span>★ Favs</span>
                  ) : (
                    <span>{cat}</span>
                  )}
                  <span className={`text-[10px] px-1 rounded ${active ? 'bg-black/20 text-black font-bold' : 'text-[#6f7584]'}`}>
                    {categoryCounts[cat] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right side status & action */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* EPG Source Status & Sync Button */}
          {epgSourceInfo ? (
            <button
              onClick={() => setIsEpgSyncModalOpen(true)}
              className="px-2 py-0.5 rounded-full bg-[#87cf3e]/10 border border-[#87cf3e]/30 text-[10px] text-[#87cf3e] font-semibold flex items-center gap-1 hover:bg-[#87cf3e]/20 transition"
              title={`Real XMLTV EPG active: ${epgSourceInfo.totalPrograms?.toLocaleString() || 0} listings. Click to manage EPG sources.`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#87cf3e]" />
              <span>Real EPG Active ({Object.keys(schedules).length} matched)</span>
            </button>
          ) : (
            <button
              onClick={() => setIsEpgSyncModalOpen(true)}
              className="px-2 py-0.5 rounded-full bg-[#20232b] border border-[#303542] text-[10px] text-[#8d93a2] hover:text-[#e3e5e8] flex items-center gap-1 hover:border-[#87cf3e]/40 transition"
              title="Click to sync real XMLTV TV Guide or choose country presets"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#f59f00]" />
              <span>Sync Real XMLTV</span>
            </button>
          )}

          {/* Channel Logo Status & Enrich action */}
          <button
            id="btn-epg-logo-status"
            onClick={handleEnrichLogos}
            disabled={isEnrichingLogos}
            className="px-2 py-0.5 rounded-full bg-[#1c1f26] border border-[#2b303d] text-[10px] text-[#9ba2b3] hover:text-white hover:border-[#87cf3e]/40 transition flex items-center gap-1.5"
            title={`${logoStats.withLogo} of ${logoStats.total} channels have logos (${logoStats.pct}%). Extracted from M3U 'tvg-logo'. Click to enrich missing logos from TV Guide or IPTV database.`}
          >
            <Sparkles className={`w-3 h-3 ${isEnrichingLogos ? 'animate-spin text-[#87cf3e]' : 'text-[#87cf3e]'}`} />
            <span>Logos: {logoStats.withLogo}/{logoStats.total}</span>
            {logoStats.withLogo < logoStats.total && onUpdateChannels && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-[#87cf3e]/20 text-[#87cf3e] font-semibold">
                {isEnrichingLogos ? 'Fetching...' : 'Enrich'}
              </span>
            )}
          </button>

          <span className="text-[11px] text-[#6b7282] hidden md:inline font-mono">
            {filteredChannels.length} of {channels.length} channels
          </span>
          {onOpenPlaylists && (
            <button
              onClick={onOpenPlaylists}
              className="px-2.5 py-1 rounded-lg bg-[#87cf3e]/15 hover:bg-[#87cf3e]/25 text-[#87cf3e] border border-[#87cf3e]/30 text-xs font-semibold flex items-center gap-1 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add M3U / XC</span>
            </button>
          )}
        </div>
      </div>

      {/* Logo Enrichment Toast */}
      {logoToast && (
        <div className="px-4 py-2 bg-[#87cf3e]/15 border-b border-[#87cf3e]/30 text-[#87cf3e] text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span>{logoToast}</span>
          </div>
          <button
            onClick={() => setLogoToast(null)}
            className="text-[#87cf3e] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Recently Watched Quick-Resume Shelf Section */}
      {recentlyWatched && recentlyWatched.length > 0 && (
        <div
          id="epg-recently-watched-section"
          className="bg-[#14161c] border-b border-[#252833] px-4 py-2.5 transition-all select-none"
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 rounded-md bg-[#87cf3e]/15 flex items-center justify-center border border-[#87cf3e]/30">
                <History className="w-3.5 h-3.5 text-[#87cf3e]" />
              </div>
              <span className="text-xs font-bold text-[#e3e6eb] tracking-wide">Recently Watched</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#20232c] text-[#8e94a5] border border-[#2b2f3c]">
                {recentlyWatched.length} {recentlyWatched.length === 1 ? 'stream' : 'streams'}
              </span>
              <span className="text-[11px] text-[#6b7282] hidden sm:inline">
                • Quick resume previously watched channels
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {onClearRecentlyWatched && (
                <button
                  id="btn-clear-recent-streams"
                  onClick={onClearRecentlyWatched}
                  className="text-[11px] text-[#7d8495] hover:text-[#ff6b6b] flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#252833] transition"
                  title="Clear recently watched history from IndexedDB"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden md:inline">Clear History</span>
                </button>
              )}
              <button
                onClick={() => setIsRecentShelfCollapsed(!isRecentShelfCollapsed)}
                className="text-xs text-[#8d93a2] hover:text-white p-1 rounded hover:bg-[#20232c] transition flex items-center gap-1"
                title={isRecentShelfCollapsed ? "Expand recently watched" : "Collapse recently watched"}
              >
                {isRecentShelfCollapsed ? (
                  <>
                    <span className="text-[10px] text-[#6f7586]">Show</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </>
                ) : (
                  <>
                    <span className="text-[10px] text-[#6f7586]">Hide</span>
                    <ChevronUp className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Horizontal Cards Reel */}
          {!isRecentShelfCollapsed && (
            <div className="flex space-x-2.5 overflow-x-auto pb-1.5 pt-0.5 scrollbar-thin scrollbar-thumb-[#2c313e]">
              {recentlyWatched.map((item) => {
                const isPlaying = currentChannel?.id === item.channelId;
                const progList = (schedules[item.channelId] && schedules[item.channelId].length > 0)
                  ? schedules[item.channelId]
                  : generateScheduleForChannel(item.channel, currentTime);
                const nowPlayingProg = progList.find(p => p.start <= currentTime && p.end >= currentTime) || (item.channel.currentProgram || null);
                const progTitle = nowPlayingProg?.title || item.programTitle || 'Live Stream';
                const progCat = nowPlayingProg?.category || item.programCategory || item.channel.group;

                return (
                  <div
                    key={item.channelId}
                    id={`recent-stream-card-${item.channelId}`}
                    onClick={() => onSelectChannel(item.channel)}
                    className={`w-60 flex-shrink-0 bg-[#181b22] hover:bg-[#1f232e] rounded-xl p-2.5 border transition cursor-pointer relative group flex flex-col justify-between ${
                      isPlaying
                        ? 'border-[#87cf3e] ring-1 ring-[#87cf3e]/40 shadow-lg shadow-[#87cf3e]/10'
                        : 'border-[#262b37] hover:border-[#87cf3e]/50'
                    }`}
                  >
                    {/* Card top */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <ChannelLogo
                          channel={item.channel}
                          size="sm"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white truncate group-hover:text-[#87cf3e] transition">
                              {item.channel.name}
                            </span>
                          </div>
                          <span className="text-[10px] text-[#707788] block truncate">
                            {item.channel.group || 'Live'} • {formatRelativeTime(item.lastWatched)}
                          </span>
                        </div>
                      </div>

                      {/* Right badge & remove */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        {isPlaying ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#87cf3e]/20 text-[#87cf3e] flex items-center gap-1 border border-[#87cf3e]/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#87cf3e] animate-ping" />
                            PLAYING
                          </span>
                        ) : (
                          onRemoveRecentlyWatched && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveRecentlyWatched(item.channelId);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#2b303e] text-[#7d8495] hover:text-[#ff6b6b] transition"
                              title="Remove from recents"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {/* Card bottom: Program title & Resume hint */}
                    <div className="mt-2 pt-2 border-t border-[#232734] flex items-center justify-between">
                      <div className="min-w-0 flex-1 pr-2">
                        <span className="text-[11px] font-medium text-[#c5c9d4] truncate block">
                          {progTitle}
                        </span>
                        <span className="text-[10px] text-[#63697a] truncate block">
                          {progCat}
                        </span>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#87cf3e] group-hover:translate-x-0.5 transition">
                        <Play className="w-3 h-3 fill-current" />
                        <span>Resume</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main EPG Timeline Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Scrollable grid container with virtualized scrolling */}
        <div 
          ref={gridContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-x-auto overflow-y-auto relative scrollbar-thin scrollbar-thumb-[#2d313c]"
        >
          <div className="min-w-max flex flex-col">
            {/* Timeline Header Row (Sticky top) */}
            <div className="sticky top-0 z-20 flex bg-[#17191e] border-b border-[#282c36] shadow-sm">
              {/* Channel column header */}
              <div className="w-64 flex-shrink-0 sticky left-0 z-30 bg-[#17191e] border-r border-[#282c36] px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-[#8c92a0]">
                <span>CHANNEL ({filteredChannels.length})</span>
                <span className="text-[10px] text-[#5e6371] font-mono">
                  {selectedCategory === 'All' ? 'ALL GROUPS' : selectedCategory.slice(0, 16)}
                </span>
              </div>

              {/* Time ruler */}
              <div className="flex relative">
                {timeSlots.map((slot, index) => (
                  <div
                    key={index}
                    style={{ width: `${30 * PIXELS_PER_MINUTE}px` }}
                    className="flex-shrink-0 border-r border-[#262a34] px-2 py-2 text-xs font-mono font-medium text-[#7d8392] flex items-center justify-between"
                  >
                    <span>
                      {slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] text-[#444955]">:30</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Red "Current Time" Vertical Line Indicator */}
            <div
              style={{ left: `${256 + currentIndicatorLeft}px` }}
              className="absolute top-0 bottom-0 w-[2px] bg-[#e03131] z-10 pointer-events-none shadow-[0_0_8px_rgba(224,49,49,0.8)]"
            >
              <div className="sticky top-0 -ml-1.5 w-3.5 h-3.5 bg-[#e03131] rounded-full border-2 border-[#121316] shadow flex items-center justify-center">
                <div className="w-1 h-1 bg-white rounded-full" />
              </div>
            </div>

            {/* Empty State */}
            {totalChannels === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-8">
                {selectedCategory === 'Recently Watched' ? (
                  <>
                    <History className="w-10 h-10 text-[#4c5262] mb-3" />
                    <h3 className="text-sm font-bold text-white">No recently watched streams</h3>
                    <p className="text-xs text-[#737989] mt-1 max-w-sm">
                      Channels you tune into will automatically appear here and persist across sessions in IndexedDB.
                    </p>
                    <button
                      onClick={() => setSelectedCategory('All')}
                      className="mt-3 px-3 py-1.5 bg-[#87cf3e] text-[#121316] font-semibold text-xs rounded hover:bg-[#97df4e] transition"
                    >
                      Browse All Channels
                    </button>
                  </>
                ) : (
                  <>
                    <Tv className="w-10 h-10 text-[#4c5262] mb-3" />
                    <h3 className="text-sm font-bold text-white">No channels found in group &ldquo;{selectedCategory}&rdquo;</h3>
                    <p className="text-xs text-[#737989] mt-1 max-w-sm">
                      Try switching to another group or reset the filter to view all channels.
                    </p>
                    <button
                      onClick={() => setSelectedCategory('All')}
                      className="mt-3 px-3 py-1.5 bg-[#87cf3e] text-[#121316] font-semibold text-xs rounded hover:bg-[#97df4e] transition"
                    >
                      Show All Groups
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Virtual Scroll Top Spacer */}
                {topSpacer > 0 && <div style={{ height: `${topSpacer}px` }} className="w-full flex-shrink-0" />}

                {/* Visible Channels & Programs Rows */}
                {visibleChannels.map((channel) => {
                  const isCurrentPlaying = currentChannel?.id === channel.id;
                  // Use real XMLTV / Xtream schedules only (no fake generated programs)
                  const programs = schedules[channel.id] || [];

                  return (
                    <div
                      key={channel.id}
                      id={`epg-row-${channel.id}`}
                      style={{ height: `${ROW_HEIGHT}px` }}
                      className={`flex border-b border-[#20232b] hover:bg-[#16181e] transition-colors group ${
                        isCurrentPlaying ? 'bg-[#87cf3e]/5' : ''
                      }`}
                    >
                      {/* Fixed Channel Card (Sticky on the left) */}
                      <div className="w-64 flex-shrink-0 sticky left-0 z-10 bg-[#15171c] group-hover:bg-[#191b22] border-r border-[#282c36] p-2 flex items-center justify-between gap-2">
                        <div 
                          onClick={() => onSelectChannel(channel)}
                          className="flex items-center space-x-2.5 flex-1 min-w-0 cursor-pointer"
                        >
                          {/* Channel Number */}
                          <span className="font-mono text-xs font-semibold text-[#666b78] w-6 text-center">
                            {channel.num < 10 ? `0${channel.num}` : channel.num}
                          </span>

                          {/* Channel Logo (rendered from M3U tvg-logo with intelligent fallbacks) */}
                          <ChannelLogo
                            channel={channel}
                            size="sm"
                            showBadge={true}
                          />

                          {/* Name & Group */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-semibold text-[#e3e5e8] truncate group-hover:text-[#87cf3e] transition">
                                {channel.name}
                              </h4>
                              {isCurrentPlaying && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[#87cf3e] animate-ping" />
                              )}
                            </div>
                            <span className="text-[10px] text-[#6b717f] block truncate">
                              {channel.group}
                            </span>
                          </div>
                        </div>

                        {/* Favorite star */}
                        <button
                          onClick={() => onToggleFavorite(channel.id)}
                          className="p-1 rounded text-[#555a67] hover:text-[#ffd43b] transition"
                        >
                          <Star className={`w-3.5 h-3.5 ${channel.isFavorite ? 'fill-[#ffd43b] text-[#ffd43b]' : ''}`} />
                        </button>
                      </div>

                      {/* Horizontal Program Blocks Timeline Area with 30-min vertical grid lines */}
                      <div 
                        style={{ width: `${timeSlots.length * 30 * PIXELS_PER_MINUTE}px` }} 
                        className="relative h-16 flex-shrink-0"
                      >
                        {/* 30-Minute Subtle Vertical Guide Columns */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {timeSlots.map((_, idx) => (
                            <div
                              key={idx}
                              style={{ width: `${30 * PIXELS_PER_MINUTE}px` }}
                              className="flex-shrink-0 border-r border-[#191b22]"
                            />
                          ))}
                        </div>

                        {programs.length > 0 ? (
                          programs.map((program) => {
                            const progStart = new Date(program.start);
                            const progEnd = new Date(program.end);

                            const startMinutes = (progStart.getTime() - timelineStart.getTime()) / (60 * 1000);
                            const endMinutes = (progEnd.getTime() - timelineStart.getTime()) / (60 * 1000);
                            const totalTimelineMins = timeSlots.length * 30;

                            // Skip programs that are completely outside the visible 9-hour timeline
                            if (endMinutes <= 0 || startMinutes >= totalTimelineMins) {
                              return null;
                            }

                            const visibleStartMinutes = Math.max(0, startMinutes);
                            const visibleEndMinutes = Math.min(totalTimelineMins, endMinutes);
                            const durationMinutes = (progEnd.getTime() - progStart.getTime()) / (60 * 1000);

                            const leftPx = visibleStartMinutes * PIXELS_PER_MINUTE;
                            const widthPx = Math.max(24, (visibleEndMinutes - visibleStartMinutes) * PIXELS_PER_MINUTE - 2);

                            const isAiringNow = progStart <= currentTime && progEnd >= currentTime;
                            const isSelected = inspectedProgram?.program.id === program.id;

                            // Calculate live progress percentage
                            let progressPercent = 0;
                            if (isAiringNow && durationMinutes > 0) {
                              const elapsed = (currentTime.getTime() - progStart.getTime()) / (60 * 1000);
                              progressPercent = Math.min(100, Math.max(0, (elapsed / durationMinutes) * 100));
                            }

                            return (
                              <div
                                key={program.id}
                                onClick={() => {
                                  setInspectedProgram({ program, channel });
                                  onSelectProgram(program, channel);
                                }}
                                style={{
                                  position: 'absolute',
                                  left: `${leftPx}px`,
                                  width: `${widthPx}px`,
                                  top: '5px',
                                  bottom: '5px',
                                }}
                                className={`rounded p-2 flex flex-col justify-between cursor-pointer border transition overflow-hidden group/prog select-none ${
                                  isSelected
                                    ? 'border-[#87cf3e] bg-[#222731] z-10 shadow-md ring-1 ring-[#87cf3e]'
                                    : isAiringNow
                                    ? 'border-[#384050] bg-[#1a1d24] hover:border-[#87cf3e]/60 z-[5]'
                                    : 'border-[#22252e] bg-[#14161b] hover:bg-[#1a1c22]'
                                }`}
                              >
                                {/* Top: Title & Category */}
                                <div className="flex items-center justify-between gap-1">
                                  <span className={`text-xs font-medium truncate ${isAiringNow ? 'text-[#e9ebed]' : 'text-[#a7acb8]'}`}>
                                    {program.title}
                                  </span>
                                  {isAiringNow && (
                                    <span className="text-[9px] font-bold px-1 rounded bg-[#87cf3e]/20 text-[#87cf3e] flex-shrink-0">
                                      LIVE
                                    </span>
                                  )}
                                </div>

                                {/* Bottom: Time interval */}
                                <div className="flex items-center justify-between text-[10px] text-[#666c7b]">
                                  <span className="truncate">
                                    {progStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {progEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className="text-[9px] text-[#4f5462] flex-shrink-0 ml-1">{Math.round(durationMinutes)}m</span>
                                </div>

                                {/* Live broadcast progress bar */}
                                {isAiringNow && (
                                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#2b303c]">
                                    <div
                                      style={{ width: `${progressPercent}%` }}
                                      className="h-full bg-[#87cf3e]"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div 
                            onClick={() => onSelectChannel(channel)}
                            style={{
                              position: 'absolute',
                              left: '4px',
                              width: '420px',
                              top: '5px',
                              bottom: '5px',
                            }}
                            className="rounded border border-[#22252e] bg-[#13151a] hover:bg-[#181a21] hover:border-[#384050] p-2.5 flex items-center justify-between cursor-pointer transition z-[2]"
                          >
                            <div className="flex items-center space-x-2">
                              <Radio className="w-4 h-4 text-[#525766]" />
                              <div>
                                <span className="text-xs text-[#8e94a3] font-medium block">
                                  {channel.name} (Live Stream)
                                </span>
                                <span className="text-[10px] text-[#555a68]">
                                  No XMLTV schedule matched • Click to tune in
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenPlaylists?.();
                              }}
                              className="px-2 py-1 rounded bg-[#1f222a] hover:bg-[#2a2f3c] text-[10px] text-[#87cf3e] font-semibold transition border border-[#2e3442]"
                            >
                              Sync EPG
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Virtual Scroll Bottom Spacer */}
                {bottomSpacer > 0 && <div style={{ height: `${bottomSpacer}px` }} className="w-full flex-shrink-0" />}
              </>
            )}
          </div>
        </div>

        {/* Bottom Inspector Bar */}
        {inspectedProgram && (
          <div className="h-16 bg-[#16181e] border-t border-[#252932] px-4 py-2 flex items-center justify-between gap-4 z-30 shadow-lg">
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="w-10 h-10 rounded bg-[#20242e] border border-[#2e3340] overflow-hidden flex-shrink-0 flex items-center justify-center">
                {inspectedProgram.channel.logo ? (
                  <img
                    src={inspectedProgram.channel.logo}
                    alt={inspectedProgram.channel.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Tv className="w-5 h-5 text-[#87cf3e]" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#87cf3e]">
                    {inspectedProgram.channel.name}
                  </span>
                  <span className="text-[#494e5b]">•</span>
                  <span className="text-xs font-mono text-[#8c919f]">
                    {new Date(inspectedProgram.program.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(inspectedProgram.program.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#252933] text-[#9ca1af] border border-[#313644]">
                    {inspectedProgram.program.category}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#eef0f2] mt-0.5">
                  {inspectedProgram.program.title}
                </h3>
                <p className="text-xs text-[#8d93a2] line-clamp-1 mt-0.5">
                  {inspectedProgram.program.description}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 self-end md:self-center">
              <button
                id="btn-tune-in-channel"
                onClick={() => onSelectChannel(inspectedProgram.channel)}
                className="flex items-center space-x-1.5 px-4 py-2 rounded bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-semibold text-xs shadow-md transition"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Watch {inspectedProgram.channel.name}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Group Selector Modal (for 28,000 channels / 1,000+ groups) */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#181a21] border border-[#2c3240] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#282d3a] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Layers className="w-5 h-5 text-[#87cf3e]" />
                <h3 className="text-base font-bold text-white">Select TV Channel Group</h3>
                <span className="text-xs font-mono text-[#767d8e] bg-[#222632] px-2 py-0.5 rounded">
                  {categories.length - 1} groups
                </span>
              </div>
              <button
                onClick={() => setIsGroupModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[#252934] text-[#767d8e] hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Fast Search input */}
            <div className="p-4 border-b border-[#232734] bg-[#14161c]">
              <div className="relative">
                <Search className="w-4 h-4 text-[#72798b] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search groups (e.g. Sports, USA, News, Movies, Arabic, UK)..."
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 bg-[#1b1e26] border border-[#2d3240] rounded-xl text-sm text-white placeholder-[#686f80] focus:outline-none focus:border-[#87cf3e]"
                />
              </div>
            </div>

            {/* Groups Grid List */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 scrollbar-thin scrollbar-thumb-[#2c313e]">
              {filteredCategories.map((cat) => {
                const isSelected = selectedCategory === cat;
                const count = categoryCounts[cat] || 0;

                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setIsGroupModalOpen(false);
                    }}
                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition ${
                      isSelected
                        ? 'bg-[#87cf3e]/15 border-[#87cf3e] text-white'
                        : 'bg-[#1b1e26] border-[#292e3a] hover:bg-[#242834] text-[#d6dae3]'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <span className={`text-xs font-semibold block truncate ${isSelected ? 'text-[#87cf3e]' : ''}`}>
                        {cat === 'Recently Watched' ? '🕒 Recently Watched' : cat === 'Favorites' ? '★ Favorites' : cat}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${
                        isSelected ? 'bg-[#87cf3e] text-[#121316] font-bold' : 'bg-[#252934] text-[#8e94a4]'
                      }`}>
                        {count} ch
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-[#87cf3e]" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#14161c] border-t border-[#242835] flex justify-between items-center text-xs text-[#767d8e]">
              <span>Click a group to apply filter immediately</span>
              <button
                onClick={() => {
                  setSelectedCategory('All');
                  setIsGroupModalOpen(false);
                }}
                className="px-3 py-1 bg-[#252934] hover:bg-[#2f3442] text-white rounded-lg transition"
              >
                Reset to All Groups
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick EPG Sync & Source Manager Modal */}
      {isEpgSyncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#181a21] border border-[#2c3240] rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#282d3a] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="w-5 h-5 text-[#87cf3e]" />
                <h3 className="text-base font-bold text-white">Sync Real TV Guide (EPG)</h3>
              </div>
              <button
                onClick={() => {
                  setIsEpgSyncModalOpen(false);
                  setEpgSyncStatus(null);
                }}
                className="p-1 rounded-lg hover:bg-[#252934] text-[#767d8e] hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto space-y-4">
              {/* Status Banner */}
              {epgSyncStatus && (
                <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  epgSyncStatus.startsWith('Success')
                    ? 'bg-[#87cf3e]/15 border border-[#87cf3e]/30 text-[#87cf3e]'
                    : epgSyncStatus.startsWith('EPG sync failed')
                    ? 'bg-red-500/15 border border-red-500/30 text-red-400'
                    : 'bg-[#222734] border border-[#303648] text-white'
                }`}>
                  {isSyncingEpg && <Sparkles className="w-4 h-4 animate-spin text-[#87cf3e] flex-shrink-0" />}
                  <span>{epgSyncStatus}</span>
                </div>
              )}

              {/* Current Active EPG Status */}
              <div className="p-3 bg-[#13151b] rounded-xl border border-[#232733]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#7e8597]">Current Status</span>
                  {epgSourceInfo ? (
                    <span className="text-xs font-semibold text-[#87cf3e] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#87cf3e]" />
                      Real XMLTV Active ({epgSourceInfo.totalPrograms?.toLocaleString()} programs)
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-[#e5a00d] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#e5a00d]" />
                      No Real EPG Loaded
                    </span>
                  )}
                </div>
                {epgSourceInfo?.sourceName && (
                  <p className="text-[11px] text-[#606778] mt-1 font-mono truncate">
                    Source: {epgSourceInfo.sourceName}
                  </p>
                )}
              </div>

              {/* Custom XMLTV URL Input */}
              <div>
                <label className="block text-xs font-semibold text-[#c8cdd8] mb-1.5">
                  Custom XMLTV / EPG URL (.xml or .xml.gz)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://example.com/epg.xml.gz"
                    value={customEpgUrl}
                    onChange={(e) => setCustomEpgUrl(e.target.value)}
                    disabled={isSyncingEpg}
                    className="flex-1 px-3 py-2 bg-[#14161c] border border-[#2d3240] rounded-xl text-xs text-white placeholder-[#585e6f] focus:outline-none focus:border-[#87cf3e]"
                  />
                  <button
                    onClick={() => handleQuickSyncEpg(customEpgUrl, 'Custom XMLTV')}
                    disabled={isSyncingEpg || !customEpgUrl.trim()}
                    className="px-4 py-2 bg-[#87cf3e] hover:bg-[#97df4e] disabled:opacity-40 text-[#121316] font-bold text-xs rounded-xl transition flex items-center gap-1.5"
                  >
                    {isSyncingEpg ? 'Fetching...' : 'Sync URL'}
                  </button>
                </div>
              </div>

              {/* Verified Country XMLTV Presets */}
              <div>
                <label className="block text-xs font-semibold text-[#c8cdd8] mb-2">
                  Verified Real XMLTV Feeds (EPGShare & Public XMLTV)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {EPG_COUNTRY_PRESETS.map((preset) => (
                    <button
                      key={preset.region}
                      onClick={() => handleQuickSyncEpg(preset.url, preset.name)}
                      disabled={isSyncingEpg}
                      className="p-2.5 rounded-xl border border-[#262b37] bg-[#14161b] hover:bg-[#1d2028] hover:border-[#87cf3e]/40 text-left transition flex items-center justify-between group"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="text-xs font-semibold text-[#e1e4eb] block truncate group-hover:text-[#87cf3e] transition">
                          {preset.name}
                        </span>
                        <span className="text-[10px] text-[#6b7182]">
                          Region: {preset.region}
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#20242f] text-[#87cf3e] font-semibold flex-shrink-0">
                        Sync
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#14161c] border-t border-[#242835] flex justify-between items-center text-xs text-[#767d8e]">
              <span>Real EPG automatically matches channels by tvg-id, stream-id, and names</span>
              <button
                onClick={() => {
                  setIsEpgSyncModalOpen(false);
                  onOpenPlaylists?.();
                }}
                className="px-3 py-1 bg-[#252934] hover:bg-[#2f3442] text-white rounded-lg transition"
              >
                Open Full Playlist Manager
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
