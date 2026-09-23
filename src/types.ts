export interface EpgProgram {
  id: string;
  channelId: string;
  title: string;
  description: string;
  category: string;
  start: Date;
  end: Date;
  poster?: string;
  rating?: string;
}

export interface Channel {
  id: string;
  name: string;
  num: number;
  logo: string;
  tvgLogo?: string;
  tvgName?: string;
  logoSource?: 'tvg-logo' | 'xmltv' | 'iptv-org' | 'avatar';
  streamUrl: string;
  group: string;
  tvgId?: string;
  isFavorite?: boolean;
  currentProgram?: EpgProgram;
  httpHeaders?: Record<string, string>;
  userAgent?: string;
  referer?: string;
  streamId?: string | number;
  xcDetails?: {
    serverUrl: string;
    username: string;
    password: string;
    streamId?: string | number;
  };
  seriesContext?: SeriesContext;
}

export interface VodEpisode {
  id: string;
  title: string;
  seasonNum: number;
  episodeNum: number;
  streamUrl: string;
  plot?: string;
  duration?: string;
  rating?: string | number;
  containerExtension?: string;
  cover?: string;
  airDate?: string;
}

export interface SeriesContext {
  seriesId?: string | number;
  seriesTitle: string;
  poster?: string;
  backdrop?: string;
  group?: string;
  episodes: VodEpisode[];
  currentEpisodeIndex: number;
  seasonsCount?: number;
  xcDetails?: {
    serverUrl: string;
    username: string;
    password: string;
    seriesId?: string | number;
  };
}

export interface VodItem {
  id: string;
  streamId?: string | number;
  title: string;
  name: string;
  streamUrl: string;
  group: string;
  categoryName?: string;
  type: 'movie' | 'series';
  logo?: string;
  poster?: string;
  backdrop?: string;
  rating?: string | number;
  year?: string | number;
  genre?: string;
  plot?: string;
  director?: string;
  cast?: string;
  duration?: string;
  containerExtension?: string;
  tmdbId?: string | number;
  seriesId?: string | number;
  seasonsCount?: number;
  episodes?: VodEpisode[];
  userAgent?: string;
  referer?: string;
  xcDetails?: {
    serverUrl: string;
    username: string;
    password: string;
    seriesId?: string | number;
  };
}

export interface ParsedPlaylistResult {
  channels: Channel[];
  movies: VodItem[];
  series: VodItem[];
  epgUrls?: string[];
  tvgLogoCount?: number;
}

export interface EpgSourceInfo {
  id?: string;
  url?: string;
  name?: string;
  sourceName?: string;
  sourceUrl?: string;
  lastUpdated?: string | Date;
  programCount?: number;
  channelCount?: number;
  totalPrograms?: number;
  totalChannels?: number;
  status?: 'active' | 'loading' | 'error';
}

export interface XtreamAccount {
  serverUrl: string;
  username: string;
  password: string;
  expDate?: string;
  activeCons?: string;
  maxCons?: string;
  status?: string;
  serverName?: string;
}

export type ActiveTab = 'epg' | 'player' | 'movies' | 'series' | 'playlists' | 'package';

export interface PlayerSettings {
  useProxy: boolean;
  aspectRatio: '16:9' | '4:3' | 'fill' | 'cover';
  bufferLength: number; // in seconds
  hardwareAcceleration: boolean;
  theme: 'mint-dark' | 'mint-light' | 'cinematic';
  volume: number;
  muted: boolean;
  desktopPort?: number;
  tmdbApiKey?: string;
  metadataLanguage?: string; // 'auto', 'en-US', 'fr-FR', 'es-ES', 'de-DE', 'ar-SA', etc.
}

export interface RecentlyWatchedItem {
  channelId: string;
  channel: Channel;
  lastWatched: number; // timestamp in ms
  programTitle?: string;
  programCategory?: string;
}

