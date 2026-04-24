import React from 'react';
import { Clock, CheckCircle, FileText, Bot, AlertTriangle, ExternalLink, Info } from 'lucide-react';

interface Contradiction {
    id: string;
    title: string;
    description: string;
    severity: string;
    status: string;
    pricing_status: string;
    source_execution_doc?: { title: string };
    target_contract_doc?: { title: string };
}

interface PendingQueueProps {
    items: Contradiction[];
    onSelectForEstimation: (item: Contradiction) => void;
}

export default function PendingQueue({ items, onSelectForEstimation }: PendingQueueProps) {
    if (items.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-500 bg-[#11161D] rounded-xl border border-white/5">
                <CheckCircle className="w-12 h-12 mb-4 opacity-50 text-emerald-500" />
                <h3 className="text-lg font-medium text-white">תור ריק</h3>
                <p className="mt-2">אין כרגע חריגים הממתינים לתמחור.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 overflow-y-auto h-full pr-2 custom-scrollbar">
            {items.map((item) => (
                <div
                    key={item.id}
                    className="p-4 rounded-xl border border-white/10 bg-[#151C24] hover:bg-[#1A222C] transition-colors cursor-pointer group"
                    onClick={() => onSelectForEstimation(item)}
                >
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-semibold text-gray-400 bg-black/30 px-2 py-1 rounded">
                            {item.id.substring(0, 8).toUpperCase()}
                        </span>
                        {item.severity === 'HIGH' && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded">
                                <AlertTriangle className="w-3 h-3" /> קריטי (V.O)
                            </span>
                        )}
                        {item.severity === 'MEDIUM' && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">
                                <AlertTriangle className="w-3 h-3" /> בינוני
                            </span>
                        )}
                        {item.severity === 'LOW' && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
                                <Info className="w-3 h-3" /> נמוך
                            </span>
                        )}
                    </div>

                    <h4 className="text-sm font-medium text-white mb-2 line-clamp-2" dir="rtl">
                        {item.title}
                    </h4>

                    <p className="text-xs text-gray-400 mb-4 line-clamp-3" dir="rtl">
                        {item.description}
                    </p>

                    <div className="flex flex-col gap-2 mt-auto">
                        {item.source_execution_doc && (
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 bg-white/5 rounded p-1.5" dir="rtl" title="מסמך ביצוע">
                                <FileText className="w-3 h-3 text-emerald-400" />
                                <span className="truncate">{item.source_execution_doc.title}</span>
                            </div>
                        )}

                        <div className="flex justify-between items-center mt-2">
                            <span className="flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded">
                                <Clock className="w-3 h-3" /> ממתין לתמחור
                            </span>

                            <button className="opacity-0 group-hover:opacity-100 transition-opacity bg-primary/20 hover:bg-primary/30 text-primary p-1.5 rounded-lg flex items-center gap-1">
                                <span className="text-xs font-medium">הערך בעזרת AI</span>
                                <Bot className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
