import React, { useState, useEffect } from 'react';
import { 
  X, 
  Play, 
  Calendar, 
  Clock, 
  Tv, 
  Tag, 
  Bookmark, 
  Film,
  Sparkles,
  Star,
  Globe,
  Loader2
} from 'lucide-react';
import { Channel, EpgProgram } from '../types';
import { fetchTmdbDetails, getUserDeviceLanguage, TmdbMetadata } from '../services/tmdbService';

interface ProgramDetailModalProps {
  program: EpgProgram | null;
  channel: Channel | null;
  onClose: () => void;
  onWatchChannel: (channel: Channel) => void;
}

export const ProgramDetailModal: React.FC<ProgramDetailModalProps> = ({
  program,
  channel,
  onClose,
  onWatchChannel,
}) => {
  const [tmdbData, setTmdbData] = useState<TmdbMetadata | null>(null);
  const [loadingTmdb, setLoadingTmdb] = useState<boolean>(false);

  useEffect(() => {
    if (!program) {
      setTmdbData(null);
      return;
    }

    let isMounted = true;
    const loadTmdb = async () => {
      // If program looks like a movie or recognized show
      const cat = (program.category || '').toLowerCase();
      const isLikelyFilm = cat.includes('movie') || cat.includes('film') || cat.includes('cinema');
      const isLikelyShow = cat.includes('series') || cat.includes('show') || cat.includes('drama');

      if (isLikelyFilm || isLikelyShow || program.title.length > 3) {
        setLoadingTmdb(true);
        try {
          const lang = getUserDeviceLanguage();
          const meta = await fetchTmdbDetails(
            program.title,
            isLikelyFilm ? 'movie' : 'tv',
            undefined,
            undefined,
            lang
          );
          if (isMounted) {
            setTmdbData(meta);
          }
        } catch (e) {
          // ignore
        } finally {
          if (isMounted) {
            setLoadingTmdb(false);
          }
        }
      }
    };

    loadTmdb();

    return () => {
      isMounted = false;
    };
  }, [program]);

  if (!program || !channel) return null;

  const now = new Date();
  const isAiringNow = program.start <= now && program.end >= now;
  const isPast = program.end < now;
  const durationMins = Math.round((program.end.getTime() - program.start.getTime()) / (60 * 1000));
  const deviceLang = getUserDeviceLanguage();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#171920] border border-[#2b2f3c] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Banner if TMDB Backdrop or Poster Available */}
        {tmdbData?.backdropUrl && (
          <div className="relative h-44 w-full bg-[#1b1e27] overflow-hidden flex-shrink-0">
            <img
              src={tmdbData.backdropUrl}
              alt={tmdbData.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#171920] via-[#171920]/60 to-transparent" />
          </div>
        )}

        {/* Header */}
        <div className="p-4 bg-[#131519] border-b border-[#242833] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#1f222a] border border-[#2d323f] flex items-center justify-center overflow-hidden">
              {channel.logo ? (
                <img src={channel.logo} alt={channel.name} className="w-full h-full object-cover" />
              ) : (
                <Tv className="w-4 h-4 text-[#87cf3e]" />
              )}
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#eef0f3]">{channel.name}</h4>
              <span className="text-[10px] text-[#717786]">Channel {channel.num} • {channel.group}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#7c8393] hover:text-white hover:bg-[#252834] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#87cf3e]/20 text-[#87cf3e] border border-[#87cf3e]/30">
              {program.category}
            </span>
            {isAiringNow && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#e03131]/20 text-[#ff6b6b] border border-[#e03131]/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff6b6b] animate-pulse" />
                BROADCASTING NOW
              </span>
            )}
            {isPast && (
              <span className="text-[10px] text-[#6d7383]">Ended</span>
            )}
            {(tmdbData?.rating || program.rating) && (
              <span className="px-2 py-0.5 rounded text-[10px] bg-[#22252e] text-[#ffd43b] border border-[#2e3340] flex items-center gap-1 font-bold">
                <Star className="w-3 h-3 fill-[#ffd43b]" />
                <span>{tmdbData?.rating || program.rating} TMDB</span>
              </span>
            )}
            {tmdbData && (
              <span className="text-[10px] text-[#87cf3e] flex items-center gap-1">
                <Globe className="w-3 h-3" />
                <span>TMDB ({deviceLang})</span>
              </span>
            )}
          </div>

          <div>
            <h2 className="text-xl font-black text-white leading-snug">
              {tmdbData?.title || program.title}
            </h2>
            {tmdbData?.tagline && (
              <p className="text-xs text-[#87cf3e] italic mt-0.5">"{tmdbData.tagline}"</p>
            )}
            <div className="flex items-center gap-3 text-xs text-[#8c92a0] font-mono mt-1.5">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#87cf3e]" />
                {program.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {program.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>•</span>
              <span>{durationMins} minutes</span>
            </div>
          </div>

          <div className="bg-[#121316] p-4 rounded-xl border border-[#242732] text-xs text-[#a6acb9] leading-relaxed">
            {tmdbData?.overview || program.description || 'Program guide schedule information.'}
          </div>

          {(tmdbData?.director || tmdbData?.cast) && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#242732] text-xs text-[#8c92a0]">
              {tmdbData.director && (
                <div>
                  <span className="text-[#5f6575] block text-[11px]">Director:</span>
                  <span className="font-semibold text-white">{tmdbData.director}</span>
                </div>
              )}
              {tmdbData.cast && (
                <div>
                  <span className="text-[#5f6575] block text-[11px]">Starring:</span>
                  <span className="font-semibold text-white">{tmdbData.cast}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-3 flex items-center justify-between border-t border-[#242732]">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#1f222a] hover:bg-[#2a2f3a] text-[#b8bdc8] text-xs font-semibold transition"
            >
              Close
            </button>

            <button
              onClick={() => {
                onWatchChannel(channel);
                onClose();
              }}
              className="px-5 py-2.5 rounded-lg bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold text-xs shadow-md transition flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Watch {channel.name}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
