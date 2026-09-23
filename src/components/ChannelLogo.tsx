import React, { useState, useEffect } from 'react';
import { Tv, Sparkles } from 'lucide-react';
import { Channel } from '../types';
import { getSafeLogoUrl, getCategoryTheme, getChannelInitials } from '../services/logoService';

interface ChannelLogoProps {
  channel: {
    name: string;
    logo?: string;
    tvgLogo?: string;
    logoSource?: string;
    group?: string;
    tvgId?: string;
    num?: number;
  };
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showBadge?: boolean;
  alt?: string;
}

const SIZE_MAP = {
  xs: { box: 'w-5 h-5 text-[8px]', icon: 'w-3 h-3', text: 'text-[9px]' },
  sm: { box: 'w-8 h-8 text-[10px]', icon: 'w-4 h-4', text: 'text-[11px]' },
  md: { box: 'w-10 h-10 text-xs', icon: 'w-5 h-5', text: 'text-xs' },
  lg: { box: 'w-12 h-12 text-sm', icon: 'w-6 h-6', text: 'text-sm' },
  xl: { box: 'w-16 h-16 text-base', icon: 'w-8 h-8', text: 'text-base' },
};

export const ChannelLogo: React.FC<ChannelLogoProps> = ({
  channel,
  size = 'sm',
  className = '',
  showBadge = false,
  alt,
}) => {
  const [loadStage, setLoadStage] = useState<number>(0);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Compute primary URL candidate
  const rawCandidate = channel.tvgLogo || channel.logo;
  const safePrimary = rawCandidate ? getSafeLogoUrl(rawCandidate) : '';

  // Reset load stage if channel or logo changes
  useEffect(() => {
    setLoadStage(0);
    setIsLoaded(false);
  }, [channel.logo, channel.tvgLogo, channel.name]);

  // Determine current image URL to try
  const getCurrentImageSrc = (): string | null => {
    if (loadStage === 0) {
      return safePrimary || null;
    }
    if (loadStage === 1) {
      // If primary was HTTP or failed, try through backend proxy
      if (rawCandidate && rawCandidate.startsWith('http')) {
        return `/api/proxy?url=${encodeURIComponent(rawCandidate)}`;
      }
      return null;
    }
    if (loadStage === 2) {
      // Try IPTV-org public repository by tvg-id
      if (channel.tvgId && channel.tvgId.trim()) {
        const cleanId = channel.tvgId.trim();
        return `https://iptv-org.github.io/epg/logos/${encodeURIComponent(cleanId)}.png`;
      }
      return null;
    }
    // Failed all stages -> fallback SVG monogram
    return null;
  };

  const currentSrc = getCurrentImageSrc();
  const theme = getCategoryTheme(channel.group);
  const initials = getChannelInitials(channel.name);
  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.sm;

  const handleImageError = () => {
    // Advance to next fallback stage
    setLoadStage((prev) => prev + 1);
  };

  const isTvgLogo = Boolean(channel.tvgLogo || channel.logoSource === 'tvg-logo');

  return (
    <div
      className={`relative rounded-lg bg-[#181a20] border border-[#2a2e3a] flex-shrink-0 flex items-center justify-center overflow-hidden shadow-inner select-none ${sizeConfig.box} ${className}`}
      title={`${channel.name}${isTvgLogo ? ' • Logo from M3U tvg-logo' : ''}`}
    >
      {currentSrc ? (
        <img
          src={currentSrc}
          alt={alt || channel.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          onError={handleImageError}
          className={`w-full h-full object-contain p-1 transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-30'
          }`}
        />
      ) : (
        /* Stylized High-Contrast Monogram Fallback */
        <div
          className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${theme.bgGradient} relative group`}
        >
          <span
            className={`font-black font-mono tracking-wider text-white drop-shadow-sm ${sizeConfig.text}`}
            style={{ color: theme.textColor }}
          >
            {initials}
          </span>
          {/* Subtle bottom indicator dot */}
          <span
            className="absolute bottom-0.5 w-1 h-1 rounded-full opacity-60"
            style={{ backgroundColor: theme.primary }}
          />
        </div>
      )}

      {/* Optional Badge showing logo came from M3U tvg-logo */}
      {showBadge && isTvgLogo && (
        <span
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#87cf3e] border border-[#14161c] shadow"
          title="Extracted from M3U tvg-logo attribute"
        />
      )}
    </div>
  );
};
