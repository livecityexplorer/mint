import React, { useState, useMemo } from 'react';
import { 
  Server, 
  FileText, 
  Upload, 
  Download, 
  Link, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Sparkles,
  KeyRound,
  Globe,
  User,
  Tv,
  Film,
  Sliders,
  ChevronDown,
  ChevronUp,
  Search,
  Layers,
  Calendar,
  Radio,
  Check,
  Zap,
  Info
} from 'lucide-react';
import { Channel, VodItem, ParsedPlaylistResult, EpgProgram, EpgSourceInfo } from '../types';
import { parseM3UPlaylist, parseM3U, normalizeGroupName } from '../utils/m3uParser';
import { ChannelLogo } from './ChannelLogo';
import { enrichChannelsWithLogos } from '../services/logoService';
import { 
  fetchEpgFromUrl, 
  fetchDefaultEpg, 
  fetchXtreamEpg, 
  matchChannelsWithEpg, 
  parseLocalXmltv 
} from '../services/epgService';

interface PlaylistManagerProps {
  channels: Channel[];
  setChannels?: React.Dispatch<React.SetStateAction<Channel[]>>;
  movies?: VodItem[];
  series?: VodItem[];
  onLoadCustomChannels: (newChannels: Channel[]) => void;
  onLoadFullPlaylistData?: (result: ParsedPlaylistResult) => void;
  onRestoreDefaults: () => void;
  schedules?: Record<string, EpgProgram[]>;
  onUpdateSchedules?: (schedules: Record<string, EpgProgram[]>, info?: { sourceName: string; totalPrograms: number }) => void;
  epgSourceInfo?: EpgSourceInfo | null;
}

const UA_PRESETS: Record<string, { label: string; value: string }> = {
  default: { label: 'Default (Mint IPTV)', value: '' },
  smarters: { label: 'IPTV Smarters Pro', value: 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)' },
  vlc: { label: 'VLC Media Player', value: 'VLC/3.0.18 LibVLC/3.0.18' },
  tivimate: { label: 'TiviMate IPTV', value: 'TiviMate/4.7.0 (Android TV)' },
  exoplayer: { label: 'ExoPlayer Android', value: 'ExoPlayerLib/2.18.7 (Linux; Android 12)' },
  custom: { label: 'Custom User-Agent', value: '' },
};

const EPG_PRESETS = [
  { label: '🇺🇸 United States (US Free XMLTV)', url: 'https://epg.pw/xmltv/epg_US.xml.gz', country: 'US' },
  { label: '🇬🇧 United Kingdom (UK Free XMLTV)', url: 'https://epg.pw/xmltv/epg_UK.xml.gz', country: 'UK' },
  { label: '🇫🇷 France & Europe (Euronews, FR Channels)', url: 'https://epg.pw/xmltv/epg_FR.xml.gz', country: 'FR' },
  { label: '🇩🇪 Germany (DE Free XMLTV)', url: 'https://epg.pw/xmltv/epg_DE.xml.gz', country: 'DE' },
  { label: '🇪🇸 Spain (ES Free XMLTV)', url: 'https://epg.pw/xmltv/epg_ES.xml.gz', country: 'ES' },
  { label: '🇮🇹 Italy (IT Free XMLTV)', url: 'https://epg.pw/xmltv/epg_IT.xml.gz', country: 'IT' },
  { label: '🇨🇦 Canada (CA Free XMLTV)', url: 'https://epg.pw/xmltv/epg_CA.xml.gz', country: 'CA' },
  { label: '🇦🇺 Australia (AU Free XMLTV)', url: 'https://epg.pw/xmltv/epg_AU.xml.gz', country: 'AU' },
  { label: '🌍 Global Multi-Source Guide', url: 'https://epg.pw/xmltv/epg_ALL.xml.gz', country: 'ALL' },
];

