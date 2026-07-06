"use client";

import React from 'react';
import { X, ShieldCheck, Briefcase } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScreenOfTruthModal from '@/components/documents/ScreenOfTruthModal';
import {
    EstimatorEvidenceTrace,
    EstimatorExpertStrategy,
    EstimatorFinancialSummary,
    EstimatorLoadingState,
    EstimatorPricingBreakdown,
    EstimatorPricingForm,
    EstimatorReasoningPanel,
    EstimatorSourceSelector,
    type AIEstimatorModalProps,
    useAiEstimatorState,
} from './ai-estimator';

/**
 * מסוף אבחון בינה מלאכותית
 * מסוף פיננסי לניתוח סתירות והערכת השפעתן.
 * תומך ב-"מצב מומחה" ליצירת אסטרטגיות הנדסיות-מסחריות.
 */
export default function AIEstimatorModal({ contradiction, onClose, onApprove }: AIEstimatorModalProps) {
    const { state, setters, actions, derived } = useAiEstimatorState({
        contradiction,
        onClose,
        onApprove,
    });
    const {
        isLoading,
        estimateData,
        isSaving,
        isExpertMode,
        formState,
        viewerDoc,
        isViewerOpen,
    } = state;
    const {
        setFormState,
        setIsExpertMode,
        setIsViewerOpen,
    } = setters;
    const {
        handleFormChange,
        handleSubmit,
        handleViewSource,
    } = actions;
    const {
        themeColor,
        themeHex,
        totalExclVat,
        vatAmount,
        totalInclVat,
        confidencePct,
        isZeroMatch,
        expertTechnical,
        expertArgument,
        expertDiary,
        transactionDisplayId,
        hasPricingDraft,
        requiresUserAnswerBeforeApproval,
    } = derived;
    const handleMarkupPreset = React.useCallback((markup: number) => {
        setFormState((prev) => ({ ...prev, markup }));
    }, [setFormState]);

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-0 sm:p-4 bg-black/95 backdrop-blur-3xl overflow-y-auto" dir="rtl">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className={`bg-[#0B0F14] border border-white/10 rounded-none sm:rounded-[3rem] w-full max-w-7xl min-h-dvh sm:my-6 sm:min-h-[85vh] flex flex-col shadow-[0_0_150px_rgba(0,0,0,1)] overflow-hidden relative transition-colors duration-700`}
            >
                {/* Scanner Line */}
                <div className={`absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent ${isExpertMode ? 'via-amber-500/50' : 'via-emerald-500/50'} to-transparent shadow-[0_0_20px_${themeHex}] animate-scan z-50 pointer-events-none opacity-30`} />

                {/* Background Decor */}
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
                    <div className={`absolute -top-24 -left-24 w-96 h-96 ${isExpertMode ? 'bg-amber-500/5' : 'bg-emerald-500/5'} rounded-full blur-[120px] transition-colors duration-1000`} />
                    <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] transition-colors duration-1000" />
                </div>

                {/* Header Section */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 sm:px-8 lg:px-12 py-5 sm:py-8 border-b border-white/5 bg-white/[0.02] relative z-10">
                    <div className="flex items-center gap-4 sm:gap-8">
                        <div className="flex flex-col">
                            <div className="flex items-center gap-3 mb-2">
                                <motion.div 
                                    animate={{ 
                                        scale: [1, 1.2, 1],
                                        boxShadow: [`0 0 10px ${themeHex}44`, `0 0 25px ${themeHex}88`, `0 0 10px ${themeHex}44`]
                                    }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    className={`w-3 h-3 ${isExpertMode ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full shadow-[0_0_15px_${themeHex}]`} 
                                />
                                <span className={`text-[11px] font-mono font-black ${isExpertMode ? 'text-amber-500' : 'text-emerald-500'} uppercase tracking-[0.4em]`}>
                                    {isExpertMode ? 'ניתוח הנדסי-מסחרי' : 'ניתוח פיננסי חכם'}
                                </span>
                            </div>
                            <h2 className="text-xl sm:text-2xl lg:text-3xl font-black text-white uppercase tracking-tighter font-mono flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                                מסוף הערכה 
                                <span className="text-gray-600 font-light font-sans text-xl">/ {isExpertMode ? 'אסטרטגיה הנדסית' : 'חישוב עלות חכם'}</span>
                            </h2>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 sm:gap-6">
                        {/* Lawyer Mode Toggle */}
                        <motion.button 
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setIsExpertMode(!isExpertMode)}
                            className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-8 py-3.5 rounded-[1.5rem] border transition-all duration-700 font-mono text-[10px] sm:text-xs font-black uppercase tracking-tight shadow-lg ${
                                isExpertMode 
                                ? 'border-amber-500 bg-amber-500/10 text-amber-500 shadow-[0_0_40px_rgba(245,158,11,0.15)]' 
                                : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white'
                            }`}
                        >
                            <ShieldCheck className={`w-5 h-5 ${isExpertMode ? 'animate-bounce' : ''}`} />
                            {isExpertMode ? 'אסטרטגיה הנדסית פעילה' : 'הפעל ניתוח מומחה'}
                        </motion.button>


                        <div className="h-12 w-[1px] bg-white/10 mx-2" />
                        
                        <button 
                            onClick={onClose} 
                            className="w-11 h-11 sm:w-14 sm:h-14 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 transition-all rounded-2xl border border-transparent hover:border-white/10"
                        >
                            <X className="w-8 h-8" />
                        </button>
                    </div>
                </div>

                <div className="px-4 sm:px-8 lg:px-12 py-5 sm:py-6 border-b border-white/5 bg-emerald-500/[0.04] relative z-10">
                    <div className="flex flex-col gap-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold w-fit">
                            <Briefcase className="w-4 h-4" />
                            אתה מתמחר עכשיו סתירה ספציפית
                        </div>
                        <h3 className="text-2xl font-black text-white">{contradiction.title}</h3>
                        <p className="text-sm text-gray-300 leading-7 max-w-5xl">{contradiction.description}</p>
                        <div className="flex flex-col md:flex-row gap-3 md:gap-6 text-sm text-gray-400">
                            {contradiction.target_doc?.title && (
                                <span>מסמך חוזה: {contradiction.target_doc.title}</span>
                            )}
                            {contradiction.source_doc?.title && (
                                <span>מסמך ביצוע: {contradiction.source_doc.title}</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:flex-row relative z-10">
                    {/* Left Panel: Intelligence & Rationale */}
                    <div className="w-full lg:w-[55%] border-b lg:border-b-0 lg:border-l border-white/5 p-4 sm:p-8 lg:p-12 bg-black/20 flex flex-col gap-6 lg:gap-10 overflow-y-auto custom-scrollbar">
                        
                        {/* Source Indicators */}
                        <div className="space-y-6">
                            <div className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                                <div className="w-8 h-[1px] bg-gray-800" />
                                מקורות נתונים
                                <div className="flex-1 h-[1px] bg-gray-800" />
                            </div>

                            <EstimatorSourceSelector
                                source={formState.source}
                                themeColor={themeColor}
                                hasPricingDraft={hasPricingDraft}
                            />
                        </div>

                        <AnimatePresence mode="wait">
                            {isLoading ? (
                                <EstimatorLoadingState isExpertMode={isExpertMode} themeHex={themeHex} />
                            ) : (
                                <motion.div 
                                    key="content"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex flex-col gap-10"
                                >
                                    <EstimatorReasoningPanel
                                        estimateData={estimateData}
                                        isZeroMatch={isZeroMatch}
                                        confidencePct={confidencePct}
                                        source={formState.source}
                                        hasPricingDraft={hasPricingDraft}
                                    />

                                    <EstimatorPricingBreakdown estimateData={estimateData} />

                                    <EstimatorExpertStrategy
                                        isExpertMode={isExpertMode}
                                        expertStrategy={estimateData?.expert_strategy}
                                        expertTechnical={expertTechnical}
                                        expertArgument={expertArgument}
                                        expertDiary={expertDiary}
                                    />

                                    <EstimatorEvidenceTrace
                                        contradiction={contradiction}
                                        estimateData={estimateData}
                                        onViewSource={handleViewSource}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Right Panel: Value Matrix & Control */}
                    <div className="w-full lg:w-[45%] p-4 sm:p-8 lg:p-12 bg-white/[0.01] flex flex-col gap-6 lg:gap-12 overflow-y-auto custom-scrollbar">
                        <div className="text-[10px] font-mono font-black text-gray-600 uppercase tracking-[0.4em] flex items-center gap-4">
                            <div className="w-8 h-[1px] bg-gray-800" />
                            הערכת שווי
                        </div>

                        <EstimatorPricingForm
                            formState={formState}
                            onFormChange={handleFormChange}
                            onMarkupPreset={handleMarkupPreset}
                            hasPricingDraft={hasPricingDraft}
                        />
                        {/* Financial Ledger Summary */}
                        <EstimatorFinancialSummary
                            themeColor={themeColor}
                            themeHex={themeHex}
                            isExpertMode={isExpertMode}
                            isSaving={isSaving}
                            isLoading={isLoading}
                            totalExclVat={totalExclVat}
                            vatAmount={vatAmount}
                            totalInclVat={totalInclVat}
                            transactionDisplayId={transactionDisplayId}
                            canSubmit={hasPricingDraft && !requiresUserAnswerBeforeApproval}
                            blockReason={requiresUserAnswerBeforeApproval
                                ? 'יש שאלות שמשפיעות על הכמות או המחיר. עדכון התמחור נשאר כטיוטה עד להשלמת הנתונים.'
                                : undefined}
                            onSubmit={handleSubmit}
                        />
                    </div>
                </div>
            </motion.div>

            <AnimatePresence>
                {isViewerOpen && viewerDoc && (
                    <ScreenOfTruthModal 
                        document={viewerDoc}
                        projectId={viewerDoc.project_id || contradiction.project_id}
                        onClose={() => setIsViewerOpen(false)}
                        onValidate={async () => {
                            setIsViewerOpen(false);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
