import { Channel, VodItem, VodEpisode, ParsedPlaylistResult } from '../types';
import { sanitizeLogoUrl } from '../services/logoService';

/**
 * Normalizes group and category names (decoding HTML entities, stripping excess quotes/brackets/spaces/decorations)
 */
export function normalizeGroupName(raw?: string): string {
  if (!raw) return 'General';
  let clean = raw.trim();
  // Remove wrapping quotes, brackets, and decorations
  clean = clean.replace(/^["'`“”«»\[\]\(\)\|\{\}]+|["'`“”«»\[\]\(\)\|\{\}]+$/g, '').trim();
  // Decode common HTML entities
  clean = clean
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&apos;/gi, "'");
  // Standardize multiple spaces
  clean = clean.replace(/\s+/g, ' ').trim();
  // Strip leading/trailing punctuation artifacts like | : - ;
  clean = clean.replace(/^[|:;~•\-—\s]+|[|:;~•\-—\s]+$/g, '').trim();

  return clean || 'General';
}

/**
 * Infers a group name from a channel title if group-title attribute is missing or generic.
 * Supports patterns: "[USA] ESPN", "UK | BBC ONE", "SPORTS - Sky Sports", "ARABIC / MBC 1", "FR: Canal+", etc.
 */
export function inferGroupFromTitle(title: string): string | null {
  if (!title) return null;
  const t = title.trim();

  // Pattern 1: [Group Name] Channel or (Group Name) Channel or |Group Name| Channel
  const bracketMatch = t.match(/^[\[\(\|]([^\]\)\|]+)[\]\)\|]/);
  if (bracketMatch) {
    const candidate = normalizeGroupName(bracketMatch[1]);
    const lower = candidate.toLowerCase();
    const nonGroupPrefixes = ['hd', 'fhd', '4k', '8k', 'uhd', 'hevc', 'h265', 'h264', 'sd', 'live', 'tv', 'ch', 'channel', 'raw', 'vip', '1080p', '720p', 'backup', 'auto'];
    if (candidate.length >= 2 && candidate.length <= 35 && !nonGroupPrefixes.includes(lower)) {
      return candidate;
    }
  }

  // Pattern 2: Group Name: Channel or Group Name | Channel or Group Name - Channel or Group Name / Channel
  // e.g. "USA: ESPN", "UK | BBC ONE", "SPORTS - Fox Soccer", "ARABIC / MBC 1", "FR - TF1 HD"
  const prefixMatch = t.match(/^([A-Za-z0-9\s&.+/'-]{2,30})\s*[:|\-/]\s*(.+)$/);
  if (prefixMatch) {
    const candidate = normalizeGroupName(prefixMatch[1]);
    const lower = candidate.toLowerCase();
    const nonGroupPrefixes = ['hd', 'fhd', '4k', '8k', 'uhd', 'hevc', 'h265', 'h264', 'sd', 'live', 'tv', 'ch', 'channel', 'raw', '1080p', '720p', 'backup', 'auto'];
    if (candidate.length >= 2 && candidate.length <= 35 && !nonGroupPrefixes.includes(lower)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parses raw attribute key-values from #EXTINF line, handling both quoted and unquoted attributes:
 * e.g. tvg-id="123" group-title="Action Movies" user-agent="VLC/3.0"
 * or group-title=News tvg-logo=http://...
 */
function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  
  // 1. Quoted attributes: key="value" or key='value' or key=`value`
  const quotedRegex = /([a-zA-Z0-9_:-]+)\s*=\s*["'`“]([^"'`”]*?)["'`”]/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRegex.exec(line)) !== null) {
    const rawKey = match[1].toLowerCase();
    const keyWithHyphen = rawKey.replace(/_/g, '-');
    const keyWithoutHyphen = rawKey.replace(/[-_:]/g, '');
    const val = match[2].trim();
    attrs[keyWithHyphen] = val;
    attrs[keyWithoutHyphen] = val;
    attrs[rawKey] = val;
  }

  // 2. Unquoted attributes e.g. group-title=News or tvg-id=123
  const unquotedRegex = /([a-zA-Z0-9_:-]+)\s*=\s*([^"'`\s,][^,]*?)(?=\s+[a-zA-Z0-9_:-]+\s*=|,\s*|$)/g;
  while ((match = unquotedRegex.exec(line)) !== null) {
    const rawKey = match[1].toLowerCase();
    const keyWithHyphen = rawKey.replace(/_/g, '-');
    const keyWithoutHyphen = rawKey.replace(/[-_:]/g, '');
    if (!attrs[keyWithHyphen] && !attrs[rawKey]) {
      const val = match[2].trim();
      attrs[keyWithHyphen] = val;
      attrs[keyWithoutHyphen] = val;
      attrs[rawKey] = val;
    }
  }

  return attrs;
}

/**
 * Extracts Year from title e.g. "Gladiator II (2024)" -> { cleanTitle: "Gladiator II", year: "2024" }
 */
function extractYearAndTitle(title: string): { cleanTitle: string; year?: string } {
  const yearMatch = title.match(/\((\d{4})\)/) || title.match(/\b(19\d\d|20\d\d)\b/);
  if (yearMatch) {
    const year = yearMatch[1];
    const cleanTitle = title.replace(/\(\d{4}\)/, '').replace(/\b(19\d\d|20\d\d)\b/, '').trim();
    return { cleanTitle: cleanTitle || title, year };
  }
  return { cleanTitle: title };
}

export interface ExtractedSeriesEpisodeInfo {
  seriesTitle: string;
  seasonNum: number;
  episodeNum: number;
  episodeTitle: string;
  year?: number;
}

/**
 * Robust extractor for Series Title, Season Number, Episode Number, and Episode Title from M3U entries.
 * Handles patterns like:
 * - "Breaking Bad S01 E02 Cat's in the Bag"
 * - "Game of Thrones (2011) 1x01 Pilot"
 * - "Friends - Season 3 Episode 12 - The One with the Embryos"
 * - "La Casa de Papel - Temporada 2 Capitulo 5"
 * - "Peaky Blinders S05 Ep.03"
 * - "[S01E01] Stranger Things - Chapter One"
 * - "Vikings T04 E15"
 */
export function extractSeriesAndEpisodeInfo(
  rawTitle: string,
  group?: string,
  streamUrl?: string
): ExtractedSeriesEpisodeInfo {
  if (!rawTitle) {
    return { seriesTitle: 'Unknown Series', seasonNum: 1, episodeNum: 1, episodeTitle: 'Episode 1' };
  }

  let title = rawTitle.trim();
  // Strip common packaging brackets at edges if wrapping whole thing
  title = title.replace(/^["'`“”«»]+|["'`“”«»]+$/g, '').trim();

  // Pattern 1: S01 E02 / S1E2 / Season 1 Episode 2 / Staffel 1 Folge 2 / Temporada 2 Capitulo 5
  const sPattern = /(?:[\s\[\(_\-\|\:\/]|^)(?:s(?:eason)?|staffel|saison|temporada|temp|stagione|st)\s*0*(\d+)\s*(?:[.\-_\s]*)\s*(?:e(?:pisode|p)?|folge|capitulo|cap|episodio)\s*0*(\d+)(?:$|[\s\]\)\-_\:\/])/i;
  // Pattern 2: S01E02 / S1E2 without word prefixes
  const shortSPattern = /(?:[\s\[\(_\-\|\:\/]|^)s0*(\d+)\s*e0*(\d+)(?:$|[\s\]\)\-_\:\/])/i;
  // Pattern 3: 1x02 / 01x02 / [1x02]
  const xPattern = /(?:[\s\[\(_\-\|\:\/]|^)0*(\d+)\s*x\s*0*(\d+)(?:$|[\s\]\)\-_\:\/])/i;
  // Pattern 4: T01 E02 / T1E2 (Tome / Temporada)
  const tPattern = /(?:[\s\[\(_\-\|\:\/]|^)t0*(\d+)\s*e(?:p)?\s*0*(\d+)(?:$|[\s\]\)\-_\:\/])/i;
  // Pattern 5: Episode only without season -> default season 1
  const epOnlyPattern = /(?:[\s\[\(_\-\|\:\/]|^)(?:episode|ep|folge|capitulo|episodio)\s*[.\-_\s]*0*(\d+)(?:$|[\s\]\)\-_\:\/])/i;

  let seasonNum = 1;
  let episodeNum = 1;
  let matchIndex = -1;
  let matchLength = 0;

  let m = title.match(sPattern);
  if (m && m.index !== undefined) {
    seasonNum = parseInt(m[1], 10) || 1;
    episodeNum = parseInt(m[2], 10) || 1;
    matchIndex = m.index;
    matchLength = m[0].length;
  } else {
    m = title.match(shortSPattern);
    if (m && m.index !== undefined) {
      seasonNum = parseInt(m[1], 10) || 1;
      episodeNum = parseInt(m[2], 10) || 1;
      matchIndex = m.index;
      matchLength = m[0].length;
    } else {
      m = title.match(xPattern);
      if (m && m.index !== undefined) {
        seasonNum = parseInt(m[1], 10) || 1;
        episodeNum = parseInt(m[2], 10) || 1;
        matchIndex = m.index;
        matchLength = m[0].length;
      } else {
        m = title.match(tPattern);
        if (m && m.index !== undefined) {
          seasonNum = parseInt(m[1], 10) || 1;
          episodeNum = parseInt(m[2], 10) || 1;
          matchIndex = m.index;
          matchLength = m[0].length;
        } else {
          m = title.match(epOnlyPattern);
          if (m && m.index !== undefined) {
            seasonNum = 1;
            episodeNum = parseInt(m[1], 10) || 1;
            matchIndex = m.index;
            matchLength = m[0].length;
          }
        }
      }
    }
  }

  // If no title pattern matched, try stream URL for /series/show_name/season/episode.mp4
  if (matchIndex === -1 && streamUrl) {
    const urlMatch = streamUrl.match(/\/s(?:eason)?0*(\d+)[/_\-]e(?:pisode)?0*(\d+)/i) ||
                     streamUrl.match(/\/(\d+)\/(\d+)\.(?:mp4|mkv|avi)/i);
    if (urlMatch) {
      seasonNum = parseInt(urlMatch[1], 10) || 1;
      episodeNum = parseInt(urlMatch[2], 10) || 1;
    }
  }

  let seriesTitle = title;
  let episodeTitle = '';

  if (matchIndex !== -1) {
    const before = title.slice(0, matchIndex).trim();
    const after = title.slice(matchIndex + matchLength).trim();

    if (before.length >= 2) {
      seriesTitle = before;
      episodeTitle = after;
    } else if (after.length >= 2) {
      // Pattern like "[S01E01] Show Title - Pilot"
      const parts = after.split(/\s*[-:–—|]\s*/);
      if (parts.length > 1) {
        seriesTitle = parts[0].trim();
        episodeTitle = parts.slice(1).join(' - ').trim();
      } else {
        seriesTitle = after;
        episodeTitle = '';
      }
    }
  }

  // Clean series title
  let cleanSeries = seriesTitle;
  // Remove wrapping brackets/parentheses
  cleanSeries = cleanSeries.replace(/^[\[\(\{]+|[\]\)\}]+$/g, '').trim();
  // Strip years in parentheses
  let extractedYear: number | undefined;
  const yearMatch = cleanSeries.match(/\((\d{4})\)/) || cleanSeries.match(/\b(19\d\d|20\d\d)\b/);
  if (yearMatch) {
    extractedYear = parseInt(yearMatch[1], 10);
    cleanSeries = cleanSeries.replace(/\(\d{4}\)/, '').replace(/\b(19\d\d|20\d\d)\b/, '').trim();
  }

  // Strip resolution & quality tags from series title
  cleanSeries = cleanSeries.replace(/\b(?:4k|8k|fhd|hd|uhd|hevc|h264|h265|1080p|720p|2160p|web-dl|bluray|multi-subs|dual-audio)\b/gi, '').trim();
  // Strip leading/trailing punctuation
  cleanSeries = cleanSeries.replace(/^[|:;~•\-—/\\\s]+|[|:;~•\-—/\\\s]+$/g, '').trim();
  // Fallback if empty
  if (!cleanSeries) {
    cleanSeries = rawTitle;
  }

  // Clean episode title
  let cleanEp = episodeTitle.replace(/^[|:;~•\-—/\\\s]+|[|:;~•\-—/\\\s]+$/g, '').trim();
  // Strip resolution & quality tags from episode title
  cleanEp = cleanEp.replace(/\b(?:4k|8k|fhd|hd|uhd|hevc|h264|h265|1080p|720p|2160p|web-dl|bluray)\b/gi, '').trim();
  cleanEp = cleanEp.replace(/^[|:;~•\-—/\\\s]+|[|:;~•\-—/\\\s]+$/g, '').trim();

  if (!cleanEp) {
    cleanEp = `S${seasonNum} E${episodeNum}`;
  } else if (!cleanEp.toLowerCase().includes(`e${episodeNum}`) && !cleanEp.toLowerCase().includes(`episode`)) {
    cleanEp = `S${seasonNum} E${episodeNum} - ${cleanEp}`;
  }

  return {
    seriesTitle: cleanSeries,
    seasonNum,
    episodeNum,
    episodeTitle: cleanEp,
    year: extractedYear,
  };
}

/**
 * Groups an array of flat Series / Episode items into unified Series VodItems with all episodes attached.
 */
export function groupSeriesEpisodes(rawSeriesItems: VodItem[]): VodItem[] {
  if (!rawSeriesItems || rawSeriesItems.length === 0) return [];

  const seriesMap = new Map<string, VodItem>();

  for (let i = 0; i < rawSeriesItems.length; i++) {
    const item = rawSeriesItems[i];
    const group = normalizeGroupName(item.group || item.categoryName || 'Series');

    // If item already contains multiple pre-grouped episodes (e.g. from XC API), merge
    if (item.episodes && item.episodes.length > 1) {
      const key = `${(item.title || item.name).toLowerCase().replace(/[^a-z0-9]/g, '')}__${group.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (seriesMap.has(key)) {
        const existing = seriesMap.get(key)!;
        const existingEpKeys = new Set(existing.episodes?.map(e => `${e.seasonNum}_${e.episodeNum}`));
        (item.episodes || []).forEach(ep => {
          if (!existingEpKeys.has(`${ep.seasonNum}_${ep.episodeNum}`)) {
            existing.episodes?.push(ep);
            existingEpKeys.add(`${ep.seasonNum}_${ep.episodeNum}`);
          }
        });
        existing.seasonsCount = Math.max(
          existing.seasonsCount || 1,
          item.seasonsCount || 1,
          ...(existing.episodes || []).map(e => e.seasonNum)
        );
      } else {
        seriesMap.set(key, {
          ...item,
          group,
          categoryName: group,
          seasonsCount: item.seasonsCount || Math.max(1, ...(item.episodes.map(e => e.seasonNum))),
        });
      }
      continue;
    }

    // Single episode item -> extract series title & episode metadata
    const rawTitle = item.name || item.title || `Series ${i + 1}`;
    const info = extractSeriesAndEpisodeInfo(rawTitle, group, item.streamUrl || '');
    
    const seriesTitle = info.seriesTitle || item.title || item.name;
    const year = info.year || (typeof item.year === 'number' ? item.year : (item.year ? parseInt(String(item.year), 10) : undefined));
    const cleanGroup = group;
    const key = `${seriesTitle.toLowerCase().replace(/[^a-z0-9]/g, '')}__${cleanGroup.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const episodeObj: VodEpisode = {
      id: item.episodes?.[0]?.id || `ep-${item.id || i}-${info.seasonNum}-${info.episodeNum}`,
      title: info.episodeTitle,
      seasonNum: info.seasonNum,
      episodeNum: info.episodeNum,
      streamUrl: item.streamUrl || item.episodes?.[0]?.streamUrl || '',
      plot: item.plot || item.episodes?.[0]?.plot,
      duration: item.duration || item.episodes?.[0]?.duration || '45m',
      rating: item.rating || item.episodes?.[0]?.rating || '8.0',
      containerExtension: item.containerExtension || 'mp4',
      cover: item.poster || item.logo,
    };

    if (seriesMap.has(key)) {
      const existing = seriesMap.get(key)!;
      if (!existing.episodes) existing.episodes = [];
      
      const existingIdx = existing.episodes.findIndex(
        e => e.seasonNum === info.seasonNum && e.episodeNum === info.episodeNum
      );
      if (existingIdx !== -1) {
        if (!existing.episodes[existingIdx].streamUrl && episodeObj.streamUrl) {
          existing.episodes[existingIdx] = episodeObj;
        }
      } else {
        existing.episodes.push(episodeObj);
      }

      existing.seasonsCount = Math.max(existing.seasonsCount || 1, info.seasonNum);
      if ((!existing.poster || existing.poster.includes('ui-avatars')) && item.poster && !item.poster.includes('ui-avatars')) {
        existing.poster = item.poster;
        existing.logo = item.logo || item.poster;
        existing.backdrop = item.backdrop || item.poster;
      }
      if (!existing.year && year) {
        existing.year = year;
      }
    } else {
      const newSeriesItem: VodItem = {
        id: `series-${key}-${i}`,
        streamId: item.streamId,
        seriesId: item.seriesId,
        name: seriesTitle,
        title: seriesTitle,
        streamUrl: item.streamUrl,
        group: cleanGroup,
        categoryName: cleanGroup,
        type: 'series',
        logo: item.logo || item.poster,
        poster: item.poster || item.logo,
        backdrop: item.backdrop || item.poster || item.logo,
        year: year,
        rating: item.rating || '8.2',
        genre: cleanGroup,
        plot: item.plot || `Television series: "${seriesTitle}".`,
        seasonsCount: info.seasonNum,
        episodes: [episodeObj],
        userAgent: item.userAgent,
        referer: item.referer,
        xcDetails: item.xcDetails,
      };
      seriesMap.set(key, newSeriesItem);
    }
  }

  // Sort episodes by season then episode number for each series
  const result: VodItem[] = [];
  seriesMap.forEach(series => {
    if (series.episodes && series.episodes.length > 0) {
      series.episodes.sort((a, b) => {
        if (a.seasonNum !== b.seasonNum) {
          return a.seasonNum - b.seasonNum;
        }
        return a.episodeNum - b.episodeNum;
      });
      const maxSeason = Math.max(...series.episodes.map(e => e.seasonNum), 1);
      series.seasonsCount = maxSeason;
      if (!series.plot || series.plot.startsWith('Television series:')) {
        series.plot = `Television series: "${series.title}". Includes ${series.episodes.length} episodes across ${maxSeason} season${maxSeason > 1 ? 's' : ''}.`;
      }
    }
    result.push(series);
  });

  return result;
}

/**
 * Extracts Season & Episode if title contains S01E02 or similar (backward compatible)
 */
function extractSeasonEpisode(title: string): { season?: number; episode?: number } {
  const info = extractSeriesAndEpisodeInfo(title);
  return { season: info.seasonNum, episode: info.episodeNum };
}

/**
 * Detects if a channel/stream entry is a Movie, Series, or Live TV
 */
function detectContentType(name: string, group: string, url: string): 'live' | 'movie' | 'series' {
  const lowerGroup = (group || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();

  // Series checks
  if (
    lowerGroup.includes('series') ||
    lowerGroup.includes('série') ||
    lowerGroup.includes('tv show') ||
    lowerGroup.includes('temporada') ||
    lowerGroup.includes('season') ||
    lowerUrl.includes('/series/') ||
    /s\d+\s*e\d+/i.test(lowerName)
  ) {
    return 'series';
  }

  // Movies / VOD checks
  if (
    lowerGroup.includes('vod') ||
    lowerGroup.includes('movie') ||
    lowerGroup.includes('film') ||
    lowerGroup.includes('cinema') ||
    lowerGroup.includes('pelicula') ||
    lowerGroup.includes('película') ||
    lowerGroup.includes('filme') ||
    lowerGroup.includes('kino') ||
    lowerGroup.includes('cine') ||
    lowerUrl.includes('/movie/') ||
    /\.(mp4|mkv|avi|mov|m4v)(\?.*)?$/i.test(lowerUrl)
  ) {
    return 'movie';
  }

  return 'live';
}

/**
 * Full, robust M3U playlist parser supporting:
 * - #EXTINF with all options (tvg-id, tvg-logo, group-title, user-agent, http-referrer)
 * - Auxiliary directives: #EXTGRP, #EXTVLCOPT, #EXTHTTP, #KODIPROP
 * - Pipe syntax: http://stream...|User-Agent=...&Referer=...
 * - Separating content into Live TV, Movies (VOD), and TV Shows (Series)
 */
export function parseM3UPlaylist(
  m3uContent: string,
  defaultOptions?: { userAgent?: string; referer?: string; sourceUrl?: string }
): ParsedPlaylistResult {
  const lines = m3uContent.split(/\r?\n/);
  const channels: Channel[] = [];
  const movies: VodItem[] = [];
  const rawSeries: VodItem[] = [];
  const epgUrls: string[] = [];

  let currentEntry: {
    tvgId?: string;
    tvgName?: string;
    name?: string;
    logo?: string;
    group?: string;
    userAgent?: string;
    referer?: string;
    rawAttributes?: Record<string, string>;
  } | null = null;

  let pendingGroup: string | null = null;
  let itemCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // 0. #EXTM3U header line - extract url-tvg or x-tvg-url
    if (/^#EXTM3U/i.test(rawLine)) {
      const headerAttrs = parseAttributes(rawLine);
      const tvgUrl = headerAttrs['url-tvg'] || headerAttrs['x-tvg-url'] || headerAttrs['url_tvg'] || headerAttrs['tvg-url'];
      if (tvgUrl) {
        // Can be comma-separated or space-separated list of URLs
        const urls = tvgUrl.split(/[,\s]+/).map(u => u.trim()).filter(u => u.startsWith('http://') || u.startsWith('https://'));
        for (const u of urls) {
          if (!epgUrls.includes(u)) {
            epgUrls.push(u);
          }
        }
      }
      continue;
    }

    // 1. #EXTINF line
    if (/^#EXTINF\s*:/i.test(rawLine)) {
      const attrs = parseAttributes(rawLine);

      // Extract display title after comma (handling commas inside quoted attributes)
      let title = '';
      const commaIdx = rawLine.lastIndexOf(',');
      if (commaIdx !== -1) {
        title = rawLine.substring(commaIdx + 1).trim();
      }
      if (!title && attrs['tvg-name']) title = attrs['tvg-name'].trim();
      if (!title) title = `Channel ${itemCounter}`;

      // Search all possible group attribute keys
      const rawGroup = 
        attrs['group-title'] || 
        attrs['grouptitle'] || 
        attrs['group_title'] || 
        attrs['group-name'] || 
        attrs['groupname'] || 
        attrs['group_name'] || 
        attrs['group'] || 
        attrs['tvg-group'] || 
        attrs['tvggroup'] || 
        attrs['tvg_group'] || 
        attrs['category'] || 
        attrs['category-name'] || 
        attrs['categoryname'] || 
        attrs['genre'] || 
        attrs['type'] || 
        pendingGroup || 
        '';

      let groupTitle = normalizeGroupName(rawGroup);
      if (groupTitle === 'General' || !groupTitle) {
        const inferred = inferGroupFromTitle(title);
        if (inferred) {
          groupTitle = inferred;
        }
      }

      // Comprehensive search across all M3U tvg-logo and icon attribute variations
      const rawLogoAttr = 
        attrs['tvg-logo'] || 
        attrs['tvg_logo'] || 
        attrs['tvglogo'] || 
        attrs['tvg-icon'] || 
        attrs['tvg_icon'] || 
        attrs['tvgicon'] || 
        attrs['logo'] || 
        attrs['icon'] || 
        attrs['channel-logo'] || 
        attrs['channel_logo'] || 
        attrs['ch-logo'] || 
        '';

      const cleanedLogo = sanitizeLogoUrl(rawLogoAttr, defaultOptions?.sourceUrl);

      currentEntry = {
        tvgId: attrs['tvg-id'] || attrs['tvg_id'] || attrs['tvgid'] || attrs['channel-id'] || '',
        name: title,
        logo: cleanedLogo,
        group: groupTitle,
        userAgent: attrs['user-agent'] || attrs['http-user-agent'] || defaultOptions?.userAgent,
        referer: attrs['http-referrer'] || attrs['referer'] || attrs['referrer'] || defaultOptions?.referer,
        rawAttributes: attrs
      };
      continue;
    }

    // 2. Auxiliary directive: #EXTGRP or #extgrp
    if (/^#EXTGRP\s*:/i.test(rawLine)) {
      const colonIdx = rawLine.indexOf(':');
      const extGrp = normalizeGroupName(rawLine.substring(colonIdx + 1));
      if (extGrp) {
        pendingGroup = extGrp;
        if (currentEntry) {
          currentEntry.group = extGrp;
        }
      }
      continue;
    }

    // 3. Auxiliary directive: #EXTVLCOPT
    if (/^#EXTVLCOPT\s*:/i.test(rawLine)) {
      if (currentEntry) {
        const colonIdx = rawLine.indexOf(':');
        const opt = rawLine.substring(colonIdx + 1).trim();
        if (opt.toLowerCase().startsWith('http-user-agent=')) {
          currentEntry.userAgent = opt.substring(16).trim();
        } else if (opt.toLowerCase().startsWith('http-referrer=')) {
          currentEntry.referer = opt.substring(14).trim();
        }
      }
      continue;
    }

    // 4. Auxiliary directive: #EXTHTTP (JSON headers)
    if (/^#EXTHTTP\s*:/i.test(rawLine)) {
      if (currentEntry) {
        try {
          const colonIdx = rawLine.indexOf(':');
          const jsonStr = rawLine.substring(colonIdx + 1).trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed.headers?.['User-Agent']) currentEntry.userAgent = parsed.headers['User-Agent'];
          if (parsed.headers?.['Referer']) currentEntry.referer = parsed.headers['Referer'];
        } catch {}
      }
      continue;
    }

    // 5. Other comment or header line (#EXTM3U, #KODIPROP, etc.)
    if (rawLine.startsWith('#')) {
      continue;
    }

    // 6. Stream URL line!
    let streamUrl = rawLine;
    let customUserAgent = currentEntry?.userAgent || defaultOptions?.userAgent;
    let customReferer = currentEntry?.referer || defaultOptions?.referer;

    // Handle pipe options on URL e.g. http://stream.m3u8|User-Agent=VLC&Referer=http://...
    if (streamUrl.includes('|')) {
      const parts = streamUrl.split('|');
      streamUrl = parts[0].trim();
      const pipeParams = new URLSearchParams(parts.slice(1).join('&'));
      if (pipeParams.get('User-Agent')) customUserAgent = pipeParams.get('User-Agent')!;
      if (pipeParams.get('user-agent')) customUserAgent = pipeParams.get('user-agent')!;
      if (pipeParams.get('Referer')) customReferer = pipeParams.get('Referer')!;
      if (pipeParams.get('referer')) customReferer = pipeParams.get('referer')!;
      if (pipeParams.get('http-referrer')) customReferer = pipeParams.get('http-referrer')!;
    }

    const title = currentEntry?.name || `Channel ${itemCounter}`;
    let group = normalizeGroupName(currentEntry?.group || pendingGroup || 'General');
    if (group === 'General' || !group) {
      const inferred = inferGroupFromTitle(title);
      if (inferred) group = inferred;
    }
    const rawLogo = currentEntry?.logo ? sanitizeLogoUrl(currentEntry.logo, defaultOptions?.sourceUrl) : '';
    const hasTvgLogo = Boolean(
      rawLogo && (rawLogo.startsWith('http://') || rawLogo.startsWith('https://') || rawLogo.startsWith('data:image/'))
    );
    const logo = hasTvgLogo
      ? rawLogo
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(title.slice(0, 4))}&background=1e2025&color=87cf3e&bold=true`;
    const tvgId = currentEntry?.tvgId || `m3u-${itemCounter}-${Date.now().toString(36)}`;

    const contentType = detectContentType(title, group, streamUrl);

    if (contentType === 'movie') {
      const { cleanTitle, year } = extractYearAndTitle(title);
      movies.push({
        id: `vod-m-${itemCounter}`,
        streamId: itemCounter,
        name: title,
        title: cleanTitle,
        streamUrl,
        group,
        categoryName: group,
        type: 'movie',
        logo,
        poster: logo,
        year: year ? parseInt(year, 10) : undefined,
        rating: (7.0 + (itemCounter % 25) / 10).toFixed(1), // TMDB default rating estimate
        genre: group,
        plot: `Full on-demand feature movie: "${cleanTitle}". Available in high-definition stream format.`,
        duration: '1h 54m',
        userAgent: customUserAgent,
        referer: customReferer,
      });
    } else if (contentType === 'series') {
      const { seriesTitle, seasonNum, episodeNum, episodeTitle, year } = extractSeriesAndEpisodeInfo(title, group, streamUrl);
      rawSeries.push({
        id: `vod-s-${itemCounter}`,
        streamId: itemCounter,
        name: title,
        title: seriesTitle,
        streamUrl,
        group,
        categoryName: group,
        type: 'series',
        logo,
        poster: logo,
        year: year,
        rating: (7.5 + (itemCounter % 20) / 10).toFixed(1),
        genre: group,
        plot: `Television series: "${seriesTitle}". Season ${seasonNum} Episode ${episodeNum}`,
        seasonsCount: seasonNum || 1,
        episodes: [
          {
            id: `ep-${itemCounter}`,
            title: episodeTitle || `S${seasonNum} E${episodeNum}`,
            seasonNum: seasonNum || 1,
            episodeNum: episodeNum || 1,
            streamUrl,
            duration: '45m',
            rating: '8.2'
          }
        ],
        userAgent: customUserAgent,
        referer: customReferer,
      });
    } else {
      // Live TV Channel with explicit tvg-logo detection
      channels.push({
        id: tvgId,
        name: title,
        num: channels.length + 1,
        logo,
        tvgLogo: hasTvgLogo ? rawLogo : undefined,
        logoSource: hasTvgLogo ? 'tvg-logo' : 'avatar',
        streamUrl,
        group,
        tvgId,
        isFavorite: false,
        userAgent: customUserAgent,
        referer: customReferer,
      });
    }

    itemCounter++;
    currentEntry = null;
    pendingGroup = null;
  }

  const groupedSeries = groupSeriesEpisodes(rawSeries);
  const tvgLogoCount = channels.filter(c => Boolean(c.tvgLogo)).length;

  return {
    channels,
    movies,
    series: groupedSeries,
    epgUrls,
    tvgLogoCount,
  };
}

/**
 * Backward-compatible helper that returns Channel[]
 */
export function parseM3U(m3uContent: string): Channel[] {
  const result = parseM3UPlaylist(m3uContent);
  // If no channels detected as live (e.g. all were labeled VOD or general), return everything as channels
  if (result.channels.length === 0 && (result.movies.length > 0 || result.series.length > 0)) {
    const fallbackChannels: Channel[] = [
      ...result.movies.map((m, idx) => ({
        id: m.id,
        name: m.name,
        num: idx + 1,
        logo: m.poster || m.logo || '',
        tvgLogo: m.poster || m.logo || undefined,
        logoSource: (m.poster || m.logo ? 'tvg-logo' : 'avatar') as 'tvg-logo' | 'avatar',
        streamUrl: m.streamUrl,
        group: m.group,
        tvgId: m.id,
        isFavorite: false,
        userAgent: m.userAgent,
        referer: m.referer
      })),
      ...result.series.map((s, idx) => ({
        id: s.id,
        name: s.name,
        num: result.movies.length + idx + 1,
        logo: s.poster || s.logo || '',
        tvgLogo: s.poster || s.logo || undefined,
        logoSource: (s.poster || s.logo ? 'tvg-logo' : 'avatar') as 'tvg-logo' | 'avatar',
        streamUrl: s.streamUrl,
        group: s.group,
        tvgId: s.id,
        isFavorite: false,
        userAgent: s.userAgent,
        referer: s.referer
      }))
    ];
    return fallbackChannels;
  }
  return result.channels;
}

