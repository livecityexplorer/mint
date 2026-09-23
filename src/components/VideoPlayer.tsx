import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Minimize, 
  Layers, 
  Tv, 
  ShieldCheck, 
  AlertCircle, 
  RefreshCw, 
  ListOrdered, 
  Settings, 
  Star,
  Clock,
  Radio,
  Search,
  Filter,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  RotateCw,
  FastForward,
  Rewind,
  Film,
  Gauge,
  Languages,
  PictureInPicture2,
  Maximize2,
  SkipBack,
  SkipForward,
  Sparkles,
  X
} from 'lucide-react';
import { Channel, EpgProgram, PlayerSettings } from '../types';
import { normalizeGroupName } from '../utils/m3uParser';
import { ChannelLogo } from './ChannelLogo';
import { extractXcDetailsFromChannel, fetchSingleXtreamStreamEpg } from '../services/epgService';

export interface AudioTrackItem {
  id: number | string;
  name: string;
  lang?: string;
  label: string;
  isDefault?: boolean;
}

// User-friendly display names for standard ISO audio language codes
const getLanguageDisplayName = (codeOrName?: string): string => {
  if (!codeOrName) return 'Audio Track';
  const clean = codeOrName.trim().toLowerCase();
  const map: Record<string, string> = {
    en: 'English', eng: 'English', english: 'English',
    es: 'Spanish', spa: 'Spanish', spanish: 'Spanish',
    fr: 'French', fra: 'French', fre: 'French', french: 'French',
    de: 'German', deu: 'German', ger: 'German', german: 'German',
    it: 'Italian', ita: 'Italian', italian: 'Italian',
    pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese',
    ru: 'Russian', rus: 'Russian', russian: 'Russian',
    ar: 'Arabic', ara: 'Arabic', arabic: 'Arabic',
    tr: 'Turkish', tur: 'Turkish', turkish: 'Turkish',
    zh: 'Chinese', zho: 'Chinese', chi: 'Chinese', chinese: 'Chinese',
    ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese',
    ko: 'Korean', kor: 'Korean', korean: 'Korean',
    hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
    pl: 'Polish', pol: 'Polish', polish: 'Polish',
    nl: 'Dutch', nld: 'Dutch', dut: 'Dutch', dutch: 'Dutch',
    sv: 'Swedish', swe: 'Swedish', swedish: 'Swedish',
    el: 'Greek', ell: 'Greek', gre: 'Greek', greek: 'Greek',
    he: 'Hebrew', heb: 'Hebrew', hebrew: 'Hebrew',
    fa: 'Persian', fas: 'Persian', per: 'Persian', persian: 'Persian',
    uk: 'Ukrainian', ukr: 'Ukrainian', ukrainian: 'Ukrainian',
    ro: 'Romanian', ron: 'Romanian', rum: 'Romanian', romanian: 'Romanian',
    hu: 'Hungarian', hun: 'Hungarian', hungarian: 'Hungarian',
    cs: 'Czech', ces: 'Czech', cze: 'Czech', czech: 'Czech',
    da: 'Danish', dan: 'Danish', danish: 'Danish',
    fi: 'Finnish', fin: 'Finnish', finnish: 'Finnish',
    no: 'Norwegian', nor: 'Norwegian', norwegian: 'Norwegian',
    und: 'Default Audio',
    qaa: 'Original Audio'
  };

  if (map[clean]) return map[clean];
  if (codeOrName.length > 3) {
    return codeOrName;
  }
  return codeOrName.toUpperCase();
};

