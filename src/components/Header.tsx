import React, { useState, useEffect } from 'react';
import { 
  Tv, 
  CalendarDays, 
  ListMusic, 
  Download, 
  Settings, 
  Maximize2, 
  Minimize2, 
  Search, 
  Radio,
  SlidersHorizontal,
  X,
  Minus,
  Square,
  Plus,
  Film,
  Clapperboard
} from 'lucide-react';
import { ActiveTab } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onOpenSettings: () => void;
  onOpenDebModal: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  channelCount: number;
  moviesCount?: number;
  seriesCount?: number;
  currentChannelName?: string;
  selectedCategory?: string;
  setSelectedCategory?: (category: string) => void;
  groups?: string[];
  groupCounts?: Record<string, number>;
  isPipActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenSettings,
  onOpenDebModal,
  searchQuery,
  setSearchQuery,
  channelCount,
  moviesCount = 0,
  seriesCount = 0,
  currentChannelName,
  selectedCategory = 'All',
  setSelectedCategory,
  groups = ['All'],
  groupCounts = {},
  isPipActive = false,
}) => {
  const [time, setTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(!!fsEl);
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        (document.documentElement as any).webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  };

  return (
    <header className="bg-[#181a1f] border-b border-[#2a2d35] select-none flex-shrink-0 z-30 shadow-md">
      {/* Top Cinnamon-style desktop titlebar */}
      <div className="h-8 px-3 bg-[#131518] flex items-center justify-between border-b border-[#22252c] text-xs text-[#8c919c]">
        {/* Left Mint branding */}
        <div className="flex items-center space-x-2">
          {/* Linux Mint Leaf Graphic */}
          <div className="w-4 h-4 rounded-full bg-[#87cf3e]/20 border border-[#87cf3e]/50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-tl-full rounded-br-full bg-[#87cf3e]" />
          </div>
          <span className="font-medium text-[#c6cbcf] tracking-wide">Mint IPTV Player</span>
          <span className="text-[#555a65]">|</span>
          <span className="text-[#6d727e] hidden sm:inline">Linux Mint Edition • Cinnamon Integration</span>
          {currentChannelName && (
            <>
              <span className="text-[#555a65]">|</span>
              <span className="text-[#87cf3e] truncate max-w-xs font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#87cf3e] animate-pulse" />
                {currentChannelName}
              </span>
            </>
          )}
        </div>

        {/* Right Cinnamon Desktop Window Controls */}
        <div className="flex items-center space-x-3">
          <span className="text-[#646975] font-mono hidden md:inline">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <div className="flex items-center space-x-1 pl-2 border-l border-[#272a32]">
            <button 
              title="Minimize" 
              className="w-5 h-5 rounded hover:bg-[#2b2e37] flex items-center justify-center text-[#7d828f] hover:text-[#e3e5e8] transition"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button 
              onClick={toggleFullscreen}
              title="Maximize / Restore" 
              className="w-5 h-5 rounded hover:bg-[#2b2e37] flex items-center justify-center text-[#7d828f] hover:text-[#e3e5e8] transition"
            >
              <Square className="w-2.5 h-2.5" />
            </button>
            <button 
              title="Close" 
              className="w-5 h-5 rounded hover:bg-[#e03131] flex items-center justify-center text-[#7d828f] hover:text-white transition"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Main navigation toolbar */}
      <div className="h-14 px-4 flex items-center justify-between gap-3 overflow-x-auto">
        {/* Navigation Tabs (TiviMate & Smarters style) */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            id="nav-tab-epg"
            onClick={() => setActiveTab('epg')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'epg'
                ? 'bg-[#87cf3e] text-[#121316] font-semibold shadow-sm shadow-[#87cf3e]/20'
                : 'text-[#a2a7b2] hover:text-[#e3e5e8] hover:bg-[#252830]'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            <span>TV Guide</span>
          </button>

          <button
            id="nav-tab-player"
            onClick={() => setActiveTab('player')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'player'
                ? 'bg-[#87cf3e] text-[#121316] font-semibold shadow-sm shadow-[#87cf3e]/20'
                : 'text-[#a2a7b2] hover:text-[#e3e5e8] hover:bg-[#252830]'
            }`}
          >
            <Tv className="w-4 h-4" />
            <span>Live Player</span>
            {isPipActive && (
              <span className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-full bg-[#87cf3e]/20 text-[#87cf3e] text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#87cf3e] animate-pulse" />
                PiP
              </span>
            )}
          </button>

          {/* VOD Movies Tab */}
          <button
            id="nav-tab-movies"
            onClick={() => setActiveTab('movies')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'movies'
                ? 'bg-[#87cf3e] text-[#121316] font-semibold shadow-sm shadow-[#87cf3e]/20'
                : 'text-[#a2a7b2] hover:text-[#e3e5e8] hover:bg-[#252830]'
            }`}
          >
            <Film className="w-4 h-4" />
            <span>Movies</span>
            {moviesCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-[#1e2026] text-[#8c92a0] border border-[#2d3039]">
                {moviesCount}
              </span>
            )}
          </button>

          {/* TV Shows / Series Tab */}
          <button
            id="nav-tab-series"
            onClick={() => setActiveTab('series')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'series'
                ? 'bg-[#87cf3e] text-[#121316] font-semibold shadow-sm shadow-[#87cf3e]/20'
                : 'text-[#a2a7b2] hover:text-[#e3e5e8] hover:bg-[#252830]'
            }`}
          >
            <Clapperboard className="w-4 h-4" />
            <span>Series</span>
            {seriesCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-[#1e2026] text-[#8c92a0] border border-[#2d3039]">
                {seriesCount}
              </span>
            )}
          </button>

          <button
            id="nav-tab-playlists"
            onClick={() => setActiveTab('playlists')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === 'playlists'
                ? 'bg-[#87cf3e] text-[#121316] font-semibold shadow-sm shadow-[#87cf3e]/20'
                : 'text-[#a2a7b2] hover:text-[#e3e5e8] hover:bg-[#252830]'
            }`}
          >
            <ListMusic className="w-4 h-4" />
            <span>Playlists & XC</span>
            <span className="ml-0.5 text-xs px-1.5 py-0.2 rounded-full bg-[#1e2026] text-[#8c92a0] border border-[#2d3039]">
              {channelCount}
            </span>
          </button>

          {/* Direct quick action for M3U & XC */}
          <button
            id="nav-btn-quick-add-xc"
            onClick={() => setActiveTab('playlists')}
            title="Import M3U Playlist or Xtream Codes (XC) Login"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#87cf3e]/15 hover:bg-[#87cf3e] text-[#87cf3e] hover:text-[#121316] border border-[#87cf3e]/40 transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add M3U / XC</span>
          </button>

          {/* Linux Mint .deb installer button */}
          <button
            id="nav-tab-package"
            onClick={() => setActiveTab('package')}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
              activeTab === 'package'
                ? 'bg-[#87cf3e] border-[#87cf3e] text-[#121316] font-semibold shadow-sm'
                : 'border-[#87cf3e]/40 bg-[#87cf3e]/10 text-[#a3e461] hover:bg-[#87cf3e]/20'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-inherit" />
            <span>Linux .deb</span>
          </button>
        </div>

        {/* Center/Right Search Bar & Controls */}
        <div className="flex items-center space-x-2.5 flex-shrink-0">
          {/* Group Filter Dropdown */}
          {setSelectedCategory && groups && groups.length > 1 && (
            <div className="flex items-center space-x-1.5 bg-[#141519] border border-[#2b2e37] rounded-md px-2.5 py-1 text-xs text-[#a2a7b2]">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#87cf3e]" />
              <span className="text-[11px] text-[#6d7280] hidden lg:inline">Group:</span>
              <select
                id="header-select-group-dropdown"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-transparent text-[#e3e5e8] font-semibold focus:outline-none cursor-pointer text-xs max-w-[140px] truncate"
              >
                <option value="All" className="bg-[#1e2129]">
                  All Groups ({channelCount})
                </option>
                <option value="Favorites" className="bg-[#1e2129]">
                  ★ Favorites ({groupCounts['Favorites'] || 0})
                </option>
                {groups.filter(g => g !== 'All' && g !== 'Favorites').map((g) => (
                  <option key={g} value={g} className="bg-[#1e2129]">
                    {g} ({groupCounts[g] || 0})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Channel search input */}
          <div className="relative w-40 md:w-52">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#656a77]" />
            <input
              id="search-channels-input"
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1 bg-[#141519] border border-[#2b2e37] rounded-md text-xs text-[#e3e5e8] placeholder-[#5c616d] focus:outline-none focus:border-[#87cf3e] focus:ring-1 focus:ring-[#87cf3e] transition"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#717684] hover:text-[#c4c7cf]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Settings button */}
          <button
            id="btn-settings"
            onClick={onOpenSettings}
            title="Player & Stream Settings"
            className="p-1.5 rounded-md text-[#9ca1af] hover:text-[#e3e5e8] hover:bg-[#252830] transition border border-[#2b2e37]"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Fullscreen toggle */}
          <button
            id="btn-fullscreen-toggle"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            className="p-1.5 rounded-md text-[#9ca1af] hover:text-[#e3e5e8] hover:bg-[#252830] transition border border-[#2b2e37]"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
