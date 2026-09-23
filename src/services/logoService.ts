import { Channel } from '../types';
import { normalizeGroupName } from '../utils/m3uParser';

/**
 * Normalizes and sanitizes a channel logo URL from M3U playlists
 */
export function sanitizeLogoUrl(rawLogo?: string, baseUrl?: string): string {
  if (!rawLogo) return '';
  let clean = rawLogo.trim();

  // Strip wrapping quotes (single, double, backticks, typographic quotes)
  clean = clean.replace(/^["'`“”«»\s]+|["'`“”«»\s]+$/g, '').trim();

  // Decode common HTML entities (e.g. &amp; in query strings)
  clean = clean
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  if (!clean) return '';

  // If protocol-relative e.g. //domain.com/logo.png
  if (clean.startsWith('//')) {
    clean = 'https:' + clean;
  }

  // If relative path and baseUrl provided, resolve against baseUrl
  if (baseUrl && !clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('data:')) {
    try {
      clean = new URL(clean, baseUrl).toString();
    } catch {
      // Keep as-is if resolution fails
    }
  }

  return clean;
}

/**
 * Returns a secure or proxied URL for a channel logo,
 * preventing mixed-content blocking (HTTP on HTTPS) and CORS issues.
 */
export function getSafeLogoUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  const clean = sanitizeLogoUrl(rawUrl);
  if (!clean) return '';

  // If already HTTPS or data URI, load directly
  if (clean.startsWith('https://') || clean.startsWith('data:')) {
    return clean;
  }

  // If HTTP and page is running on HTTPS (like Google Cloud Run), proxy it
  if (clean.startsWith('http://')) {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return `/api/proxy?url=${encodeURIComponent(clean)}`;
    }
    return clean;
  }

  return clean;
}

/**
 * Generates high-confidence public repository logo URL candidates
 * from IPTV-org open database for channels with tvg-id.
 */
export function getIptvOrgLogoCandidates(tvgId?: string, channelName?: string): string[] {
  const candidates: string[] = [];

  if (tvgId && tvgId.trim()) {
    const cleanId = tvgId.trim();
    // 1. iptv-org GitHub raw EPG logos
    candidates.push(`https://iptv-org.github.io/epg/logos/${encodeURIComponent(cleanId)}.png`);
    candidates.push(`https://raw.githubusercontent.com/iptv-org/database/master/data/logos/${encodeURIComponent(cleanId)}.png`);

    // If ID contains country suffix e.g. "cnn.us" -> "cnn"
    if (cleanId.includes('.')) {
      const baseId = cleanId.split('.')[0];
      candidates.push(`https://iptv-org.github.io/epg/logos/${encodeURIComponent(baseId)}.png`);
    }
  }

  if (channelName && channelName.trim()) {
    // Normalized name candidate e.g. "BBC One HD" -> "BBC One"
    const simple = channelName
      .replace(/\b(hd|fhd|4k|8k|uhd|hevc|sd|tv|channel|ch|live|1080p|720p)\b/gi, '')
      .replace(/^[\[\(\{][^\]\)\}]+[\]\}\)]\s*/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim();

    if (simple && simple.length >= 2) {
      const slug = simple.replace(/\s+/g, '-');
      candidates.push(`https://iptv-org.github.io/epg/logos/${encodeURIComponent(slug)}.png`);
    }
  }

  return candidates;
}

/**
 * Category color theming for fallback badges and accents
 */
export interface CategoryTheme {
  primary: string;
  bgGradient: string;
  borderColor: string;
  textColor: string;
  label: string;
}

