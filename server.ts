import express from 'express';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import { Readable } from 'stream';
import { createServer as createViteServer } from 'vite';
import { buildDebianPackage } from './scripts/create-deb.ts';
import { 
  fetchAndParseXmltvUrl, 
  parseXmltvContent, 
  decodeBase64IfEncoded 
} from './server/epgService.ts';

// Permit self-signed and custom SSL certificates from IPTV and Xtream Codes servers
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function startServer() {
  const app = express();
  // Support custom desktop port via MINT_IPTV_PORT when running on Linux Mint desktop,
  // while strictly defaulting to 3000 in the AI Studio cloud container environment.
  const PORT = process.env.MINT_IPTV_PORT ? parseInt(process.env.MINT_IPTV_PORT, 10) : 3000;

  // Middlewares
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Server port & status info
  app.get('/api/server-info', (req, res) => {
    res.json({
      port: PORT,
      isCustomPort: Boolean(process.env.MINT_IPTV_PORT),
      desktopDefaultPort: 43210,
      timestamp: new Date().toISOString()
    });
  });

  // Proxy endpoint to bypass CORS and handle IPTV m3u8/ts streams and XMLTV EPG
  app.options('/api/proxy', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.sendStatus(200);
  });

  app.get('/api/proxy', async (req, res) => {
    const rawTarget = req.query.url as string;
    if (!rawTarget) {
      return res.status(400).json({ error: 'Missing "url" query parameter' });
    }

    try {
      // Support pipe options attached to URL: http://stream.m3u8|User-Agent=...&Referer=...
      let actualUrl = rawTarget.trim();
      let customUserAgent = (req.query.userAgent as string) || '';
      let customReferer = (req.query.referer as string) || '';

      if (actualUrl.includes('|')) {
        const parts = actualUrl.split('|');
        actualUrl = parts[0].trim();
        const pipeParams = new URLSearchParams(parts.slice(1).join('&'));
        if (pipeParams.get('User-Agent')) customUserAgent = pipeParams.get('User-Agent')!;
        if (pipeParams.get('user-agent')) customUserAgent = pipeParams.get('user-agent')!;
        if (pipeParams.get('Referer')) customReferer = pipeParams.get('Referer')!;
        if (pipeParams.get('referer')) customReferer = pipeParams.get('referer')!;
        if (pipeParams.get('http-referrer')) customReferer = pipeParams.get('http-referrer')!;
      }

      // Validate url
      new URL(actualUrl);

      const fetchHeaders: Record<string, string> = {
        'User-Agent': customUserAgent || (req.headers['x-user-agent'] as string) || 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
        'Accept': '*/*',
        'Connection': 'keep-alive',
      };

      if (customReferer) {
        fetchHeaders['Referer'] = customReferer;
      }

      // Pass forward Range header if streaming video segments or seeking
      if (req.headers.range) {
        fetchHeaders['Range'] = req.headers.range;
      }

      const response = await fetch(actualUrl, {
        headers: fetchHeaders,
        redirect: 'follow',
      });

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      // Forward response status & headers
      res.status(response.status);
      const remoteContentType = (response.headers.get('content-type') || '').toLowerCase();
      const urlPath = actualUrl.split('?')[0].toLowerCase();

      // Detect content type accurately
      let contentType = response.headers.get('content-type') || 'application/octet-stream';
      if (urlPath.endsWith('.ts')) {
        contentType = 'video/mp2t';
      } else if (urlPath.endsWith('.mp4')) {
        contentType = 'video/mp4';
      } else if (urlPath.endsWith('.mkv')) {
        contentType = 'video/x-matroska';
      } else if (urlPath.endsWith('.webm')) {
        contentType = 'video/webm';
      } else if (urlPath.endsWith('.m3u8')) {
        contentType = 'application/vnd.apple.mpegurl';
      }

      res.setHeader('Content-Type', contentType);

      const contentLength = response.headers.get('content-length');
      if (contentLength && req.query.raw !== 'true') res.setHeader('Content-Length', contentLength);

      const contentRange = response.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      const acceptRanges = response.headers.get('accept-ranges') || 'bytes';
      res.setHeader('Accept-Ranges', acceptRanges);

      // Determine if response is candidate for HLS playlist parsing (m3u8 manifest) or raw download
      const isM3u8Candidate = 
        urlPath.endsWith('.m3u8') ||
        remoteContentType.includes('mpegurl') || 
        remoteContentType.includes('application/x-mpegurl') ||
        remoteContentType.includes('vnd.apple.mpegurl');

      if (req.query.raw === 'true' || isM3u8Candidate) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (req.query.raw === 'true') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.send(buffer);
        }

        const text = buffer.toString('utf-8');
        const isM3u8Content = 
          text.startsWith('#EXTM3U') || 
          text.includes('#EXTINF') || 
          text.includes('#EXT-X-STREAM-INF') || 
          text.includes('#EXT-X-TARGETDURATION') ||
          text.includes('#EXT-X-MEDIA') ||
          text.includes('#EXT-X-VERSION');

        if (isM3u8Content) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

          // Prepare query parameters to propagate to child segments
          const extraParams = new URLSearchParams();
          if (customUserAgent) extraParams.set('userAgent', customUserAgent);
          if (customReferer) extraParams.set('referer', customReferer);
          const extraQueryStr = extraParams.toString() ? `&${extraParams.toString()}` : '';

          const effectiveBaseUrl = new URL(response.url || actualUrl);
          const lines = text.split('\n');
          const processed = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            // Handle tag lines with URI="..." (e.g., #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA)
            if (trimmed.startsWith('#')) {
              if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
                  try {
                    const absolute = new URL(uri, effectiveBaseUrl).toString();
                    return `URI="/api/proxy?url=${encodeURIComponent(absolute)}${extraQueryStr}"`;
                  } catch {
                    return match;
                  }
                });
              }
              return line;
            }

            // Media segment or nested playlist URL
            try {
              const absolute = new URL(trimmed, effectiveBaseUrl).toString();
              return `/api/proxy?url=${encodeURIComponent(absolute)}${extraQueryStr}`;
            } catch {
              return line;
            }
          }).join('\n');

          return res.send(processed);
        } else {
          // If server returned binary stream or custom response despite .m3u8 extension
          return res.send(buffer);
        }
      }

      // Stream binary pipe for TS, MP4, MKV, AAC chunks
      if (response.body) {
        if (typeof (Readable as any).fromWeb === 'function') {
          const stream = (Readable as any).fromWeb(response.body as any);
          req.on('close', () => {
            stream.destroy();
          });
          stream.on('error', (err: any) => {
            console.warn(`[STREAM PIPE ERROR]: ${err.message}`);
          });
          return stream.pipe(res);
        } else {
          const arrayBuffer = await response.arrayBuffer();
          return res.send(Buffer.from(arrayBuffer));
        }
      } else {
        return res.end();
      }
    } catch (err: any) {
      console.error(`[PROXY ERROR] Failed to proxy ${rawTarget}:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: `Proxy stream failed: ${err.message}` });
      }
    }
  });

  // Xtream Codes API Proxy - Login
  app.post('/api/xc/login', async (req, res) => {
    const { serverUrl, username, password } = req.body;
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ error: 'Missing serverUrl, username, or password' });
    }

    try {
      let cleanUrl = serverUrl.trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'http://' + cleanUrl;
      }
      // Remove trailing slash
      cleanUrl = cleanUrl.replace(/\/+$/, '');

      const apiUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      console.log(`[XC LOGIN] Contacting ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: `Server returned HTTP ${response.status}` });
      }

      const data = await response.json();
      return res.json({ success: true, data, serverUrl: cleanUrl });
    } catch (err: any) {
      console.error('[XC LOGIN ERROR]:', err);
      return res.status(500).json({ error: `Connection failed: ${err.message}` });
    }
  });

  // Xtream Codes API Proxy - Actions (get_live_categories, get_live_streams, get_vod_streams, get_series, etc.)
  app.get('/api/xc/action', async (req, res) => {
    const { serverUrl, username, password, action } = req.query;
    if (!serverUrl || !username || !password || !action) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
      let cleanUrl = (serverUrl as string).trim().replace(/\/+$/, '');
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'http://' + cleanUrl;
      }

      let apiUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(username as string)}&password=${encodeURIComponent(password as string)}&action=${encodeURIComponent(action as string)}`;
      
      // Pass any additional query parameters (e.g., category_id, vod_id, series_id, stream_id)
      for (const key of Object.keys(req.query)) {
        if (!['serverUrl', 'username', 'password', 'action'].includes(key)) {
          apiUrl += `&${encodeURIComponent(key)}=${encodeURIComponent(String(req.query[key]))}`;
        }
      }

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
          'Accept': 'application/json',
        },
      });

      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: `XC Action failed: ${err.message}` });
    }
  });

  // --- Electronic Program Guide (EPG) XMLTV & Xtream Proxies ---

  // 1. Fetch & parse remote XMLTV URL (.xml or .xml.gz)
  app.get('/api/epg/fetch', async (req, res) => {
    const rawUrl = req.query.url as string;
    if (!rawUrl) {
      return res.status(400).json({ error: 'Missing "url" parameter' });
    }

    try {
      console.log(`[EPG FETCH] Fetching XMLTV guide from: ${rawUrl}`);
      const data = await fetchAndParseXmltvUrl(rawUrl);
      res.json(data);
    } catch (err: any) {
      console.error('[EPG FETCH ERROR]:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch and parse EPG XMLTV feed' });
    }
  });

  // 2. Fetch default real EPG for initial/public channels (Euronews, France 24, DW, NASA, etc.)
  app.get('/api/epg/default', async (req, res) => {
    try {
      // Primary public multi-channel XMLTV feed
      const data = await fetchAndParseXmltvUrl('https://epg.pw/xmltv/epg_FR.xml.gz');
      res.json(data);
    } catch (err: any) {
      console.warn('[DEFAULT EPG FALLBACK]:', err.message);
      res.json({
        timestamp: new Date().toISOString(),
        channelCount: 0,
        totalPrograms: 0,
        channels: {},
        programsByChannel: {},
        programsByName: {},
      });
    }
  });

  // 3. Xtream Codes EPG API Proxy
  app.get('/api/xc/epg', async (req, res) => {
    const { serverUrl, username, password, streamId } = req.query;
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ error: 'Missing serverUrl, username, or password' });
    }

    try {
      let cleanUrl = (serverUrl as string).trim().replace(/\/+$/, '');
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = 'http://' + cleanUrl;
      }
      const encodedUser = encodeURIComponent(username as string);
      const encodedPass = encodeURIComponent(password as string);

      if (streamId) {
        // Fetch short EPG for single live stream
        const apiUrl = `${cleanUrl}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_short_epg&stream_id=${encodeURIComponent(String(streamId))}&limit=20`;
        let listings: any[] = [];
        try {
          const xcRes = await fetch(apiUrl, {
            headers: {
              'User-Agent': 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
              'Accept': 'application/json',
            },
          });
          if (xcRes.ok) {
            const xcData = await xcRes.json();
            if (Array.isArray(xcData?.epg_listings)) {
              listings = xcData.epg_listings;
            } else if (Array.isArray(xcData)) {
              listings = xcData;
            }
          }
        } catch (e: any) {
          console.warn('[XC SHORT EPG FAIL, TRYING FALLBACK TABLE]:', e.message);
        }

        // Fallback to get_simple_data_table if short_epg returned nothing
        if (listings.length === 0) {
          try {
            const tableUrl = `${cleanUrl}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_simple_data_table&stream_id=${encodeURIComponent(String(streamId))}`;
            const tableRes = await fetch(tableUrl, {
              headers: {
                'User-Agent': 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
                'Accept': 'application/json',
              },
            });
            if (tableRes.ok) {
              const tableData = await tableRes.json();
              if (Array.isArray(tableData?.epg_listings)) {
                listings = tableData.epg_listings;
              } else if (Array.isArray(tableData)) {
                listings = tableData;
              }
            }
          } catch {}
        }

        const programs = listings.map((item: any, idx: number) => {
          const title = decodeBase64IfEncoded(item.title || item.name || 'Scheduled Broadcast');
          const description = decodeBase64IfEncoded(item.description || item.descr || '');
          
          let startDate: Date;
          if (item.start_timestamp) {
            startDate = new Date(parseInt(String(item.start_timestamp), 10) * 1000);
          } else if (item.start) {
            startDate = new Date(item.start);
          } else {
            startDate = new Date();
          }

          let stopDate: Date;
          if (item.stop_timestamp) {
            stopDate = new Date(parseInt(String(item.stop_timestamp), 10) * 1000);
          } else if (item.end || item.stop) {
            stopDate = new Date(item.end || item.stop);
          } else {
            stopDate = new Date(startDate.getTime() + 60 * 60 * 1000);
          }

          return {
            id: `xc-prog-${streamId}-${idx}`,
            channelId: String(streamId),
            title,
            description,
            category: item.category || 'Live Broadcast',
            start: isNaN(startDate.getTime()) ? new Date().toISOString() : startDate.toISOString(),
            end: isNaN(stopDate.getTime()) ? new Date(Date.now() + 3600000).toISOString() : stopDate.toISOString(),
          };
        });

        return res.json({
          timestamp: new Date().toISOString(),
          channelCount: 1,
          totalPrograms: programs.length,
          channels: { [String(streamId)]: { name: `Stream ${streamId}`, altNames: [String(streamId)] } },
          programsByChannel: { [String(streamId)]: programs, [`xc-${streamId}`]: programs },
          programsByName: {},
        });
      } else {
        // Try full XMLTV export from Xtream server first
        const xmltvUrl = `${cleanUrl}/xmltv.php?username=${encodedUser}&password=${encodedPass}`;
        try {
          const data = await fetchAndParseXmltvUrl(xmltvUrl);
          if (data && data.totalPrograms > 0) {
            return res.json(data);
          }
        } catch (xmltvErr: any) {
          console.warn('[XC XMLTV.PHP NOT AVAILABLE, TRYING API EPG]:', xmltvErr.message);
        }

        // Fallback: fetch via get_live_streams_epg or get_epg
        try {
          const apiEpgUrl = `${cleanUrl}/player_api.php?username=${encodedUser}&password=${encodedPass}&action=get_live_streams_epg`;
          const apiRes = await fetch(apiEpgUrl, {
            headers: {
              'User-Agent': 'IPTVSmartersPro/3.1.5.1 (Linux; Android 11)',
              'Accept': 'application/json',
            },
          });

          if (apiRes.ok) {
            const apiData = await apiRes.json();
            const epgItems = Array.isArray(apiData) ? apiData : (apiData?.epg_listings || []);
            if (Array.isArray(epgItems) && epgItems.length > 0) {
              const programsByChannel: Record<string, any[]> = {};
              const programsByName: Record<string, any[]> = {};
              let count = 0;

              for (const item of epgItems) {
                const streamId = String(item.stream_id || item.channel_id || item.id || '');
                if (!streamId) continue;

                const title = decodeBase64IfEncoded(item.title || item.name || 'Live Broadcast');
                const description = decodeBase64IfEncoded(item.description || item.descr || '');
                
                let startDate: Date;
                if (item.start_timestamp) {
                  startDate = new Date(parseInt(String(item.start_timestamp), 10) * 1000);
                } else if (item.start) {
                  startDate = new Date(item.start);
                } else {
                  startDate = new Date();
                }

                let stopDate: Date;
                if (item.stop_timestamp) {
                  stopDate = new Date(parseInt(String(item.stop_timestamp), 10) * 1000);
                } else if (item.end || item.stop) {
                  stopDate = new Date(item.end || item.stop);
                } else {
                  stopDate = new Date(startDate.getTime() + 60 * 60 * 1000);
                }

                const prog = {
                  id: `xc-prog-${streamId}-${count++}`,
                  channelId: streamId,
                  title,
                  description,
                  category: item.category || 'Live Broadcast',
                  start: isNaN(startDate.getTime()) ? new Date().toISOString() : startDate.toISOString(),
                  end: isNaN(stopDate.getTime()) ? new Date(Date.now() + 3600000).toISOString() : stopDate.toISOString(),
                };

                if (!programsByChannel[streamId]) programsByChannel[streamId] = [];
                programsByChannel[streamId].push(prog);
                if (!programsByChannel[`xc-${streamId}`]) programsByChannel[`xc-${streamId}`] = [];
                programsByChannel[`xc-${streamId}`].push(prog);
              }

              return res.json({
                timestamp: new Date().toISOString(),
                channelCount: Object.keys(programsByChannel).length,
                totalPrograms: count,
                channels: {},
                programsByChannel,
                programsByName,
              });
            }
          }
        } catch (apiErr: any) {
          console.warn('[XC GET_LIVE_STREAMS_EPG ERROR]:', apiErr.message);
        }

        // Return empty structure gracefully if server has no global EPG
        return res.json({
          timestamp: new Date().toISOString(),
          channelCount: 0,
          totalPrograms: 0,
          channels: {},
          programsByChannel: {},
          programsByName: {},
        });
      }
    } catch (err: any) {
      console.error('[XC EPG ERROR]:', err);
      res.status(500).json({ error: `Failed to fetch Xtream EPG: ${err.message}` });
    }
  });

  // 4. Parse raw client-uploaded XMLTV content
  app.post('/api/epg/parse-xml', (req, res) => {
    try {
      const xmlString = req.body.xml;
      if (!xmlString) {
        return res.status(400).json({ error: 'Missing XML content' });
      }
      const result = parseXmltvContent(xmlString);
      res.json(result);
    } catch (err: any) {
      console.error('[PARSE XML ERROR]:', err);
      res.status(500).json({ error: `Failed to parse XMLTV: ${err.message}` });
    }
  });

  // --- TMDB Metadata API Proxies (with Multi-Language & Device Language Support) ---
  const DEFAULT_TMDB_KEY = process.env.TMDB_API_KEY || '15d2ea6d0dc1d476efbca3eba2b9bbfb';
  const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

  // Helper to clean titles for optimal TMDB matching
  const cleanMediaTitle = (raw: string): string => {
    return raw
      .replace(/\b(1080p|720p|4k|uhd|hevc|x264|x265|bluray|web-dl|hdtv|multi|truefrench|vostfr|sub|ita|fra|esp|ger|rus|latino|dual|extended|remastered|directors cut|uncut|hdrip|dvdrip|cam|ts)\b/gi, '')
      .replace(/\.(mkv|mp4|avi|ts|m3u8)$/i, '')
      .replace(/^[\[\(\{][^\]\)\}]+[\]\}\)]\s*/g, '') // remove leading tags e.g. [FR] or [4K]
      .replace(/[\[\(][0-9]{4}[\]\)]/g, '') // remove bracketed year
      .replace(/[|:_\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Search TMDB for movie or TV series
  app.get('/api/tmdb/search', async (req, res) => {
    const rawQuery = (req.query.query as string) || '';
    const type = (req.query.type as string) === 'tv' || (req.query.type as string) === 'series' ? 'tv' : 'movie';
    const year = (req.query.year as string) || '';
    const language = (req.query.language as string) || 'en-US';
    const clientKey = (req.query.apiKey as string) || DEFAULT_TMDB_KEY;

    const cleanTitle = cleanMediaTitle(rawQuery);
    if (!cleanTitle) {
      return res.status(400).json({ error: 'Missing or empty search query' });
    }

    try {
      const endpoint = type === 'tv' 
        ? 'https://api.themoviedb.org/3/search/tv' 
        : 'https://api.themoviedb.org/3/search/movie';

      const searchParams = new URLSearchParams({
        api_key: clientKey,
        query: cleanTitle,
        language: language,
        page: '1',
        include_adult: 'false',
      });

      if (year) {
        if (type === 'movie') searchParams.set('primary_release_year', year);
        else searchParams.set('first_air_date_year', year);
      }

      let tmdbRes = await fetch(`${endpoint}?${searchParams.toString()}`);
      let tmdbData: any = await tmdbRes.json();

      // If no results with year, retry search without year constraint
      if ((!tmdbData.results || tmdbData.results.length === 0) && year) {
        searchParams.delete('primary_release_year');
        searchParams.delete('first_air_date_year');
        tmdbRes = await fetch(`${endpoint}?${searchParams.toString()}`);
        tmdbData = await tmdbRes.json();
      }

      // If still no results and title has multiple words, try first 3 words
      if (!tmdbData.results || tmdbData.results.length === 0) {
        const words = cleanTitle.split(' ');
        if (words.length > 2) {
          searchParams.set('query', words.slice(0, 2).join(' '));
          tmdbRes = await fetch(`${endpoint}?${searchParams.toString()}`);
          tmdbData = await tmdbRes.json();
        }
      }

      const first = tmdbData.results?.[0];
      if (!first) {
        return res.json({ found: false, results: [] });
      }

      // If result found, fetch full enriched details in requested language
      const detailEndpoint = type === 'tv'
        ? `https://api.themoviedb.org/3/tv/${first.id}`
        : `https://api.themoviedb.org/3/movie/${first.id}`;

      const detailParams = new URLSearchParams({
        api_key: clientKey,
        language: language,
        append_to_response: 'credits,videos',
      });

      const detailRes = await fetch(`${detailEndpoint}?${detailParams.toString()}`);
      const detail = detailRes.ok ? await detailRes.json() : first;

      // Check if overview is empty in requested language; fallback to English overview if needed
      let overview = detail.overview || first.overview || '';
      if (!overview && language !== 'en-US') {
        try {
          const enParams = new URLSearchParams({ api_key: clientKey, language: 'en-US' });
          const enRes = await fetch(`${detailEndpoint}?${enParams.toString()}`);
          if (enRes.ok) {
            const enData = await enRes.json();
            overview = enData.overview || '';
          }
        } catch {}
      }

      // Extract director and cast
      const crew = detail.credits?.crew || [];
      const directorObj = crew.find((c: any) => c.job === 'Director' || c.department === 'Directing');
      const director = directorObj?.name || (detail.created_by?.length ? detail.created_by.map((c: any) => c.name).join(', ') : undefined);
      
      const castArray = detail.credits?.cast || [];
      const castNames = castArray.slice(0, 5).map((c: any) => c.name).join(', ');
      const castList = castArray.slice(0, 10).map((c: any) => ({
        name: c.name,
        character: c.character,
        profileUrl: c.profile_path ? `${TMDB_IMG_BASE}/w185${c.profile_path}` : undefined,
      }));

      // Trailer video (YouTube)
      const videos = detail.videos?.results || [];
      const trailer = videos.find((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) || videos[0];

      // Formatted runtime
      let durationStr = '';
      if (detail.runtime) {
        const h = Math.floor(detail.runtime / 60);
        const m = detail.runtime % 60;
        durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
      } else if (detail.episode_run_time?.length) {
        durationStr = `~${detail.episode_run_time[0]}m / ep`;
      }

      const genresList = detail.genres?.map((g: any) => g.name) || [];

      res.json({
        found: true,
        tmdbId: detail.id || first.id,
        title: detail.title || detail.name || first.title || first.name || cleanTitle,
        originalTitle: detail.original_title || detail.original_name,
        tagline: detail.tagline || '',
        overview: overview || 'High definition on-demand feature ready for playback.',
        posterUrl: (detail.poster_path || first.poster_path) ? `${TMDB_IMG_BASE}/w500${detail.poster_path || first.poster_path}` : undefined,
        backdropUrl: (detail.backdrop_path || first.backdrop_path) ? `${TMDB_IMG_BASE}/w1280${detail.backdrop_path || first.backdrop_path}` : undefined,
        rating: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : (first.vote_average ? Math.round(first.vote_average * 10) / 10 : undefined),
        voteCount: detail.vote_count || first.vote_count,
        releaseDate: detail.release_date || detail.first_air_date || first.release_date || first.first_air_date,
        year: (detail.release_date || detail.first_air_date || first.release_date || first.first_air_date)?.slice(0, 4) || year,
        genres: genresList,
        genre: genresList.join(', '),
        director,
        cast: castNames,
        castList,
        duration: durationStr,
        trailerYoutubeKey: trailer?.key,
        language,
      });
    } catch (err: any) {
      console.error('[TMDB SEARCH ERROR]:', err);
      res.status(500).json({ error: `TMDB search failed: ${err.message}` });
    }
  });

  // Get TMDB details directly by TMDB ID
  app.get('/api/tmdb/details', async (req, res) => {
    const id = req.query.id as string;
    const type = (req.query.type as string) === 'tv' || (req.query.type as string) === 'series' ? 'tv' : 'movie';
    const language = (req.query.language as string) || 'en-US';
    const clientKey = (req.query.apiKey as string) || DEFAULT_TMDB_KEY;

    if (!id) {
      return res.status(400).json({ error: 'Missing TMDB ID' });
    }

    try {
      const endpoint = type === 'tv'
        ? `https://api.themoviedb.org/3/tv/${id}`
        : `https://api.themoviedb.org/3/movie/${id}`;

      const detailParams = new URLSearchParams({
        api_key: clientKey,
        language: language,
        append_to_response: 'credits,videos',
      });

      const response = await fetch(`${endpoint}?${detailParams.toString()}`);
      if (!response.ok) {
        return res.status(response.status).json({ error: 'TMDB resource not found' });
      }

      const detail = await response.json();

      // Check if overview is empty in requested language; fallback to English
      let overview = detail.overview || '';
      if (!overview && language !== 'en-US') {
        try {
          const enParams = new URLSearchParams({ api_key: clientKey, language: 'en-US' });
          const enRes = await fetch(`${endpoint}?${enParams.toString()}`);
          if (enRes.ok) {
            const enData = await enRes.json();
            overview = enData.overview || '';
          }
        } catch {}
      }

      const crew = detail.credits?.crew || [];
      const directorObj = crew.find((c: any) => c.job === 'Director' || c.department === 'Directing');
      const director = directorObj?.name || (detail.created_by?.length ? detail.created_by.map((c: any) => c.name).join(', ') : undefined);
      
      const castArray = detail.credits?.cast || [];
      const castNames = castArray.slice(0, 5).map((c: any) => c.name).join(', ');
      const castList = castArray.slice(0, 10).map((c: any) => ({
        name: c.name,
        character: c.character,
        profileUrl: c.profile_path ? `${TMDB_IMG_BASE}/w185${c.profile_path}` : undefined,
      }));

      const videos = detail.videos?.results || [];
      const trailer = videos.find((v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) || videos[0];

      let durationStr = '';
      if (detail.runtime) {
        const h = Math.floor(detail.runtime / 60);
        const m = detail.runtime % 60;
        durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
      } else if (detail.episode_run_time?.length) {
        durationStr = `~${detail.episode_run_time[0]}m / ep`;
      }

      const genresList = detail.genres?.map((g: any) => g.name) || [];

      res.json({
        found: true,
        tmdbId: detail.id,
        title: detail.title || detail.name,
        originalTitle: detail.original_title || detail.original_name,
        tagline: detail.tagline || '',
        overview: overview || 'High definition on-demand feature ready for playback.',
        posterUrl: detail.poster_path ? `${TMDB_IMG_BASE}/w500${detail.poster_path}` : undefined,
        backdropUrl: detail.backdrop_path ? `${TMDB_IMG_BASE}/w1280${detail.backdrop_path}` : undefined,
        rating: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : undefined,
        voteCount: detail.vote_count,
        releaseDate: detail.release_date || detail.first_air_date,
        year: (detail.release_date || detail.first_air_date)?.slice(0, 4),
        genres: genresList,
        genre: genresList.join(', '),
        director,
        cast: castNames,
        castList,
        duration: durationStr,
        trailerYoutubeKey: trailer?.key,
        language,
      });
    } catch (err: any) {
      console.error('[TMDB DETAILS ERROR]:', err);
      res.status(500).json({ error: `TMDB details failed: ${err.message}` });
    }
  });

  // Build Debian Package on demand
  app.post('/api/package/build-deb', (req, res) => {
    try {
      const debPath = buildDebianPackage();
      const stats = fs.statSync(debPath);
      res.json({
        success: true,
        fileName: 'mint-iptv-player_1.0.0_amd64.deb',
        sizeBytes: stats.size,
        sizeKb: (stats.size / 1024).toFixed(1),
        downloadUrl: '/api/package/download-deb',
      });
    } catch (err: any) {
      res.status(500).json({ error: `Build failed: ${err.message}` });
    }
  });

  // Download the pre-built or freshly generated .deb file
  const handleDebDownload = (req: express.Request, res: express.Response) => {
    const debPath = path.join(process.cwd(), 'dist', 'mint-iptv-player_1.0.0_amd64.deb');
    if (!fs.existsSync(debPath)) {
      try {
        buildDebianPackage();
      } catch (err: any) {
        return res.status(500).send(`Failed to build .deb: ${err.message}`);
      }
    }

    res.download(debPath, 'mint-iptv-player_1.0.0_amd64.deb', (err) => {
      if (err && !res.headersSent) {
        console.error('[DOWNLOAD ERROR]:', err);
        res.status(500).send('Failed to stream deb file');
      }
    });
  };

  app.get('/api/package/download-deb', handleDebDownload);
  app.get('/api/download/deb', handleDebDownload);

  // Download the .desktop launcher file
  app.get('/api/package/download-desktop', (req, res) => {
    const desktopContent = `[Desktop Entry]
Name=Mint IPTV Player
Comment=Modern IPTV Player with M3U, Xtream Codes, and EPG Grid
GenericName=IPTV & TV Guide Player
Exec=/usr/bin/mint-iptv-player %U
Icon=mint-iptv-player
Terminal=false
Type=Application
Categories=AudioVideo;Video;TV;Player;
Keywords=iptv;m3u;xtream;epg;tivimate;tv;player;stream;mint;cinnamon;
StartupWMClass=mint-iptv-player
MimeType=application/x-mpegurl;video/mp2t;application/vnd.apple.mpegurl;
Actions=FullScreen;EpgGrid;Port43210;Port8080;

[Desktop Action FullScreen]
Name=Launch in Full Screen
Exec=/usr/bin/mint-iptv-player --fullscreen

[Desktop Action EpgGrid]
Name=Open TV Guide (EPG)
Exec=/usr/bin/mint-iptv-player --view=epg

[Desktop Action Port43210]
Name=Launch on Dedicated Port (43210)
Exec=/usr/bin/mint-iptv-player --port=43210

[Desktop Action Port8080]
Name=Launch on Port 8080
Exec=/usr/bin/mint-iptv-player --port=8080
`;
    res.setHeader('Content-Disposition', 'attachment; filename="mint-iptv-player.desktop"');
    res.setHeader('Content-Type', 'application/x-desktop');
    res.send(desktopContent);
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Mint IPTV Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[Server Error]:', err);
  process.exit(1);
});
