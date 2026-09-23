import { Channel, RecentlyWatchedItem } from '../types';

/**
 * Lightweight native IndexedDB storage for Mint IPTV Player.
 * Replaces localStorage to store massive playlists (28,000+ channels, movies, series)
 * without hitting 5MB browser quota limits or freezing the UI thread.
 */

const DB_NAME = 'mint_iptv_db';
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('channels')) {
        db.createObjectStore('channels');
      }
      if (!db.objectStoreNames.contains('movies')) {
        db.createObjectStore('movies');
      }
      if (!db.objectStoreNames.contains('series')) {
        db.createObjectStore('series');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata');
      }
      if (!db.objectStoreNames.contains('recently_watched')) {
        db.createObjectStore('recently_watched');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`IndexedDB set error in ${storeName}:${key}`, err);
  }
}

export async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`IndexedDB get error in ${storeName}:${key}`, err);
    return null;
  }
}

export async function idbClear(storeName: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`IndexedDB clear error in ${storeName}`, err);
  }
}

export async function idbClearAll(): Promise<void> {
  try {
    const db = await openDB();
    const stores = ['channels', 'movies', 'series', 'settings', 'metadata', 'recently_watched'];
    for (const s of stores) {
      if (db.objectStoreNames.contains(s)) {
        await idbClear(s);
      }
    }
  } catch (err) {
    console.warn('IndexedDB clearAll error:', err);
  }
}

const RECENT_KEY = 'recently_watched_list';
const MAX_RECENT_ITEMS = 25;

/**
 * Retrieve the list of recently watched stream channels from IndexedDB.
 */
export async function getRecentlyWatched(): Promise<RecentlyWatchedItem[]> {
  try {
    // Read from metadata store with key 'recently_watched_list'
    const list = await idbGet<RecentlyWatchedItem[]>('metadata', RECENT_KEY);
    if (!list || !Array.isArray(list)) {
      return [];
    }
    return list;
  } catch (err) {
    console.warn('Failed to retrieve recently watched channels:', err);
    return [];
  }
}

/**
 * Save or bump a channel in the Recently Watched list in IndexedDB.
 */
export async function saveRecentlyWatched(
  channel: Channel,
  programTitle?: string,
  programCategory?: string
): Promise<RecentlyWatchedItem[]> {
  try {
    if (!channel || !channel.id) return [];

    const existing = await getRecentlyWatched();
    // Exclude existing entry of this channel to prevent duplicates
    const filtered = existing.filter((item) => item.channelId !== channel.id && item.channel.streamUrl !== channel.streamUrl);

    const newItem: RecentlyWatchedItem = {
      channelId: channel.id,
      channel: {
        id: channel.id,
        name: channel.name,
        num: channel.num,
        logo: channel.logo,
        streamUrl: channel.streamUrl,
        group: channel.group,
        tvgId: channel.tvgId,
        isFavorite: channel.isFavorite,
        currentProgram: channel.currentProgram,
        userAgent: channel.userAgent,
        referer: channel.referer,
        httpHeaders: channel.httpHeaders,
      },
      lastWatched: Date.now(),
      programTitle: programTitle || channel.currentProgram?.title,
      programCategory: programCategory || channel.currentProgram?.category || channel.group,
    };

    const updated = [newItem, ...filtered].slice(0, MAX_RECENT_ITEMS);
    await idbSet('metadata', RECENT_KEY, updated);
    return updated;
  } catch (err) {
    console.warn('Failed to persist recently watched channel:', err);
    return [];
  }
}

/**
 * Remove an individual channel from recently watched list in IndexedDB.
 */
export async function removeRecentlyWatched(channelId: string): Promise<RecentlyWatchedItem[]> {
  try {
    const existing = await getRecentlyWatched();
    const updated = existing.filter((item) => item.channelId !== channelId);
    await idbSet('metadata', RECENT_KEY, updated);
    return updated;
  } catch (err) {
    console.warn('Failed to remove channel from recently watched:', err);
    return [];
  }
}

/**
 * Clear all recently watched items from IndexedDB.
 */
export async function clearRecentlyWatched(): Promise<void> {
  try {
    await idbSet('metadata', RECENT_KEY, []);
  } catch (err) {
    console.warn('Failed to clear recently watched:', err);
  }
}
