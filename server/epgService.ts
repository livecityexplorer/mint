import zlib from 'zlib';

export interface RawXmltvProgram {
  id: string;
  channelId: string;
  title: string;
  description: string;
  category: string;
  start: string; // ISO string
  end: string;   // ISO string
  poster?: string;
  rating?: string;
}

export interface ParsedXmltvResult {
  sourceUrl?: string;
  timestamp: string;
  channelCount: number;
  totalPrograms: number;
  channels: Record<string, { name: string; icon?: string; altNames: string[] }>;
  programsByChannel: Record<string, RawXmltvProgram[]>;
  programsByName: Record<string, RawXmltvProgram[]>;
}

// In-memory cache for parsed XMLTV feeds (TTL: 2 hours)
const EPG_CACHE = new Map<string, { data: ParsedXmltvResult; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export function decodeXmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

export function extractTagContent(xmlSnippet: string, tagName: string): string {
  // Handles <tag>content</tag>, <tag lang="en">content</tag>, <tag><![CDATA[content]]></tag>
  const regex = new RegExp(`<${tagName}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tagName}>`, 'i');
  const match = xmlSnippet.match(regex);
  if (!match) return '';
  const val = (match[1] !== undefined ? match[1] : match[2]) || '';
  return decodeXmlEntities(val.trim());
}

export function normalizeChannelName(raw: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/\b(hd|fhd|4k|8k|uhd|hevc|h264|h265|sd|tv|channel|ch|live|backup|raw|vip|1080p|720p|50fps|60fps|plus|\+)\b/g, '')
    .replace(/^[\[\(\{][^\]\)\}]+[\]\}\)]\s*/g, '') // remove prefix tags like [FR] or (US)
    .replace(/^[a-z0-9\s&.+/'-]{2,15}\s*[:|\-/]\s*/g, '') // remove prefix like "USA : " or "UK | "
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Parses all standard XMLTV date formats:
 * - "20260921200000 +0000"
 * - "20260921200000 -0400"
 * - "20260921200000 +02:00"
 * - "20260921200000"
 * - "2026-09-21T20:00:00Z"
 * - "2026-09-21 20:00:00"
 */
export function parseXmltvDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const s = dateStr.trim();

  // Standard XMLTV: YYYYMMDDHHMMSS [+-]HHMM or YYYYMMDDHHMMSS [+-]HH:MM
  const xmltvMatch = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{2}):?(\d{2}))?/);
  if (xmltvMatch) {
    const [_, y, m, d, h, min, sec, tzH, tzM] = xmltvMatch;
    if (tzH !== undefined && tzM !== undefined) {
      const iso = `${y}-${m}-${d}T${h}:${min}:${sec}${tzH}:${tzM}`;
      const parsed = new Date(iso);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +sec));
  }

  // ISO / standard date fallback
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return fallback;
  }

  return null;
}

export function decodeBase64IfEncoded(str: string): string {
  if (!str) return '';
  const trimmed = str.trim();
  // Valid Base64 check (multiple of 4, at least 4 chars)
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0 && trimmed.length >= 4) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (/^[\x20-\x7E\s\u00A0-\uFFFF]+$/.test(decoded) && decoded.length > 0) {
        return decoded;
      }
    } catch {}
  }
  return str;
}

/**
 * Robust XMLTV Parser that supports attributes in any order, CDATA blocks,
 * and comprehensive channel aliases and program metadata.
 */