export function getCategoryTheme(group?: string): CategoryTheme {
  const norm = normalizeGroupName(group || '').toLowerCase();

  if (norm.includes('sport') || norm.includes('foot') || norm.includes('nba') || norm.includes('espn')) {
    return {
      primary: '#ff922b',
      bgGradient: 'from-[#ff922b]/20 to-[#c92a2a]/20',
      borderColor: '#ff922b/40',
      textColor: '#ffa94d',
      label: 'Sports',
    };
  }
  if (norm.includes('news') || norm.includes('info') || norm.includes('actu') || norm.includes('cnn')) {
    return {
      primary: '#339af0',
      bgGradient: 'from-[#339af0]/20 to-[#1c7ed6]/20',
      borderColor: '#339af0/40',
      textColor: '#74c0fc',
      label: 'News',
    };
  }
  if (norm.includes('movie') || norm.includes('cinema') || norm.includes('film') || norm.includes('vod') || norm.includes('hbo')) {
    return {
      primary: '#cc5de8',
      bgGradient: 'from-[#cc5de8]/20 to-[#845ef7]/20',
      borderColor: '#cc5de8/40',
      textColor: '#e599f7',
      label: 'Cinema',
    };
  }
  if (norm.includes('doc') || norm.includes('science') || norm.includes('nature') || norm.includes('geo')) {
    return {
      primary: '#51cf66',
      bgGradient: 'from-[#51cf66]/20 to-[#2b8a3e]/20',
      borderColor: '#51cf66/40',
      textColor: '#8ce99a',
      label: 'Docs',
    };
  }
  if (norm.includes('music') || norm.includes('mtv') || norm.includes('radio')) {
    return {
      primary: '#f06595',
      bgGradient: 'from-[#f06595]/20 to-[#c2255c]/20',
      borderColor: '#f06595/40',
      textColor: '#faa2c1',
      label: 'Music',
    };
  }
  if (norm.includes('kid') || norm.includes('anim') || norm.includes('cartoon') || norm.includes('disney')) {
    return {
      primary: '#fcc419',
      bgGradient: 'from-[#fcc419]/20 to-[#e67700]/20',
      borderColor: '#fcc419/40',
      textColor: '#ffe066',
      label: 'Kids',
    };
  }

  // Default Mint IPTV styling
  return {
    primary: '#87cf3e',
    bgGradient: 'from-[#87cf3e]/20 to-[#5c9400]/20',
    borderColor: '#87cf3e/30',
    textColor: '#87cf3e',
    label: group || 'General',
  };
}

/**
 * Extracts a concise 2-4 letter initials monogram from a channel title
 */
export function getChannelInitials(name: string): string {
  if (!name) return 'TV';
  const clean = name
    .replace(/\b(hd|fhd|4k|8k|uhd|hevc|sd|tv|channel|ch|live|raw|vip|1080p|720p)\b/gi, '')
    .replace(/^[\[\(\{][^\]\)\}]+[\]\}\)]\s*/g, '')
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  if (words.length >= 2) {
    return (words[0][0] + words[1][0] + (words[2]?.[0] || '')).toUpperCase();
  }
  return clean.slice(0, 3).toUpperCase() || 'TV';
}

/**
 * Batch enriches a list of channels with logos from:
 * 1. Explicit M3U tvg-logo
 * 2. XMLTV channel icons (from EPG)
 * 3. Public IPTV-org logos repository
 */
export function enrichChannelsWithLogos(
  channels: Channel[],
  xmltvIcons?: Record<string, string>
): { updatedChannels: Channel[]; enrichedCount: number } {
  let enrichedCount = 0;

  const updatedChannels = channels.map((channel) => {
    // If channel already has an explicit tvg-logo, keep it
    if (channel.tvgLogo && channel.tvgLogo.startsWith('http')) {
      return channel;
    }

    // Check XMLTV channel icon
    if (xmltvIcons) {
      const xmlIcon = 
        (channel.tvgId && xmltvIcons[channel.tvgId]) ||
        xmltvIcons[channel.id] ||
        xmltvIcons[channel.name];

      if (xmlIcon && xmlIcon.startsWith('http')) {
        enrichedCount++;
        return {
          ...channel,
          logo: xmlIcon,
          tvgLogo: xmlIcon,
          logoSource: 'xmltv' as const,
        };
      }
    }

    // Check if channel has tvgId to attempt IPTV-org logo
    if (channel.tvgId && !channel.logo.startsWith('http')) {
      const candidate = getIptvOrgLogoCandidates(channel.tvgId, channel.name)[0];
      if (candidate) {
        enrichedCount++;
        return {
          ...channel,
          logo: candidate,
          logoSource: 'iptv-org' as const,
        };
      }
    }

    return channel;
  });

  return { updatedChannels, enrichedCount };
}