export const PlaylistManager: React.FC<PlaylistManagerProps> = ({
  channels,
  setChannels,
  movies = [],
  series = [],
  onLoadCustomChannels,
  onLoadFullPlaylistData,
  onRestoreDefaults,
  schedules = {},
  onUpdateSchedules,
  epgSourceInfo,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'xc' | 'm3u' | 'epg' | 'curated'>('xc');
  
  // Xtream Codes state
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnectingXc, setIsConnectingXc] = useState(false);
  const [xcStatus, setXcStatus] = useState<{ success: boolean; message: string; details?: any } | null>(null);

  // M3U state
  const [m3uUrl, setM3uUrl] = useState('');
  const [m3uText, setM3uText] = useState('');
  const [isLoadingM3u, setIsLoadingM3u] = useState(false);
  const [m3uFeedback, setM3uFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // M3U with options (Headers / User-Agent)
  const [showM3uOptions, setShowM3uOptions] = useState(false);
  const [selectedUaPreset, setSelectedUaPreset] = useState<string>('default');
  const [customUserAgent, setCustomUserAgent] = useState('');
  const [customReferer, setCustomReferer] = useState('');

  // EPG Tab state
  const [customEpgUrl, setCustomEpgUrl] = useState('https://epg.pw/xmltv/epg_FR.xml.gz');
  const [isLoadingEpg, setIsLoadingEpg] = useState(false);
  const [epgFeedback, setEpgFeedback] = useState<{ success: boolean; message: string; matchedCount?: number; totalPrograms?: number } | null>(null);

  // Tab 4 search filter
  const [overviewSearch, setOverviewSearch] = useState('');

  // Get active effective User-Agent
  const getEffectiveUserAgent = () => {
    if (selectedUaPreset === 'custom') return customUserAgent.trim();
    return UA_PRESETS[selectedUaPreset]?.value || '';
  };

  // Helper to sync EPG data from a URL and match against current channels
  const syncEpgUrl = async (url: string, sourceLabel?: string) => {
    setIsLoadingEpg(true);
    setEpgFeedback(null);
    try {
      const epgPayload = await fetchEpgFromUrl(url);
      const { schedules: newSchedules, matchedCount } = matchChannelsWithEpg(channels, epgPayload);
      
      // Auto-enrich channel logos with XMLTV icons if present
      let enrichedCount = 0;
      if (epgPayload.channels) {
        const xmltvIcons: Record<string, string> = {};
        Object.entries(epgPayload.channels).forEach(([chId, chData]: [string, any]) => {
          if (chData.icon) {
            xmltvIcons[chId] = chData.icon;
            if (chData.name) xmltvIcons[chData.name] = chData.icon;
          }
        });
        if (Object.keys(xmltvIcons).length > 0) {
          const res = enrichChannelsWithLogos(channels, xmltvIcons);
          enrichedCount = res.enrichedCount;
          if (enrichedCount > 0) {
            if (setChannels) setChannels(res.updatedChannels);
            onLoadCustomChannels(res.updatedChannels);
          }
        }
      }

      if (onUpdateSchedules) {
        onUpdateSchedules(newSchedules, {
          sourceName: sourceLabel || url,
          totalPrograms: epgPayload.totalPrograms,
        });
      }

      setEpgFeedback({
        success: true,
        message: `Successfully loaded ${epgPayload.totalPrograms.toLocaleString()} real broadcast programs from XMLTV guide. Mapped ${matchedCount} of ${channels.length} active channels.${enrichedCount > 0 ? ` Auto-enriched ${enrichedCount} channel logos.` : ''}`,
        matchedCount,
        totalPrograms: epgPayload.totalPrograms,
      });
    } catch (err: any) {
      console.error('EPG sync error:', err);
      setEpgFeedback({
        success: false,
        message: `Failed to load EPG feed: ${err.message}`,
      });
    } finally {
      setIsLoadingEpg(false);
    }
  };

  // Helper to sync EPG directly from Xtream Codes server
  const syncXcEpg = async (xcServerUrl: string, xcUser: string, xcPass: string, sourceLabel?: string) => {
    if (!xcServerUrl || !xcUser || !xcPass) {
      setEpgFeedback({
        success: false,
        message: 'Please provide Xtream server URL, username, and password to fetch EPG.',
      });
      return;
    }
    setIsLoadingEpg(true);
    setEpgFeedback(null);
    try {
      let cleanBase = xcServerUrl.trim().replace(/\/+$/, '');
      if (!cleanBase.startsWith('http://') && !cleanBase.startsWith('https://')) {
        cleanBase = 'http://' + cleanBase;
      }
      const epgPayload = await fetchXtreamEpg(cleanBase, xcUser.trim(), xcPass.trim());
      const { schedules: newSchedules, matchedCount } = matchChannelsWithEpg(channels, epgPayload);
      
      // Auto-enrich channel logos with XMLTV icons if present
      let enrichedCount = 0;
      if (epgPayload.channels) {
        const xmltvIcons: Record<string, string> = {};
        Object.entries(epgPayload.channels).forEach(([chId, chData]: [string, any]) => {
          if (chData.icon) {
            xmltvIcons[chId] = chData.icon;
            if (chData.name) xmltvIcons[chData.name] = chData.icon;
          }
        });
        if (Object.keys(xmltvIcons).length > 0) {
          const res = enrichChannelsWithLogos(channels, xmltvIcons);
          enrichedCount = res.enrichedCount;
          if (enrichedCount > 0) {
            if (setChannels) setChannels(res.updatedChannels);
            onLoadCustomChannels(res.updatedChannels);
          }
        }
      }

      if (onUpdateSchedules) {
        onUpdateSchedules(newSchedules, {
          sourceName: sourceLabel || `${cleanBase} (Xtream EPG)`,
          totalPrograms: epgPayload.totalPrograms,
        });
      }

      setEpgFeedback({
        success: true,
        message: `Successfully loaded ${epgPayload.totalPrograms.toLocaleString()} programs from Xtream Codes server. Mapped ${matchedCount} of ${channels.length} active channels.${enrichedCount > 0 ? ` Auto-enriched ${enrichedCount} channel logos.` : ''}`,
        matchedCount,
        totalPrograms: epgPayload.totalPrograms,
      });
    } catch (err: any) {
      console.error('XC EPG sync error:', err);
      setEpgFeedback({
        success: false,
        message: `Failed to load Xtream Codes EPG: ${err.message}`,
      });
    } finally {
      setIsLoadingEpg(false);
    }
  };

  // Handle Xtream Codes Login
  const handleXcLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl || !username || !password) {
      setXcStatus({ success: false, message: 'Please fill in server URL, username, and password.' });
      return;
    }

    setIsConnectingXc(true);
    setXcStatus(null);

    try {
      const res = await fetch('/api/xc/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, username, password }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Server rejected credentials');
      }

      const userInfo = json.data?.user_info;
      const serverInfo = json.data?.server_info;

      if (userInfo?.auth === 0) {
        throw new Error('Authentication failed: Invalid username or password.');
      }

      const cleanBase = serverUrl.trim().replace(/\/+$/, '');
      const cleanUser = username.trim();
      const cleanPass = password.trim();
      const encodedUser = encodeURIComponent(cleanUser);
      const encodedPass = encodeURIComponent(cleanPass);

      // Fetch Categories in parallel to accurately map category_id to group names
      const [liveCatsRes, vodCatsRes, seriesCatsRes] = await Promise.allSettled([
        fetch(`/api/xc/action?serverUrl=${encodeURIComponent(cleanBase)}&username=${encodedUser}&password=${encodedPass}&action=get_live_categories`),
        fetch(`/api/xc/action?serverUrl=${encodeURIComponent(cleanBase)}&username=${encodedUser}&password=${encodedPass}&action=get_vod_categories`),
        fetch(`/api/xc/action?serverUrl=${encodeURIComponent(cleanBase)}&username=${encodedUser}&password=${encodedPass}&action=get_series_categories`),
      ]);

      const liveCategoryMap: Record<string, string> = {};
      if (liveCatsRes.status === 'fulfilled' && liveCatsRes.value.ok) {
        try {
          const liveCats = await liveCatsRes.value.json();
          if (Array.isArray(liveCats)) {
            liveCats.forEach((c: any) => {
              if (c.category_id && c.category_name) {
                liveCategoryMap[String(c.category_id)] = normalizeGroupName(c.category_name);
              }
            });
          }
        } catch {}
      }

      const vodCategoryMap: Record<string, string> = {};
      if (vodCatsRes.status === 'fulfilled' && vodCatsRes.value.ok) {
        try {
          const vodCats = await vodCatsRes.value.json();
          if (Array.isArray(vodCats)) {
            vodCats.forEach((c: any) => {
              if (c.category_id && c.category_name) {
                vodCategoryMap[String(c.category_id)] = normalizeGroupName(c.category_name);
              }
            });
          }
        } catch {}
      }

      const seriesCategoryMap: Record<string, string> = {};
      if (seriesCatsRes.status === 'fulfilled' && seriesCatsRes.value.ok) {
        try {
          const seriesCats = await seriesCatsRes.value.json();
          if (Array.isArray(seriesCats)) {
            seriesCats.forEach((c: any) => {
              if (c.category_id && c.category_name) {
                seriesCategoryMap[String(c.category_id)] = normalizeGroupName(c.category_name);
              }
            });
          }
        } catch {}
      }

      // 1. Fetch ALL Live Streams
      const streamsRes = await fetch(
        `/api/xc/action?serverUrl=${encodeURIComponent(cleanBase)}&username=${encodedUser}&password=${encodedPass}&action=get_live_streams`
      );
      const streamsData = await streamsRes.json();
      
      let newChannels: Channel[] = [];
      if (Array.isArray(streamsData)) {
        newChannels = streamsData.map((item: any, idx: number) => {
          const streamId = item.stream_id;
          const streamUrl = `${cleanBase}/live/${encodedUser}/${encodedPass}/${streamId}.m3u8`;
          const rawCat = liveCategoryMap[String(item.category_id)] || item.category_name || 'Xtream Live';
          return {
            id: `xc-${streamId || idx}`,
            name: item.name || `XC Channel ${idx + 1}`,
            num: idx + 1,
            group: normalizeGroupName(rawCat),
            logo: item.stream_icon || '',
            tvgLogo: item.stream_icon || '',
            streamUrl,
            streamId,
            tvgId: item.epg_channel_id || String(streamId) || `xc.${streamId}`,
            isFavorite: false,
            xcDetails: {
              serverUrl: cleanBase,
              username: cleanUser,
              password: cleanPass,
              streamId,
            },
          };
        });
      }

      // 2. Fetch VOD Movies
      let newMovies: VodItem[] = [];
      try {
        const vodRes = await fetch(
          `/api/xc/action?serverUrl=${encodeURIComponent(cleanBase)}&username=${encodedUser}&password=${encodedPass}&action=get_vod_streams`
        );
        const vodData = await vodRes.json();
        if (Array.isArray(vodData)) {
          newMovies = vodData.map((item: any, idx: number) => {
            const rawCat = vodCategoryMap[String(item.category_id)] || item.category_name || 'Movies';
            const group = normalizeGroupName(rawCat);
            const ext = item.container_extension || 'mp4';
            return {
              id: `xc-movie-${item.stream_id || idx}`,
              streamId: item.stream_id,
              name: item.name || `Movie ${idx + 1}`,
              title: item.name || `Movie ${idx + 1}`,
              streamUrl: `${cleanBase}/movie/${encodedUser}/${encodedPass}/${item.stream_id}.${ext}`,
              group,
              categoryName: group,
              poster: item.stream_icon || '',
              backdrop: item.stream_icon || '',
              rating: item.rating ? String(item.rating) : '7.5',
              year: item.year ? String(item.year) : undefined,
              type: 'movie' as const,
              plot: item.plot || 'Xtream Codes on-demand feature film.',
              containerExtension: ext,
            };
          });
        }
      } catch (err) {
        console.warn('VOD fetch warning:', err);
      }

      // 3. Fetch TV Series
      let newSeries: VodItem[] = [];
      try {
        const seriesRes = await fetch(
          `/api/xc/action?serverUrl=${encodeURIComponent(cleanBase)}&username=${encodedUser}&password=${encodedPass}&action=get_series`
        );
        const seriesData = await seriesRes.json();
        if (Array.isArray(seriesData)) {
          newSeries = seriesData.map((item: any, idx: number) => {
            const rawCat = seriesCategoryMap[String(item.category_id)] || item.category_name || 'Series';
            const group = normalizeGroupName(rawCat);
            return {
              id: `xc-series-${item.series_id || idx}`,
              seriesId: item.series_id,
              name: item.name || `Series ${idx + 1}`,
              title: item.name || `Series ${idx + 1}`,
              streamUrl: `${cleanBase}/series/${encodedUser}/${encodedPass}/${item.series_id}`,
              group,
              categoryName: group,
              poster: item.cover || '',
              backdrop: item.backdrop_path?.[0] || item.cover || '',
              rating: item.rating ? String(item.rating) : '8.0',
              year: item.releaseDate ? item.releaseDate.slice(0, 4) : undefined,
              type: 'series' as const,
              plot: item.plot || 'Xtream Codes television series.',
              seasonsCount: 1,
              xcDetails: {
                serverUrl: cleanBase,
                username: cleanUser,
                password: cleanPass,
                seriesId: item.series_id,
              },
            };
          });
        }
      } catch (err) {
        console.warn('Series fetch warning:', err);
      }

      // Enrich channels with logos
      const enrichedChannels = enrichChannelsWithLogos(newChannels).updatedChannels;

      // Apply to app state
      if (onLoadFullPlaylistData) {
        onLoadFullPlaylistData({
          channels: enrichedChannels,
          movies: newMovies,
          series: newSeries,
        });
      }
      if (setChannels) {
        setChannels(enrichedChannels);
      }
      onLoadCustomChannels(enrichedChannels);

      // 4. Automatically trigger Xtream EPG fetching in the background
      fetchXtreamEpg(cleanBase, cleanUser, cleanPass)
        .then((xcEpg) => {
          if (xcEpg && xcEpg.totalPrograms > 0) {
            const { schedules: xcSch, matchedCount } = matchChannelsWithEpg(enrichedChannels, xcEpg);
            if (onUpdateSchedules) {
              onUpdateSchedules(xcSch, {
                sourceName: `${serverInfo?.server_name || 'Xtream'} XMLTV EPG`,
                totalPrograms: xcEpg.totalPrograms,
              });
            }
          }
        })
        .catch((e) => console.warn('Background Xtream EPG sync note:', e.message));

      setXcStatus({
        success: true,
        message: `Connected! Loaded ${newChannels.length} Live Channels, ${newMovies.length} VOD Movies, and ${newSeries.length} TV Series from ${serverInfo?.url || serverUrl}.`,
        details: {
          status: userInfo?.status || 'Active',
          expDate: userInfo?.exp_date ? new Date(parseInt(userInfo.exp_date, 10) * 1000).toLocaleDateString() : 'Unlimited',
          activeCons: `${userInfo?.active_cons || 0} / ${userInfo?.max_connections || 1}`,
          serverName: serverInfo?.server_name || 'Xtream Server',
          liveCount: newChannels.length,
          movieCount: newMovies.length,
          seriesCount: newSeries.length,
        }
      });
    } catch (err: any) {
      setXcStatus({
        success: false,
        message: `Connection failed: ${err.message}`,
      });
    } finally {
      setIsConnectingXc(false);
    }
  };

  // Handle M3U URL load with options
  const handleLoadM3uUrl = async () => {
    if (!m3uUrl.trim()) {
      setM3uFeedback({ success: false, message: 'Please enter an M3U playlist URL.' });
      return;
    }

    setIsLoadingM3u(true);
    setM3uFeedback(null);

    try {
      const effectiveUa = getEffectiveUserAgent();
      const effectiveRef = customReferer.trim();

      const queryParams = new URLSearchParams({
        url: m3uUrl.trim(),
      });
      if (effectiveUa) queryParams.set('userAgent', effectiveUa);
      if (effectiveRef) queryParams.set('referer', effectiveRef);

      const proxyUrl = `/api/proxy?${queryParams.toString()}`;
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status} (${response.statusText})`);
      }

      const text = await response.text();
      const result = parseM3UPlaylist(text, {
        userAgent: effectiveUa,
        referer: effectiveRef,
      });

      if (result.channels.length === 0 && result.movies.length === 0 && result.series.length === 0) {
        throw new Error('No valid streams found in playlist. Check file syntax (#EXTM3U).');
      }

      const baseChannels = result.channels.length > 0 ? result.channels : parseM3U(text);
      const enrichedChannels = enrichChannelsWithLogos(baseChannels).updatedChannels;

      if (onLoadFullPlaylistData) {
        onLoadFullPlaylistData({
          ...result,
          channels: enrichedChannels,
        });
      }
      if (setChannels) {
        setChannels(enrichedChannels);
      }
      onLoadCustomChannels(enrichedChannels);

      // Auto-fetch EPG if declared in header
      if (result.epgUrls && result.epgUrls.length > 0) {
        syncEpgUrl(result.epgUrls[0], 'M3U Header EPG');
      }

      setM3uFeedback({
        success: true,
        message: `Successfully loaded ${enrichedChannels.length} Live channels, ${result.movies.length} Movies, and ${result.series.length} TV Series.${result.epgUrls?.length ? ' Auto-syncing TV guide from header.' : ''}`,
      });
    } catch (err: any) {
      setM3uFeedback({
        success: false,
        message: `Failed to load M3U: ${err.message}`,
      });
    } finally {
      setIsLoadingM3u(false);
    }
  };

  // Handle Local M3U File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const effectiveUa = getEffectiveUserAgent();
        const effectiveRef = customReferer.trim();

        const result = parseM3UPlaylist(text, {
          userAgent: effectiveUa,
          referer: effectiveRef,
        });

        if (result.channels.length === 0 && result.movies.length === 0 && result.series.length === 0) {
          setM3uFeedback({ success: false, message: 'No valid channels or VOD streams found in file.' });
          return;
        }

        const baseChannels = result.channels.length > 0 ? result.channels : parseM3U(text);
        const enrichedChannels = enrichChannelsWithLogos(baseChannels).updatedChannels;

        if (onLoadFullPlaylistData) {
          onLoadFullPlaylistData({
            ...result,
            channels: enrichedChannels,
          });
        }
        if (setChannels) {
          setChannels(enrichedChannels);
        }
        onLoadCustomChannels(enrichedChannels);

        if (result.epgUrls && result.epgUrls.length > 0) {
          syncEpgUrl(result.epgUrls[0], 'M3U File Header EPG');
        }

        setM3uFeedback({
          success: true,
          message: `Successfully imported ${enrichedChannels.length} Live channels, ${result.movies.length} Movies, and ${result.series.length} Series from ${file.name}.`,
        });
      } catch (err: any) {
        setM3uFeedback({ success: false, message: `File parsing error: ${err.message}` });
      }
    };
    reader.readAsText(file);
  };

  // Handle Local XMLTV File Upload
  const handleXmltvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingEpg(true);
    setEpgFeedback(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/epg/parse-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to parse XML file`);
      const payload = await res.json();
      const { schedules: newSchedules, matchedCount } = matchChannelsWithEpg(channels, payload);
      
      // Auto-enrich logos if XMLTV includes channel icon elements
      let enrichedCount = 0;
      if (payload.channels) {
        const xmltvIcons: Record<string, string> = {};
        Object.entries(payload.channels).forEach(([chId, chData]: [string, any]) => {
          if (chData.icon) {
            xmltvIcons[chId] = chData.icon;
            if (chData.name) xmltvIcons[chData.name] = chData.icon;
          }
        });
        if (Object.keys(xmltvIcons).length > 0) {
          const enrichRes = enrichChannelsWithLogos(channels, xmltvIcons);
          enrichedCount = enrichRes.enrichedCount;
          if (enrichedCount > 0) {
            if (setChannels) setChannels(enrichRes.updatedChannels);
            onLoadCustomChannels(enrichRes.updatedChannels);
          }
        }
      }

      if (onUpdateSchedules) {
        onUpdateSchedules(newSchedules, {
          sourceName: file.name,
          totalPrograms: payload.totalPrograms,
        });
      }

      setEpgFeedback({
        success: true,
        message: `Parsed local file ${file.name}: ${payload.totalPrograms.toLocaleString()} programs loaded, ${matchedCount} channels matched.${enrichedCount > 0 ? ` Auto-enriched ${enrichedCount} channel logos.` : ''}`,
        matchedCount,
        totalPrograms: payload.totalPrograms,
      });
    } catch (err: any) {
      setEpgFeedback({
        success: false,
        message: `XMLTV file error: ${err.message}`,
      });
    } finally {
      setIsLoadingEpg(false);
    }
  };

  // Handle Paste Raw M3U
  const handlePasteSubmit = () => {
    if (!m3uText.trim()) {
      setM3uFeedback({ success: false, message: 'Please paste your #EXTM3U text content first.' });
      return;
    }
    const effectiveUa = getEffectiveUserAgent();
    const effectiveRef = customReferer.trim();

    const result = parseM3UPlaylist(m3uText, {
      userAgent: effectiveUa,
      referer: effectiveRef,
    });

    if (result.channels.length === 0 && result.movies.length === 0 && result.series.length === 0) {
      setM3uFeedback({ success: false, message: 'No valid channels or VOD found in pasted text.' });
      return;
    }

    const baseChannels = result.channels.length > 0 ? result.channels : parseM3U(m3uText);
    const enrichedChannels = enrichChannelsWithLogos(baseChannels).updatedChannels;

    if (onLoadFullPlaylistData) {
      onLoadFullPlaylistData({
        ...result,
        channels: enrichedChannels,
      });
    }
    if (setChannels) {
      setChannels(enrichedChannels);
    }
    onLoadCustomChannels(enrichedChannels);

    if (result.epgUrls && result.epgUrls.length > 0) {
      syncEpgUrl(result.epgUrls[0], 'Pasted M3U EPG');
    }

    setM3uFeedback({
      success: true,
      message: `Successfully parsed ${enrichedChannels.length} Live channels, ${result.movies.length} Movies, and ${result.series.length} Series.`,
    });
  };

  // Export M3U file
  const handleExportM3u = () => {
    let content = '#EXTM3U\n';
    channels.forEach((ch) => {
      let optStr = '';
      if (ch.userAgent) optStr += `|User-Agent=${encodeURIComponent(ch.userAgent)}`;
      if (ch.referer) optStr += `${optStr ? '&' : '|'}Referer=${encodeURIComponent(ch.referer)}`;

      content += `#EXTINF:-1 tvg-id="${ch.tvgId || ''}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.group}",${ch.name}\n${ch.streamUrl}${optStr}\n`;
    });

    const blob = new Blob([content], { type: 'application/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iptv-channels-${new Date().toISOString().slice(0, 10)}.m3u`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter channels in Active Overview tab
  const filteredOverviewChannels = useMemo(() => {
    if (!overviewSearch.trim()) return channels;
    const q = overviewSearch.toLowerCase().trim();
    return channels.filter(
      c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    );
  }, [channels, overviewSearch]);

  const totalSchedulesLoaded = useMemo(() => {
    return Object.values(schedules).reduce((acc, curr) => acc + curr.length, 0);
  }, [schedules]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121316] overflow-y-auto p-6 text-[#e3e5e8]">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#232731]">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#87cf3e]" />
              <span>IPTV Playlist & EPG TV Guide Manager</span>
            </h2>
            <p className="text-xs text-[#7d8494] mt-1">
              Connect Xtream Codes API, load M3U/M3U8 playlists with custom headers, and link live real-time XMLTV Electronic Program Guides.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportM3u}
              className="px-3 py-1.5 rounded bg-[#1e2129] hover:bg-[#282d38] border border-[#2d323e] text-xs font-medium text-[#c8cdd6] transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export M3U</span>
            </button>

            <button
              onClick={onRestoreDefaults}
              className="px-3 py-1.5 rounded bg-[#87cf3e]/15 hover:bg-[#87cf3e]/25 border border-[#87cf3e]/30 text-xs font-semibold text-[#87cf3e] transition flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Restore Curated Channels</span>
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-[#272b35] mb-6 space-x-4">
          <button
            onClick={() => setActiveSubTab('xc')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeSubTab === 'xc'
                ? 'border-[#87cf3e] text-[#87cf3e]'
                : 'border-transparent text-[#7e8594] hover:text-[#e3e5e8]'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Xtream Codes (XC) API</span>
          </button>

          <button
            onClick={() => setActiveSubTab('m3u')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeSubTab === 'm3u'
                ? 'border-[#87cf3e] text-[#87cf3e]'
                : 'border-transparent text-[#7e8594] hover:text-[#e3e5e8]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>M3U / M3U8 Playlist</span>
          </button>

          <button
            onClick={() => setActiveSubTab('epg')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeSubTab === 'epg'
                ? 'border-[#87cf3e] text-[#87cf3e]'
                : 'border-transparent text-[#7e8594] hover:text-[#e3e5e8]'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>EPG (TV Guide) Sources {totalSchedulesLoaded > 0 && `(${Object.keys(schedules).length} matched)`}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('curated')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
              activeSubTab === 'curated'
                ? 'border-[#87cf3e] text-[#87cf3e]'
                : 'border-transparent text-[#7e8594] hover:text-[#e3e5e8]'
            }`}
          >
            <Tv className="w-4 h-4" />
            <span>Active Library ({channels.length} Ch / {movies.length} Movies / {series.length} Series)</span>
          </button>
        </div>

        {/* Tab 1: Xtream Codes (XC) */}
        {activeSubTab === 'xc' && (
          <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-6 shadow-md">
            <div className="flex items-center space-x-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-[#87cf3e]/15 border border-[#87cf3e]/30 flex items-center justify-center">
                <Globe className="w-5 h-5 text-[#87cf3e]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#eef0f3]">Xtream Codes API Login</h3>
                <p className="text-xs text-[#717786]">
                  Enter your Xtream IPTV provider host, port, username, and password. Imports all Live Channels, VOD Movies, and TV Shows with real EPG guide synchronization.
                </p>
              </div>
            </div>

            <form onSubmit={handleXcLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#a9b0be] mb-1.5">
                  Server URL (with port)
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#575c69]" />
                  <input
                    type="text"
                    placeholder="http://iptv-server.net:8080"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e] focus:ring-1 focus:ring-[#87cf3e] transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#a9b0be] mb-1.5">
                    Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#575c69]" />
                    <input
                      type="text"
                      placeholder="Your Xtream username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e] focus:ring-1 focus:ring-[#87cf3e] transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#a9b0be] mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#575c69]" />
                    <input
                      type="password"
                      placeholder="Your Xtream password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e] focus:ring-1 focus:ring-[#87cf3e] transition"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isConnectingXc}
                className="w-full py-2.5 px-4 bg-[#87cf3e] hover:bg-[#78bb35] disabled:bg-[#343a46] disabled:text-[#6a7180] text-[#121316] font-bold text-xs rounded-lg transition flex items-center justify-center space-x-2 mt-2 shadow-sm"
              >
                {isConnectingXc ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Connecting & Syncing Channels + Real EPG...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Connect & Sync All Content + Live TV Guide</span>
                  </>
                )}
              </button>
            </form>

            {xcStatus && (
              <div className={`mt-4 p-4 rounded-lg text-xs border ${
                xcStatus.success
                  ? 'bg-[#87cf3e]/10 border-[#87cf3e]/30 text-[#87cf3e]'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                <div className="flex items-start space-x-2">
                  {xcStatus.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold">{xcStatus.message}</p>
                    {xcStatus.details && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#87cf3e]/20 text-[#abb2bf]">
                        <div><span className="text-[#6d7482]">Server:</span> <span className="text-white font-medium">{xcStatus.details.serverName}</span></div>
                        <div><span className="text-[#6d7482]">Expiry:</span> <span className="text-white font-medium">{xcStatus.details.expDate}</span></div>
                        <div><span className="text-[#6d7482]">Live Ch:</span> <span className="text-white font-medium">{xcStatus.details.liveCount}</span></div>
                        <div><span className="text-[#6d7482]">VOD / Series:</span> <span className="text-white font-medium">{xcStatus.details.movieCount + xcStatus.details.seriesCount}</span></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: M3U / M3U8 Playlist */}
        {activeSubTab === 'm3u' && (
          <div className="space-y-5">
            {/* URL Loader */}
            <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-6 shadow-md">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-[#87cf3e]/15 border border-[#87cf3e]/30 flex items-center justify-center">
                  <Link className="w-4 h-4 text-[#87cf3e]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#eef0f3]">Load M3U / M3U8 from URL</h3>
                  <p className="text-xs text-[#717786]">
                    Enter any remote M3U URL. Automatically extracts url-tvg headers for real broadcast guide mapping.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="https://example.com/playlist.m3u8"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    className="flex-1 px-3 py-2 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                  />
                  <button
                    onClick={handleLoadM3uUrl}
                    disabled={isLoadingM3u}
                    className="px-5 py-2 bg-[#87cf3e] hover:bg-[#78bb35] disabled:bg-[#343a46] disabled:text-[#6a7180] text-[#121316] font-bold text-xs rounded-lg transition flex items-center justify-center space-x-2 whitespace-nowrap"
                  >
                    {isLoadingM3u ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Loading...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Load Playlist</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Optional User-Agent & Referer dropdown toggle */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowM3uOptions(!showM3uOptions)}
                    className="text-xs text-[#87cf3e] hover:underline flex items-center gap-1 font-medium"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{showM3uOptions ? 'Hide stream header options' : 'Stream Headers & Custom User-Agent (Anti-blocking options)'}</span>
                    {showM3uOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {showM3uOptions && (
                    <div className="mt-3 p-3.5 bg-[#121316] border border-[#2a2e39] rounded-lg space-y-3 text-xs">
                      <div>
                        <label className="block text-[#a9b0be] font-semibold mb-1">User-Agent Preset</label>
                        <select
                          value={selectedUaPreset}
                          onChange={(e) => setSelectedUaPreset(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#1a1d24] border border-[#313644] rounded text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                        >
                          {Object.entries(UA_PRESETS).map(([key, item]) => (
                            <option key={key} value={key}>{item.label}</option>
                          ))}
                        </select>
                      </div>

                      {selectedUaPreset === 'custom' && (
                        <div>
                          <label className="block text-[#a9b0be] font-semibold mb-1">Custom User-Agent string</label>
                          <input
                            type="text"
                            placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
                            value={customUserAgent}
                            onChange={(e) => setCustomUserAgent(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-[#1a1d24] border border-[#313644] rounded text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[#a9b0be] font-semibold mb-1">Custom Referer (Optional)</label>
                        <input
                          type="text"
                          placeholder="https://provider.stream/"
                          value={customReferer}
                          onChange={(e) => setCustomReferer(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#1a1d24] border border-[#313644] rounded text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* File Upload & Raw Paste Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center space-x-2.5 mb-2">
                    <Upload className="w-4 h-4 text-[#87cf3e]" />
                    <h4 className="text-xs font-bold text-[#eef0f3]">Upload M3U File (.m3u, .m3u8)</h4>
                  </div>
                  <p className="text-[11px] text-[#717786] mb-3">
                    Drag and drop or select a saved playlist file from your device.
                  </p>
                </div>
                <input
                  type="file"
                  accept=".m3u,.m3u8,.txt"
                  onChange={handleFileUpload}
                  className="block w-full text-xs text-[#87cf3e] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#87cf3e]/20 file:text-[#87cf3e] hover:file:bg-[#87cf3e]/30 cursor-pointer"
                />
              </div>

              <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md">
                <div className="flex items-center space-x-2.5 mb-2">
                  <FileText className="w-4 h-4 text-[#87cf3e]" />
                  <h4 className="text-xs font-bold text-[#eef0f3]">Paste Raw M3U Content</h4>
                </div>
                <textarea
                  rows={2}
                  placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-id=&quot;ch1&quot;,Channel Name&#10;http://..."
                  value={m3uText}
                  onChange={(e) => setM3uText(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#121316] border border-[#2a2e39] rounded text-xs text-[#e3e5e8] font-mono focus:outline-none focus:border-[#87cf3e] mb-2"
                />
                <button
                  onClick={handlePasteSubmit}
                  className="w-full py-1.5 bg-[#20242e] hover:bg-[#2a303d] border border-[#313644] text-[#87cf3e] font-semibold text-xs rounded transition"
                >
                  Parse Pasted Playlist
                </button>
              </div>
            </div>

            {m3uFeedback && (
              <div className={`p-4 rounded-lg text-xs border ${
                m3uFeedback.success
                  ? 'bg-[#87cf3e]/10 border-[#87cf3e]/30 text-[#87cf3e]'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                <div className="flex items-start space-x-2">
                  {m3uFeedback.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  )}
                  <p className="font-semibold">{m3uFeedback.message}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: EPG (TV Guide) Sources & Live Sync */}
        {activeSubTab === 'epg' && (
          <div className="space-y-6">
            {/* Active EPG Guide Status Banner */}
            <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start space-x-3.5">
                  <div className="w-10 h-10 rounded-lg bg-[#87cf3e]/15 border border-[#87cf3e]/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Radio className="w-5 h-5 text-[#87cf3e]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[#eef0f3]">Real Electronic Program Guide (EPG) Engine</h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#87cf3e]/20 text-[#87cf3e] border border-[#87cf3e]/30">
                        {totalSchedulesLoaded > 0 ? 'Active & Live' : 'Ready'}
                      </span>
                    </div>
                    <p className="text-xs text-[#717786] mt-1">
                      {epgSourceInfo?.sourceUrl 
                        ? `Source: ${epgSourceInfo.sourceUrl}` 
                        : 'Loads actual broadcast TV guide listings with real start/end timestamps, descriptions, categories, and TMDB integration.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="text-xs font-bold text-[#e3e5e8]">
                      {Object.keys(schedules).length} / {channels.length} Channels Mapped
                    </div>
                    <div className="text-[10px] text-[#717786]">
                      {totalSchedulesLoaded.toLocaleString()} Real Programs Loaded
                    </div>
                  </div>

                  <button
                    onClick={() => syncEpgUrl(customEpgUrl)}
                    disabled={isLoadingEpg}
                    className="px-3 py-2 bg-[#87cf3e] hover:bg-[#78bb35] disabled:bg-[#343a46] text-[#121316] font-bold text-xs rounded-lg transition flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingEpg ? 'animate-spin' : ''}`} />
                    <span>{isLoadingEpg ? 'Syncing...' : 'Sync Guide Now'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Country Presets */}
            <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md">
              <h4 className="text-xs font-bold text-[#eef0f3] mb-2 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-[#87cf3e]" />
                <span>1-Click Popular Free EPG XMLTV Presets</span>
              </h4>
              <p className="text-[11px] text-[#717786] mb-3">
                Select your region to automatically populate and map real broadcast schedules for global news, sports, and entertainment channels:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {EPG_PRESETS.map((preset) => {
                  const isSelected = customEpgUrl === preset.url;
                  return (
                    <button
                      key={preset.country}
                      onClick={() => {
                        setCustomEpgUrl(preset.url);
                        syncEpgUrl(preset.url, preset.label);
                      }}
                      disabled={isLoadingEpg}
                      className={`p-2.5 rounded-lg border text-left transition flex items-center justify-between ${
                        isSelected
                          ? 'bg-[#87cf3e]/15 border-[#87cf3e] text-[#e3e5e8]'
                          : 'bg-[#121316] border-[#292e3a] text-[#8e95a5] hover:border-[#3d4454] hover:text-[#e3e5e8]'
                      }`}
                    >
                      <span className="text-xs font-medium truncate">{preset.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#87cf3e] flex-shrink-0 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom XMLTV URL, Xtream Codes EPG & File Upload */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-[#eef0f3] flex items-center gap-1.5 mb-1">
                      <Server className="w-3.5 h-3.5 text-[#87cf3e]" />
                      <span>Sync from Xtream Codes (XC)</span>
                    </h4>
                    <p className="text-[11px] text-[#717786]">
                      Directly sync XMLTV and stream EPG schedules from your Xtream server.
                    </p>
                  </div>
                  <input
                    type="text"
                    placeholder="Server: http://xc.example.com:8080"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    className="w-full px-3 py-1.5 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                    />
                  </div>
                </div>

                <button
                  onClick={() => syncXcEpg(serverUrl, username, password, `${serverUrl} (Xtream Codes EPG)`)}
                  disabled={isLoadingEpg || !serverUrl.trim() || !username.trim() || !password.trim()}
                  className="w-full py-2 bg-[#87cf3e]/20 hover:bg-[#87cf3e]/30 border border-[#87cf3e]/40 text-[#87cf3e] font-bold text-xs rounded-lg transition flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {isLoadingEpg ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Syncing XC Guide...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Sync XC Server EPG</span>
                    </>
                  )}
                </button>
              </div>

              <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md space-y-3 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-[#eef0f3] flex items-center gap-1.5 mb-1">
                    <Link className="w-3.5 h-3.5 text-[#87cf3e]" />
                    <span>Custom XMLTV URL</span>
                  </h4>
                  <p className="text-[11px] text-[#717786] mb-2">
                    Supports plain XML or gzip XMLTV files (.xml, .xml.gz).
                  </p>
                  <input
                    type="text"
                    placeholder="https://example.com/epg.xml.gz"
                    value={customEpgUrl}
                    onChange={(e) => setCustomEpgUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-[#121316] border border-[#2a2e39] rounded-lg text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e]"
                  />
                </div>

                <button
                  onClick={() => syncEpgUrl(customEpgUrl)}
                  disabled={isLoadingEpg || !customEpgUrl.trim()}
                  className="w-full py-2 bg-[#212632] hover:bg-[#2c3343] border border-[#343b4c] text-[#87cf3e] font-bold text-xs rounded-lg transition flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {isLoadingEpg ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Downloading Guide...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Fetch XMLTV Feed</span>
                    </>
                  )}
                </button>
              </div>

              <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-5 shadow-md flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-[#eef0f3] flex items-center gap-1.5 mb-1">
                    <Upload className="w-3.5 h-3.5 text-[#87cf3e]" />
                    <span>Upload Local XMLTV File</span>
                  </h4>
                  <p className="text-[11px] text-[#717786] mb-3">
                    Upload your downloaded XMLTV guide file (.xml, .xmltv, .gz) directly.
                  </p>
                </div>

                <input
                  type="file"
                  accept=".xml,.xmltv,.gz"
                  onChange={handleXmltvFileUpload}
                  className="block w-full text-xs text-[#87cf3e] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#87cf3e]/20 file:text-[#87cf3e] hover:file:bg-[#87cf3e]/30 cursor-pointer"
                />
              </div>
            </div>

            {epgFeedback && (
              <div className={`p-4 rounded-lg text-xs border ${
                epgFeedback.success
                  ? 'bg-[#87cf3e]/10 border-[#87cf3e]/30 text-[#87cf3e]'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                <div className="flex items-start space-x-2">
                  {epgFeedback.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold">{epgFeedback.message}</p>
                    {epgFeedback.success && (
                      <p className="text-[11px] text-[#a9b0be] mt-1">
                        Go to the <strong>EPG Guide</strong> tab to browse the populated live schedule grid!
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Active Library Overview */}
        {activeSubTab === 'curated' && (
          <div className="space-y-4">
            <div className="bg-[#17191f] border border-[#262a34] rounded-xl p-6 shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-[#eef0f3] flex items-center gap-2">
                    <Tv className="w-4 h-4 text-[#87cf3e]" />
                    <span>Channels in Memory ({filteredOverviewChannels.length})</span>
                  </h3>
                  <p className="text-xs text-[#717786]">
                    Ready for instant playback and EPG TV Guide
                  </p>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#686e7e]" />
                  <input
                    type="text"
                    placeholder="Search channel or group..."
                    value={overviewSearch}
                    onChange={(e) => setOverviewSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-[#121316] border border-[#2b303d] rounded-lg text-xs text-white placeholder-[#686e7e] focus:outline-none focus:border-[#87cf3e]"
                  />
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-[#232731] scrollbar-thin scrollbar-thumb-[#2d323f]">
                {filteredOverviewChannels.slice(0, 100).map((ch) => (
                  <div key={ch.id} className="py-2.5 px-3 flex items-center justify-between hover:bg-[#1a1d24] transition rounded">
                    <div className="flex items-center space-x-3 min-w-0">
                      <span className="font-mono text-xs text-[#636979] w-8 text-center">{ch.num}</span>
                      <ChannelLogo channel={ch} size="sm" />
                      <div className="min-w-0">
                        <h5 className="text-xs font-semibold text-[#e3e5e8] truncate">{ch.name}</h5>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[#6b7180]">{ch.group}</span>
                          {schedules[ch.id] && schedules[ch.id].length > 0 && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#87cf3e]/20 text-[#87cf3e] font-semibold">
                              {schedules[ch.id].length} EPG items
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <span className="text-[11px] font-mono text-[#5c6270] truncate max-w-xs hidden sm:inline">
                      {ch.streamUrl}
                    </span>
                  </div>
                ))}

                {filteredOverviewChannels.length > 100 && (
                  <div className="p-3 text-center text-xs text-[#717787] bg-[#14161c]">
                    Showing first 100 of {filteredOverviewChannels.length} channels. Use search above to find any channel.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