export function parseXmltvContent(xmlString: string, sourceUrl?: string): ParsedXmltvResult {
  const channels: Record<string, { name: string; icon?: string; altNames: string[] }> = {};

  // Extract <channel ...> blocks (attributes in ANY order)
  const channelRegex = /<channel\s+([^>]+)>([\s\S]*?)<\/channel>/gi;
  let chMatch: RegExpExecArray | null;

  while ((chMatch = channelRegex.exec(xmlString)) !== null) {
    const attrStr = chMatch[1];
    const body = chMatch[2];

    const idMatch = attrStr.match(/id=["']([^"']+)["']/i);
    if (!idMatch) continue;
    const chId = idMatch[1].trim();

    // Extract all <display-name> tags (with or without CDATA)
    const displayNames: string[] = [];
    const nameRegex = /<display-name[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/display-name>/gi;
    let nMatch: RegExpExecArray | null;
    while ((nMatch = nameRegex.exec(body)) !== null) {
      const rawName = (nMatch[1] !== undefined ? nMatch[1] : nMatch[2]) || '';
      const nameVal = decodeXmlEntities(rawName.trim());
      if (nameVal && !displayNames.includes(nameVal)) {
        displayNames.push(nameVal);
      }
    }

    const iconMatch = body.match(/<icon[^>]+src=["']([^"']+)["']/i);
    const primaryName = displayNames[0] || chId;

    channels[chId] = {
      name: primaryName,
      icon: iconMatch ? iconMatch[1] : undefined,
      altNames: displayNames.length > 0 ? displayNames : [primaryName],
    };
  }

  // Extract <programme ...> blocks (attributes in ANY order)
  const programsByChannel: Record<string, RawXmltvProgram[]> = {};
  const programsByName: Record<string, RawXmltvProgram[]> = {};

  const progRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/gi;
  let pMatch: RegExpExecArray | null;
  let count = 0;

  while ((pMatch = progRegex.exec(xmlString)) !== null) {
    const attrStr = pMatch[1];
    const body = pMatch[2];

    const chIdMatch = attrStr.match(/channel=["']([^"']+)["']/i);
    const startMatch = attrStr.match(/start=["']([^"']+)["']/i);
    const stopMatch = attrStr.match(/(?:stop|end)=["']([^"']+)["']/i);

    if (!chIdMatch || !startMatch || !stopMatch) continue;

    const chId = chIdMatch[1].trim();
    const startDate = parseXmltvDate(startMatch[1]);
    const stopDate = parseXmltvDate(stopMatch[1]);
    if (!startDate || !stopDate) continue;

    const title = extractTagContent(body, 'title') || 'Scheduled Broadcast';
    const description = extractTagContent(body, 'desc') || '';
    const category = extractTagContent(body, 'category') || 'Live TV';
    
    const iconMatch = body.match(/<icon[^>]+src=["']([^"']+)["']/i);
    const ratingMatch = body.match(/<star-rating[^>]*>[\s\S]*?<value>([^<]+)<\/value>/i) ||
                        body.match(/<rating[^>]*>[\s\S]*?<value>([^<]+)<\/value>/i);

    const prog: RawXmltvProgram = {
      id: `xmltv-${chId}-${count++}`,
      channelId: chId,
      title,
      description,
      category,
      start: startDate.toISOString(),
      end: stopDate.toISOString(),
      poster: iconMatch ? iconMatch[1] : undefined,
      rating: ratingMatch ? decodeXmlEntities(ratingMatch[1].trim()) : undefined,
    };

    // 1. Index by raw XMLTV channel ID
    if (!programsByChannel[chId]) {
      programsByChannel[chId] = [];
    }
    programsByChannel[chId].push(prog);

    // 2. Index by normalized channel ID
    const normChId = normalizeChannelName(chId);
    if (normChId) {
      if (!programsByName[normChId]) {
        programsByName[normChId] = [];
      }
      programsByName[normChId].push(prog);
    }

    // 3. Index by all associated display names for this channel
    const chInfo = channels[chId];
    if (chInfo && chInfo.altNames) {
      for (const altName of chInfo.altNames) {
        const normAlt = normalizeChannelName(altName);
        if (normAlt && normAlt !== normChId) {
          if (!programsByName[normAlt]) {
            programsByName[normAlt] = [];
          }
          programsByName[normAlt].push(prog);
        }
      }
    }
  }

  // Chronologically sort all program arrays
  for (const k of Object.keys(programsByChannel)) {
    programsByChannel[k].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }
  for (const k of Object.keys(programsByName)) {
    programsByName[k].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  return {
    sourceUrl,
    timestamp: new Date().toISOString(),
    channelCount: Object.keys(channels).length || Object.keys(programsByChannel).length,
    totalPrograms: count,
    channels,
    programsByChannel,
    programsByName,
  };
}

/**
 * Fetches and decompresses remote XMLTV URLs (.xml or .gz / .xml.gz)
 */
export async function fetchAndParseXmltvUrl(targetUrl: string): Promise<ParsedXmltvResult> {
  const cleanUrl = targetUrl.trim();
  const cached = EPG_CACHE.get(cleanUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
  };

  const response = await fetch(cleanUrl, {
    headers: fetchHeaders,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch XMLTV feed (HTTP ${response.status} ${response.statusText})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let xmlString = '';
  // Check if gzipped (magic bytes 0x1f 0x8b or url ending in .gz)
  const isGzip = (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) || cleanUrl.toLowerCase().endsWith('.gz');

  if (isGzip) {
    try {
      const decompressed = zlib.gunzipSync(buffer);
      xmlString = decompressed.toString('utf-8');
    } catch (e: any) {
      // Fallback: try inflateSync or raw text
      try {
        const inflated = zlib.inflateSync(buffer);
        xmlString = inflated.toString('utf-8');
      } catch {
        xmlString = buffer.toString('utf-8');
      }
    }
  } else {
    xmlString = buffer.toString('utf-8');
  }

  const result = parseXmltvContent(xmlString, cleanUrl);
  EPG_CACHE.set(cleanUrl, {
    data: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}