interface VideoPlayerProps {
  channel: Channel | null;
  channels: Channel[];
  schedules: Record<string, EpgProgram[]>;
  onSelectChannel: (channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
  settings: PlayerSettings;
  updateSettings: (partial: Partial<PlayerSettings>) => void;
  isPip?: boolean;
  onTogglePip?: () => void;
  onClosePip?: () => void;
  onExpandFromPip?: () => void;
  onUpdateSchedules?: (newSchedules: Record<string, EpgProgram[]>, info?: { sourceName: string; totalPrograms: number }) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  channel,
  channels,
  schedules,
  onSelectChannel,
  onToggleFavorite,
  settings,
  updateSettings,
  isPip = false,
  onTogglePip,
  onClosePip,
  onExpandFromPip,
  onUpdateSchedules,
}) => {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const osdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bufferWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const seekFeedbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferTimeoutWarning, setBufferTimeoutWarning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOsd, setShowOsd] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const [volume, setVolume] = useState(settings.volume);
  const [isMuted, setIsMuted] = useState(settings.muted);
  const [aspectRatio, setAspectRatio] = useState<PlayerSettings['aspectRatio']>(settings.aspectRatio);
  const [useProxyOverride, setUseProxyOverride] = useState(settings.useProxy);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // VOD, Movies & Series timeline & forward/rewind states
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedPercent, setBufferedPercent] = useState<number>(0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [seekFeedback, setSeekFeedback] = useState<{ type: 'rewind' | 'forward'; seconds: number } | null>(null);

  // Audio track states for multi-language audio streams
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState<number | string | null>(null);
  const [showAudioMenu, setShowAudioMenu] = useState<boolean>(false);
  const [audioFeedback, setAudioFeedback] = useState<string | null>(null);
  const audioFeedbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Drawer filtering states for large playlists
  const [drawerSearch, setDrawerSearch] = useState('');
  const [drawerGroup, setDrawerGroup] = useState('All');

  // Distinct groups with counts for player drawer
  const { drawerGroups, drawerGroupCounts } = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < channels.length; i++) {
      const g = normalizeGroupName(channels[i].group || 'General');
      counts[g] = (counts[g] || 0) + 1;
    }
    const sortedGroups = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const groupCounts: Record<string, number> = { All: channels.length, ...counts };
    return {
      drawerGroups: ['All', ...sortedGroups],
      drawerGroupCounts: groupCounts
    };
  }, [channels]);

  // Filtered drawer channels
  const drawerFilteredChannels = React.useMemo(() => {
    let list = channels;
    if (drawerGroup !== 'All') {
      const gTarget = drawerGroup.toLowerCase().trim();
      list = list.filter(c => normalizeGroupName(c.group || 'General').toLowerCase() === gTarget);
    }
    if (drawerSearch.trim()) {
      const q = drawerSearch.toLowerCase().trim();
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) || 
        String(c.num).includes(q) ||
        (c.group && c.group.toLowerCase().includes(q))
      );
    }
    return list;
  }, [channels, drawerGroup, drawerSearch]);

  // Compute active program
  const currentSchedule = channel ? schedules[channel.id] || [] : [];
  const now = new Date();
  const currentProgram = currentSchedule.find(p => p.start <= now && p.end >= now) || currentSchedule[0];
  const nextProgram = currentSchedule.find(p => p.start > (currentProgram ? currentProgram.end : now));

  // Xtream Codes live stream EPG state
  const [isFetchingXcEpg, setIsFetchingXcEpg] = useState(false);
  const [xcEpgFeedback, setXcEpgFeedback] = useState<string | null>(null);

  const xcDetails = React.useMemo(() => {
    return channel ? extractXcDetailsFromChannel(channel) : null;
  }, [channel]);

  // Fetch Xtream Codes single stream live EPG
  const handleFetchXcStreamEpg = async (force: boolean = false) => {
    if (!channel || !xcDetails || !onUpdateSchedules) return;

    // Check if we already have real listings unless forced
    const existing = schedules[channel.id] || [];
    const isMock = existing.length === 0 || existing.some(p => p.id.startsWith('mock-') || p.id.startsWith('gen-'));
    if (!isMock && !force) return;

    setIsFetchingXcEpg(true);
    setXcEpgFeedback('Syncing Xtream EPG...');
    try {
      const programs = await fetchSingleXtreamStreamEpg(
        xcDetails.serverUrl,
        xcDetails.username,
        xcDetails.password,
        xcDetails.streamId,
        channel.id
      );

      if (programs && programs.length > 0) {
        onUpdateSchedules(
          { [channel.id]: programs },
          { sourceName: `Xtream Codes Live (Stream ${xcDetails.streamId})`, totalPrograms: programs.length }
        );
        setXcEpgFeedback(`Loaded ${programs.length} listings from XC`);
      } else {
        setXcEpgFeedback('No XC guide on server');
      }
    } catch (err: any) {
      console.warn('XC live stream EPG fetch notice:', err.message);
      setXcEpgFeedback('XC Guide unavailable');
    } finally {
      setIsFetchingXcEpg(false);
      setTimeout(() => setXcEpgFeedback(null), 3000);
    }
  };

  // Automatically fetch XC stream EPG on channel change if channel originates from XC
  useEffect(() => {
    if (channel && xcDetails) {
      handleFetchXcStreamEpg(false);
    }
  }, [channel?.id, xcDetails?.streamId]);

  // Series Episodes Management & Continuation
  const seriesContext = channel?.seriesContext;
  const hasSeriesContext = Boolean(
    seriesContext && seriesContext.episodes && seriesContext.episodes.length > 0
  );
  const currentEpIndex = seriesContext?.currentEpisodeIndex ?? 0;
  const currentEp = hasSeriesContext ? seriesContext!.episodes[currentEpIndex] : null;
  const hasNextEp = Boolean(
    hasSeriesContext && currentEpIndex + 1 < (seriesContext?.episodes?.length || 0)
  );
  const hasPrevEp = Boolean(hasSeriesContext && currentEpIndex > 0);
  const nextEp = hasNextEp ? seriesContext!.episodes[currentEpIndex + 1] : null;
  const prevEp = hasPrevEp ? seriesContext!.episodes[currentEpIndex - 1] : null;

  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [drawerSelectedSeason, setDrawerSelectedSeason] = useState<number>(0);
  const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null);

  const playEpisodeAtIndex = (idx: number) => {
    if (!seriesContext || !seriesContext.episodes || idx < 0 || idx >= seriesContext.episodes.length) return;
    setNextEpCountdown(null);
    const ep = seriesContext.episodes[idx];
    const chId = ep.id || `series-ep-${seriesContext.seriesId}-${ep.seasonNum}-${ep.episodeNum}`;
    const newChannel: Channel = {
      id: chId,
      num: 1,
      name: `${seriesContext.seriesTitle} - S${ep.seasonNum}E${ep.episodeNum}`,
      group: seriesContext.group || channel?.group || 'TV Series',
      logo: ep.cover || seriesContext.poster || channel?.logo || '',
      streamUrl: ep.streamUrl,
      seriesContext: {
        ...seriesContext,
        currentEpisodeIndex: idx,
      },
      currentProgram: {
        id: `prog-${chId}`,
        channelId: chId,
        title: `${seriesContext.seriesTitle} • S${ep.seasonNum}E${ep.episodeNum} ${ep.title ? `- ${ep.title}` : ''}`,
        description: ep.plot || `Season ${ep.seasonNum}, Episode ${ep.episodeNum}`,
        start: new Date(),
        end: new Date(Date.now() + 3600 * 1000),
        category: 'Series',
        rating: ep.rating ? String(ep.rating) : undefined,
      },
    };
    onSelectChannel(newChannel);
  };

  const handlePlayNextEpisode = () => {
    if (hasNextEp) playEpisodeAtIndex(currentEpIndex + 1);
  };

  const handlePlayPrevEpisode = () => {
    if (hasPrevEp) playEpisodeAtIndex(currentEpIndex - 1);
  };

  // Next episode auto-advance countdown ticker
  useEffect(() => {
    if (nextEpCountdown === null) return;
    if (nextEpCountdown <= 0) {
      setNextEpCountdown(null);
      if (hasNextEp) {
        handlePlayNextEpisode();
      }
      return;
    }
    const timer = setTimeout(() => {
      setNextEpCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [nextEpCountdown, hasNextEp, currentEpIndex]);

  // Reset OSD timer on mouse move
  const triggerOsd = () => {
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setShowOsd(false);
      setShowSpeedMenu(false);
      setShowAudioMenu(false);
    }, 5000);
  };

  // Determine effective stream URL with headers
  const getStreamUrl = (rawUrl: string, useProxy: boolean, ch?: Channel | null) => {
    if (!rawUrl) return '';
    if (useProxy) {
      const params = new URLSearchParams({ url: rawUrl });
      if (ch?.userAgent) params.set('userAgent', ch.userAgent);
      if (ch?.referer) params.set('referer', ch.referer);
      return `/api/proxy?${params.toString()}`;
    }
    return rawUrl;
  };

  // Copy raw stream URL
  const handleCopyUrl = () => {
    if (!channel?.streamUrl) return;
    navigator.clipboard.writeText(channel.streamUrl).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }).catch(() => {});
  };

  // Initialize and play stream
  useEffect(() => {
    if (!channel || !videoRef.current) return;

    setErrorMsg(null);
    setIsBuffering(true);
    setBufferTimeoutWarning(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPercent(0);
    setPlaybackRate(1);
    setShowSpeedMenu(false);
    setAudioTracks([]);
    setCurrentAudioTrackId(null);
    setShowAudioMenu(false);
    triggerOsd();

    // Set buffer watchdog timeout: after 7s of buffering, alert user with easy recovery actions
    if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
    bufferWatchdogRef.current = setTimeout(() => {
      setBufferTimeoutWarning(true);
    }, 7000);

    const rawUrl = channel.streamUrl;
    const targetUrl = getStreamUrl(rawUrl, useProxyOverride, channel);

    // Destroy existing Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;
    video.volume = volume;
    video.muted = isMuted;
    video.playbackRate = 1;

    // Direct video formats or VOD streams
    const cleanUrl = rawUrl.split('?')[0].toLowerCase();
    const isDirectVideo = 
      cleanUrl.endsWith('.mp4') || 
      cleanUrl.endsWith('.webm') || 
      cleanUrl.endsWith('.mkv') || 
      cleanUrl.endsWith('.mov') || 
      cleanUrl.endsWith('.avi') ||
      rawUrl.includes('/movie/') ||
      rawUrl.includes('/series/');

    if (Hls.isSupported() && !isDirectVideo) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 14000,
        manifestLoadingMaxRetry: 4,
        levelLoadingTimeOut: 14000,
        levelLoadingMaxRetry: 4,
        fragLoadingTimeOut: 16000,
        fragLoadingMaxRetry: 6,
        startLevel: -1,
      });

      hlsRef.current = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);

      const syncHlsAudioTracks = () => {
        if (!hls) return;
        const tracks = hls.audioTracks;
        if (tracks && tracks.length > 0) {
          const list: AudioTrackItem[] = tracks.map((t, idx) => {
            const rawLang = t.lang || '';
            const displayLabel = t.name 
              ? (t.name.length <= 3 && rawLang ? getLanguageDisplayName(rawLang) : t.name)
              : (rawLang ? getLanguageDisplayName(rawLang) : `Track ${idx + 1}`);
            return {
              id: t.id !== undefined ? t.id : idx,
              name: t.name || '',
              lang: rawLang,
              label: displayLabel,
              isDefault: !!t.default,
            };
          });
          setAudioTracks(list);
          const activeTrackId = hls.audioTrack !== -1 ? hls.audioTrack : (list[0]?.id ?? null);
          setCurrentAudioTrackId(activeTrackId);
        }
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        setBufferTimeoutWarning(false);
        if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
        video.play().catch(() => {
          setIsPlaying(false);
        });
        syncHlsAudioTracks();
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          const list: AudioTrackItem[] = data.audioTracks.map((t, idx) => {
            const rawLang = t.lang || '';
            const displayLabel = t.name 
              ? (t.name.length <= 3 && rawLang ? getLanguageDisplayName(rawLang) : t.name)
              : (rawLang ? getLanguageDisplayName(rawLang) : `Track ${idx + 1}`);
            return {
              id: t.id !== undefined ? t.id : idx,
              name: t.name || '',
              lang: rawLang,
              label: displayLabel,
              isDefault: !!t.default,
            };
          });
          setAudioTracks(list);
          const activeTrackId = hls.audioTrack !== -1 ? hls.audioTrack : (list[0]?.id ?? null);
          setCurrentAudioTrackId(activeTrackId);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
        setCurrentAudioTrackId(data.id);
      });

      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (data.details.totalduration && isFinite(data.details.totalduration) && data.details.totalduration > 0) {
          setDuration(data.details.totalduration);
        }
        syncHlsAudioTracks();
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        setIsBuffering(false);
        setBufferTimeoutWarning(false);
        if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
      });

      hls.on(Hls.Events.BUFFER_APPENDED, () => {
        setIsBuffering(false);
        setBufferTimeoutWarning(false);
        if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('[HLS WARNING/ERROR]', data.type, data.details);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (!useProxyOverride) {
                setErrorMsg('Direct connection restricted by CORS or ISP. Enable Mint Proxy to bypass.');
              } else {
                setErrorMsg(`Stream connection failed (${data.details}). Server might be offline or rate-limiting.`);
              }
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              // Fallback to native video tag if HLS manifest parse fails (e.g. direct media)
              hls.destroy();
              hlsRef.current = null;
              if (videoRef.current) {
                videoRef.current.src = targetUrl;
                videoRef.current.play().catch(() => {
                  setErrorMsg(`Playback error (${data.details})`);
                });
              } else {
                setErrorMsg(`Playback error (${data.details})`);
              }
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || isDirectVideo || true) {
      video.src = targetUrl;
      video.play().catch(() => {
        setIsPlaying(false);
      });
      setIsBuffering(false);
      setBufferTimeoutWarning(false);
      if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
    } else {
      setErrorMsg('Your browser does not support HLS streaming.');
    }

    return () => {
      if (bufferWatchdogRef.current) {
        clearTimeout(bufferWatchdogRef.current);
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel?.id, channel?.streamUrl, useProxyOverride]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      setBufferTimeoutWarning(false);
      if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
    };
    const syncNativeAudioTracks = () => {
      const nativeTracks = (video as any).audioTracks;
      if (nativeTracks && nativeTracks.length > 0) {
        const list: AudioTrackItem[] = [];
        let enabledId: number | string | null = null;
        for (let i = 0; i < nativeTracks.length; i++) {
          const t = nativeTracks[i];
          const rawLang = t.language || '';
          const displayLabel = t.label || (rawLang ? getLanguageDisplayName(rawLang) : `Track ${i + 1}`);
          list.push({
            id: t.id || i,
            name: t.label || '',
            lang: rawLang,
            label: displayLabel,
            isDefault: i === 0,
          });
          if (t.enabled) {
            enabledId = t.id || i;
          }
        }
        setAudioTracks(list);
        setCurrentAudioTrackId(enabledId ?? list[0]?.id ?? null);
      }
    };

    const onCanPlay = () => {
      setIsBuffering(false);
      setBufferTimeoutWarning(false);
      if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
      syncNativeAudioTracks();
    };
    const onLoadedData = () => {
      setIsBuffering(false);
      setBufferTimeoutWarning(false);
      if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
    };
    const onLoadedMetadata = () => {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
      syncNativeAudioTracks();
    };
    const onDurationChange = () => {
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };
    const onTimeUpdate = () => {
      if (video.currentTime > 0) {
        setIsBuffering(false);
        setBufferTimeoutWarning(false);
        if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
      }
      if (!isScrubbing) {
        setCurrentTime(video.currentTime);
      }
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
    };
    const onProgress = () => {
      if (video.buffered.length > 0 && video.duration && isFinite(video.duration) && video.duration > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferedPercent(Math.min(100, (end / video.duration) * 100));
      }
    };
    const onError = () => {
      if (!useProxyOverride) {
        setErrorMsg('Playback error. Click "Enable Mint Proxy" below to route around network CORS restrictions.');
      } else {
        setErrorMsg('Stream source could not be played. The remote server may be offline.');
      }
      setIsBuffering(false);
      setBufferTimeoutWarning(false);
    };

    const onEnded = () => {
      if (hasNextEp) {
        setNextEpCountdown(5);
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', onProgress);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [useProxyOverride, isScrubbing, hasNextEp]);

  // Window mouse move & up listeners for smooth timeline scrubbing
  useEffect(() => {
    if (!isScrubbing) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!progressTrackRef.current || !videoRef.current || duration <= 0) return;
      const rect = progressTrackRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetTime = pos * duration;
      setCurrentTime(targetTime);
      videoRef.current.currentTime = targetTime;
    };

    const handleWindowMouseUp = () => {
      setIsScrubbing(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isScrubbing, duration]);

  // Format seconds to HH:MM:SS or MM:SS
  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return '0:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Determine if active stream is a movie, series, or VOD with timeline
  const isVod = Boolean(
    (duration > 0 && isFinite(duration)) ||
    channel?.id.startsWith('vod-') ||
    channel?.group.toLowerCase().includes('movie') ||
    channel?.group.toLowerCase().includes('series') ||
    channel?.group.toLowerCase().includes('vod') ||
    channel?.currentProgram?.category === 'Movie' ||
    channel?.currentProgram?.category === 'Series' ||
    channel?.streamUrl?.toLowerCase().includes('/movie/') ||
    channel?.streamUrl?.toLowerCase().includes('/series/')
  );

  // Fast forward or rewind relative to current time
  const seekRelative = (delta: number) => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const maxDur = isFinite(video.duration) && video.duration > 0 ? video.duration : (duration > 0 ? duration : Infinity);
    const target = Math.max(0, Math.min(maxDur, video.currentTime + delta));
    video.currentTime = target;
    setCurrentTime(target);
    triggerOsd();

    setSeekFeedback({
      type: delta < 0 ? 'rewind' : 'forward',
      seconds: Math.abs(delta)
    });
    if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    seekFeedbackTimerRef.current = setTimeout(() => {
      setSeekFeedback(null);
    }, 900);
  };

  // Timeline track mouse down
  const handleScrubberMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressTrackRef.current || !videoRef.current || duration <= 0) return;
    const rect = progressTrackRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * duration;
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
    setIsScrubbing(true);
    triggerOsd();
  };

  // Timeline hover preview
  const handleScrubberHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressTrackRef.current || duration <= 0) return;
    const rect = progressTrackRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(pos * duration);
    setHoverPos(e.clientX - rect.left);
  };

  const handleScrubberLeave = () => {
    setHoverTime(null);
  };

  // Playback speed change
  const changePlaybackRate = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
    triggerOsd();
  };

  // Switch active audio track for multi-language streams
  const selectAudioTrack = (trackId: number | string) => {
    const selected = audioTracks.find(t => t.id === trackId);
    if (hlsRef.current && hlsRef.current.audioTracks && hlsRef.current.audioTracks.length > 0) {
      const numId = typeof trackId === 'number' ? trackId : parseInt(String(trackId), 10);
      hlsRef.current.audioTrack = numId;
      setCurrentAudioTrackId(numId);
    } else if (videoRef.current && (videoRef.current as any).audioTracks) {
      const nativeTracks = (videoRef.current as any).audioTracks;
      for (let i = 0; i < nativeTracks.length; i++) {
        nativeTracks[i].enabled = (nativeTracks[i].id === trackId || i === trackId);
      }
      setCurrentAudioTrackId(trackId);
    } else {
      setCurrentAudioTrackId(trackId);
    }

    if (selected) {
      setAudioFeedback(`Audio: ${selected.label}`);
      if (audioFeedbackTimerRef.current) clearTimeout(audioFeedbackTimerRef.current);
      audioFeedbackTimerRef.current = setTimeout(() => {
        setAudioFeedback(null);
      }, 1500);
    }

    setShowAudioMenu(false);
    triggerOsd();
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    updateSettings({ muted: nextMuted });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
    updateSettings({ volume: val, muted: val === 0 });
  };

  const cycleAspectRatio = () => {
    const modes: PlayerSettings['aspectRatio'][] = ['16:9', '4:3', 'fill', 'cover'];
    const currentIndex = modes.indexOf(aspectRatio);
    const next = modes[(currentIndex + 1) % modes.length];
    setAspectRatio(next);
    updateSettings({ aspectRatio: next });
  };

  const togglePiP = async () => {
    if (onTogglePip) {
      onTogglePip();
      return;
    }
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP not available:', err);
    }
  };

  const enterFullscreen = async () => {
    const el = playerContainerRef.current;
    if (!el) return;

    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as any).webkitRequestFullscreen) {
        await (el as any).webkitRequestFullscreen();
      } else if ((el as any).mozRequestFullScreen) {
        await (el as any).mozRequestFullScreen();
      } else if ((el as any).msRequestFullscreen) {
        await (el as any).msRequestFullscreen();
      } else {
        // Fallback for environments where requestFullscreen is not supported
        setIsFullscreen(true);
      }
    } catch (err) {
      console.warn('Native fullscreen request blocked/failed, using in-window viewport fullscreen:', err);
      // CSS in-window total fullscreen fallback (ideal inside iframes)
      setIsFullscreen(true);
    }
  };

  const exitFullscreen = async () => {
    try {
      const fsEl = document.fullscreenElement || 
        (document as any).webkitFullscreenElement || 
        (document as any).mozFullScreenElement || 
        (document as any).msFullscreenElement;

      if (fsEl) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Exit fullscreen error:', err);
    }
    setIsFullscreen(false);
  };

  const toggleFullscreen = () => {
    const fsEl = document.fullscreenElement || 
      (document as any).webkitFullscreenElement || 
      (document as any).mozFullScreenElement || 
      (document as any).msFullscreenElement;

    if (isFullscreen || fsEl) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  };

  // Synchronize state with browser fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsEl = document.fullscreenElement || 
        (document as any).webkitFullscreenElement || 
        (document as any).mozFullScreenElement || 
        (document as any).msFullscreenElement;
      
      setIsFullscreen(!!fsEl);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Keyboard navigation & controls in player
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          e.preventDefault();
          exitFullscreen();
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(v => {
          const next = Math.min(1, Math.round((v + 0.05) * 100) / 100);
          if (videoRef.current) {
            videoRef.current.volume = next;
            videoRef.current.muted = false;
          }
          setIsMuted(false);
          updateSettings({ volume: next, muted: false });
          return next;
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(v => {
          const next = Math.max(0, Math.round((v - 0.05) * 100) / 100);
          if (videoRef.current) {
            videoRef.current.volume = next;
            videoRef.current.muted = next === 0;
          }
          setIsMuted(next === 0);
          updateSettings({ volume: next, muted: next === 0 });
          return next;
        });
      } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        seekRelative(e.shiftKey ? -30 : -10);
      } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        seekRelative(e.shiftKey ? 30 : 10);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Home') {
        if (videoRef.current) {
          e.preventDefault();
          videoRef.current.currentTime = 0;
          setCurrentTime(0);
          triggerOsd();
        }
      } else if (e.key === 'End' && duration > 0) {
        if (videoRef.current) {
          e.preventDefault();
          videoRef.current.currentTime = duration - 1;
          setCurrentTime(duration - 1);
          triggerOsd();
        }
      } else if (e.key >= '0' && e.key <= '9' && duration > 0) {
        e.preventDefault();
        const pct = parseInt(e.key, 10) / 10;
        if (videoRef.current) {
          const target = pct * duration;
          videoRef.current.currentTime = target;
          setCurrentTime(target);
          triggerOsd();
        }
      } else if (e.key === '<' || e.key === ',') {
        e.preventDefault();
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const currIdx = speeds.indexOf(playbackRate);
        if (currIdx > 0) {
          changePlaybackRate(speeds[currIdx - 1]);
        }
      } else if (e.key === '>' || e.key === '.') {
        e.preventDefault();
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const currIdx = speeds.indexOf(playbackRate);
        if (currIdx !== -1 && currIdx < speeds.length - 1) {
          changePlaybackRate(speeds[currIdx + 1]);
        }
      } else if (e.key === 'a' || e.key === 'A') {
        if (audioTracks.length > 1) {
          e.preventDefault();
          const currIdx = audioTracks.findIndex(t => t.id === currentAudioTrackId);
          const nextIdx = (currIdx + 1) % audioTracks.length;
          selectAudioTrack(audioTracks[nextIdx].id);
        }
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (isPip) {
          onExpandFromPip?.();
        } else if (onTogglePip) {
          onTogglePip();
        } else {
          togglePiP();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, isPlaying, isMuted, duration, playbackRate, audioTracks, currentAudioTrackId, isPip, onTogglePip, onExpandFromPip]);

  const getAspectStyle = () => {
    switch (aspectRatio) {
      case '4:3':
        return 'aspect-[4/3] max-h-full object-contain';
      case 'fill':
        return 'w-full h-full object-fill';
      case 'cover':
        return 'w-full h-full object-cover';
      case '16:9':
      default:
        return 'w-full h-full object-contain';
    }
  };

  if (!channel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0d0e11] text-[#787f91] p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#181a20] border border-[#2b2f3a] flex items-center justify-center mb-4">
          <Tv className="w-8 h-8 text-[#87cf3e]" />
        </div>
        <h2 className="text-lg font-bold text-[#e3e5e8]">No Channel Selected</h2>
        <p className="text-xs text-[#717684] mt-1 max-w-sm">
          Select any channel from the TV Guide (EPG) or channel list to start streaming.
        </p>
      </div>
    );
  }

  return (
    <div 
      ref={playerContainerRef}
      onMouseMove={triggerOsd}
      onClick={triggerOsd}
      className={`flex-1 flex relative bg-[#000000] overflow-hidden select-none w-full h-full ${
        isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen' : ''
      } ${!showOsd && isFullscreen ? 'cursor-none' : 'cursor-default'} ${
        isPip ? 'group/pip cursor-default' : ''
      }`}
    >
      {/* Main Video Canvas */}
      <div 
        className="flex-1 flex items-center justify-center relative w-full h-full bg-black"
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button') || target.closest('input') || target.closest('select') || target.closest('.pointer-events-auto')) {
            return;
          }
          if (isPip) {
            onExpandFromPip?.();
          } else {
            toggleFullscreen();
          }
        }}
      >
        <video
          ref={videoRef}
          className={`${getAspectStyle()} transition-all`}
          playsInline
          autoPlay
        />

        {/* Floating Mini-Player UI when in Picture-in-Picture mode */}
        {isPip && (
          <div className="absolute inset-0 flex flex-col justify-between p-2 z-20 pointer-events-none group-hover/pip:bg-black/30 transition-colors">
            {/* Top Bar: Channel details, Live Badge, Expand, Close */}
            <div className="flex items-center justify-between pointer-events-auto bg-black/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-white/15 shadow-xl">
              <div className="flex items-center space-x-2 min-w-0 mr-1.5">
                <div className="w-5 h-5 rounded bg-[#1e222a] border border-white/10 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {channel.logo ? (
                    <img src={channel.logo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Tv className="w-3 h-3 text-[#87cf3e]" />
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white truncate max-w-[130px] sm:max-w-[160px] leading-tight">
                    {channel.name}
                  </span>
                  {currentProgram && (
                    <span className="text-[10px] text-white/60 truncate max-w-[130px] sm:max-w-[160px] leading-tight">
                      {currentProgram.title}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-1 flex-shrink-0">
                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#e03131] text-white uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
                  LIVE
                </span>
                <button
                  id="btn-pip-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandFromPip?.();
                  }}
                  title="Expand to Full Player (P)"
                  className="p-1 rounded hover:bg-white/20 text-white/80 hover:text-white transition"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  id="btn-pip-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClosePip?.();
                  }}
                  title="Close Picture-in-Picture"
                  className="p-1 rounded hover:bg-[#e03131] text-white/80 hover:text-white transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Bottom Bar: Quick Play/Pause, Mute, Audio & Expand buttons on hover */}
            <div className="opacity-0 group-hover/pip:opacity-100 transition-opacity duration-200 pointer-events-auto bg-black/85 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-white/15 flex items-center justify-between gap-2 shadow-xl">
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay();
                  }}
                  className="p-1 rounded hover:bg-white/20 text-white transition"
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-[#87cf3e]" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className="p-1 rounded hover:bg-white/20 text-white transition"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5 text-[#e03131]" /> : <Volume2 className="w-3.5 h-3.5 text-white" />}
                </button>
              </div>

              <div className="flex items-center space-x-1.5">
                {audioTracks.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const currIdx = audioTracks.findIndex(t => t.id === currentAudioTrackId);
                      const nextIdx = (currIdx + 1) % audioTracks.length;
                      selectAudioTrack(audioTracks[nextIdx].id);
                    }}
                    title={`Cycle Audio Language (${audioTracks.length} available)`}
                    className="p-1 rounded hover:bg-white/20 text-[#87cf3e] transition text-[10px]"
                  >
                    <Languages className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandFromPip?.();
                  }}
                  className="px-2 py-0.5 rounded bg-[#87cf3e] hover:bg-[#99e64e] text-[#121316] text-[10px] font-bold transition flex items-center gap-1"
                  title="Expand to Full Player"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Expand</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Animated Seek Feedback Badge (Forward / Rewind) */}
        {!isPip && seekFeedback && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="bg-black/85 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-3 animate-pulse text-white">
              {seekFeedback.type === 'rewind' ? (
                <RotateCcw className="w-8 h-8 text-[#87cf3e]" />
              ) : (
                <RotateCw className="w-8 h-8 text-[#87cf3e]" />
              )}
              <div className="flex flex-col">
                <span className="text-xl font-bold font-mono tracking-wider text-white">
                  {seekFeedback.type === 'rewind' ? `-${seekFeedback.seconds}s` : `+${seekFeedback.seconds}s`}
                </span>
                <span className="text-[10px] font-mono text-white/60">
                  {formatTime(currentTime)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Animated Audio Track Switch Feedback Badge */}
        {!isPip && audioFeedback && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="bg-black/85 backdrop-blur-md px-6 py-3.5 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-3 animate-pulse text-white">
              <Languages className="w-6 h-6 text-[#87cf3e]" />
              <div className="flex flex-col">
                <span className="text-sm font-bold font-mono tracking-wide text-white">
                  {audioFeedback}
                </span>
                <span className="text-[10px] font-mono text-white/60">
                  Audio Language Switched
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Buffering Spinner */}
        {isBuffering && !errorMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 pointer-events-none z-10">
            <div className="w-12 h-12 border-3 border-[#87cf3e]/30 border-t-[#87cf3e] rounded-full animate-spin" />
            <span className="text-xs font-mono text-[#a5e464] mt-3">Connecting to stream...</span>
          </div>
        )}

        {/* Slow Connection / Buffer Timeout Recovery Banner */}
        {!isPip && isBuffering && bufferTimeoutWarning && !errorMsg && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-[#181a22]/95 border border-[#373c4d] backdrop-blur-md px-5 py-3.5 rounded-xl shadow-2xl flex flex-col sm:flex-row items-center gap-3 z-30 max-w-lg text-center sm:text-left">
            <div className="flex items-center gap-2 text-xs text-[#d8dce6]">
              <AlertCircle className="w-4 h-4 text-[#ffd43b] flex-shrink-0" />
              <span>Stream server is taking longer than usual to respond.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setUseProxyOverride(!useProxyOverride);
                  updateSettings({ useProxy: !useProxyOverride });
                }}
                className="px-3 py-1 rounded bg-[#87cf3e] hover:bg-[#97e44e] text-[#121316] text-[11px] font-bold transition flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{useProxyOverride ? 'Try Direct' : 'Try Proxy'}</span>
              </button>
              <button
                onClick={handleCopyUrl}
                className="px-2.5 py-1 rounded bg-[#272b36] hover:bg-[#343a49] text-[#c5cbd6] text-[11px] font-medium border border-[#3d4455] transition flex items-center gap-1"
                title="Copy URL for VLC"
              >
                {copiedUrl ? <Check className="w-3 h-3 text-[#87cf3e]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedUrl ? 'Copied' : 'VLC URL'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Playback Error Overlay */}
        {errorMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 text-center z-20">
            <div className="w-14 h-14 rounded-full bg-[#e03131]/20 border border-[#e03131]/40 flex items-center justify-center mb-3 text-[#ff6b6b]">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-[#f8f9fa]">{channel.name} Stream Unavailable</h3>
            <p className="text-xs text-[#a9b0c0] mt-1 max-w-md">{errorMsg}</p>
            
            <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
              <button
                onClick={() => {
                  const nextProxy = !useProxyOverride;
                  setUseProxyOverride(nextProxy);
                  updateSettings({ useProxy: nextProxy });
                }}
                className="px-4 py-2 rounded-md bg-[#87cf3e] hover:bg-[#99e64e] text-[#121316] text-xs font-bold transition flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{useProxyOverride ? 'Switch to Direct Stream' : 'Enable Mint Stream Proxy'}</span>
              </button>

              <button
                onClick={() => {
                  setErrorMsg(null);
                  setIsBuffering(true);
                  if (videoRef.current) videoRef.current.load();
                }}
                className="px-4 py-2 rounded-md bg-[#252932] hover:bg-[#323744] text-[#d6dae2] text-xs font-medium border border-[#3b4150] transition flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Stream</span>
              </button>

              <button
                onClick={handleCopyUrl}
                className="px-3 py-2 rounded-md bg-[#1d2027] hover:bg-[#282d38] text-[#a6adb9] text-xs border border-[#323744] transition flex items-center gap-1.5"
                title="Copy Stream URL for VLC Player"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-[#87cf3e]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? 'Copied' : 'Copy Stream Link'}</span>
              </button>
            </div>
          </div>
        )}

        {/* On-Screen Display (OSD) Overlay */}
        {!isPip && (
        <div
          className={`absolute inset-0 flex flex-col justify-between p-6 pointer-events-none transition-opacity duration-500 z-10 ${
            showOsd ? 'opacity-100' : 'opacity-0'
          }`}
        >
            {/* Top Bar: Channel / Series Details */}
            <div className="flex items-center justify-between pointer-events-auto">
              <div className="flex items-center space-x-3 bg-black/60 backdrop-blur-md px-4 py-2.5 rounded-lg border border-white/10 shadow-lg">
                {/* Channel Logo / Series Cover */}
                <ChannelLogo
                  channel={channel}
                  size="md"
                  showBadge={true}
                />
                <div>
                  <div className="flex items-center gap-2">
                    {hasSeriesContext && currentEp ? (
                      <span className="text-xs font-mono font-bold bg-[#87cf3e]/20 text-[#87cf3e] border border-[#87cf3e]/40 px-1.5 py-0.2 rounded">
                        S{currentEp.seasonNum} • E{currentEp.episodeNum}
                      </span>
                    ) : (
                      <span className="text-xs font-mono font-bold text-[#87cf3e]">
                        CH {channel.num < 10 ? `0${channel.num}` : channel.num}
                      </span>
                    )}
                    <span className="text-white/40">•</span>
                    <span className="text-sm font-bold text-white tracking-wide">
                      {hasSeriesContext ? seriesContext?.seriesTitle : channel.name}
                    </span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(channel.id);
                      }}
                      className="ml-1 text-white/50 hover:text-[#ffd43b] transition"
                    >
                      <Star className={`w-3.5 h-3.5 ${channel.isFavorite ? 'fill-[#ffd43b] text-[#ffd43b]' : ''}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/70 mt-0.5">
                    <span className="px-1.5 py-0.2 rounded bg-white/15 text-[10px] font-medium text-white/90">
                      {hasSeriesContext ? (currentEp?.title || channel.group || 'TV Series') : (channel.group || 'General')}
                    </span>
                    {useProxyOverride && (
                      <span className="text-[10px] text-[#87cf3e] flex items-center gap-1 font-mono">
                        <ShieldCheck className="w-3 h-3" /> Mint Proxy Active
                      </span>
                    )}
                    <span className="text-white/40">•</span>
                    <span className="text-[10px] font-mono text-white/60">
                      {hasSeriesContext ? `Episode ${currentEpIndex + 1} of ${seriesContext?.episodes.length}` : 'HLS / AAC / 1080p'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Actions: Series Episodes, PiP, Channels List */}
              <div className="flex items-center space-x-2">
                {hasSeriesContext && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEpisodesDrawer(!showEpisodesDrawer);
                      setShowChannelDrawer(false);
                    }}
                    className={`px-3.5 py-2 rounded-lg backdrop-blur-md border text-xs font-medium flex items-center gap-2 transition ${
                      showEpisodesDrawer 
                        ? 'bg-[#87cf3e] text-[#121316] font-bold border-[#87cf3e]' 
                        : 'bg-black/60 hover:bg-black/80 text-white/90 border-white/10 hover:text-[#87cf3e]'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span>Episodes ({seriesContext?.episodes.length})</span>
                  </button>
                )}

                <button
                  id="btn-osd-pip-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onTogglePip) {
                      onTogglePip();
                    } else {
                      togglePiP();
                    }
                  }}
                  title="Picture-in-Picture Mode (P) — Browse TV Guide, Movies & Series while watching"
                  className="px-3.5 py-2 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-white/90 text-xs font-medium flex items-center gap-2 transition hover:text-[#87cf3e]"
                >
                  <PictureInPicture2 className="w-4 h-4 text-[#87cf3e]" />
                  <span>Picture-in-Picture</span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowChannelDrawer(!showChannelDrawer);
                    setShowEpisodesDrawer(false);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-white/90 text-xs font-medium flex items-center gap-2 transition"
                >
                  <ListOrdered className="w-4 h-4 text-[#87cf3e]" />
                  <span>Channels List</span>
                </button>
              </div>
            </div>

          {/* Bottom Bar: EPG Info & Player Controls */}
          <div className="flex flex-col space-y-3 pointer-events-auto">
            {/* EPG Info Banner */}
            {currentProgram && (
              <div className="bg-black/70 backdrop-blur-md p-3.5 rounded-lg border border-white/10 shadow-lg max-w-2xl">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#87cf3e]">NOW PLAYING</span>
                    <span className="text-white/40">•</span>
                    <span className="text-xs font-mono text-white/70">
                      {new Date(currentProgram.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(currentProgram.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {xcDetails && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFetchXcStreamEpg(true);
                        }}
                        disabled={isFetchingXcEpg}
                        title="Fetch latest live EPG from Xtream Codes server for this channel"
                        className="ml-2 px-2 py-0.5 rounded bg-[#87cf3e]/20 hover:bg-[#87cf3e]/30 text-[#87cf3e] text-[10px] font-bold border border-[#87cf3e]/40 flex items-center gap-1 transition"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isFetchingXcEpg ? 'animate-spin' : ''}`} />
                        <span>{isFetchingXcEpg ? 'Syncing...' : 'XC Guide'}</span>
                      </button>
                    )}
                    {xcEpgFeedback && (
                      <span className="text-[10px] text-[#87cf3e] font-mono animate-fade-in">
                        {xcEpgFeedback}
                      </span>
                    )}
                  </div>
                  {nextProgram && (
                    <span className="text-[11px] text-white/50 truncate max-w-xs">
                      NEXT: {nextProgram.title}
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-white mt-1">{currentProgram.title}</h4>
                <p className="text-xs text-white/70 line-clamp-1 mt-0.5">{currentProgram.description}</p>
              </div>
            )}

            {/* Timeline Progress Scrubber (Movies, Series, VOD & Seekable streams) */}
            {(isVod || (duration > 0 && isFinite(duration))) && (
              <div className="bg-black/80 backdrop-blur-md px-4 py-2.5 rounded-lg border border-white/10 flex flex-col gap-1.5 shadow-lg select-none">
                <div className="flex items-center justify-between text-xs font-mono text-white/80">
                  <div className="flex items-center gap-2">
                    <span className="text-[#87cf3e] font-bold">{formatTime(currentTime)}</span>
                    <span className="text-white/40">/</span>
                    <span className="text-white/70">
                      {duration > 0 && isFinite(duration) ? formatTime(duration) : '--:--'}
                    </span>
                  </div>
                  {duration > 0 && isFinite(duration) && (
                    <span className="text-white/50 text-[11px]">
                      -{formatTime(Math.max(0, duration - currentTime))}
                    </span>
                  )}
                </div>

                {/* Interactive Progress Track */}
                <div 
                  ref={progressTrackRef}
                  onMouseDown={handleScrubberMouseDown}
                  onMouseMove={handleScrubberHover}
                  onMouseLeave={handleScrubberLeave}
                  className="relative w-full h-4 group cursor-pointer flex items-center"
                >
                  <div className="w-full h-1.5 group-hover:h-2.5 bg-white/20 rounded-full overflow-hidden transition-all relative">
                    {/* Buffered Progress */}
                    <div 
                      className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all"
                      style={{ width: `${bufferedPercent}%` }}
                    />
                    {/* Played Progress */}
                    <div 
                      className="absolute top-0 bottom-0 left-0 bg-[#87cf3e] rounded-full transition-all"
                      style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                    />
                  </div>

                  {/* Scrubber Knob */}
                  <div 
                    className="absolute w-3.5 h-3.5 bg-[#87cf3e] rounded-full shadow border-2 border-white scale-0 group-hover:scale-100 transition-transform -translate-x-1/2 pointer-events-none"
                    style={{ left: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                  />

                  {/* Hover timestamp tooltip */}
                  {hoverTime !== null && (
                    <div 
                      className="absolute bottom-6 -translate-x-1/2 bg-[#121316] text-[#87cf3e] text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-[#3b4150] shadow-lg pointer-events-none"
                      style={{ left: `${hoverPos}px` }}
                    >
                      {formatTime(hoverTime)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Controls Toolbar */}
            <div className="bg-black/75 backdrop-blur-md px-4 py-2.5 rounded-lg border border-white/10 flex items-center justify-between gap-4 shadow-lg">
              {/* Playback Controls (Previous Ep, Rewind, Play/Pause, Fast-Forward, Next Ep & Volume) */}
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                {/* Previous Episode button (Series only) */}
                {hasSeriesContext && (
                  <button
                    onClick={handlePlayPrevEpisode}
                    disabled={!hasPrevEp}
                    title={hasPrevEp && prevEp ? `Previous: S${prevEp.seasonNum}E${prevEp.episodeNum} ${prevEp.title}` : 'No previous episode'}
                    className={`p-1.5 rounded-full transition flex items-center justify-center ${
                      hasPrevEp 
                        ? 'hover:bg-white/15 text-white/90 hover:text-[#87cf3e]' 
                        : 'text-white/20 cursor-not-allowed'
                    }`}
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>
                )}

                {/* Rewind 10s button */}
                <button
                  id="btn-rewind-10"
                  onClick={() => seekRelative(-10)}
                  title="Rewind 10 Seconds (Left Arrow / J)"
                  className="p-1.5 rounded-full hover:bg-white/15 text-white/90 hover:text-white transition flex items-center justify-center relative group"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-[9px] font-bold font-mono text-[#87cf3e] ml-0.5">10</span>
                </button>

                {/* Play/Pause Button */}
                <button
                  id="btn-play-pause"
                  onClick={togglePlay}
                  className="w-8 h-8 rounded-full bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] flex items-center justify-center transition shadow"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                {/* Fast-Forward 10s button */}
                <button
                  id="btn-forward-10"
                  onClick={() => seekRelative(10)}
                  title="Fast Forward 10 Seconds (Right Arrow / L)"
                  className="p-1.5 rounded-full hover:bg-white/15 text-white/90 hover:text-white transition flex items-center justify-center relative group"
                >
                  <span className="text-[9px] font-bold font-mono text-[#87cf3e] mr-0.5">10</span>
                  <RotateCw className="w-4 h-4" />
                </button>

                {/* Next Episode button (Series only) */}
                {hasSeriesContext && (
                  <button
                    onClick={handlePlayNextEpisode}
                    disabled={!hasNextEp}
                    title={hasNextEp && nextEp ? `Next: S${nextEp.seasonNum}E${nextEp.episodeNum} ${nextEp.title}` : 'No next episode'}
                    className={`p-1.5 rounded-full transition flex items-center justify-center ${
                      hasNextEp 
                        ? 'hover:bg-white/15 text-white/90 hover:text-[#87cf3e]' 
                        : 'text-white/20 cursor-not-allowed'
                    }`}
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                )}

                {/* Volume */}
                <div className="flex items-center space-x-2 ml-1 sm:ml-2">
                  <button onClick={toggleMute} className="text-white/80 hover:text-white transition">
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-[#ff6b6b]" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-16 sm:w-20 accent-[#87cf3e] cursor-pointer h-1 bg-white/20 rounded-lg"
                  />
                </div>
              </div>

              {/* Status & Stream Mode */}
              <div className="hidden sm:flex items-center space-x-2 md:space-x-3 text-xs text-white/70 font-mono">
                {isVod ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#87cf3e]/20 text-[#87cf3e] border border-[#87cf3e]/40 flex items-center gap-1">
                    <Film className="w-3 h-3" />
                    <span>VOD</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#87cf3e] animate-pulse" />
                    LIVE
                  </span>
                )}

                {/* Current Time / Duration counter */}
                <span className="text-white/90 font-medium">
                  {formatTime(currentTime)} {duration > 0 && isFinite(duration) ? `/ ${formatTime(duration)}` : ''}
                </span>

                <span className="text-white/30">|</span>

                <button
                  onClick={() => {
                    const nextProxy = !useProxyOverride;
                    setUseProxyOverride(nextProxy);
                    updateSettings({ useProxy: nextProxy });
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                    useProxyOverride 
                      ? 'bg-[#87cf3e]/20 text-[#87cf3e] border-[#87cf3e]/40' 
                      : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20'
                  }`}
                >
                  Proxy: {useProxyOverride ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Right tools: Playback Speed, Audio Tracks, Aspect Ratio, PiP, Fullscreen */}
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                {/* Audio Track Selector (Multi-Language Audio) */}
                {audioTracks.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setShowAudioMenu(!showAudioMenu);
                        setShowSpeedMenu(false);
                      }}
                      title={`Audio Track (${audioTracks.length} available) — Press 'A' to cycle`}
                      className={`px-2 py-1 rounded text-xs font-mono border transition flex items-center gap-1.5 ${
                        audioTracks.length > 1 
                          ? 'bg-white/10 hover:bg-white/20 text-white/90 border-white/15' 
                          : 'bg-white/5 text-white/60 border-white/10'
                      }`}
                    >
                      <Languages className="w-3.5 h-3.5 text-[#87cf3e]" />
                      <span className="max-w-[80px] sm:max-w-[100px] truncate">
                        {(() => {
                          const curr = audioTracks.find(t => t.id === currentAudioTrackId) || audioTracks[0];
                          return curr?.label || 'Audio';
                        })()}
                      </span>
                      {audioTracks.length > 1 && (
                        <span className="hidden sm:inline-block px-1 py-0.2 text-[9px] bg-[#87cf3e]/20 text-[#87cf3e] rounded font-bold">
                          {audioTracks.length}
                        </span>
                      )}
                    </button>

                    {showAudioMenu && (
                      <div className="absolute bottom-full mb-2 right-0 bg-[#16181f] border border-[#2b303d] rounded-lg shadow-2xl py-1 z-30 min-w-[150px] max-h-60 overflow-y-auto">
                        <div className="px-2.5 py-1 text-[10px] text-white/50 border-b border-white/10 font-bold uppercase tracking-wider flex items-center justify-between">
                          <span>Audio Tracks</span>
                          <span className="text-[#87cf3e] font-mono text-[9px]">{audioTracks.length} available</span>
                        </div>
                        {audioTracks.map((track, idx) => {
                          const isSelected = track.id === currentAudioTrackId || (currentAudioTrackId === null && idx === 0);
                          return (
                            <button
                              key={track.id}
                              onClick={() => selectAudioTrack(track.id)}
                              className={`w-full px-2.5 py-1.5 text-left text-xs transition flex items-center justify-between gap-2 ${
                                isSelected 
                                  ? 'bg-[#87cf3e]/20 text-[#87cf3e] font-bold' 
                                  : 'text-white/80 hover:bg-white/10'
                              }`}
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">{track.label}</span>
                                {track.lang && (
                                  <span className="text-[10px] text-white/40 font-mono">
                                    {track.lang.toUpperCase()}
                                  </span>
                                )}
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-[#87cf3e] flex-shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Playback Speed Menu */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setShowSpeedMenu(!showSpeedMenu);
                      setShowAudioMenu(false);
                    }}
                    title="Playback Speed"
                    className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/90 text-xs font-mono border border-white/10 transition flex items-center gap-1"
                  >
                    <Gauge className="w-3.5 h-3.5 text-[#87cf3e]" />
                    <span>{playbackRate}x</span>
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-full mb-2 right-0 bg-[#16181f] border border-[#2b303d] rounded-lg shadow-2xl py-1 z-30 min-w-[80px]">
                      <div className="px-2.5 py-1 text-[10px] text-white/50 border-b border-white/10 font-bold uppercase tracking-wider">
                        Speed
                      </div>
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changePlaybackRate(rate)}
                          className={`w-full px-2.5 py-1 text-left text-xs font-mono transition flex items-center justify-between ${
                            playbackRate === rate ? 'bg-[#87cf3e]/20 text-[#87cf3e] font-bold' : 'text-white/80 hover:bg-white/10'
                          }`}
                        >
                          <span>{rate}x</span>
                          {playbackRate === rate && <Check className="w-3 h-3 text-[#87cf3e]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={cycleAspectRatio}
                  title="Aspect Ratio (16:9, 4:3, Fill, Cover)"
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/90 text-xs font-mono border border-white/10 transition"
                >
                  {aspectRatio}
                </button>

                <button
                  id="btn-pip-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onTogglePip) {
                      onTogglePip();
                    } else {
                      togglePiP();
                    }
                  }}
                  title={isPip ? "Expand to Full Player (P)" : "Picture-in-Picture Mode (P) — Continue watching while navigating"}
                  className={`p-1.5 rounded transition flex items-center gap-1 text-xs ${
                    isPip 
                      ? 'bg-[#87cf3e] text-[#121316] font-bold shadow-sm shadow-[#87cf3e]/30' 
                      : 'bg-white/10 hover:bg-white/20 text-white/90 border border-white/10 hover:border-[#87cf3e]/40'
                  }`}
                >
                  <PictureInPicture2 className="w-4 h-4 text-[#87cf3e]" />
                  <span className="hidden xl:inline text-[11px] font-medium">PiP</span>
                </button>

                <button
                  id="btn-player-fullscreen"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  title={isFullscreen ? "Exit Fullscreen (F / Esc)" : "Full Screen (F)"}
                  className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/90 border border-white/10 transition"
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
        {/* Up Next Episode Auto-Advance Banner */}
        {nextEpCountdown !== null && nextEp && (
          <div className="absolute bottom-20 right-6 z-30 bg-[#161922]/95 backdrop-blur-md border border-[#87cf3e]/50 rounded-2xl p-4 shadow-2xl max-w-sm animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-1.5 text-xs text-[#87cf3e] font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Up Next in {nextEpCountdown}s</span>
                </div>
                <h4 className="text-sm font-bold text-white line-clamp-1">
                  S{nextEp.seasonNum}E{nextEp.episodeNum}: {nextEp.title}
                </h4>
                {nextEp.plot && (
                  <p className="text-[11px] text-[#8e95a5] line-clamp-2">
                    {nextEp.plot}
                  </p>
                )}
              </div>
              <button
                onClick={() => setNextEpCountdown(null)}
                className="text-[#686e7f] hover:text-white text-xs p-1"
                title="Cancel Auto-Play"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center space-x-2 mt-3">
              <button
                onClick={handlePlayNextEpisode}
                className="flex-1 py-1.5 px-3 rounded-lg bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold text-xs flex items-center justify-center space-x-1.5 transition shadow"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play Next Episode Now</span>
              </button>
              <button
                onClick={() => setNextEpCountdown(null)}
                className="py-1.5 px-3 rounded-lg bg-[#222632] hover:bg-[#2b3040] text-[#c0c5d0] text-xs font-semibold transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-out Series Episodes Drawer (Right side) */}
      {!isPip && showEpisodesDrawer && hasSeriesContext && (
        <div className="w-88 sm:w-96 bg-[#15171d] border-l border-[#272b35] flex flex-col z-30 shadow-2xl animate-in slide-in-from-right">
          {/* Header */}
          <div className="p-3 bg-[#191c22] border-b border-[#292d37] flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <Layers className="w-4 h-4 text-[#87cf3e] flex-shrink-0" />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-[#e3e5e8] truncate">
                  {seriesContext?.seriesTitle}
                </h4>
                <p className="text-[10px] text-[#787f90]">
                  {seriesContext?.episodes.length} Episodes • Current: S{currentEp?.seasonNum}E{currentEp?.episodeNum}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowEpisodesDrawer(false)}
              className="text-[#7d8392] hover:text-[#e3e5e8] text-xs font-mono px-2 py-0.5 rounded hover:bg-[#252932] flex-shrink-0"
            >
              ✕ Close
            </button>
          </div>

          {/* Season selector filter tabs */}
          {(() => {
            const epList = seriesContext?.episodes || [];
            const seasonsSet = new Set<number>();
            epList.forEach(e => seasonsSet.add(e.seasonNum || 1));
            const seasons = Array.from(seasonsSet).sort((a, b) => a - b);
            if (seasons.length <= 1) return null;

            return (
              <div className="p-2.5 bg-[#171920] border-b border-[#242833] flex items-center gap-1.5 overflow-x-auto">
                <button
                  onClick={() => setDrawerSelectedSeason(0)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition ${
                    drawerSelectedSeason === 0
                      ? 'bg-[#87cf3e] text-[#121316]'
                      : 'bg-[#20232c] text-[#8e95a5] hover:text-white'
                  }`}
                >
                  All
                </button>
                {seasons.map((sNum) => (
                  <button
                    key={sNum}
                    onClick={() => setDrawerSelectedSeason(sNum)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition ${
                      drawerSelectedSeason === sNum
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

          {/* Episodes List in Drawer */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#20232b] scrollbar-thin scrollbar-thumb-[#2e323e]">
            {seriesContext?.episodes
              .map((ep, originalIdx) => ({ ep, originalIdx }))
              .filter(({ ep }) => drawerSelectedSeason === 0 || (ep.seasonNum || 1) === drawerSelectedSeason)
              .map(({ ep, originalIdx }) => {
                const isCurrentPlaying = originalIdx === currentEpIndex;
                return (
                  <div
                    key={ep.id || originalIdx}
                    onClick={() => {
                      playEpisodeAtIndex(originalIdx);
                    }}
                    className={`p-3 flex items-start space-x-3 cursor-pointer hover:bg-[#1f222a] transition group ${
                      isCurrentPlaying ? 'bg-[#87cf3e]/10 border-l-2 border-[#87cf3e]' : ''
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex flex-col items-center justify-center font-bold text-xs flex-shrink-0 ${
                        isCurrentPlaying
                          ? 'bg-[#87cf3e] text-[#121316]'
                          : 'bg-[#222632] text-[#87cf3e] group-hover:bg-[#2c3242]'
                      }`}
                    >
                      <span className="text-[8px] font-mono leading-none">S{ep.seasonNum || 1}</span>
                      <span className="leading-none mt-0.5">E{ep.episodeNum}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <h5
                          className={`text-xs font-semibold truncate ${
                            isCurrentPlaying ? 'text-[#87cf3e] font-bold' : 'text-[#e3e5e8] group-hover:text-white'
                          }`}
                        >
                          {ep.title}
                        </h5>
                        {isCurrentPlaying && (
                          <span className="px-1.5 py-0.2 rounded bg-[#87cf3e] text-[#121316] text-[9px] font-black uppercase flex-shrink-0">
                            PLAYING
                          </span>
                        )}
                      </div>
                      {ep.plot && (
                        <p className="text-[11px] text-[#717686] line-clamp-2 mt-0.5">
                          {ep.plot}
                        </p>
                      )}
                      {ep.duration && (
                        <span className="text-[10px] text-[#555b6c] flex items-center gap-1 mt-1 font-mono">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{ep.duration}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Slide-out Channel Surfing Drawer (Right side) */}
      {!isPip && showChannelDrawer && (
        <div className="w-80 bg-[#15171d] border-l border-[#272b35] flex flex-col z-30 shadow-2xl">
          {/* Header */}
          <div className="p-3 bg-[#191c22] border-b border-[#292d37] flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ListOrdered className="w-4 h-4 text-[#87cf3e]" />
              <span className="text-xs font-bold text-[#e3e5e8]">Channel List</span>
              <span className="text-[10px] font-mono text-[#818798] bg-[#22252e] px-1.5 py-0.5 rounded">
                {drawerFilteredChannels.length}
              </span>
            </div>
            <button
              onClick={() => setShowChannelDrawer(false)}
              className="text-[#7d8392] hover:text-[#e3e5e8] text-xs font-mono px-2 py-0.5 rounded hover:bg-[#252932]"
            >
              ✕ Close
            </button>
          </div>

          {/* Search & Group filters */}
          <div className="p-2.5 bg-[#171920] border-b border-[#242833] space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#686e7f]" />
              <input
                type="text"
                placeholder="Search channel or number..."
                value={drawerSearch}
                onChange={(e) => setDrawerSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-[#1f222b] border border-[#2b303d] rounded-lg text-xs text-white placeholder-[#686e7f] focus:outline-none focus:border-[#87cf3e]"
              />
            </div>

            <div className="flex items-center space-x-1.5 text-xs">
              <Filter className="w-3 h-3 text-[#87cf3e] flex-shrink-0" />
              <select
                value={drawerGroup}
                onChange={(e) => setDrawerGroup(e.target.value)}
                className="w-full bg-[#1f222b] border border-[#2b303d] rounded-lg text-[11px] text-white py-1 px-2 focus:outline-none focus:border-[#87cf3e] cursor-pointer"
              >
                {drawerGroups.map((g) => (
                  <option key={g} value={g} className="bg-[#1f222b]">
                    {g} ({drawerGroupCounts[g] || 0})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Channel list */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#20232b] scrollbar-thin scrollbar-thumb-[#2e323e]">
            {drawerFilteredChannels.slice(0, 100).map((ch) => {
              const active = ch.id === channel.id;
              const sched = schedules[ch.id] || [];
              const curr = sched.find(p => p.start <= now && p.end >= now) || sched[0];

              return (
                <div
                  key={ch.id}
                  onClick={() => {
                    onSelectChannel(ch);
                    setShowChannelDrawer(false);
                  }}
                  className={`p-2.5 flex items-center space-x-3 cursor-pointer hover:bg-[#1f222a] transition ${
                    active ? 'bg-[#87cf3e]/10 border-l-2 border-[#87cf3e]' : ''
                  }`}
                >
                  <span className="font-mono text-xs font-semibold text-[#6a707e] w-5 text-center">
                    {ch.num}
                  </span>
                  <ChannelLogo
                    channel={ch}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <h5 className={`text-xs font-semibold truncate ${active ? 'text-[#87cf3e]' : 'text-[#e3e5e8]'}`}>
                      {ch.name}
                    </h5>
                    <p className="text-[10px] text-[#717686] truncate">
                      {curr ? curr.title : (ch.group || 'General')}
                    </p>
                  </div>
                </div>
              );
            })}

            {drawerFilteredChannels.length > 100 && (
              <div className="p-3 text-center text-xs text-[#717787] bg-[#161820]">
                Showing first 100 of {drawerFilteredChannels.length} channels. Use search or group selector above to narrow down.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

