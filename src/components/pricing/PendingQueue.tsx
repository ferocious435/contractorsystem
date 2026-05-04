import React from 'react';
import { RefreshCw, AlertTriangle, ExternalLink, Gavel, Sparkles, Database } from 'lucide-react';
import { RichText } from '../ui/RichText';
import { motion } from 'framer-motion';

interface Contradiction {
    id: string;
    title: string;
    description: string;
    severity: string;
    status: string;
    pricing_status: string;
    source_execution_doc?: { title: string; url?: string };
    target_contract_doc?: { title: string; url?: string };
    contract_quote?: string;
    work_quote?: string;
    contract_url?: string;
    work_url?: string;
    contract_page?: number;
    work_page?: number;
}

interface PendingQueueProps {
    items: Contradiction[];
    onSelectForEstimation: (item: Contradiction) => void;
    onRescan?: (item: Contradiction) => Promise<void>;
    scanningItems?: string[];
}

export default function PendingQueue({ items, onSelectForEstimation, onRescan, scanningItems = [] }: PendingQueueProps) {
    if (items.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-[#0B0F14] rounded-2xl border border-white/5 font-mono">
                <div className="relative mb-6">
                    <div className="absolute -inset-4 bg-emerald-500/10 rounded-full blur-xl animate-pulse" />
                    <Database className="w-10 h-10 text-emerald-500/30 relative z-10" />
                </div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">סטטוס_תור: ריק</h3>
                <p className="mt-2 text-[9px] uppercase tracking-widest text-gray-600">לא נמצאו סתירות הממתינות להערכה.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 overflow-y-auto h-full pr-3 custom-scrollbar scroll-smooth">
            {items.map((item) => {
                const isScanning = scanningItems.includes(item.id);
                
                return (
                    <div
                        key={item.id}
                        className="group relative p-5 rounded-2xl bg-[#0B0F14] border border-white/5 hover:border-white/10 transition-all cursor-pointer shadow-2xl overflow-hidden"
                        onClick={() => onSelectForEstimation(item)}
                    >
                        {/* Status Accent Gradient */}
                        <div className={`absolute top-0 right-0 w-1.5 h-full ${
                            item.severity === 'HIGH' ? 'bg-red-500' : 
                            item.severity === 'MEDIUM' ? 'bg-orange-500' : 'bg-blue-500'
                        } opacity-20 group-hover:opacity-100 transition-opacity`} />
                        
                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                        <div className="relative z-10">
                            {/* Header: ID and Meta */}
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex flex-wrap gap-2">
                                    <span className="text-[9px] font-mono font-black text-gray-500 bg-white/5 px-2 py-1 rounded-md border border-white/5 uppercase tracking-widest">
                                        אירוע_{item.id.substring(0, 6).toUpperCase()}
                                    </span>
                                    {item.severity === 'HIGH' && (
                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/20 text-[9px] font-black text-red-500 uppercase tracking-widest animate-pulse">
                                            <AlertTriangle className="w-2.5 h-2.5" />
                                            סיכון_גבוה_VO
                                        </div>
                                    )}
                                </div>
                                
                                <button 
                                    className={`p-2 rounded-lg bg-white/5 transition-all ${isScanning ? 'text-indigo-400' : 'text-gray-500 hover:text-white hover:bg-white/10'}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onRescan && !isScanning) onRescan(item);
                                    }}
                                    disabled={isScanning}
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                                </button>
                            </div>

                            <h4 className="text-sm font-black text-white mb-2 leading-tight group-hover:text-indigo-400 transition-colors uppercase tracking-tight">
                                {item.title}
                            </h4>

                            <div className="text-[11px] text-gray-500 mb-5 line-clamp-2 leading-relaxed font-medium">
                                <RichText text={item.description} evidence={item} />
                            </div>

                            {/* Footer: Trace and Action */}
                            <div className="pt-4 border-t border-white/5 flex flex-col gap-3">
                                <div className="flex flex-col gap-1.5">
                                    {item.source_execution_doc && (
                                        <div className="flex items-center gap-2 text-[9px] font-mono text-gray-500">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/40" />
                                            <span className="opacity-50 uppercase">ביצוע:</span>
                                            <span className="text-gray-400 truncate max-w-[120px]">{item.source_execution_doc.title}</span>
                                        </div>
                                    )}
                                    {item.target_contract_doc && (
                                        <div className="flex items-center gap-2 text-[9px] font-mono text-gray-500">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40" />
                                            <span className="opacity-50 uppercase">חוזה:</span>
                                            <span className="text-gray-400 truncate max-w-[120px]">{item.target_contract_doc.title}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-between items-center mt-1">
                                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-indigo-500/5 border border-indigo-500/10">
                                        <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
                                        <span className="text-[8px] font-mono font-black text-indigo-400 uppercase tracking-widest">ממתין_לניתוח</span>
                                    </div>
                                    <div className="p-1.5 rounded-lg bg-white/5 text-gray-500 group-hover:text-white group-hover:bg-white/10 transition-all">
                                        <ExternalLink className="w-3 h-3" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
