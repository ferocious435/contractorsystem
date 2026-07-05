"use client";

import React from 'react';
import { FileText, X } from 'lucide-react';
import { motion } from 'framer-motion';
import SmartLetterGenerator from '@/components/features/SmartLetterGenerator';

interface LetterGeneratorModalProps {
    projectId: string;
    initialSelectedItems: string[];
    onClose: () => void;
}

function LetterGeneratorModal({
    projectId, 
    initialSelectedItems, 
    onClose 
}: LetterGeneratorModalProps) {
    return (
        <div className="fixed inset-0 z-[100] bg-[#0B0F14]/80 backdrop-blur-2xl flex items-center justify-center p-4 md:p-12">
            <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-[#151C24] border border-white/10 rounded-[3rem] w-full max-w-7xl max-h-[92vh] overflow-hidden shadow-[0_50px_100px_rgba(0,0,0,0.6)] flex flex-col relative"
            >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent" />
                <div className="px-10 py-6 border-b border-white/5 flex items-center justify-between bg-black/20">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
                            <FileText className="h-5 w-5 text-purple-400" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-mono font-black text-purple-400 uppercase tracking-[0.3em]">מסוף_מכתבים_מאובטח</span>
                            <span className="text-lg font-black text-white font-mono uppercase tracking-tighter">צומת_מחולל_טיוטות</span>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center transition-all text-gray-400 hover:text-white border border-white/5"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-10">
                    <SmartLetterGenerator 
                        projectId={projectId} 
                        initialSelectedItems={initialSelectedItems}
                        onClose={onClose}
                    />
                </div>
            </motion.div>
        </div>
    );
}

export default React.memo(LetterGeneratorModal);
