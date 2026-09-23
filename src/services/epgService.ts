import { Channel, EpgProgram } from '../types';
import { generateScheduleForChannel } from '../data/sampleChannels';

export interface EpgPayload {
  sourceUrl?: string;
  timestamp: string;
  channelCount: number;
  totalPrograms: number;
  channels: Record<string, { name: string; icon?: string; altNames: string[] }>;
  programsByChannel: Record<string, Array<{
    id: string;
    channelId: string;
    title: string;
    description: string;
    category: string;
    start: string;
    end: string;
    poster?: string;
    rating?: string;
  }>>;
  programsByName: Record<string, Array<{
    id: string;
    channelId: string;
    title: string;
    description: string;
    category: string;
    start: string;
    end: string;
    poster?: string;
    rating?: string;
  }>>;
}

export function normalizeChannelName(raw: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/\b(hd|fhd|4k|8k|uhd|hevc|h264|h265|sd|tv|channel|ch|live|backup|raw|vip|1080p|720p|50fps|60fps|plus|\+)\b/g, '')
    .replace(/^[\[\(\{][^\]\)\}]+[\]\}\)]\s*/g, '') // remove tags like [FR] or (US)
    .replace(/^[a-z0-9\s&.+/'-]{2,15}\s*[:|\-/]\s*/g, '') // remove prefix like "USA : " or "UK | "
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Converts ISO date strings to native Date objects in EpgProgram
 */
function convertRawProgram(raw: any, targetChannelId: string): EpgProgram {
  return {
    id: raw.id || `prog-${targetChannelId}-${Math.random().toString(36).slice(2, 8)}`,
    channelId: targetChannelId,
    title: raw.title || 'Scheduled Program',
    description: raw.description || 'Program guide schedule information.',
    category: raw.category || 'General',
    start: new Date(raw.start),
    end: new Date(raw.end),
    poster: raw.poster,
    rating: raw.rating,
  };
}

/**
 * Matches channels against an XMLTV / EPG payload using multi-level heuristic matching
 */
export function matchChannelsWithEpg(
  channels: Channel[],
  epgData: EpgPayload
): { schedules: Record<string, EpgProgram[]>; matchedCount: number } {
  const schedules: Record<string, EpgProgram[]> = {};
  let matchedCount = 0;

  if (!epgData || !epgData.programsByChannel) {
    return { schedules, matchedCount: 0 };
  }

  const { programsByChannel, programsByName } = epgData;
  const nameKeys = Object.keys(programsByName || {});

  for (const channel of channels) {
    let rawList: any[] | undefined;

    // Level 1: Match by streamId (for Xtream Codes channels)
    if (!rawList && channel.streamId) {
      const sId = String(channel.streamId);
      if (programsByChannel[sId]) {
        rawList = programsByChannel[sId];
      } else if (programsByChannel[`xc-${sId}`]) {
        rawList = programsByChannel[`xc-${sId}`];
      }
    }

    // Level 2: Match by exact channel.tvgId
    if (!rawList && channel.tvgId && programsByChannel[channel.tvgId]) {
      rawList = programsByChannel[channel.tvgId];
    }

    // Level 3: Match by exact channel.id
    if (!rawList && programsByChannel[channel.id]) {
      rawList = programsByChannel[channel.id];
    }

    // Level 4: Match by stripped channel.id (e.g. xc-1234 -> 1234)
    if (!rawList && channel.id.startsWith('xc-')) {
      const stripped = channel.id.replace(/^xc-/, '');
      if (programsByChannel[stripped]) {
        rawList = programsByChannel[stripped];
      }
    }

    // Level 5: Match by normalized tvgId
    if (!rawList && channel.tvgId) {
      const normTvgId = normalizeChannelName(channel.tvgId);
      if (normTvgId && programsByName[normTvgId]) {
        rawList = programsByName[normTvgId];
      }
    }

    // Level 6: Match by normalized channel.tvgName (if present)
    if (!rawList && channel.tvgName) {
      const normTvgName = normalizeChannelName(channel.tvgName);
      if (normTvgName && programsByName[normTvgName]) {
        rawList = programsByName[normTvgName];
      }
    }

    // Level 7: Match by normalized channel.name
    if (!rawList && channel.name) {
      const normName = normalizeChannelName(channel.name);
      if (normName && programsByName[normName]) {
        rawList = programsByName[normName];
      }
    }

    // Level 8: Fuzzy key containment matching
    if (!rawList && channel.name) {
      const normName = normalizeChannelName(channel.name);
      if (normName.length >= 3) {
        // Find best candidate in nameKeys
        const foundKey = nameKeys.find(
          (k) => k.length >= 3 && (normName.includes(k) || k.includes(normName))
        );
        if (foundKey && programsByName[foundKey]) {
          rawList = programsByName[foundKey];
        }
      }
    }

    // If real programs matched, convert and assign
    if (rawList && rawList.length > 0) {
      schedules[channel.id] = rawList.map((p) => convertRawProgram(p, channel.id));
      matchedCount++;
    }
  }

  return { schedules, matchedCount };
}

/**
 * Returns the currently active on-air program for a channel schedule
 */
export function getCurrentOnAirProgram(
  programs: EpgProgram[] | undefined,
  now: Date = new Date()
): EpgProgram | undefined {
  if (!programs || programs.length === 0) return undefined;
  const nowMs = now.getTime();
  return (
    programs.find((p) => p.start.getTime() <= nowMs && p.end.getTime() >= nowMs) ||
    programs.find((p) => p.start.getTime() > nowMs) ||
    programs[0]
  );
}

/**
 * Gets real schedule for a channel. Returns real data only.
 */
export function getScheduleForChannel(
  channel: Channel,
  schedules: Record<string, EpgProgram[]>
): EpgProgram[] {
  if (schedules[channel.id] && schedules[channel.id].length > 0) {
    return schedules[channel.id];
  }
  return [];
}

/**
 * Extracts Xtream Codes server credentials and stream ID from channel data or stream URL
 */
export function extractXcDetailsFromChannel(channel: Channel): {
  serverUrl: string;
  username: string;
  password: string;
  streamId: string | number;
} | null {
  if (channel.xcDetails && channel.xcDetails.serverUrl && channel.xcDetails.username && channel.xcDetails.password) {
    return {
      serverUrl: channel.xcDetails.serverUrl,
      username: channel.xcDetails.username,
      password: channel.xcDetails.password,
      streamId: channel.xcDetails.streamId || channel.streamId || channel.id.replace(/^xc-/, ''),
    };
  }

  // Parse directly from streamUrl if it follows Xtream URL structure
  try {
    const rawUrl = channel.streamUrl.split('|')[0].trim();
    const url = new URL(rawUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // /live/:user/:pass/:streamId(.m3u8|.ts)
    if (pathParts.length >= 4 && pathParts[0] === 'live') {
      const username = decodeURIComponent(pathParts[1]);
      const password = decodeURIComponent(pathParts[2]);
      const streamId = pathParts[3].replace(/\.(m3u8|ts|mp4)$/i, '');
      const serverUrl = `${url.protocol}//${url.host}`;
      return { serverUrl, username, password, streamId };
    } else if (pathParts.length >= 3 && !['hls', 'manifest', 'api'].includes(pathParts[0])) {
      const username = decodeURIComponent(pathParts[0]);
      const password = decodeURIComponent(pathParts[1]);
      const streamId = pathParts[2].replace(/\.(m3u8|ts|mp4)$/i, '');
      const serverUrl = `${url.protocol}//${url.host}`;
      return { serverUrl, username, password, streamId };
    }
  } catch {}

  return null;
}

/**
 * Fetch Xtream Codes short EPG for a specific live stream ID
 */
export async function fetchSingleXtreamStreamEpg(
  serverUrl: string,
  username: string,
  password: string,
  streamId: string | number,
  targetChannelId?: string
): Promise<EpgProgram[]> {
  try {
    const payload = await fetchXtreamEpg(serverUrl, username, password, streamId);
    if (!payload || !payload.programsByChannel) return [];
    
    const key = String(streamId);
    const rawList = payload.programsByChannel[key] || 
                    payload.programsByChannel[`xc-${key}`] || 
                    Object.values(payload.programsByChannel)[0] || 
                    [];

    const effectiveChannelId = targetChannelId || `xc-${key}`;
    return rawList.map((p) => convertRawProgram(p, effectiveChannelId));
  } catch (err: any) {
    console.warn(`[XC STREAM EPG FETCH ERROR stream ${streamId}]:`, err.message);
    return [];
  }
}

/**
 * Fetch and parse EPG from a remote XMLTV URL (.xml or .xml.gz)
 */
export async function fetchEpgFromUrl(url: string): Promise<EpgPayload> {
  const encoded = encodeURIComponent(url.trim());
  const res = await fetch(`/api/epg/fetch?url=${encoded}`);
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(errorJson.error || `HTTP ${res.status}: Failed to fetch EPG XMLTV feed`);
  }
  return await res.json();
}

/**
 * Fetch default real EPG for initial/public channels
 */
export async function fetchDefaultEpg(): Promise<EpgPayload> {
  const res = await fetch('/api/epg/default');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: Could not load default EPG`);
  }
  return await res.json();
}

/**
 * Fetch Xtream Codes EPG for live streams
 */
export async function fetchXtreamEpg(
  serverUrl: string,
  username: string,
  password: string,
  streamId?: string | number
): Promise<EpgPayload> {
  const query = new URLSearchParams({
    serverUrl,
    username,
    password,
  });
  if (streamId) query.set('streamId', String(streamId));

  const res = await fetch(`/api/xc/epg?${query.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}: Xtream EPG request failed`);
  }
  return await res.json();
}

/**
 * Parse uploaded local XMLTV file
 */
export async function parseLocalXmltv(file: File): Promise<EpgPayload> {
  const formData = new FormData();
  formData.append('xmlFile', file);

  const res = await fetch('/api/epg/parse-file', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}: Failed to parse local XMLTV file`);
  }

  return await res.json();
}
