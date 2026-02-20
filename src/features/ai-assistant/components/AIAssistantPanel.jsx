import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  Languages,
  Loader2,
  RotateCcw,
  Bot,
  Wand2,
  X
} from 'lucide-react';
import {
  AI_ASSISTANT_LENGTHS,
  AI_ASSISTANT_TASKS,
  AI_ASSISTANT_TONES,
  AI_OUTPUT_LANGUAGES,
  AI_TRANSLATE_LANGUAGES,
  isTranslateTask
} from '../constants/options';
import { runPromptAssistantTask } from '../services/promptAssistantService';
import './AIAssistantPanel.css';

const DEFAULT_TASK = 'summarize';
const DEFAULT_TONE = 'neutral';
const DEFAULT_LENGTH = 'medium';
const DEFAULT_OUTPUT_LANGUAGE = 'auto';
const COMPACT_LAYOUT_THRESHOLD = 560;

function AIAssistantPanel({
  open,
  sourceText,
  sourceType = 'text',
  onClose,
}) {
  const { t, i18n } = useTranslation();
  const [taskType, setTaskType] = useState(DEFAULT_TASK);
  const [inputText, setInputText] = useState(sourceText || '');
  const [outputLanguage, setOutputLanguage] = useState(DEFAULT_OUTPUT_LANGUAGE);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [length, setLength] = useState(DEFAULT_LENGTH);
  const [extraInstruction, setExtraInstruction] = useState('');
  const [resultText, setResultText] = useState('');
  const [running, setRunning] = useState(false);
  const [hasExecuted, setHasExecuted] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [copied, setCopied] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [responseMeta, setResponseMeta] = useState({
    model: '',
    effectiveOutputLanguage: ''
  });
  const panelRef = useRef(null);
  const resultCardRef = useRef(null);

  const languageOptions = useMemo(
    () => (isTranslateTask(taskType) ? AI_TRANSLATE_LANGUAGES : AI_OUTPUT_LANGUAGES),
    [taskType]
  );

  useEffect(() => {
    if (!open) return;
    setInputText(sourceText || '');
    setResultText('');
    setErrorText('');
    setCopied(false);
    setHasExecuted(false);
    setResponseMeta({
      model: '',
      effectiveOutputLanguage: ''
    });
    requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }, [open, sourceText]);

  useEffect(() => {
    if (!isTranslateTask(taskType)) return;
    if (outputLanguage === 'auto') {
      setOutputLanguage('en-US');
    }
  }, [taskType, outputLanguage]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open || !panelRef.current) return undefined;

    const panel = panelRef.current;
    const updateCompactState = () => {
      setIsCompactLayout(panel.clientWidth < COMPACT_LAYOUT_THRESHOLD);
    };

    updateCompactState();
    const observer = new ResizeObserver(updateCompactState);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open]);

  if (!open) return null;

  const canRun = inputText.trim().length > 0 && !running;

  const handleTaskChange = (nextTask) => {
    if (nextTask === taskType) return;
    setTaskType(nextTask);
    setErrorText('');
    setResultText('');
    setHasExecuted(false);
  };

  const handleRun = async () => {
    if (!canRun) return;
    setHasExecuted(true);
    setRunning(true);
    setErrorText('');
    setCopied(false);

    try {
      const response = await runPromptAssistantTask({
        taskType,
        input: inputText.trim(),
        uiLanguage: i18n.language,
        outputLanguage,
        tone,
        length,
        extraInstruction: extraInstruction.trim() || null
      });

      setResultText(response?.output || '');
      setResponseMeta({
        model: response?.model || '',
        effectiveOutputLanguage: response?.effectiveOutputLanguage || ''
      });
      requestAnimationFrame(() => {
        resultCardRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      });
    } catch (error) {
      setErrorText(
        typeof error === 'string'
          ? error
          : error?.message || t('aiAssistant.errorUnknown')
      );
    } finally {
      setRunning(false);
    }
  };

  const handleCopyResult = async () => {
    if (!resultText.trim()) return;
    try {
      await invoke('copy_plain_text', { text: resultText });
      setCopied(true);
    } catch (error) {
      setErrorText(
        typeof error === 'string'
          ? error
          : error?.message || t('aiAssistant.copyFailed')
      );
    }
  };

  const resetInputFromSource = () => {
    setInputText(sourceText || '');
    setErrorText('');
  };

  const sourceLabel = t(`aiAssistant.sourceType.${sourceType}`, {
    defaultValue: t('aiAssistant.sourceType.text')
  });

  return (
    <section
      ref={panelRef}
      className="ai-assistant-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ai-assistant-head">
        <div className="ai-assistant-title-wrap">
          <span className="ai-assistant-title-icon">
            <Bot size={14} />
          </span>
          <div>
            <div className="ai-assistant-title">{t('aiAssistant.title')}</div>
            <div className="ai-assistant-subtitle">{t('aiAssistant.subtitle')}</div>
          </div>
        </div>
        <button
          type="button"
          className="ai-assistant-close-btn"
          onClick={onClose}
          title={t('aiAssistant.close')}
        >
          <X size={14} />
        </button>
      </div>

      <div className="ai-assistant-scroll-area">
        <div className="ai-assistant-task-grid">
          {AI_ASSISTANT_TASKS.map((task) => (
            <button
              key={task}
              type="button"
              className={`ai-assistant-task-btn ${task === taskType ? 'active' : ''}`}
              onClick={() => handleTaskChange(task)}
            >
              <span>{t(`aiAssistant.tasks.${task}`)}</span>
            </button>
          ))}
        </div>

        {!isCompactLayout && (
          <div className="ai-assistant-controls-grid">
            <label className="ai-assistant-control">
              <span className="ai-assistant-control-label">
                <Languages size={13} />
                {t('aiAssistant.outputLanguage')}
              </span>
              <select
                value={outputLanguage}
                onChange={(e) => setOutputLanguage(e.target.value)}
              >
                {languageOptions.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`aiAssistant.language.${locale}`)}
                  </option>
                ))}
              </select>
            </label>

            {!isTranslateTask(taskType) && (
              <label className="ai-assistant-control">
                <span className="ai-assistant-control-label">{t('aiAssistant.tone')}</span>
                <select value={tone} onChange={(e) => setTone(e.target.value)}>
                  {AI_ASSISTANT_TONES.map((option) => (
                    <option key={option} value={option}>
                      {t(`aiAssistant.toneOption.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!isTranslateTask(taskType) && (
              <label className="ai-assistant-control">
                <span className="ai-assistant-control-label">{t('aiAssistant.length')}</span>
                <select value={length} onChange={(e) => setLength(e.target.value)}>
                  {AI_ASSISTANT_LENGTHS.map((option) => (
                    <option key={option} value={option}>
                      {t(`aiAssistant.lengthOption.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <label className="ai-assistant-input-group">
          <span className="ai-assistant-input-label">
            {t('aiAssistant.inputLabel', { source: sourceLabel })}
          </span>
          <textarea
            className="ai-assistant-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t('aiAssistant.inputPlaceholder')}
          />
        </label>

        <label className="ai-assistant-input-group">
          <span className="ai-assistant-input-label">
            {t('aiAssistant.extraInstructionLabel')}
          </span>
          <textarea
            className="ai-assistant-extra"
            value={extraInstruction}
            onChange={(e) => setExtraInstruction(e.target.value)}
            placeholder={t('aiAssistant.extraInstructionPlaceholder')}
          />
        </label>
      </div>

      <div className="ai-assistant-footer">
        <div className="ai-assistant-actions">
          <button
            type="button"
            className="ai-assistant-btn secondary"
            onClick={resetInputFromSource}
          >
            <RotateCcw size={14} />
            <span>{t('aiAssistant.reset')}</span>
          </button>
          <button
            type="button"
            className="ai-assistant-btn primary"
            onClick={handleRun}
            disabled={!canRun}
          >
            {running ? <Loader2 size={14} className="ai-spin" /> : <Wand2 size={14} />}
            <span>{running ? t('aiAssistant.running') : t('aiAssistant.run')}</span>
          </button>
        </div>

        {errorText && (
          <div className="ai-assistant-feedback error">{errorText}</div>
        )}

        {hasExecuted && (
          <div className="ai-assistant-result-card" ref={resultCardRef}>
            <div className="ai-assistant-result-head">
              <span>{t('aiAssistant.result')}</span>
              <div className="ai-assistant-result-meta">
                {responseMeta.effectiveOutputLanguage && (
                  <span>{t(`aiAssistant.language.${responseMeta.effectiveOutputLanguage}`)}</span>
                )}
                {responseMeta.model && <span>{responseMeta.model}</span>}
              </div>
              <button
                type="button"
                className={`ai-assistant-copy-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopyResult}
                disabled={!resultText.trim()}
                title={copied ? t('aiAssistant.copied') : t('aiAssistant.copy')}
              >
                <Copy size={13} />
                <span>{copied ? t('aiAssistant.copied') : t('aiAssistant.copy')}</span>
              </button>
            </div>
            <div className="ai-assistant-result-text">
              {running ? t('aiAssistant.resultLoading') : (resultText || t('aiAssistant.resultPlaceholder'))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default AIAssistantPanel;
