import React from 'react';
import { motion } from 'framer-motion';
import { CURRENCY_FORMAT_OPTIONS, PRICING_LEDGER_STAT_CARDS } from '../constants';
import type { PricingLedgerTotals } from '../types';

interface TotalsSummaryProps {
    totals: PricingLedgerTotals;
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('he-IL', CURRENCY_FORMAT_OPTIONS).format(value);
}

export default function TotalsSummary({ totals }: TotalsSummaryProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0" dir="rtl">
            {PRICING_LEDGER_STAT_CARDS.map((stat, index) => (
                (() => {
                    const isHighlighted = 'highlight' in stat && stat.highlight;

                    return (
                        <motion.div
                            key={stat.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className={`bg-[#151C24]/60 border border-white/5 p-6 rounded-[2rem] flex flex-col justify-center relative overflow-hidden group ${isHighlighted ? 'bg-blue-500/5 border-blue-500/20' : ''}`}
                        >
                            {isHighlighted && (
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
                            )}
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{stat.label}</span>
                                <span className="text-[8px] font-mono text-gray-600 uppercase tracking-widest">{stat.sub}</span>
                            </div>
                            <span className={`text-2xl font-black font-mono tracking-tighter ${
                                stat.color === 'blue' ? 'text-blue-400'
                                    : stat.color === 'emerald' ? 'text-emerald-400'
                                        : stat.color === 'primary' ? 'text-white'
                                            : 'text-gray-300'
                            }`}>
                                {formatCurrency(totals[stat.valueKey])}
                            </span>
                        </motion.div>
                    );
                })()
            ))}
        </div>
    );
}
