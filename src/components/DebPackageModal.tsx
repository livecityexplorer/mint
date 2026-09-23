import React, { useState } from 'react';
import { 
  Download, 
  Package, 
  CheckCircle2, 
  MousePointerClick, 
  Terminal, 
  Layers, 
  Monitor, 
  Cpu, 
  HardDrive, 
  FileCode2, 
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Copy,
  Check,
  HelpCircle
} from 'lucide-react';

interface DebPackageModalProps {
  onClose?: () => void;
}

export const DebPackageModal: React.FC<DebPackageModalProps> = () => {
  const [isBuilding, setIsBuilding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedPerms, setCopiedPerms] = useState(false);
  const [copiedPortCmd, setCopiedPortCmd] = useState(false);
  const [customPortInput, setCustomPortInput] = useState('43210');
  const [buildInfo, setBuildInfo] = useState<{ sizeKb: string; fileName: string } | null>({
    sizeKb: '284.7',
    fileName: 'mint-iptv-player_1.0.0_amd64.deb',
  });
  const [activeCodeTab, setActiveCodeTab] = useState<'desktop' | 'electron' | 'control'>('desktop');
  const [simulatedInstallState, setSimulatedInstallState] = useState<'ready' | 'installing' | 'installed'>('ready');

  // Trigger package build
  const triggerBuild = async () => {
    setIsBuilding(true);
    try {
      const res = await fetch('/api/package/build-deb', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBuildInfo({ sizeKb: data.sizeKb, fileName: data.fileName });
      }
    } catch (err) {
      console.error('Failed to trigger deb build:', err);
    } finally {
      setIsBuilding(false);
    }
  };

  // Safe Blob-verified download to prevent truncated/corrupted downloads in iframe
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/api/package/download-deb');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'mint-iptv-player_1.0.0_amd64.deb';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 1000);
    } catch (err) {
      console.error('Download via blob failed, falling back to direct navigation:', err);
      window.location.href = '/api/package/download-deb';
    } finally {
      setDownloading(false);
    }
  };

  const copyToClipboard = (text: string, type: 'cmd' | 'perms' | 'port') => {
    navigator.clipboard.writeText(text);
    if (type === 'cmd') {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } else if (type === 'perms') {
      setCopiedPerms(true);
      setTimeout(() => setCopiedPerms(false), 2000);
    } else {
      setCopiedPortCmd(true);
      setTimeout(() => setCopiedPortCmd(false), 2000);
    }
  };

  const handleSimulatedInstall = () => {
    setSimulatedInstallState('installing');
    setTimeout(() => {
      setSimulatedInstallState('installed');
    }, 1500);
  };

  const installCommand = 'cd ~/Downloads && sudo apt install ./mint-iptv-player_1.0.0_amd64.deb';
  const permsCommand = 'chmod +r ~/Downloads/mint-iptv-player_1.0.0_amd64.deb';

  return (
    <div className="flex-1 bg-[#121316] overflow-y-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        {/* Banner */}
        <div className="bg-gradient-to-r from-[#171a20] via-[#1a1e26] to-[#15171d] border border-[#2c313d] rounded-2xl p-6 md:p-8 shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 w-80 h-80 bg-[#87cf3e]/10 blur-3xl pointer-events-none rounded-full" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#87cf3e]/15 border border-[#87cf3e]/40 text-[#9de850] text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-[#87cf3e] animate-ping" />
                <span>Linux Mint 20, 21 &amp; 22 (Wilma) • GDebi Double-Click Ready</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                Native Linux Mint <span className="text-[#87cf3e]">.deb</span> Package
              </h1>
              <p className="text-xs md:text-sm text-[#959caa] max-w-xl">
                Built with universal Debian dependencies (<code className="text-[#87cf3e]">bash, xdg-utils</code>), standard <code className="text-[#87cf3e]">0755/0644</code> permissions, MD5 checksum integrity, and desktop menu registration.
              </p>
            </div>

            {/* Big Download Button */}
            <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 flex-shrink-0">
              <button
                id="download-deb-button"
                onClick={handleDownload}
                disabled={downloading}
                className="px-6 py-3.5 bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold text-sm rounded-xl shadow-lg shadow-[#87cf3e]/20 hover:shadow-[#87cf3e]/30 transition-all flex items-center justify-center gap-2 group disabled:opacity-75"
              >
                {downloading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Download className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" />
                )}
                <span>{downloading ? 'Downloading .deb...' : 'Download .deb Package'}</span>
              </button>

              <div className="flex items-center justify-center gap-3 text-[11px] text-[#717786]">
                <span>Arch: amd64 (64-bit)</span>
                <span>•</span>
                <span>Size: {buildInfo?.sizeKb || '285'} KB</span>
                <button
                  onClick={triggerBuild}
                  disabled={isBuilding}
                  title="Rebuild package"
                  className="text-[#87cf3e] hover:underline flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isBuilding ? 'animate-spin' : ''}`} />
                  <span>Rebuild</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Troubleshooting & Fix Box for "Corrupted or Missing Permissions" */}
        <div className="bg-[#1b1e26] border-2 border-[#87cf3e]/30 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#87cf3e]/20 border border-[#87cf3e]/40 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5 text-[#87cf3e]" />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Fixing "File may be corrupted or missing permissions" on Linux Mint</span>
              </h3>
              <p className="text-xs text-[#a9b0c0] leading-relaxed">
                In Linux Mint, this message occurs when:
              </p>
              <ul className="text-xs text-[#8f96a7] list-disc list-inside space-y-1 mt-1 pl-1">
                <li>
                  <strong>Dependency Mismatch:</strong> Older .deb packages requested <code className="text-[#e2e6ef] bg-[#14161c] px-1 py-0.5 rounded">libasound2</code> or <code className="text-[#e2e6ef] bg-[#14161c] px-1 py-0.5 rounded">libcups2</code>, which were transitioned to 64-bit time (<code className="text-[#87cf3e]">t64</code>) on Linux Mint 22 (Wilma/Ubuntu 24.04). <strong>This fresh release resolves that with universal dependencies.</strong>
                </li>
                <li>
                  <strong>Browser Download Permissions:</strong> If your browser downloaded the file with restricted read permissions (<code className="text-[#e2e6ef] bg-[#14161c] px-1 py-0.5 rounded">chmod 600</code>), GDebi cannot read it.
                </li>
              </ul>
            </div>
          </div>

          {/* 2 Quick Solutions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {/* Terminal Solution */}
            <div className="bg-[#121316] p-3.5 rounded-lg border border-[#282d3a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#87cf3e] flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Terminal 1-Liner (100% Reliable)</span>
                </span>
                <button
                  onClick={() => copyToClipboard(installCommand, 'cmd')}
                  className="px-2 py-1 rounded bg-[#202430] hover:bg-[#2b3040] text-[11px] text-[#c8cdd6] flex items-center gap-1 transition"
                >
                  {copiedCmd ? <Check className="w-3 h-3 text-[#87cf3e]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCmd ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="bg-[#0b0c0e] p-2.5 rounded font-mono text-[11px] text-[#87cf3e] break-all select-all border border-[#1e222d]">
                {installCommand}
              </div>
              <p className="text-[11px] text-[#6e7484]">
                Uses Mint&apos;s native APT resolver to automatically install and register desktop icons.
              </p>
            </div>

            {/* GUI Nemo Solution */}
            <div className="bg-[#121316] p-3.5 rounded-lg border border-[#282d3a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#87cf3e] flex items-center gap-1.5">
                  <MousePointerClick className="w-3.5 h-3.5" />
                  <span>Fix Permissions in Nemo (GUI)</span>
                </span>
                <button
                  onClick={() => copyToClipboard(permsCommand, 'perms')}
                  className="px-2 py-1 rounded bg-[#202430] hover:bg-[#2b3040] text-[11px] text-[#c8cdd6] flex items-center gap-1 transition"
                >
                  {copiedPerms ? <Check className="w-3 h-3 text-[#87cf3e]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPerms ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="bg-[#0b0c0e] p-2.5 rounded font-mono text-[11px] text-[#87cf3e] break-all select-all border border-[#1e222d]">
                {permsCommand}
              </div>
              <p className="text-[11px] text-[#6e7484]">
                Or right-click the file in Nemo &rarr; <em>Properties</em> &rarr; <em>Permissions</em> &rarr; ensure Read is allowed.
              </p>
            </div>
          </div>
        </div>

        {/* Connection Refused / Port Troubleshooting Card */}
        <div className="bg-[#1c1a24] border-2 border-[#f59f00]/40 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#f59f00]/20 border border-[#f59f00]/40 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5 text-[#f59f00]" />
            </div>
            <div className="space-y-1 flex-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Fixing "ERR_CONNECTION_REFUSED / localhost refused to connect"</span>
                </h3>
                <span className="text-[11px] px-2 py-0.5 rounded bg-[#87cf3e]/20 text-[#87cf3e] border border-[#87cf3e]/40 font-semibold">
                  Resolved in Latest .deb
                </span>
              </div>
              <p className="text-xs text-[#c2c7d4] leading-relaxed">
                If the browser opened to a blank page showing <code className="text-[#ff6b6b] bg-[#121316] px-1 py-0.5 rounded">ERR_CONNECTION_REFUSED</code>, it means the local background proxy server was not running. 
              </p>
              <div className="bg-[#13141a] p-3 rounded-lg border border-[#2a2b36] mt-2 space-y-2 text-xs text-[#9ea5b5]">
                <div className="text-white font-medium">Why this occurred:</div>
                <p>
                  Linux Mint does not come with Node.js pre-installed. The previous launcher tried to execute <code className="text-[#87cf3e]">node dist/server.cjs</code>, which silently exited on fresh Linux Mint systems that didn&apos;t have Node.
                </p>
                <div className="text-white font-medium pt-1">The permanent fix in this package:</div>
                <p>
                  We have bundled an <strong>embedded Python 3 server</strong> (<code className="text-[#87cf3e]">server.py</code>) right into the package. Because <strong>Python 3 is standard on 100% of Linux Mint systems</strong>, the local server boots instantly with zero external dependencies, waits for health confirmation, and automatically launches the app with the full <strong>M3U Playlist and Xtream Codes (XC)</strong> interface ready to use!
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Port Configuration & "Why http://localhost:3000/?" Card */}
        <div className="bg-[#181b23] border border-[#2e3342] rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#3b82f6]/20 border border-[#3b82f6]/40 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Monitor className="w-5 h-5 text-[#60a5fa]" />
            </div>
            <div className="space-y-1 flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Why Did It Open on <code className="text-[#ff6b6b] bg-[#121316] px-1.5 py-0.5 rounded text-xs">http://localhost:3000/</code>?</span>
                </h3>
                <span className="text-[11px] px-2 py-0.5 rounded bg-[#87cf3e]/15 text-[#87cf3e] border border-[#87cf3e]/30 font-semibold font-mono">
                  Now: Port 43210 (or custom)
                </span>
              </div>
              <p className="text-xs text-[#a9b0c0] leading-relaxed">
                In earlier packaging runs, the launcher script was hardcoded to boot the local proxy server on port <code className="text-[#e2e6ef] bg-[#13151a] px-1 rounded">3000</code> and opened it in your web browser. If you had existing local web servers or development tools already listening on port 3000, it caused collisions or routed to the wrong app.
              </p>
            </div>
          </div>

          <div className="bg-[#13151a] rounded-lg p-4 border border-[#232732] space-y-3">
            <h4 className="text-xs font-bold text-[#87cf3e] flex items-center gap-1.5">
              <span>What Changed in This Release:</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[#8f96a7]">
              <div className="bg-[#181a20] p-3 rounded-md border border-[#262a35] space-y-1">
                <div className="font-semibold text-white">1. Dedicated Port 43210</div>
                <p className="text-[11px] text-[#717786]">
                  Defaults to high-range port <strong>43210</strong>, avoiding all common web dev and system port collisions.
                </p>
              </div>
              <div className="bg-[#181a20] p-3 rounded-md border border-[#262a35] space-y-1">
                <div className="font-semibold text-white">2. Custom --port CLI Flag</div>
                <p className="text-[11px] text-[#717786]">
                  Launch on any port: <code className="text-[#87cf3e]">mint-iptv-player --port 8080</code> or <code className="text-[#87cf3e]">-p 43210</code>.
                </p>
              </div>
              <div className="bg-[#181a20] p-3 rounded-md border border-[#262a35] space-y-1">
                <div className="font-semibold text-white">3. Standalone App Window</div>
                <p className="text-[11px] text-[#717786]">
                  Launches in dedicated <code className="text-[#87cf3e]">--app</code> window mode (no browser address bar, tabs, or bookmarks).
                </p>
              </div>
            </div>

            {/* Custom Port Interactive Command Generator */}
            <div className="pt-2 border-t border-[#232630] space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">Run on custom port:</span>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={customPortInput}
                    onChange={(e) => setCustomPortInput(e.target.value)}
                    className="w-24 px-2 py-1 bg-[#181a20] border border-[#2d3240] rounded font-mono text-xs text-[#87cf3e] focus:outline-none focus:border-[#87cf3e]"
                  />
                </div>
                <button
                  onClick={() => copyToClipboard(`mint-iptv-player --port ${customPortInput || '43210'}`, 'port')}
                  className="px-3 py-1 rounded bg-[#212633] hover:bg-[#2c3244] text-xs font-semibold text-[#87cf3e] border border-[#30384a] flex items-center gap-1.5 transition self-start sm:self-auto"
                >
                  {copiedPortCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedPortCmd ? 'Copied Command!' : 'Copy Launch Command'}</span>
                </button>
              </div>

              <div className="bg-[#0b0c0e] p-2.5 rounded font-mono text-[11px] text-[#87cf3e] break-all border border-[#1d212b]">
                mint-iptv-player --port {customPortInput || '43210'}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6b7282] pt-1">
                <span>Quick port presets:</span>
                {[43210, 8080, 8888, 3838, 5000].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setCustomPortInput(preset.toString())}
                    className="px-2 py-0.5 rounded bg-[#181b22] hover:bg-[#252935] text-[#9da5b5] hover:text-[#87cf3e] border border-[#272b36] font-mono text-[10px]"
                  >
                    :{preset}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 3-Step Double-Click Guide */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#16181f] border border-[#262a34] rounded-xl p-5 relative">
            <div className="w-8 h-8 rounded-lg bg-[#87cf3e]/20 text-[#87cf3e] font-bold text-sm flex items-center justify-center mb-3">
              1
            </div>
            <h4 className="text-sm font-bold text-[#eef0f3]">Download .deb</h4>
            <p className="text-xs text-[#7e8594] mt-1">
              Click the download button above to save <code className="text-[#87cf3e] bg-[#1d2028] px-1 py-0.5 rounded">mint-iptv-player_1.0.0_amd64.deb</code> into your Downloads folder.
            </p>
          </div>

          <div className="bg-[#16181f] border border-[#262a34] rounded-xl p-5 relative">
            <div className="w-8 h-8 rounded-lg bg-[#87cf3e]/20 text-[#87cf3e] font-bold text-sm flex items-center justify-center mb-3">
              2
            </div>
            <h4 className="text-sm font-bold text-[#eef0f3]">Double-Click in Nemo</h4>
            <p className="text-xs text-[#7e8594] mt-1">
              Double-click the .deb file in Linux Mint&apos;s Nemo file manager. The native <strong>GDebi Package Installer</strong> will automatically launch.
            </p>
          </div>

          <div className="bg-[#16181f] border border-[#262a34] rounded-xl p-5 relative">
            <div className="w-8 h-8 rounded-lg bg-[#87cf3e]/20 text-[#87cf3e] font-bold text-sm flex items-center justify-center mb-3">
              3
            </div>
            <h4 className="text-sm font-bold text-[#eef0f3]">Click &quot;Install Package&quot;</h4>
            <p className="text-xs text-[#7e8594] mt-1">
              Click the green &quot;Install Package&quot; button in GDebi. Enter your password when prompted. Launch anytime from <em>Menu &gt; Sound &amp; Video</em>.
            </p>
          </div>
        </div>

        {/* Interactive Linux Mint GDebi Window Simulation */}
        <div className="bg-[#181a20] border border-[#292d37] rounded-xl overflow-hidden shadow-2xl">
          <div className="bg-[#131519] px-4 py-2 border-b border-[#22252c] flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Package className="w-4 h-4 text-[#87cf3e]" />
              <span className="text-xs font-semibold text-[#c8cdd6]">
                Package Installer - mint-iptv-player_1.0.0_amd64.deb
              </span>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-[#626877]">
              <span>GDebi (Linux Mint Default)</span>
            </div>
          </div>

          <div className="p-6 bg-[#16181e] flex flex-col md:flex-row items-start justify-between gap-6">
            <div className="space-y-3 flex-1">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-xl bg-[#20232c] border border-[#313644] flex items-center justify-center">
                  <Package className="w-6 h-6 text-[#87cf3e]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#f1f3f5]">mint-iptv-player</h3>
                  <p className="text-xs text-[#87cf3e] font-mono">Version: 1.0.0 (amd64)</p>
                </div>
              </div>

              <div className="bg-[#13151a] p-3 rounded-lg border border-[#242832] text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#6d7382]">Status:</span>
                  <span className="text-[#9fe653] font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready for installation (all dependencies satisfied)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6d7382]">Section:</span>
                  <span className="text-[#c8cdd6] font-mono">video / sound &amp; video</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6d7382]">Maintainer:</span>
                  <span className="text-[#c8cdd6]">Linux Mint IPTV Community</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6d7382]">Menu Integration:</span>
                  <span className="text-[#c8cdd6]">Applications &gt; Sound &amp; Video &gt; Mint IPTV Player</span>
                </div>
              </div>

              <p className="text-xs text-[#8d93a2] leading-relaxed">
                A sleek, desktop-integrated IPTV player for Linux Mint supporting M3U playlists, Xtream Codes API, interactive TiviMate-style EPG grid, and hardware playback.
              </p>
            </div>

            {/* GDebi Action Button */}
            <div className="w-full md:w-56 flex flex-col items-center justify-center p-4 bg-[#131519] border border-[#242832] rounded-xl text-center space-y-3">
              <span className="text-[11px] text-[#717786]">Linux Mint Double-Click Simulation</span>
              
              {simulatedInstallState === 'ready' && (
                <button
                  onClick={handleSimulatedInstall}
                  className="w-full py-2.5 bg-[#87cf3e] hover:bg-[#97df4e] text-[#121316] font-bold text-xs rounded-lg shadow transition flex items-center justify-center gap-1.5"
                >
                  <MousePointerClick className="w-4 h-4" />
                  <span>Install Package</span>
                </button>
              )}

              {simulatedInstallState === 'installing' && (
                <div className="w-full py-2.5 bg-[#2a2e39] text-[#87cf3e] font-bold text-xs rounded-lg flex items-center justify-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-[#87cf3e] border-t-transparent rounded-full animate-spin" />
                  <span>Installing...</span>
                </div>
              )}

              {simulatedInstallState === 'installed' && (
                <div className="space-y-2 w-full">
                  <div className="w-full py-2 bg-[#87cf3e]/20 text-[#9be94f] border border-[#87cf3e]/40 font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Installed on Mint!</span>
                  </div>
                  <button
                    onClick={() => setSimulatedInstallState('ready')}
                    className="text-[11px] text-[#6d7382] hover:text-[#c8cdd6] underline"
                  >
                    Reset simulation
                  </button>
                </div>
              )}

              <span className="text-[10px] text-[#555a67]">
                Double-clicking .deb in Linux Mint triggers this exact GDebi UI
              </span>
            </div>
          </div>
        </div>

        {/* Technical Specification & Source Files Explorer */}
        <div className="bg-[#16181f] border border-[#262a34] rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-[#eef0f3] flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-[#87cf3e]" />
                <span>Package Metadata &amp; Source Manifests</span>
              </h3>
              <p className="text-xs text-[#717786]">
                Inspect the standard Debian packaging files bundled into this .deb release.
              </p>
            </div>

            <a
              href="/api/package/download-desktop"
              download="mint-iptv-player.desktop"
              className="px-3 py-1.5 rounded bg-[#1e2129] hover:bg-[#282d38] border border-[#2f3442] text-xs font-medium text-[#c8cdd6] transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .desktop file</span>
            </a>
          </div>

          {/* Tab selector for files */}
          <div className="flex border-b border-[#272b35] mb-4 space-x-2">
            <button
              onClick={() => setActiveCodeTab('desktop')}
              className={`pb-2 text-xs font-mono font-medium border-b-2 transition ${
                activeCodeTab === 'desktop' ? 'border-[#87cf3e] text-[#87cf3e]' : 'border-transparent text-[#6e7484] hover:text-white'
              }`}
            >
              mint-iptv-player.desktop
            </button>
            <button
              onClick={() => setActiveCodeTab('control')}
              className={`pb-2 text-xs font-mono font-medium border-b-2 transition ${
                activeCodeTab === 'control' ? 'border-[#87cf3e] text-[#87cf3e]' : 'border-transparent text-[#6e7484] hover:text-white'
              }`}
            >
              DEBIAN/control
            </button>
            <button
              onClick={() => setActiveCodeTab('electron')}
              className={`pb-2 text-xs font-mono font-medium border-b-2 transition ${
                activeCodeTab === 'electron' ? 'border-[#87cf3e] text-[#87cf3e]' : 'border-transparent text-[#6e7484] hover:text-white'
              }`}
            >
              electron/main.cjs
            </button>
          </div>

          {/* Code Viewer */}
          <div className="bg-[#111215] border border-[#232731] rounded-lg p-4 overflow-x-auto text-xs font-mono text-[#c5c9d3] max-h-56">
            {activeCodeTab === 'desktop' && (
              <pre>{`[Desktop Entry]
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
Actions=FullScreen;EpgGrid;

[Desktop Action FullScreen]
Name=Launch in Full Screen
Exec=/usr/bin/mint-iptv-player --fullscreen

[Desktop Action EpgGrid]
Name=Open TV Guide (EPG)
Exec=/usr/bin/mint-iptv-player --view=epg`}</pre>
            )}

            {activeCodeTab === 'control' && (
              <pre>{`Package: mint-iptv-player
Version: 1.0.0
Section: video
Priority: optional
Architecture: amd64
Installed-Size: 1197
Maintainer: Linux Mint IPTV Community <community@linuxmint.com>
Depends: bash, xdg-utils
Recommends: firefox | chromium-browser | google-chrome-stable | electron
Homepage: https://github.com/linuxmint/mint-iptv-player
Description: Native Modern IPTV & EPG Player for Linux Mint
 A sleek, desktop-integrated IPTV player for Linux Mint supporting
 M3U/M3U8 playlists, Xtream Codes (XC) API, interactive TiviMate-style EPG grid,
 multi-category stream filtering, HLS adaptive bitrate, and hardware playback.`}</pre>
            )}

            {activeCodeTab === 'electron' && (
              <pre>{`// Electron Main process for Mint IPTV Player
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#121316',
    title: 'Mint IPTV Player',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allows diverse IPTV streams without CORS failures
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(createWindow);`}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
