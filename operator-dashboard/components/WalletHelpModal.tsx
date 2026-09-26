'use client';

import { useState } from 'react';

export function WalletHelpModal({ onClose }: { onClose: () => void }) {
    const [active, setActive] = useState<'phantom' | 'solflare' | 'general'>('general');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
                 onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h2 className="text-lg font-semibold text-white">Wallet Domain Trust Help</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
                </div>
                <div className="p-4 border-b border-slate-800 flex gap-2">
                    {(['general', 'phantom', 'solflare'] as const).map((t) => (
                        <button key={t} onClick={() => setActive(t)}
                                className={`flex-1 py-2 text-sm rounded-lg transition-all font-medium ${
                                    active === t
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                }`}>
                            {t === 'general' ? 'General' : t === 'phantom' ? 'Phantom' : 'Solflare'}
                        </button>
                    ))}
                </div>
                <div className="p-4 max-h-64 overflow-y-auto">
                    {active === 'general' && (
                        <div className="space-y-3 text-sm text-slate-300">
                            <p className="font-medium text-white">Why am I seeing a security warning?</p>
                            <p>When you connect your wallet to a new website for the first time, wallet extensions (Phantom, Solflare, etc.) show a security warning. This is a safety feature — the wallet is asking you to confirm you trust this domain before allowing it to sign transactions.</p>
                            <p className="mt-2">This is <strong>normal and expected</strong> for any new website. It does not mean the site is unsafe — it means your wallet hasn't seen this domain before.</p>
                            <p className="font-medium text-white mt-3">How to make the warning go away</p>
                            <p>Once you approve the site in your wallet extension, the warning will not appear again for future visits. Each wallet handles this differently:</p>
                            <ul className="list-disc list-inside space-y-1">
                                <li><strong>Phantom:</strong> Click "Approve" or "Trust" when the popup appears. You can also manage trusted sites in Phantom Settings → Security.</li>
                                <li><strong>Solflare:</strong> Click "Approve" or "Allow" when the popup appears. You can also manage trusted sites in Solflare Settings → Website Permissions.</li>
                            </ul>
                            <p className="mt-2 text-slate-400">After approving, refresh the page. The wallet connection should work without warnings.</p>
                        </div>
                    )}
                    {active === 'phantom' && (
                        <div className="space-y-3 text-sm text-slate-300">
                            <p className="font-medium text-white">Phantom — Managing Site Trust</p>
                            <p>Phantom shows a red warning UI when connecting to a new domain. You have two options:</p>
                            <div className="bg-slate-950 rounded-lg p-3 space-y-2">
                                <p className="font-medium text-slate-200">Option 1: One-time approval (recommended)</p>
                                <p>When the Phantom popup appears with the warning:</p>
                                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                                    <li>Read the transaction details</li>
                                    <li>Click <strong>"Confirm Unsafe"</strong> or <strong>"Approve"</strong></li>
                                    <li>The transaction will proceed</li>
                                </ol>
                                <p>Phantom may remember this approval for future visits.</p>
                            </div>
                            <div className="bg-slate-950 rounded-lg p-3 space-y-2">
                                <p className="font-medium text-slate-200">Option 2: Permanently trust this site</p>
                                <p>To permanently trust <strong>operator-dashboard-wine.vercel.app</strong>:</p>
                                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                                    <li>Open Phantom extension</li>
                                    <li>Go to Settings (gear icon) → Security</li>
                                    <li>Find "Allowed Sites" or "Trusted Sites"</li>
                                    <li>Add <code>operator-dashboard-wine.vercel.app</code> to the allowlist</li>
                                </ol>
                            </div>
                            <p className="text-slate-400 text-xs mt-2">Note: The exact wording may vary by Phantom version. If you don't see these options, try Option 1 first.</p>
                        </div>
                    )}
                    {active === 'solflare' && (
                        <div className="space-y-3 text-sm text-slate-300">
                            <p className="font-medium text-white">Solflare — Managing Site Trust</p>
                            <p>Solflare shows an "Unknown site" warning when connecting to a domain it doesn't recognize.</p>
                            <div className="bg-slate-950 rounded-lg p-3 space-y-2">
                                <p className="font-medium text-slate-200">One-time approval</p>
                                <p>When the Solflare popup appears:</p>
                                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                                    <li>Read the warning message</li>
                                    <li>Click <strong>"Approve"</strong> or <strong>"Allow"</strong></li>
                                    <li>The wallet will proceed with the connection/signature</li>
                                </ol>
                            </div>
                            <div className="bg-slate-950 rounded-lg p-3 space-y-2">
                                <p className="font-medium text-slate-200">Permanently trust this site</p>
                                <p>To permanently trust <strong>operator-dashboard-wine.vercel.app</strong>:</p>
                                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                                    <li>Open Solflare extension</li>
                                    <li>Go to Settings (gear icon) → Website Permissions</li>
                                    <li>Find the site in the list and toggle it to "Allowed"</li>
                                    <li>Or click "Add to trusted sites" if available</li>
                                </ol>
                            </div>
                            <p className="text-slate-400 text-xs mt-2">After trusting the site, refresh the dashboard. Future connections should work without warnings.</p>
                        </div>
                    )}
                </div>
                <div className="p-4 border-t border-slate-700 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-all">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
