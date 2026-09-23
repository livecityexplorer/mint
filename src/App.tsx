import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { EpgGrid } from './components/EpgGrid';
import { VideoPlayer } from './components/VideoPlayer';
import { PlaylistManager } from './components/PlaylistManager';
import { VodBrowser } from './components/VodBrowser';
import { DebPackageModal } from './components/DebPackageModal';
import { SettingsModal } from './components/SettingsModal';
import { ProgramDetailModal } from './components/ProgramDetailModal';
import { Channel, EpgProgram, ActiveTab, PlayerSettings, VodItem, ParsedPlaylistResult, EpgSourceInfo, RecentlyWatchedItem } from './types';
import { INITIAL_CHANNELS, generateScheduleForChannel } from './data/sampleChannels';
import { SAMPLE_MOVIES, SAMPLE_SERIES } from './data/sampleVod';
import { idbGet, idbSet, idbClearAll, getRecentlyWatched, saveRecentlyWatched, removeRecentlyWatched, clearRecentlyWatched } from './utils/db';
import { normalizeGroupName } from './utils/m3uParser';
import { fetchDefaultEpg, matchChannelsWithEpg } from './services/epgService';

const STORAGE_SETTINGS_KEY = 'mint_iptv_settings_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('epg');
  const [isPipActive, setIsPipActive] = useState(false);
  const [lastNonPlayerTab, setLastNonPlayerTab] = useState<ActiveTab>('epg');
  
  // Live Channels state (starts with initial sample, then loads saved from IndexedDB)
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);

  // VOD Movies state
  const [movies, setMovies] = useState<VodItem[]>(SAMPLE_MOVIES);

  // TV Series state
  const [series, setSeries] = useState<VodItem[]>(SAMPLE_SERIES);

  // Recently Watched streams state (persisted to IndexedDB)
  const [recentlyWatched, setRecentlyWatched] = useState<RecentlyWatchedItem[]>([]);

  const [currentChannel, setCurrentChannel] = useState<Channel | null>(() => {
    return INITIAL_CHANNELS[0] || null;
  });

  const [schedules, setSchedules] = useState<Record<string, EpgProgram[]>>({});
  const [epgSourceInfo, setEpgSourceInfo] = useState<EpgSourceInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [inspectedModalData, setInspectedModalData] = useState<{ program: EpgProgram; channel: Channel } | null>(null);

  const [settings, setSettings] = useState<PlayerSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      useProxy: true,
      aspectRatio: '16:9',
      bufferLength: 60,
      hardwareAcceleration: true,
      theme: 'mint-dark',
      volume: 0.8,
      muted: false,
    };
  });

  // Load saved playlists from IndexedDB on startup
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const savedChannels = await idbGet<Channel[]>('channels', 'saved_channels');
        if (isMounted && savedChannels && Array.isArray(savedChannels) && savedChannels.length > 0) {
          setChannels(savedChannels);
          setCurrentChannel(savedChannels[0]);
        }
        const savedMovies = await idbGet<VodItem[]>('movies', 'saved_movies');
        if (isMounted && savedMovies && Array.isArray(savedMovies) && savedMovies.length > 0) {
          setMovies(savedMovies);
        }
        const savedSeries = await idbGet<VodItem[]>('series', 'saved_series');
        if (isMounted && savedSeries && Array.isArray(savedSeries) && savedSeries.length > 0) {
          setSeries(savedSeries);
        }
        const savedRecent = await getRecentlyWatched();
        if (isMounted && savedRecent && Array.isArray(savedRecent) && savedRecent.length > 0) {
          setRecentlyWatched(savedRecent);
        }
      } catch (err) {
        console.warn('Could not restore from IndexedDB:', err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch real XMLTV EPG data in background on initial load
  useEffect(() => {
    let isMounted = true;
    const loadInitialEpg = async () => {
      try {
        const defaultPayload = await fetchDefaultEpg();
        if (isMounted && defaultPayload && defaultPayload.totalPrograms > 0) {
          const { schedules: matchedSch, matchedCount } = matchChannelsWithEpg(channels, defaultPayload);
          if (Object.keys(matchedSch).length > 0) {
            setSchedules((prev) => ({ ...prev, ...matchedSch }));
            setEpgSourceInfo({
              sourceUrl: defaultPayload.sourceUrl || 'Global XMLTV Live Guide',
              lastUpdated: new Date(),
              totalChannels: defaultPayload.channelCount,
              totalPrograms: defaultPayload.totalPrograms,
            });
          }
        }
      } catch (e) {
        console.warn('Initial EPG background sync note:', e);
      }
    };

    loadInitialEpg();
    return () => {
      isMounted = false;
    };
  }, [channels.length]);

  // Handler to update schedules from PlaylistManager or EpgGrid
  const handleUpdateSchedules = (
    newSchedules: Record<string, EpgProgram[]>, 
    info?: { sourceName: string; totalPrograms: number }
  ) => {
    setSchedules((prev) => ({ ...prev, ...newSchedules }));
    if (info) {
      setEpgSourceInfo({
        sourceUrl: info.sourceName,
        lastUpdated: new Date(),
        totalChannels: Object.keys(newSchedules).length,
        totalPrograms: info.totalPrograms,
      });
    }
  };

  // Save settings to localStorage (settings is tiny ~100 bytes, so safe in localStorage)
  const updateSettings = (partial: Partial<PlayerSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Distinct channel groups & counts
  const { allGroups, groupCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    let favCount = 0;
    for (let i = 0; i < channels.length; i++) {
      const c = channels[i];
      const g = normalizeGroupName(c.group || 'General');
      counts[g] = (counts[g] || 0) + 1;
      if (c.isFavorite) favCount++;
    }
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return {
      allGroups: ['All', 'Favorites', ...sorted],
      groupCounts: { All: channels.length, Favorites: favCount, ...counts }
    };
  }, [channels]);

  // Filter channels based on search query (fast memoized search)
  const displayedChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const q = searchQuery.toLowerCase().trim();
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.group && c.group.toLowerCase().includes(q)) ||
        (c.tvgId && c.tvgId.toLowerCase().includes(q))
    );
  }, [channels, searchQuery]);

  // Favorite toggle handler with async persistence
  const handleToggleFavorite = (channelId: string) => {
    setChannels((prev) => {
      const updated = prev.map((c) => (c.id === channelId ? { ...c, isFavorite: !c.isFavorite } : c));
      idbSet('channels', 'saved_channels', updated).catch(() => {});
      return updated;
    });
  };

  // Tab navigation handler with PiP sync
  const handleTabChange = (newTab: ActiveTab) => {
    if (newTab !== 'player') {
      setLastNonPlayerTab(newTab);
    } else {
      setIsPipActive(false);
    }
    setActiveTab(newTab);
  };

  // Picture-in-Picture mode handlers
  const handleTogglePip = () => {
    if (isPipActive) {
      setIsPipActive(false);
      setActiveTab('player');
    } else {
      setIsPipActive(true);
      setActiveTab(lastNonPlayerTab || 'epg');
    }
  };

  const handleExpandPip = () => {
    setIsPipActive(false);
    setActiveTab('player');
  };

  const handleClosePip = () => {
    setIsPipActive(false);
  };

  // Select channel to watch
  const handleSelectChannel = (channel: Channel) => {
    setCurrentChannel(channel);
    // Persist to IndexedDB Recently Watched
    saveRecentlyWatched(channel, channel.currentProgram?.title, channel.currentProgram?.category).then((updated) => {
      if (updated && updated.length > 0) {
        setRecentlyWatched(updated);
      }
    });
    if (!isPipActive) {
      setActiveTab('player');
    }
  };

  // Play VOD media (Movie or Series episode)
  const handlePlayVodMedia = (mediaChannel: Channel) => {
    setCurrentChannel(mediaChannel);
    saveRecentlyWatched(mediaChannel, mediaChannel.currentProgram?.title || mediaChannel.name, mediaChannel.group).then((updated) => {
      if (updated && updated.length > 0) {
        setRecentlyWatched(updated);
      }
    });
    if (!isPipActive) {
      setActiveTab('player');
    }
  };

  // Remove individual channel from recents
  const handleRemoveRecentlyWatched = async (channelId: string) => {
    const updated = await removeRecentlyWatched(channelId);
    setRecentlyWatched(updated);
  };

  // Clear all recently watched channels
  const handleClearRecentlyWatched = async () => {
    await clearRecentlyWatched();
    setRecentlyWatched([]);
  };

  // Select program to view details
  const handleSelectProgram = (program: EpgProgram, channel: Channel) => {
    setInspectedModalData({ program, channel });
  };

  // Restore defaults
  const handleRestoreDefaults = async () => {
    await idbClearAll();
    setRecentlyWatched([]);
    setChannels(INITIAL_CHANNELS);
    setMovies(SAMPLE_MOVIES);
    setSeries(SAMPLE_SERIES);
    setCurrentChannel(INITIAL_CHANNELS[0]);
    setSelectedCategory('All');
    setSearchQuery('');
  };

  // Full playlist data loaded via M3U / XC (Channels + Movies + Series)
  const handleLoadFullPlaylistData = (result: ParsedPlaylistResult) => {
    setSelectedCategory('All');
    setSearchQuery('');

    if (result.channels && result.channels.length > 0) {
      setChannels(result.channels);
      setCurrentChannel(result.channels[0]);
      idbSet('channels', 'saved_channels', result.channels).catch(() => {});

      // Seed continuous schedules for newly loaded channels if not present
      const freshScheds: Record<string, EpgProgram[]> = {};
      result.channels.forEach((ch) => {
        freshScheds[ch.id] = generateScheduleForChannel(ch);
      });
      setSchedules((prev) => ({ ...freshScheds, ...prev }));
    }
    if (result.movies && result.movies.length > 0) {
      setMovies(result.movies);
      idbSet('movies', 'saved_movies', result.movies).catch(() => {});
    }
    if (result.series && result.series.length > 0) {
      setSeries(result.series);
      idbSet('series', 'saved_series', result.series).catch(() => {});
    }

    // Auto-navigate to the loaded content
    if (result.channels && result.channels.length > 0) {
      setActiveTab('epg');
    } else if (result.movies && result.movies.length > 0) {
      setActiveTab('movies');
    } else if (result.series && result.series.length > 0) {
      setActiveTab('series');
    }
  };

  // Callback for live channels
  const handleLoadCustomChannels = (newChannels: Channel[]) => {
    if (newChannels.length > 0) {
      setChannels(newChannels);
      setCurrentChannel(newChannels[0]);
      setSelectedCategory('All');
      setSearchQuery('');
      idbSet('channels', 'saved_channels', newChannels).catch(() => {});

      // Seed schedules for new channels
      const freshScheds: Record<string, EpgProgram[]> = {};
      newChannels.forEach((ch) => {
        freshScheds[ch.id] = generateScheduleForChannel(ch);
      });
      setSchedules((prev) => ({ ...freshScheds, ...prev }));

      setActiveTab('epg');
    }
  };

  // Update channels state and IndexedDB cache
  const handleUpdateChannels = (updatedChannels: Channel[]) => {
    setChannels(updatedChannels);
    idbSet('channels', 'saved_channels', updatedChannels).catch(() => {});
  };

  const handleResetAllData = async () => {
    try {
      localStorage.clear();
      await idbClearAll();
    } catch {}
    setChannels(INITIAL_CHANNELS);
    setMovies(SAMPLE_MOVIES);
    setSeries(SAMPLE_SERIES);
    setCurrentChannel(INITIAL_CHANNELS[0]);
    setSelectedCategory('All');
    setSearchQuery('');
    setSettings({
      useProxy: true,
      aspectRatio: '16:9',
      bufferLength: 60,
      hardwareAcceleration: true,
      theme: 'mint-dark',
      volume: 0.8,
      muted: false,
    });
    setIsSettingsOpen(false);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#121316] text-[#e3e5e8] font-sans">
      {/* Titlebar & Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDebModal={() => setActiveTab('package')}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        channelCount={channels.length}
        moviesCount={movies.length}
        seriesCount={series.length}
        currentChannelName={currentChannel?.name}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        groups={allGroups}
        groupCounts={groupCounts}
        isPipActive={isPipActive}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'epg' && (
          <EpgGrid
            channels={displayedChannels}
            schedules={schedules}
            currentChannel={currentChannel}
            onSelectChannel={handleSelectChannel}
            onSelectProgram={handleSelectProgram}
            onToggleFavorite={handleToggleFavorite}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            onOpenPlaylists={() => setActiveTab('playlists')}
            epgSourceInfo={epgSourceInfo}
            recentlyWatched={recentlyWatched}
            onRemoveRecentlyWatched={handleRemoveRecentlyWatched}
            onClearRecentlyWatched={handleClearRecentlyWatched}
            onUpdateChannels={handleUpdateChannels}
            onUpdateSchedules={handleUpdateSchedules}
          />
        )}

        {activeTab === 'player' && (
          <VideoPlayer
            channel={currentChannel}
            channels={displayedChannels}
            schedules={schedules}
            onSelectChannel={handleSelectChannel}
            onToggleFavorite={handleToggleFavorite}
            settings={settings}
            updateSettings={updateSettings}
            isPip={false}
            onTogglePip={handleTogglePip}
            onClosePip={handleClosePip}
            onExpandFromPip={handleExpandPip}
            onUpdateSchedules={handleUpdateSchedules}
          />
        )}

        {activeTab === 'movies' && (
          <VodBrowser
            type="movie"
            items={movies}
            settings={settings}
            onPlayMedia={handlePlayVodMedia}
            onOpenPlaylists={() => setActiveTab('playlists')}
          />
        )}

        {activeTab === 'series' && (
          <VodBrowser
            type="series"
            items={series}
            settings={settings}
            onPlayMedia={handlePlayVodMedia}
            onOpenPlaylists={() => setActiveTab('playlists')}
          />
        )}

        {activeTab === 'playlists' && (
          <PlaylistManager
            channels={channels}
            setChannels={setChannels}
            movies={movies}
            series={series}
            onLoadCustomChannels={handleLoadCustomChannels}
            onLoadFullPlaylistData={handleLoadFullPlaylistData}
            onRestoreDefaults={handleRestoreDefaults}
            schedules={schedules}
            onUpdateSchedules={handleUpdateSchedules}
            epgSourceInfo={epgSourceInfo}
          />
        )}

        {activeTab === 'package' && (
          <DebPackageModal />
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateSettings={updateSettings}
        onResetAllData={handleResetAllData}
      />

      {/* Program Detail Modal */}
      {inspectedModalData && (
        <ProgramDetailModal
          program={inspectedModalData.program}
          channel={inspectedModalData.channel}
          onClose={() => setInspectedModalData(null)}
          onWatchChannel={handleSelectChannel}
        />
      )}

      {/* Floating Picture-in-Picture Mini-Player when navigating other tabs */}
      {isPipActive && activeTab !== 'player' && currentChannel && (
        <aside
          id="pip-floating-container"
          aria-label="Picture in Picture Player"
          className="fixed bottom-5 right-5 z-50 w-72 sm:w-80 md:w-96 aspect-video rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 bg-black hover:border-[#87cf3e]/60 transition-all ring-2 ring-black/80"
        >
          <VideoPlayer
            channel={currentChannel}
            channels={displayedChannels}
            schedules={schedules}
            onSelectChannel={handleSelectChannel}
            onToggleFavorite={handleToggleFavorite}
            settings={settings}
            updateSettings={updateSettings}
            isPip={true}
            onTogglePip={handleTogglePip}
            onClosePip={handleClosePip}
            onExpandFromPip={handleExpandPip}
            onUpdateSchedules={handleUpdateSchedules}
          />
        </aside>
      )}
    </div>
  );
}

