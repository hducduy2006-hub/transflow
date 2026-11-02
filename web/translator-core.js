/**
 * TransFlow — Universal In-Place Live Translator & Smart IME Bar
 * Works seamlessly as:
 *   1. Chrome / Edge / Cốc Cốc / Brave Extension Content Script (Messenger, Zalo Web, Gmail, Slack, Discord, etc.)
 *   2. Standalone Web App / Bookmarklet Runtime (direct CORS fetch fallback + localStorage)
 */

(() => {
  if (window.__TRANSFLOW_INITIALIZED__) return;
  window.__TRANSFLOW_INITIALIZED__ = true;

  const IS_EXTENSION = Boolean(
    typeof chrome !== 'undefined' &&
    chrome?.runtime?.id &&
    chrome?.storage?.sync
  );

  const LANGUAGES = [
    { code: 'vi', label: 'VI', fullName: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'en', label: 'EN', fullName: 'English', flag: '🇬🇧' },
    { code: 'ja', label: 'JA', fullName: '日本語', flag: '🇯🇵' },
    { code: 'zh-CN', label: 'ZH', fullName: '中文(简)', flag: '🇨🇳' },
    { code: 'zh-TW', label: '繁', fullName: '中文(繁)', flag: '🇹🇼' }
  ];

  const TONES = [
    { id: 'natural', label: 'Tự nhiên' },
    { id: 'polite', label: 'Lịch sự / Keigo' },
    { id: 'casual', label: 'Thân mật' },
    { id: 'concise', label: 'Ngắn gọn' }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    targetLang: 'en',
    fallbackLang: 'vi',
    sourceLang: 'auto',
    autoPivot: true,
    confirmKey: 'Tab',        // 'Tab' | 'Alt+Q' | 'Ctrl+Enter' | 'ButtonOnly'
    defaultScope: 'segment',  // 'segment' | 'full'
    showPhonetic: true,
    engine: 'free',           // 'free' | 'gemini'
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    tone: 'natural',
    disabledHosts: []
  };

  const BLOCKED_INPUT_TYPES = new Set([
    'password', 'email', 'number', 'tel', 'url', 'date', 'datetime-local',
    'month', 'week', 'time', 'color', 'range', 'file', 'checkbox', 'radio',
    'submit', 'button', 'reset', 'image', 'hidden'
  ]);

  const AUTOFILL_SKIP_PATTERN = /\b(password|passcode|otp|one-time-code|cc-|card|cvc|cvv|postal|zip|username|bday|tel|email)\b/i;

  // Runtime state
  let settings = { ...DEFAULT_SETTINGS };
  let scopeOverride = null;          // null | 'segment' | 'full'
  let manualForceTarget = false;     // true when user explicitly clicks a lang pill for current phrase
  let isComposingIME = false;
  let isApplyingReplacement = false;
  let dismissedForText = null;

  let activeTarget = null;           // { kind: 'form'|'contenteditable', el: HTMLElement }
  let currentSegment = null;         // { kind, el, rawText, contextText, activeScope, start?, end?, domRange? }
  let latestResult = null;           // Translation result object
  let pendingReqId = 0;
  let debounceTimer = null;
  let toastTimer = null;

  // Post-commit anchor so continuing to type a 2nd sentence in another language translates ONLY the new sentence
  let anchorState = null;            // { el, prefix (for form) | linePrefix (for contenteditable) }
  let undoState = null;              // { kind, el, originalText, insertedText, start?, end?, prevAnchor }

  // Drag offset for floating bar
  let manualDragOffset = null;       // { dx, dy }

  // Standalone Web / Bookmarklet local cache
  const localCache = new Map();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normLangBase(code) {
    if (!code) return '';
    const lower = code.toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    return lower.split('-')[0];
  }

  function getLangMeta(code) {
    if (!code) return { code: 'auto', label: 'AUTO', fullName: 'Tự động', flag: '🌐' };
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase());
    if (exact) return exact;
    const base = LANGUAGES.find((l) => normLangBase(l.code) === normLangBase(code));
    if (base) return base;
    return { code, label: code.slice(0, 2).toUpperCase(), fullName: code.toUpperCase(), flag: '🌐' };
  }

  function isHostActive() {
    if (!settings.enabled) return false;
    const host = (location.hostname || '').toLowerCase();
    if (!host) return true;
    return !(settings.disabledHosts || []).some((h) => h.toLowerCase() === host);
  }

  // =========================================================================
  // 1. SETTINGS & TRANSLATION TRANSPORT (Extension + Standalone Web Fallback)
  // =========================================================================

  async function loadSettings() {
    if (IS_EXTENSION) {
      try {
        const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
        settings = { ...DEFAULT_SETTINGS, ...stored };
      } catch {
        settings = { ...DEFAULT_SETTINGS };
      }
    } else {
      try {
        const raw = localStorage.getItem('transflow_settings_v1');
        if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {
        settings = { ...DEFAULT_SETTINGS };
      }
    }
    renderBar();
  }

  async function savePartialSettings(patch) {
    settings = { ...settings, ...patch };
    if (IS_EXTENSION) {
      try {
        await chrome.storage.sync.set(patch);
      } catch {}
    } else {
      try {
        localStorage.setItem('transflow_settings_v1', JSON.stringify(settings));
        window.dispatchEvent(new CustomEvent('transflow:settings-updated', { detail: settings }));
      } catch {}
    }
  }

  if (IS_EXTENSION) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [k, v] of Object.entries(changes)) {
        settings[k] = v.newValue;
      }
      if (!isHostActive()) {
        hideWidget();
      } else if (activeTarget) {
        scheduleTranslate(true);
      }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'STATUS_TOGGLED') {
        settings.enabled = msg.enabled;
        if (!isHostActive()) hideWidget();
      } else if (msg?.type === 'TRIGGER_INSTANT_REPLACE') {
        triggerInstantTranslateAndReplace();
      }
    });
  } else {
    window.addEventListener('transflow:update-settings', (e) => {
      if (e.detail) {
        settings = { ...settings, ...e.detail };
        try {
          localStorage.setItem('transflow_settings_v1', JSON.stringify(settings));
        } catch {}
        if (!isHostActive()) hideWidget();
        else if (activeTarget) scheduleTranslate(true);
        else renderBar();
      }
    });
  }

  function detectScriptHint(text) {
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text)) {
      return 'vi';
    }
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
    return null;
  }

  async function standaloneTranslate(payload) {
    const text = (payload.text || '').trim();
    if (!text) return { ok: false, error: 'EMPTY' };

    const sourceLang = payload.sourceLang || settings.sourceLang || 'auto';
    let desiredTarget = payload.targetLang || settings.targetLang || 'en';
    const fallbackLang = payload.fallbackLang || settings.fallbackLang || 'vi';
    const autoPivot = payload.autoPivot ?? settings.autoPivot ?? true;
    const forceTarget = Boolean(payload.forceTarget);
    const engine = payload.engine || settings.engine || 'free';
    const tone = payload.tone || settings.tone || 'natural';
    const apiKey = (settings.geminiApiKey || '').trim();

    let pivoted = false;
    const scriptHint = detectScriptHint(text);
    if (!forceTarget && sourceLang === 'auto' && autoPivot && scriptHint && normLangBase(scriptHint) === normLangBase(desiredTarget)) {
      desiredTarget = normLangBase(fallbackLang) !== normLangBase(desiredTarget)
        ? fallbackLang
        : (normLangBase(desiredTarget) === 'vi' ? 'en' : 'vi');
      pivoted = true;
    }

    const useGemini = engine === 'gemini' && apiKey.length > 10;
    const cacheKey = JSON.stringify([useGemini ? `g:${tone}` : 'f', sourceLang, desiredTarget, forceTarget ? '1' : fallbackLang, text]);
    if (localCache.has(cacheKey)) {
      return { ok: true, ...localCache.get(cacheKey), cached: true };
    }

    const callGTX = async (sl, tl) => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl || 'auto')}&tl=${encodeURIComponent(tl)}&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      let translatedText = '';
      let phonetic = '';
      if (Array.isArray(data?.[0])) {
        for (const seg of data[0]) {
          if (!Array.isArray(seg)) continue;
          if (typeof seg[0] === 'string') translatedText += seg[0];
          if (seg[0] === null && typeof seg[2] === 'string') phonetic += (phonetic ? ' ' : '') + seg[2];
        }
      }
      return {
        translatedText,
        detectedLang: data?.[2] || scriptHint || sl || 'auto',
        phonetic: phonetic.trim(),
        engineUsed: 'free-gtx'
      };
    };

    const callGeminiDirect = async (sl, tl) => {
      const toneMap = {
        natural: 'Use natural, fluent everyday phrasing.',
        polite: 'Use polite, respectful business phrasing (Keigo 丁寧語 for Japanese, polite pronouns for Vietnamese/Chinese/English).',
        casual: 'Use friendly, casual chat phrasing.',
        concise: 'Make the translation concise and clear.'
      };
      const needPhonetic = normLangBase(tl) === 'ja' || normLangBase(tl) === 'zh';
      const sys = [
        `Translate the user's input into ${tl}. ${toneMap[tone] || toneMap.natural}`,
        payload.contextText ? `Preceding context (do not include in output): "${payload.contextText.slice(-180)}"` : '',
        `Return ONLY JSON: {"translatedText": string, "detectedLang": string, "phonetic": string}.`,
        needPhonetic ? `Include accurate ${normLangBase(tl) === 'ja' ? 'Romaji' : 'Pinyin'} in "phonetic".` : `Set "phonetic" to "".`
      ].filter(Boolean).join('\n');

      const model = settings.geminiModel || 'gemini-2.5-flash';
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
          })
        }
      );
      if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
      const json = await resp.json();
      const parsed = JSON.parse(json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      return {
        translatedText: parsed.translatedText,
        detectedLang: parsed.detectedLang || scriptHint || 'auto',
        phonetic: parsed.phonetic || '',
        engineUsed: 'gemini'
      };
    };

    let result;
    let fallbackUsed = false;
    if (useGemini) {
      try {
        result = await callGeminiDirect(sourceLang, desiredTarget);
      } catch {
        fallbackUsed = true;
        result = await callGTX(sourceLang, desiredTarget);
      }
    } else {
      result = await callGTX(sourceLang, desiredTarget);
    }

    if (
      !forceTarget &&
      !pivoted &&
      sourceLang === 'auto' &&
      autoPivot &&
      result.detectedLang &&
      normLangBase(result.detectedLang) === normLangBase(desiredTarget)
    ) {
      desiredTarget = normLangBase(fallbackLang) !== normLangBase(desiredTarget)
        ? fallbackLang
        : (normLangBase(desiredTarget) === 'vi' ? 'en' : 'vi');
      pivoted = true;
      result = useGemini && !fallbackUsed
        ? await callGeminiDirect(result.detectedLang, desiredTarget).catch(() => callGTX(result.detectedLang, desiredTarget))
        : await callGTX(result.detectedLang, desiredTarget);
    }

    const leading = (payload.rawText || '').match(/^\s*/)?.[0] || '';
    const trailing = (payload.rawText || '').match(/\s*$/)?.[0] || '';
    const finalData = {
      translatedText: result.translatedText,
      formattedReplacement: `${leading}${result.translatedText.trim()}${trailing}`,
      detectedLang: result.detectedLang,
      targetLang: desiredTarget,
      phonetic: result.phonetic || '',
      engineUsed: result.engineUsed,
      fallbackUsed,
      pivoted
    };
    localCache.set(cacheKey, finalData);
    return { ok: true, ...finalData };
  }

  async function requestTranslation(payload) {
    if (IS_EXTENSION) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'TRANSLATE', payload });
        if (res) return res;
      } catch {
        // Fallback to direct fetch if extension service worker was reloaded
        return standaloneTranslate(payload);
      }
    }
    return standaloneTranslate(payload);
  }

  // =========================================================================
  // 2. EDITABLE ELEMENT & SMART ACTIVE SEGMENT DETECTION
  // =========================================================================

  function resolveEditableTarget(rawNode, allowRestricted = false) {
    if (!rawNode || !(rawNode instanceof Element || rawNode instanceof Node)) return null;
    const el = rawNode instanceof Element ? rawNode : rawNode.parentElement;
    if (!el) return null;
    if (el.closest('#transflow-shadow-host') || el.closest('[data-transflow-ignore="true"]')) {
      return null;
    }

    const tag = el.tagName?.toLowerCase();
    if (tag === 'textarea') {
      if (el.disabled || el.readOnly) return null;
      return { kind: 'form', el };
    }

    if (tag === 'input') {
      if (el.disabled || el.readOnly) return null;
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (BLOCKED_INPUT_TYPES.has(type)) return null;
      if (!allowRestricted) {
        const meta = `${el.name || ''} ${el.id || ''} ${el.autocomplete || ''}`;
        if (AUTOFILL_SKIP_PATTERN.test(meta)) return null;
      }
      return { kind: 'form', el };
    }

    const ceRoot = el.closest('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]');
    if (ceRoot && ceRoot.getAttribute('contenteditable') !== 'false') {
      return { kind: 'contenteditable', el: ceRoot };
    }

    return null;
  }

  function findBlockAncestor(node, rootEl) {
    let curr = node instanceof Element ? node : node?.parentElement;
    const blockTags = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    while (curr && curr !== rootEl) {
      if (blockTags.has(curr.tagName)) return curr;
      curr = curr.parentElement;
    }
    return rootEl;
  }

  /**
   * Builds a DOM Range for the current visual line up to the caret inside a contenteditable block,
   * respecting <br> line breaks and optional character skip offset (for post-commit sentence continuation).
   */
  function buildContentEditableLineRange(rootEl, skipChars = 0) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !rootEl.contains(sel.focusNode)) return null;

    const caretNode = sel.focusNode;
    const caretOffset = sel.focusOffset;
    const blockEl = findBlockAncestor(caretNode, rootEl);

    // Find last <br> inside blockEl that comes strictly before (caretNode, caretOffset)
    const caretProbe = document.createRange();
    caretProbe.selectNodeContents(blockEl);
    try {
      caretProbe.setEnd(caretNode, caretOffset);
    } catch {
      return null;
    }

    let startContainer = blockEl;
    let startOffset = 0;

    const brs = blockEl.querySelectorAll('br');
    for (const br of brs) {
      const cmpRange = document.createRange();
      cmpRange.setStartBefore(br);
      cmpRange.collapse(true);
      // Compare if <br> is before or at caret
      if (caretProbe.compareBoundaryPoints(Range.END_TO_START, cmpRange) >= 0) {
        const parent = br.parentNode;
        if (parent) {
          const idx = Array.prototype.indexOf.call(parent.childNodes, br);
          if (idx >= 0) {
            startContainer = parent;
            startOffset = idx + 1;
          }
        }
      }
    }

    const lineRange = document.createRange();
    try {
      lineRange.setStart(startContainer, startOffset);
      lineRange.setEnd(caretNode, caretOffset);
    } catch {
      return null;
    }

    if (skipChars <= 0) return lineRange;

    // Advance start of lineRange forward by `skipChars` characters across text nodes
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let remaining = skipChars;
    let node;
    while ((node = walker.nextNode())) {
      // Skip text nodes completely before lineRange start
      const nodeEndRange = document.createRange();
      nodeEndRange.setStart(node, node.nodeValue.length);
      nodeEndRange.collapse(true);
      if (lineRange.compareBoundaryPoints(Range.START_TO_START, nodeEndRange) >= 0) {
        continue;
      }

      // Determine starting index inside this text node
      let localStart = 0;
      if (node === lineRange.startContainer) {
        localStart = lineRange.startOffset;
      }
      const available = node.nodeValue.length - localStart;
      if (remaining <= available) {
        const advanced = lineRange.cloneRange();
        advanced.setStart(node, localStart + remaining);
        return advanced;
      }
      remaining -= available;
    }

    return lineRange;
  }

  function extractActiveSegment(target, forceFull = false) {
    if (!target || !target.el || !target.el.isConnected) return null;
    const effectiveScope = forceFull ? 'full' : (scopeOverride || settings.defaultScope || 'segment');

    if (target.kind === 'form') {
      const el = target.el;
      const val = el.value || '';
      if (!val) return null;

      const selStart = el.selectionStart ?? val.length;
      const selEnd = el.selectionEnd ?? val.length;

      if (selStart !== selEnd) {
        return {
          kind: 'form',
          el,
          rawText: val.slice(selStart, selEnd),
          contextText: val.slice(Math.max(0, selStart - 200), selStart),
          activeScope: 'selection',
          start: selStart,
          end: selEnd
        };
      }

      if (effectiveScope === 'full') {
        return {
          kind: 'form',
          el,
          rawText: val,
          contextText: '',
          activeScope: 'full',
          start: 0,
          end: val.length
        };
      }

      const lineStart = val.lastIndexOf('\n', Math.max(0, selEnd - 1)) + 1;
      let segStart = lineStart;

      if (
        anchorState &&
        anchorState.el === el &&
        typeof anchorState.prefix === 'string' &&
        val.startsWith(anchorState.prefix) &&
        selEnd >= anchorState.prefix.length &&
        anchorState.prefix.length >= lineStart
      ) {
        segStart = anchorState.prefix.length;
      } else if (anchorState && anchorState.el === el && !val.startsWith(anchorState.prefix || '')) {
        anchorState = null;
      }

      return {
        kind: 'form',
        el,
        rawText: val.slice(segStart, selEnd),
        contextText: val.slice(Math.max(0, segStart - 200), segStart),
        activeScope: 'segment',
        start: segStart,
        end: selEnd
      };
    }

    // contenteditable (Messenger, Zalo Web, Gmail, Slack, Discord, Notion...)
    const rootEl = target.el;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !rootEl.contains(sel.anchorNode)) return null;

    if (!sel.isCollapsed) {
      const domRange = sel.getRangeAt(0).cloneRange();
      const rawText = domRange.toString();
      return {
        kind: 'contenteditable',
        el: rootEl,
        rawText,
        contextText: '',
        activeScope: 'selection',
        domRange
      };
    }

    if (effectiveScope === 'full') {
      const domRange = document.createRange();
      domRange.selectNodeContents(rootEl);
      const rawText = domRange.toString() || rootEl.innerText || '';
      return {
        kind: 'contenteditable',
        el: rootEl,
        rawText,
        contextText: '',
        activeScope: 'full',
        domRange
      };
    }

    const fullLineRange = buildContentEditableLineRange(rootEl, 0);
    if (!fullLineRange) return null;
    const fullLineText = fullLineRange.toString();

    let skipChars = 0;
    let contextText = '';
    if (
      anchorState &&
      anchorState.el === rootEl &&
      typeof anchorState.linePrefix === 'string' &&
      anchorState.linePrefix.length > 0
    ) {
      if (fullLineText.startsWith(anchorState.linePrefix) && fullLineText.length >= anchorState.linePrefix.length) {
        skipChars = anchorState.linePrefix.length;
        contextText = anchorState.linePrefix;
      } else {
        anchorState = null;
      }
    }

    const segRange = skipChars > 0 ? buildContentEditableLineRange(rootEl, skipChars) : fullLineRange;
    if (!segRange) return null;

    return {
      kind: 'contenteditable',
      el: rootEl,
      rawText: segRange.toString(),
      contextText,
      activeScope: 'segment',
      domRange: segRange
    };
  }

  function isWorthTranslating(rawText) {
    if (!rawText) return false;
    const trimmed = rawText.trim();
    if (trimmed.length < 2) {
      // Single CJK character IS meaningful!
      if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(trimmed)) return true;
      return false;
    }
    // Skip pure URLs, emails, or pure numbers/punctuation
    if (/^(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)$/i.test(trimmed)) return false;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return false;
    return true;
  }

  // =========================================================================
  // 3. IN-PLACE DOM REPLACEMENT & UNDO ENGINE (Lexical / Slate / React Safe)
  // =========================================================================

  function setNativeFormValue(el, newValue, caretPos) {
    const proto = el.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) {
      descriptor.set.call(el, newValue);
    } else {
      el.value = newValue;
    }
    try {
      el.setSelectionRange(caretPos, caretPos);
    } catch {}
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertReplacementText',
      data: newValue
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function applyReplacement(segment, replacementText, { isUndo = false } = {}) {
    if (!segment || !segment.el || !segment.el.isConnected) return false;
    isApplyingReplacement = true;

    try {
      if (segment.kind === 'form') {
        const el = segment.el;
        const val = el.value || '';
        const start = Math.max(0, Math.min(segment.start ?? 0, val.length));
        const end = Math.max(start, Math.min(segment.end ?? val.length, val.length));
        const before = val.slice(0, start);
        const after = val.slice(end);
        const expected = before + replacementText + after;
        const newCaret = start + replacementText.length;

        const prevAnchor = anchorState ? { ...anchorState } : null;

        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(start, end);
        } catch {}

        let ok = false;
        try {
          ok = document.execCommand('insertText', false, replacementText);
        } catch {}

        if (!ok || el.value !== expected) {
          setNativeFormValue(el, expected, newCaret);
        } else {
          try {
            el.setSelectionRange(newCaret, newCaret);
          } catch {}
        }

        if (!isUndo) {
          // Ensure trailing space convenience when continuing sentence if none present? Keep exact text so user controls spacing!
          anchorState = { el, prefix: el.value.slice(0, newCaret) };
          undoState = {
            kind: 'form',
            el,
            start,
            end: newCaret,
            originalText: segment.rawText,
            insertedText: replacementText,
            prevAnchor
          };
          emitHistoryEvent(segment.rawText, replacementText);
        } else {
          anchorState = segment.restoreAnchor || null;
          undoState = null;
        }
        return true;
      }

      // contenteditable (Messenger Lexical, Discord Slate, Zalo Web, Gmail, Slack, Notion)
      const rootEl = segment.el;
      const domRange = segment.domRange;
      if (!domRange) return false;

      const prevAnchor = anchorState ? { ...anchorState } : null;

      rootEl.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (!sel) return false;

      sel.removeAllRanges();
      sel.addRange(domRange);
      document.dispatchEvent(new Event('selectionchange'));

      // Critical 25ms sync window so Lexical (Messenger) & Slate (Discord) sync internal selection
      await sleep(25);

      if (sel.rangeCount === 0) {
        sel.addRange(domRange);
      }

      const snapshotBefore = rootEl.innerText;
      let execWorked = false;
      try {
        execWorked = document.execCommand('insertText', false, replacementText);
      } catch {}

      await sleep(20);

      const textChanged = rootEl.innerText !== snapshotBefore || replacementText === segment.rawText;

      if (!execWorked || !textChanged) {
        // Fallback 1: Synthetic ClipboardEvent paste (handled by Slate/ProseMirror custom editors)
        let pasteHandled = false;
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', replacementText);
          const pasteEvt = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
            composed: true
          });
          pasteHandled = !rootEl.dispatchEvent(pasteEvt);
        } catch {}

        await sleep(15);

        // Fallback 2: Direct DOM Range mutation + InputEvent
        if (!pasteHandled && rootEl.innerText === snapshotBefore) {
          domRange.deleteContents();
          const textNode = document.createTextNode(replacementText);
          domRange.insertNode(textNode);
          sel.removeAllRanges();
          const afterRange = document.createRange();
          afterRange.setStart(textNode, textNode.nodeValue.length);
          afterRange.collapse(true);
          sel.addRange(afterRange);
          rootEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertReplacementText',
            data: replacementText
          }));
        }
      }

      if (!isUndo) {
        const updatedLineRange = buildContentEditableLineRange(rootEl, 0);
        anchorState = {
          el: rootEl,
          linePrefix: updatedLineRange ? updatedLineRange.toString() : ''
        };
        undoState = {
          kind: 'contenteditable',
          el: rootEl,
          originalText: segment.rawText,
          insertedText: replacementText,
          prevAnchor
        };
        emitHistoryEvent(segment.rawText, replacementText);
      } else {
        anchorState = segment.restoreAnchor || null;
        undoState = null;
      }

      return true;
    } finally {
      setTimeout(() => {
        isApplyingReplacement = false;
      }, 35);
    }
  }

  function emitHistoryEvent(sourceText, translatedText) {
    if (!IS_EXTENSION) {
      window.dispatchEvent(new CustomEvent('transflow:committed', {
        detail: {
          sourceText,
          translatedText,
          sourceLang: latestResult?.detectedLang || 'auto',
          targetLang: latestResult?.targetLang || settings.targetLang,
          phonetic: latestResult?.phonetic || '',
          timestamp: Date.now()
        }
      }));
    }
  }

  /**
   * Builds a DOM Range selecting the last `charCount` characters immediately preceding the caret
   * so 1-click Undo restores the exact original text even inside Messenger (Lexical) or Zalo Web!
   */
  function buildBackwardRangeFromCaret(rootEl, targetStr) {
    const fullLineRange = buildContentEditableLineRange(rootEl, 0);
    if (!fullLineRange) return null;
    const lineStr = fullLineRange.toString();
    const idx = lineStr.lastIndexOf(targetStr);
    if (idx < 0) return null;

    // Range starting at idx and having length targetStr.length
    const startRange = buildContentEditableLineRange(rootEl, idx);
    if (!startRange) return null;

    // If targetStr ends right at caret, startRange already ends at caret!
    if (idx + targetStr.length === lineStr.length) {
      return startRange;
    }

    // Otherwise advance end boundary to idx + targetStr.length
    const endProbe = buildContentEditableLineRange(rootEl, idx + targetStr.length);
    if (!endProbe) return startRange;
    const exact = startRange.cloneRange();
    exact.setEnd(endProbe.startContainer, endProbe.startOffset);
    return exact;
  }

  async function performUndo() {
    if (!undoState || !undoState.el || !undoState.el.isConnected) return;
    const u = undoState;

    if (u.kind === 'form') {
      const val = u.el.value || '';
      // Verify insertedText is still at [u.start, u.end]
      let start = u.start;
      let end = u.end;
      if (val.slice(start, end) !== u.insertedText) {
        const found = val.lastIndexOf(u.insertedText);
        if (found < 0) return;
        start = found;
        end = found + u.insertedText.length;
      }
      await applyReplacement(
        {
          kind: 'form',
          el: u.el,
          start,
          end,
          rawText: u.insertedText,
          restoreAnchor: u.prevAnchor
        },
        u.originalText,
        { isUndo: true }
      );
      hideWidget();
      scheduleTranslate(true);
      return;
    }

    // contenteditable undo
    const backRange = buildBackwardRangeFromCaret(u.el, u.insertedText);
    if (backRange) {
      await applyReplacement(
        {
          kind: 'contenteditable',
          el: u.el,
          domRange: backRange,
          rawText: u.insertedText,
          restoreAnchor: u.prevAnchor
        },
        u.originalText,
        { isUndo: true }
      );
    } else {
      u.el.focus({ preventScroll: true });
      try {
        document.execCommand('undo');
      } catch {}
      anchorState = u.prevAnchor || null;
      undoState = null;
    }
    hideWidget();
    scheduleTranslate(true);
  }

  // =========================================================================
  // 4. SHADOW DOM FLOATING SMART IME BAR
  // =========================================================================

  let shadowHost = null;
  let shadowRoot = null;
  let barEl = null;
  let uiState = 'hidden'; // 'hidden' | 'loading' | 'ready' | 'committing' | 'toast' | 'error'
  let errorMsg = '';

  function ensureShadowUI() {
    if (shadowHost && shadowHost.isConnected) return;

    shadowHost = document.createElement('div');
    shadowHost.id = 'transflow-shadow-host';
    shadowHost.style.cssText = [
      'position: fixed !important',
      'top: 0 !important',
      'left: 0 !important',
      'width: 0 !important',
      'height: 0 !important',
      'z-index: 2147483647 !important',
      'pointer-events: none !important',
      'border: 0 !important',
      'margin: 0 !important',
      'padding: 0 !important'
    ].join(';');

    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans JP", "Noto Sans SC", sans-serif;
      }
      .tf-card {
        position: fixed;
        pointer-events: auto;
        min-width: 310px;
        max-width: min(520px, calc(100vw - 20px));
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 14px;
        box-shadow: 0 16px 40px -8px rgba(2, 6, 23, 0.65), 0 0 0 1px rgba(99, 102, 241, 0.18);
        padding: 9px 11px;
        transition: opacity 0.14s ease, transform 0.14s ease;
        opacity: 1;
        transform: translateY(0);
        user-select: none;
      }
      .tf-card.tf-hidden {
        display: none !important;
      }
      .tf-card.tf-toast-mode {
        min-width: auto;
        padding: 6px 11px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.94);
        border-color: rgba(16, 185, 129, 0.4);
      }
      .tf-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 7px;
        cursor: grab;
      }
      .tf-top:active {
        cursor: grabbing;
      }
      .tf-langs {
        display: flex;
        align-items: center;
        gap: 3px;
        flex-wrap: wrap;
      }
      .tf-src-badge {
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .tf-arrow {
        color: #64748b;
        font-size: 11px;
        margin: 0 2px;
      }
      .tf-lang-btn {
        appearance: none;
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.05);
        color: #cbd5e1;
        font-size: 11px;
        font-weight: 600;
        padding: 2.5px 7px;
        border-radius: 7px;
        cursor: pointer;
        transition: all 0.12s ease;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .tf-lang-btn:hover {
        background: rgba(255, 255, 255, 0.13);
        color: #fff;
      }
      .tf-lang-btn.active {
        background: linear-gradient(135deg, #4f46e5, #0891b2);
        color: #ffffff;
        border-color: rgba(165, 243, 252, 0.35);
        box-shadow: 0 2px 8px rgba(79, 70, 229, 0.45);
      }
      .tf-tools {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .tf-chip {
        appearance: none;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(30, 41, 59, 0.8);
        color: #cbd5e1;
        font-size: 10.5px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.12s;
      }
      .tf-chip:hover {
        border-color: rgba(148, 163, 184, 0.5);
        color: #fff;
      }
      .tf-chip.ai-on {
        border-color: rgba(192, 132, 252, 0.5);
        color: #e9d5ff;
        background: rgba(88, 28, 135, 0.45);
      }
      .tf-close {
        appearance: none;
        border: none;
        background: transparent;
        color: #64748b;
        font-size: 14px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 5px;
        cursor: pointer;
      }
      .tf-close:hover {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.1);
      }
      .tf-body {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .tf-preview-wrap {
        flex: 1;
        min-width: 0;
        user-select: text;
      }
      .tf-preview-text {
        font-size: 13.5px;
        line-height: 1.45;
        color: #f8fafc;
        font-weight: 500;
        word-break: break-word;
        white-space: pre-wrap;
        max-height: 120px;
        overflow-y: auto;
      }
      .tf-phonetic {
        margin-top: 3px;
        font-size: 11.5px;
        line-height: 1.35;
        color: #38bdf8;
        opacity: 0.92;
        word-break: break-word;
      }
      .tf-pivot-note {
        margin-top: 3px;
        font-size: 10.5px;
        color: #fbbf24;
      }
      .tf-loading {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 12.5px;
        color: #94a3b8;
        padding: 2px 0;
      }
      .tf-dot-pulse {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #38bdf8;
        animation: tfPulse 0.9s infinite alternate;
      }
      @keyframes tfPulse {
        from { opacity: 0.35; transform: scale(0.85); }
        to { opacity: 1; transform: scale(1.2); }
      }
      .tf-actions {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
      }
      .tf-copy-btn {
        appearance: none;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(255, 255, 255, 0.05);
        color: #cbd5e1;
        font-size: 12px;
        padding: 6px 8px;
        border-radius: 9px;
        cursor: pointer;
        transition: all 0.12s;
      }
      .tf-copy-btn:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
      }
      .tf-confirm-btn {
        appearance: none;
        border: none;
        background: linear-gradient(135deg, #4f46e5, #06b6d4);
        color: #ffffff;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 11px;
        border-radius: 9px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 12px rgba(6, 182, 212, 0.32);
        transition: transform 0.1s ease, filter 0.12s ease;
        white-space: nowrap;
      }
      .tf-confirm-btn:hover {
        filter: brightness(1.1);
      }
      .tf-confirm-btn:active {
        transform: scale(0.97);
      }
      .tf-kbd {
        font-size: 10px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 4px;
        background: rgba(15, 23, 42, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.22);
        color: #e2e8f0;
      }
      .tf-toast-row {
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 12px;
        color: #d1fae5;
      }
      .tf-undo-btn {
        appearance: none;
        border: 1px solid rgba(52, 211, 153, 0.45);
        background: rgba(6, 95, 70, 0.55);
        color: #ecfdf5;
        font-size: 11.5px;
        font-weight: 600;
        padding: 2.5px 8px;
        border-radius: 999px;
        cursor: pointer;
      }
      .tf-undo-btn:hover {
        background: rgba(16, 185, 129, 0.45);
      }
      .tf-tone-row {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        flex-wrap: wrap;
      }
      .tf-tone-label {
        font-size: 10.5px;
        color: #94a3b8;
        margin-right: 2px;
      }
      .tf-tone-pill {
        appearance: none;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: transparent;
        color: #94a3b8;
        font-size: 10.5px;
        padding: 1.5px 6px;
        border-radius: 999px;
        cursor: pointer;
      }
      .tf-tone-pill.active {
        border-color: #c084fc;
        background: rgba(192, 132, 252, 0.18);
        color: #f3e8ff;
      }
    `;

    barEl = document.createElement('div');
    barEl.className = 'tf-card tf-hidden';

    // CRITICAL: Prevent mousedown/pointerdown from stealing focus or clearing selection in Messenger/Zalo/Gmail!
    barEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(barEl);
    (document.documentElement || document.body).appendChild(shadowHost);
  }

  function getAnchorRect() {
    if (!activeTarget || !activeTarget.el || !activeTarget.el.isConnected) return null;
    const el = activeTarget.el;

    if (activeTarget.kind === 'contenteditable') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.focusNode)) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && (r.width > 0 || r.height > 0)) {
          return r;
        }
      }
    }
    return el.getBoundingClientRect();
  }

  function positionBar() {
    if (!barEl || uiState === 'hidden') return;
    const anchor = getAnchorRect();
    if (!anchor) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const barRect = barEl.getBoundingClientRect();
    const bw = barRect.width || 360;
    const bh = barRect.height || 76;

    // Prefer placing ABOVE bottom-docked chat bars (Messenger, Zalo Web, Discord, Slack),
    // and BELOW top/middle inputs when there is ample space below.
    const spaceBelow = vh - anchor.bottom;
    const placeAbove = spaceBelow < bh + 28 && anchor.top > bh + 16;

    let top = placeAbove ? (anchor.top - bh - 10) : (anchor.bottom + 10);
    let left = anchor.left;

    if (manualDragOffset) {
      left += manualDragOffset.dx;
      top += manualDragOffset.dy;
    }

    left = Math.max(10, Math.min(left, vw - bw - 10));
    top = Math.max(10, Math.min(top, vh - bh - 10));

    barEl.style.left = `${Math.round(left)}px`;
    barEl.style.top = `${Math.round(top)}px`;
  }

  function setupDragHandle(handleEl) {
    if (!handleEl) return;
    handleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const baseDx = manualDragOffset?.dx || 0;
      const baseDy = manualDragOffset?.dy || 0;

      const onMove = (ev) => {
        manualDragOffset = {
          dx: baseDx + (ev.clientX - startX),
          dy: baseDy + (ev.clientY - startY)
        };
        positionBar();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    });
  }

  function renderBar() {
    ensureShadowUI();
    if (!barEl) return;

    if (uiState === 'hidden' || !isHostActive()) {
      barEl.className = 'tf-card tf-hidden';
      return;
    }

    if (uiState === 'toast') {
      const targetMeta = getLangMeta(latestResult?.targetLang || settings.targetLang);
      barEl.className = 'tf-card tf-toast-mode';
      barEl.innerHTML = `
        <div class="tf-toast-row">
          <span>✓ Đã chuyển sang ${targetMeta.flag} <strong>${targetMeta.label}</strong></span>
          ${undoState ? `<button class="tf-undo-btn" data-action="undo" title="Phím tắt: Alt+Z">↩ Hoàn tác</button>` : ''}
        </div>
      `;
      const undoBtn = barEl.querySelector('[data-action="undo"]');
      if (undoBtn) {
        undoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          performUndo();
        });
      }
      requestAnimationFrame(positionBar);
      return;
    }

    barEl.className = 'tf-card';

    const srcMeta = getLangMeta(latestResult?.detectedLang || settings.sourceLang);
    const activeTargetCode = latestResult?.targetLang || settings.targetLang;
    const scopeLabel = currentSegment?.activeScope === 'selection'
      ? 'Vùng bôi đen'
      : ((scopeOverride || settings.defaultScope) === 'full' ? 'Toàn bộ ô' : 'Đoạn đang gõ');

    const useAI = settings.engine === 'gemini' && (settings.geminiApiKey || '').trim().length > 10;
    const shortcutLabel = settings.confirmKey === 'ButtonOnly' ? '↵' : settings.confirmKey;

    const langButtonsHtml = LANGUAGES.map((l) => {
      const isActive = l.code.toLowerCase() === activeTargetCode.toLowerCase();
      return `<button class="tf-lang-btn ${isActive ? 'active' : ''}" data-lang="${l.code}" title="${l.fullName}">${l.flag} ${l.label}</button>`;
    }).join('');

    let bodyHtml = '';
    if (uiState === 'loading' || uiState === 'committing') {
      bodyHtml = `
        <div class="tf-body">
          <div class="tf-loading">
            <span class="tf-dot-pulse"></span>
            <span>${uiState === 'committing' ? 'Đang chuyển ngữ tại chỗ...' : 'Đang dịch realtime...'}</span>
          </div>
        </div>
      `;
    } else if (uiState === 'error') {
      bodyHtml = `
        <div class="tf-body">
          <div class="tf-loading" style="color:#fca5a5;">⚠ ${escapeHtml(errorMsg || 'Không thể kết nối dịch thuật')}</div>
        </div>
      `;
    } else if (uiState === 'ready' && latestResult) {
      const showPhonetic = settings.showPhonetic && latestResult.phonetic &&
        (normLangBase(latestResult.targetLang) === 'ja' || normLangBase(latestResult.targetLang) === 'zh');
      bodyHtml = `
        <div class="tf-body">
          <div class="tf-preview-wrap">
            <div class="tf-preview-text">${escapeHtml(latestResult.translatedText)}</div>
            ${showPhonetic ? `<div class="tf-phonetic">📖 ${escapeHtml(latestResult.phonetic)}</div>` : ''}
            ${latestResult.pivoted ? `<div class="tf-pivot-note">⇄ Tự động đảo chiều sang ${getLangMeta(latestResult.targetLang).fullName}</div>` : ''}
          </div>
          <div class="tf-actions">
            <button class="tf-copy-btn" data-action="copy" title="Sao chép bản dịch">📋</button>
            <button class="tf-confirm-btn" data-action="confirm" title="Thay thế ngay văn bản đang gõ">
              <span>Xác nhận</span>
              <span class="tf-kbd">${escapeHtml(shortcutLabel)}</span>
            </button>
          </div>
        </div>
      `;
    }

    const toneRowHtml = useAI ? `
      <div class="tf-tone-row">
        <span class="tf-tone-label">✨ Văn phong AI:</span>
        ${TONES.map((t) => `<button class="tf-tone-pill ${settings.tone === t.id ? 'active' : ''}" data-tone="${t.id}">${t.label}</button>`).join('')}
      </div>
    ` : '';

    barEl.innerHTML = `
      <div class="tf-top" data-drag-handle="1">
        <div class="tf-langs">
          <span class="tf-src-badge" title="Ngôn ngữ nhận diện">${srcMeta.flag} ${srcMeta.label}</span>
          <span class="tf-arrow">→</span>
          ${langButtonsHtml}
        </div>
        <div class="tf-tools">
          ${currentSegment?.activeScope !== 'selection'
            ? `<button class="tf-chip" data-action="toggle-scope" title="Đổi phạm vi dịch: Đoạn đang gõ ↔ Toàn bộ ô">${scopeLabel}</button>`
            : `<span class="tf-chip">${scopeLabel}</span>`
          }
          ${useAI ? `<span class="tf-chip ai-on" title="Đang dùng Gemini AI">✨ AI</span>` : ''}
          <button class="tf-close" data-action="dismiss" title="Ẩn tạm thời (Esc)">×</button>
        </div>
      </div>
      ${bodyHtml}
      ${toneRowHtml}
    `;

    setupDragHandle(barEl.querySelector('[data-drag-handle="1"]'));

    barEl.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const nextLang = btn.getAttribute('data-lang');
        if (!nextLang) return;
        const prevTarget = settings.targetLang;
        const patch = { targetLang: nextLang };
        if (normLangBase(prevTarget) !== normLangBase(nextLang)) {
          patch.fallbackLang = prevTarget;
        }
        manualForceTarget = true;
        savePartialSettings(patch);
        scheduleTranslate(true);
      });
    });

    barEl.querySelectorAll('[data-tone]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const nextTone = btn.getAttribute('data-tone');
        if (!nextTone) return;
        savePartialSettings({ tone: nextTone });
        scheduleTranslate(true);
      });
    });

    const scopeBtn = barEl.querySelector('[data-action="toggle-scope"]');
    if (scopeBtn) {
      scopeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const cur = scopeOverride || settings.defaultScope || 'segment';
        scopeOverride = cur === 'segment' ? 'full' : 'segment';
        scheduleTranslate(true);
      });
    }

    const dismissBtn = barEl.querySelector('[data-action="dismiss"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.preventDefault();
        dismissedForText = currentSegment?.rawText || '';
        hideWidget();
      });
    }

    const copyBtn = barEl.querySelector('[data-action="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (latestResult?.translatedText) {
          try {
            await navigator.clipboard.writeText(latestResult.translatedText);
            copyBtn.textContent = '✓';
            setTimeout(() => { copyBtn.textContent = '📋'; }, 1000);
          } catch {}
        }
      });
    }

    const confirmBtn = barEl.querySelector('[data-action="confirm"]');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        confirmCurrentTranslation();
      });
    }

    requestAnimationFrame(positionBar);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hideWidget() {
    clearTimeout(debounceTimer);
    clearTimeout(toastTimer);
    uiState = 'hidden';
    renderBar();
  }

  function showToast() {
    clearTimeout(toastTimer);
    uiState = 'toast';
    renderBar();
    toastTimer = setTimeout(() => {
      if (uiState === 'toast') {
        hideWidget();
      }
    }, 4500);
  }

  // =========================================================================
  // 5. LIVE TRANSLATION SCHEDULER & INSTANT COMMIT FLOW
  // =========================================================================

  function scheduleTranslate(immediate = false) {
    if (!isHostActive() || isApplyingReplacement || isComposingIME) return;
    if (!activeTarget) {
      hideWidget();
      return;
    }

    const seg = extractActiveSegment(activeTarget);
    currentSegment = seg;

    if (!seg || !isWorthTranslating(seg.rawText)) {
      if (uiState !== 'toast') hideWidget();
      return;
    }

    if (!immediate && dismissedForText && dismissedForText === seg.rawText) {
      return;
    }
    dismissedForText = null;

    clearTimeout(debounceTimer);
    clearTimeout(toastTimer);

    const run = async () => {
      const latestSeg = extractActiveSegment(activeTarget);
      if (!latestSeg || !isWorthTranslating(latestSeg.rawText)) {
        hideWidget();
        return;
      }
      currentSegment = latestSeg;
      const reqId = ++pendingReqId;

      uiState = 'loading';
      renderBar();

      const res = await requestTranslation({
        text: latestSeg.rawText.trim(),
        rawText: latestSeg.rawText,
        contextText: latestSeg.contextText || '',
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        fallbackLang: settings.fallbackLang,
        autoPivot: settings.autoPivot,
        forceTarget: manualForceTarget,
        engine: settings.engine,
        tone: settings.tone
      });

      if (reqId !== pendingReqId) return;

      if (!res?.ok || !res.translatedText) {
        uiState = 'error';
        errorMsg = res?.error || 'Không dịch được đoạn này';
        renderBar();
        return;
      }

      latestResult = res;
      uiState = 'ready';
      renderBar();
    };

    if (immediate) {
      run();
    } else {
      debounceTimer = setTimeout(run, 310);
    }
  }

  async function confirmCurrentTranslation() {
    if (isApplyingReplacement) return;
    const freshSeg = extractActiveSegment(activeTarget) || currentSegment;
    if (!freshSeg || !isWorthTranslating(freshSeg.rawText)) return;

    // If user pressed Confirm quickly before debounce finished, fetch immediately!
    if (uiState !== 'ready' || !latestResult || currentSegment?.rawText !== freshSeg.rawText) {
      clearTimeout(debounceTimer);
      const reqId = ++pendingReqId;
      uiState = 'committing';
      renderBar();

      const res = await requestTranslation({
        text: freshSeg.rawText.trim(),
        rawText: freshSeg.rawText,
        contextText: freshSeg.contextText || '',
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        fallbackLang: settings.fallbackLang,
        autoPivot: settings.autoPivot,
        forceTarget: manualForceTarget,
        engine: settings.engine,
        tone: settings.tone
      });

      if (reqId !== pendingReqId || !res?.ok || !res.translatedText) {
        uiState = 'error';
        errorMsg = 'Chưa thể chuyển ngữ, vui lòng thử lại';
        renderBar();
        return;
      }
      latestResult = res;
    }

    const replacement = latestResult.formattedReplacement || latestResult.translatedText;
    manualForceTarget = false;
    scopeOverride = null;

    const ok = await applyReplacement(freshSeg, replacement);
    if (ok) {
      showToast();
    }
  }

  async function triggerInstantTranslateAndReplace() {
    const focused = document.activeElement;
    const resolved = resolveEditableTarget(focused, true) || activeTarget;
    if (!resolved) return;
    activeTarget = resolved;
    await confirmCurrentTranslation();
  }

  // =========================================================================
  // 6. GLOBAL EVENT LISTENERS (IME-Safe, Capture Phase Shortcut Handling)
  // =========================================================================

  window.addEventListener('compositionstart', () => {
    isComposingIME = true;
  }, true);

  window.addEventListener('compositionend', (e) => {
    isComposingIME = false;
    const resolved = resolveEditableTarget(e.composedPath?.()[0] || e.target);
    if (resolved) {
      activeTarget = resolved;
      scheduleTranslate(false);
    }
  }, true);

  window.addEventListener('focusin', (e) => {
    const raw = e.composedPath?.()[0] || e.target;
    const resolved = resolveEditableTarget(raw);
    if (resolved) {
      if (!activeTarget || activeTarget.el !== resolved.el) {
        manualDragOffset = null;
        scopeOverride = null;
        manualForceTarget = false;
      }
      activeTarget = resolved;
    }
  }, true);

  window.addEventListener('input', (e) => {
    if (isApplyingReplacement || isComposingIME || e.isComposing) return;
    const raw = e.composedPath?.()[0] || e.target;
    const resolved = resolveEditableTarget(raw);
    if (!resolved) return;
    activeTarget = resolved;
    manualForceTarget = false;
    scheduleTranslate(false);
  }, true);

  document.addEventListener('selectionchange', () => {
    if (isApplyingReplacement || isComposingIME) return;
    if (!isHostActive()) return;
    const sel = window.getSelection();
    const activeEl = document.activeElement;
    const resolved = resolveEditableTarget(sel?.anchorNode || activeEl);
    if (!resolved) return;

    // Trigger live translation when user highlights text inside an editable field
    if (resolved.kind === 'form') {
      if (resolved.el.selectionStart !== resolved.el.selectionEnd) {
        activeTarget = resolved;
        scheduleTranslate(false);
      }
    } else if (sel && !sel.isCollapsed && resolved.el.contains(sel.anchorNode)) {
      activeTarget = resolved;
      scheduleTranslate(false);
    }
  });

  window.addEventListener('mousedown', (e) => {
    const path = e.composedPath?.() || [];
    if (shadowHost && path.includes(shadowHost)) return;
    const resolved = resolveEditableTarget(path[0] || e.target);
    if (!resolved && uiState !== 'hidden') {
      hideWidget();
    }
  }, true);

  window.addEventListener('scroll', () => {
    if (uiState !== 'hidden') requestAnimationFrame(positionBar);
  }, true);

  window.addEventListener('resize', () => {
    if (uiState !== 'hidden') requestAnimationFrame(positionBar);
  });

  function matchesConfirmShortcut(e) {
    const mode = settings.confirmKey || 'Tab';
    if (mode === 'Tab') {
      return e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
    }
    if (mode === 'Alt+Q') {
      return e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyQ';
    }
    if (mode === 'Ctrl+Enter') {
      return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'Enter';
    }
    return false;
  }

  window.addEventListener('keydown', (e) => {
    // NEVER hijack active IME composition (Vietnamese Telex/VNI, Japanese Kana/Kanji, Chinese Pinyin)
    if (e.isComposing || isComposingIME || e.keyCode === 229) return;

    // Global quick toggle: Alt + X
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyX') {
      e.preventDefault();
      e.stopPropagation();
      const next = !settings.enabled;
      savePartialSettings({ enabled: next });
      if (!next) hideWidget();
      else scheduleTranslate(true);
      return;
    }

    if (!isHostActive()) return;

    // Quick Undo after confirm: Alt + Z
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyZ' && undoState) {
      e.preventDefault();
      e.stopPropagation();
      performUndo();
      return;
    }

    // Quick Force Translate & Replace anywhere (even on restricted input): Alt + Q
    if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyQ') {
      const raw = e.composedPath?.()[0] || e.target;
      const resolved = resolveEditableTarget(raw, true) || activeTarget;
      if (resolved) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        activeTarget = resolved;
        confirmCurrentTranslation();
        return;
      }
    }

    // Quick Language Switching while typing: Alt + 1 (VI), Alt + 2 (EN), Alt + 3 (JA), Alt + 4 (ZH)
    if (e.altKey && !e.ctrlKey && !e.shiftKey && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
      const raw = e.composedPath?.()[0] || e.target;
      const resolved = resolveEditableTarget(raw, true) || activeTarget;
      if (resolved) {
        e.preventDefault();
        e.stopPropagation();
        const map = { Digit1: 'vi', Digit2: 'en', Digit3: 'ja', Digit4: 'zh-CN' };
        const nextLang = map[e.code];
        const prevTarget = settings.targetLang;
        const patch = { targetLang: nextLang };
        if (normLangBase(prevTarget) !== normLangBase(nextLang)) {
          patch.fallbackLang = prevTarget;
        }
        activeTarget = resolved;
        manualForceTarget = true;
        savePartialSettings(patch);
        scheduleTranslate(true);
        return;
      }
    }

    // Dismiss floating bar with Escape so normal Tab / navigation works unhindered
    if (e.key === 'Escape' && uiState !== 'hidden' && uiState !== 'toast') {
      e.preventDefault();
      e.stopPropagation();
      dismissedForText = currentSegment?.rawText || '';
      hideWidget();
      return;
    }

    // Confirm & Replace Shortcut (e.g. Tab or Ctrl+Enter when widget is active)
    if ((uiState === 'ready' || uiState === 'loading') && matchesConfirmShortcut(e)) {
      const raw = e.composedPath?.()[0] || e.target;
      const resolved = resolveEditableTarget(raw);
      if (resolved && activeTarget && resolved.el === activeTarget.el) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        confirmCurrentTranslation();
      }
    }
  }, true);

  // Clean up widget immediately when Enter sends/clears chat box in Messenger, Zalo Web, Discord, etc.
  window.addEventListener('keyup', (e) => {
    if (isApplyingReplacement || isComposingIME) return;
    if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') {
      setTimeout(() => {
        if (!activeTarget || uiState === 'hidden' || uiState === 'toast') return;
        const seg = extractActiveSegment(activeTarget);
        if (!seg || !isWorthTranslating(seg.rawText)) {
          anchorState = null;
          hideWidget();
        }
      }, 35);
    }
  }, true);

  loadSettings();
})();
