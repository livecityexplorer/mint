import React from 'react';
import { 
  X, 
  Settings, 
  ShieldCheck, 
  Sliders, 
  Cpu, 
  HardDrive, 
  RefreshCcw, 
  Monitor, 
  Zap,
  Check,
  Film,
  Globe
} from 'lucide-react';
import { PlayerSettings } from '../types';
import { SUPPORTED_METADATA_LANGUAGES, getUserDeviceLanguage } from '../services/tmdbService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PlayerSettings;
  updateSettings: (partial: Partial<PlayerSettings>) => void;
  onResetAllData: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  updateSettings,
  onResetAllData,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#171920] border border-[#2b2f3c] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-[#14151a] border-b border-[#252934] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-[#87cf3e]" />
            <h3 className="text-sm font-bold text-[#f1f3f5]">Mint IPTV Player Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#787f90] hover:text-white hover:bg-[#252834] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Stream Proxy Setting */}
          <div className="bg-[#121316] p-4 rounded-xl border border-[#232630] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <ShieldCheck className="w-4 h-4 text-[#87cf3e]" />
                <div>
                  <h4 className="font-bold text-[#e3e5e8]">Mint Stream Proxy &amp; CORS Resolver</h4>
                  <p className="text-[#717786] text-[11px]">
                    Routes streams through the local server to bypass CORS blocks, geoblocks, and user-agent limits.
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateSettings({ useProxy: !settings.useProxy })}
                className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-0.5 ${
                  settings.useProxy ? 'bg-[#87cf3e]' : 'bg-[#2b2f3a]'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    settings.useProxy ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Hardware Acceleration (Linux VA-API) */}
          <div className="bg-[#121316] p-4 rounded-xl border border-[#232630] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Cpu className="w-4 h-4 text-[#87cf3e]" />
                <div>
                  <h4 className="font-bold text-[#e3e5e8]">Linux VA-API Hardware Video Decoding</h4>
                  <p className="text-[#717786] text-[11px]">
                    Enables GPU hardware video decoding (Intel / AMD / NVIDIA) on Linux Mint.
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateSettings({ hardwareAcceleration: !settings.hardwareAcceleration })}
                className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-0.5 ${
                  settings.hardwareAcceleration ? 'bg-[#87cf3e]' : 'bg-[#2b2f3a]'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    settings.hardwareAcceleration ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Default Aspect Ratio */}
          <div className="bg-[#121316] p-4 rounded-xl border border-[#232630] space-y-2">
            <h4 className="font-bold text-[#e3e5e8] mb-1">Default Aspect Ratio</h4>
            <div className="grid grid-cols-4 gap-2">
              {(['16:9', '4:3', 'fill', 'cover'] as PlayerSettings['aspectRatio'][]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateSettings({ aspectRatio: mode })}
                  className={`py-2 rounded-lg font-mono text-center font-semibold border transition ${
                    settings.aspectRatio === mode
                      ? 'bg-[#87cf3e]/15 border-[#87cf3e] text-[#87cf3e]'
                      : 'bg-[#181a20] border-[#292c36] text-[#8f96a4] hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* HLS Buffer Length */}
          <div className="bg-[#121316] p-4 rounded-xl border border-[#232630] space-y-2">
            <div className="flex justify-between items-center mb-1">
              <h4 className="font-bold text-[#e3e5e8]">Live Stream Buffer Length</h4>
              <span className="font-mono text-[#87cf3e]">{settings.bufferLength}s</span>
            </div>
            <input
              type="range"
              min="10"
              max="180"
              step="10"
              value={settings.bufferLength}
              onChange={(e) => updateSettings({ bufferLength: parseInt(e.target.value) })}
              className="w-full accent-[#87cf3e] cursor-pointer h-1.5 bg-[#252833] rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-[#636877]">
              <span>10s (Ultra Low Latency)</span>
              <span>60s (Standard)</span>
              <span>180s (Deep Buffer)</span>
            </div>
          </div>

          {/* Desktop Port Configuration */}
          <div className="bg-[#121316] p-4 rounded-xl border border-[#232630] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-[#e3e5e8] flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-[#87cf3e]" />
                  <span>Linux Mint Desktop Port</span>
                </h4>
                <p className="text-[#717786] text-[11px] mt-0.5">
                  Select which local port Mint IPTV Player binds to when launched on your desktop.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-[#87cf3e]/15 text-[#87cf3e] font-mono font-bold text-xs border border-[#87cf3e]/30">
                :{settings.desktopPort || 43210}
              </span>
            </div>

            {/* Quick Port Presets */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { port: 43210, label: '43210 (Default Dedicated)' },
                { port: 8080, label: '8080 (Alt Web)' },
                { port: 3838, label: '3838 (Media Port)' },
                { port: 3000, label: '3000 (Legacy Dev)' },
              ].map(({ port, label }) => (
                <button
                  key={port}
                  type="button"
                  onClick={() => updateSettings({ desktopPort: port })}
                  className={`p-2 rounded-lg text-left border transition ${
                    (settings.desktopPort || 43210) === port
                      ? 'bg-[#87cf3e]/15 border-[#87cf3e] text-[#87cf3e]'
                      : 'bg-[#181a20] border-[#282b35] text-[#8e95a3] hover:text-white'
                  }`}
                >
                  <div className="font-mono font-bold text-xs">:{port}</div>
                  <div className="text-[10px] text-[#656b7a] truncate">{label.split(' ')[1]}</div>
                </button>
              ))}
            </div>

            {/* Custom Port Input */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] text-[#787f90]">Custom Port:</span>
              <input
                type="number"
                min="1024"
                max="65535"
                placeholder="43210"
                value={settings.desktopPort || 43210}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val > 0 && val <= 65535) {
                    updateSettings({ desktopPort: val });
                  }
                }}
                className="w-28 px-2 py-1 bg-[#181a20] border border-[#2d3240] rounded font-mono text-xs text-[#87cf3e] focus:outline-none focus:border-[#87cf3e]"
              />
              <span className="text-[10px] text-[#555b6a]">
                CLI Flag: <code className="text-[#87cf3e] bg-[#0c0d10] px-1 py-0.5 rounded">--port {settings.desktopPort || 43210}</code>
              </span>
            </div>

            <div className="bg-[#181a20] p-2.5 rounded-lg border border-[#262a34] text-[11px] text-[#808796] space-y-1">
              <div className="font-semibold text-[#c8ceda]">Why did it open on port 3000 originally?</div>
              <div>
                Earlier builds defaulted to port 3000, which caused collisions if you had development servers running. The updated package now defaults to high-range port <strong>43210</strong> and supports custom ports via <code className="text-[#87cf3e]">--port</code>.
              </div>
            </div>
          </div>

          {/* TMDB Details & Language configuration */}
          <div className="bg-[#121316] p-4 rounded-xl border border-[#232630] space-y-3">
            <div className="flex items-center space-x-2.5">
              <Film className="w-4 h-4 text-[#87cf3e]" />
              <div>
                <h4 className="font-bold text-[#e3e5e8]">TheMovieDatabase (TMDB) Metadata &amp; Language</h4>
                <p className="text-[#717786] text-[11px]">
                  Automatically fetches high-res posters, backdrops, cast, ratings, and synopses localized in your device language.
                </p>
              </div>
            </div>

            {/* Metadata Language Selector */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold text-[#b3b9c7] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#87cf3e]" />
                  <span>Metadata Display Language:</span>
                </span>
                <span className="text-[11px] font-normal text-[#87cf3e]">
                  Device detected: {getUserDeviceLanguage()}
                </span>
              </label>
              <select
                value={settings.metadataLanguage || 'auto'}
                onChange={(e) => updateSettings({ metadataLanguage: e.target.value })}
                className="w-full px-3 py-1.5 bg-[#181a20] border border-[#2d3240] rounded text-xs text-[#e3e5e8] focus:outline-none focus:border-[#87cf3e] cursor-pointer"
              >
                {SUPPORTED_METADATA_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name} {lang.code === 'auto' ? `(${getUserDeviceLanguage()})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Optional Custom API Key */}
            <div className="space-y-1 pt-1">
              <label className="text-[11px] font-semibold text-[#8c92a0]">
                Custom TMDB API Key (Optional — default built-in proxy is ready):
              </label>
              <input
                type="password"
                placeholder="Enter your TMDB API v3 key (optional)"
                value={settings.tmdbApiKey || ''}
                onChange={(e) => updateSettings({ tmdbApiKey: e.target.value.trim() })}
                className="w-full px-3 py-1.5 bg-[#181a20] border border-[#2d3240] rounded font-mono text-xs text-[#e3e5e8] placeholder-[#555b6a] focus:outline-none focus:border-[#87cf3e]"
              />
            </div>
          </div>

          {/* Reset cache button */}
          <div className="pt-2 flex justify-between items-center">
            <button
              onClick={onResetAllData}
              className="px-3 py-2 rounded-lg bg-[#e03131]/10 hover:bg-[#e03131]/20 text-[#ff8787] border border-[#e03131]/30 transition flex items-center gap-1.5"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              <span>Reset Saved Playlists &amp; Cache</span>
            </button>

            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold transition shadow"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
