import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Fingerprint, FileSearch, Quote } from 'lucide-react';

interface EvidenceData {
    contract_quote?: string;
    work_quote?: string;
    contract_title?: string;
    work_title?: string;
    contract_page?: number | string;
    work_page?: number | string;
    contract_url?: string;
    work_url?: string;
}

const EvidenceMarker = ({ 
    part, 
    isMarker1, 
    evidence, 
    onOpen 
}: { 
    part: string; 
    isMarker1: boolean; 
    evidence: EvidenceData; 
    onOpen?: (url: string | null, page: number | string | null) => void 
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const quote = isMarker1 ? evidence?.contract_quote : evidence?.work_quote;
    const title = isMarker1 ? evidence?.contract_title : evidence?.work_title;
    const page = isMarker1 ? evidence?.contract_page : evidence?.work_page;
    const url = isMarker1 ? evidence?.contract_url : evidence?.work_url;
    
    if (!quote) {
        return (
            <span className="inline-flex items-center mx-0.5 px-2 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[10px] font-black align-middle">
                {part} נדרש אימות
            </span>
        );
    }

    return (
        <span 
            className="relative inline-block mx-0.5 align-middle select-none"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <motion.span 
                whileHover={{ scale: 1.15, y: -1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onOpen && url) {
                        onOpen(url, page || null);
                    } else if (url) {
                        window.open(page ? `${url}#page=${page}` : url, '_blank');
                    }
                }}
                className={`cursor-pointer px-2 py-0.5 rounded-md text-[10px] font-black border transition-all shadow-md flex items-center gap-1.5 active:brightness-125 ${
                    isMarker1 
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/50 hover:bg-blue-500/40' 
                    : 'bg-red-600/30 text-red-300 border-red-500/50 hover:bg-red-500/40'
                }`}
            >
                {part}
                <ExternalLink size={8} className="opacity-70" />
            </motion.span>
            
            <AnimatePresence>
                {isHovered && (
                    <motion.span 
                        initial={{ opacity: 0, scale: 0.9, y: 5, x: '-50%' }}
                        animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, scale: 0.9, y: 2, x: '-50%' }}
                        transition={{ duration: 0.1, ease: "linear" }}
                        style={{ zIndex: 9999 }}
                        className="absolute bottom-full left-1/2 mb-3 w-80 p-5 bg-[#0B0F14] border border-white/10 rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,1)] pointer-events-none"
                    >
                        <span className="block font-black text-[9px] uppercase tracking-[0.2em] text-gray-500 mb-3 border-b border-white/5 pb-2 flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Fingerprint className={`w-3.5 h-3.5 ${isMarker1 ? 'text-blue-400' : 'text-red-400'}`} />
                                {isMarker1 ? 'בסיס חוזי (צילום מצב)' : 'ראיית ביצוע (מהשטח)'}
                            </span>
                            <span className="text-white/20 font-mono text-[8px]">REF: {part}</span>
                        </span>
                        <div className="relative">
                            <Quote className="absolute -top-1 -right-1 w-6 h-6 text-white/5 pointer-events-none" />
                            <p className="text-[12px] text-gray-100 leading-relaxed italic font-medium text-right relative z-10 pr-2" dir="rtl">
                                "{quote}"
                            </p>
                        </div>
                        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[9px] text-gray-500 font-black truncate uppercase tracking-widest">
                            <span className="flex items-center gap-2 max-w-[70%] truncate text-gray-400">
                                <FileSearch className="w-3.5 h-3.5 text-gray-600" />
                                {title || 'מסמך מקור'}
                            </span>
                            {page && (
                                <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 text-emerald-400/70 shrink-0 font-mono">
                                    עמוד {page}
                                </span>
                            )}
                        </div>
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#0B0F14] border-r border-b border-white/10 rotate-45" />
                    </motion.span>
                )}
            </AnimatePresence>
        </span>
    );
};

interface RichTextProps {
    text: string;
    evidence?: EvidenceData;
    onOpen?: (url: string | null, page: number | string | null) => void;
    className?: string;
    dir?: 'rtl' | 'ltr';
}

export const RichText = ({ text, evidence, onOpen, className = "", dir = "ltr" }: RichTextProps) => {
    if (!text) return null;
    
    const parts = text.split(/(\[[12]\])/);
    
    return (
        <span className={`${className} leading-relaxed block`} dir={dir}>
            {parts.map((part, i) => {
                const isMarker1 = part === '[1]';
                const isMarker2 = part === '[2]';
                
                if (isMarker1 || isMarker2) {
                    return <EvidenceMarker key={i} part={part} isMarker1={isMarker1} evidence={evidence || {}} onOpen={onOpen} />;
                }
                
                return <span key={i}>{part}</span>;
            })}
        </span>
    );
};
