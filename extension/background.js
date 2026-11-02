/**
 * TransFlow Background Service Worker (Manifest V3)
 * Handles zero-config free translation (Google GTX + MyMemory fallback),
 * optional context/tone-aware Gemini AI translation, smart language auto-pivoting,
 * and an in-memory LRU cache for instant repeat lookups.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: 'en',          // 'vi' | 'en' | 'ja' | 'zh-CN' | 'zh-TW'
  fallbackLang: 'vi',        // Auto-pivot target when input matches targetLang
  sourceLang: 'auto',        // 'auto' | 'vi' | 'en' | 'ja' | 'zh-CN'
  autoPivot: true,
  confirmKey: 'Tab',         // 'Tab' | 'Alt+Q' | 'Ctrl+Enter' | 'ButtonOnly'
  defaultScope: 'segment',   // 'segment' | 'full'
  showPhonetic: true,
  engine: 'free',            // 'free' | 'gemini'
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  tone: 'natural',           // 'natural' | 'polite' | 'casual' | 'concise'
  disabledHosts: []
};

// Simple LRU Cache (max 250 entries)
const translationCache = new Map();
const MAX_CACHE_SIZE = 250;

function getCache(key) {
  if (!translationCache.has(key)) return null;
  const val = translationCache.get(key);
  translationCache.delete(key);
  translationCache.set(key, val);
  return val;
}

function setCache(key, val) {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
  translationCache.set(key, val);
}

function normLangBase(code) {
  if (!code) return '';
  const lower = code.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  return lower.split('-')[0];
}

/**
 * Fast script heuristic for CJK / Kana / Vietnamese diacritics
 */
function detectScriptHint(text) {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
  if (/[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text)) {
    return 'vi';
  }
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
  return null;
}

const LANG_NAMES = {
  'vi': 'Vietnamese (Tiếng Việt)',
  'en': 'English',
  'ja': 'Japanese (日本語)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)'
};

const TONE_INSTRUCTIONS = {
  natural: 'Use natural, fluent everyday phrasing suitable for general communication.',
  polite: 'Use polite, respectful, professional phrasing (e.g., business polite in English/Vietnamese, Teineigo/Keigo 丁寧語 in Japanese, polite 您 where appropriate in Chinese).',
  casual: 'Use friendly, casual chat phrasing suitable for messaging close colleagues or friends on Messenger/Zalo/LINE.',
  concise: 'Make the translation concise, direct, and clear without losing any core meaning.'
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  await chrome.storage.sync.set(merged);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-transflow') {
    const { enabled = true } = await chrome.storage.sync.get('enabled');
    const next = !enabled;
    await chrome.storage.sync.set({ enabled: next });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'STATUS_TOGGLED', enabled: next }).catch(() => {});
    }
  } else if (command === 'instant-replace') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_INSTANT_REPLACE' }).catch(() => {});
    }
  }
});

/**
 * Primary Free Engine: Google Translate GTX (supports auto-detect + Romaji/Pinyin reading)
 */
async function translateGoogleGTX(text, sl, tl) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: sl || 'auto',
    tl: tl,
    dt: 't'
  });
  // Append second dt=rm for transliteration / reading (Romaji / Pinyin)
  const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}&dt=rm&q=${encodeURIComponent(text)}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!resp.ok) {
    throw new Error(`GTX HTTP ${resp.status}`);
  }

  const data = await resp.json();
  let translatedText = '';
  let phonetic = '';

  if (Array.isArray(data?.[0])) {
    for (const seg of data[0]) {
      if (!Array.isArray(seg)) continue;
      if (typeof seg[0] === 'string') {
        translatedText += seg[0];
      }
      if (seg[0] === null && typeof seg[2] === 'string') {
        phonetic += (phonetic ? ' ' : '') + seg[2];
      }
    }
  }

  const detectedLang = (typeof data?.[2] === 'string' && data[2]) ? data[2] : (detectScriptHint(text) || sl || 'auto');

  if (!translatedText.trim()) {
    throw new Error('Empty GTX translation');
  }

  return {
    translatedText,
    detectedLang,
    phonetic: phonetic.trim(),
    engineUsed: 'free-gtx'
  };
}

/**
 * Secondary Free Fallback Engine: MyMemory API
 */
async function translateMyMemory(text, sl, tl) {
  const resolvedSource = (!sl || sl === 'auto') ? (detectScriptHint(text) || 'en') : sl;
  const pair = `${resolvedSource}|${tl}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`MyMemory HTTP ${resp.status}`);
  const data = await resp.json();
  const translatedText = data?.responseData?.translatedText;
  if (!translatedText) throw new Error('Empty MyMemory response');

  return {
    translatedText,
    detectedLang: resolvedSource,
    phonetic: '',
    engineUsed: 'free-mymemory'
  };
}

/**
 * Optional Upgrade Engine: Gemini AI (tone, nuance, keigo, context continuity)
 */
async function translateWithGemini({ text, sl, tl, tone, contextText, apiKey, model }) {
  const targetDesc = LANG_NAMES[tl] || tl;
  const sourceDesc = (!sl || sl === 'auto') ? 'auto-detected language' : (LANG_NAMES[sl] || sl);
  const toneDesc = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.natural;
  const needPhonetic = normLangBase(tl) === 'ja' || normLangBase(tl) === 'zh';

  const systemInstruction = [
    `You are an instant in-place typing translator between Vietnamese, English, Japanese, and Chinese.`,
    `Translate the user's input from ${sourceDesc} into ${targetDesc}.`,
    toneDesc,
    `Preserve trailing spaces, line breaks, emojis, and formatting if appropriate.`,
    contextText ? `Preceding sentence context (DO NOT include this in output, use only for pronoun/context accuracy): "${contextText.slice(-220)}"` : '',
    `Respond ONLY with valid JSON matching: {"translatedText": string, "detectedLang": "vi"|"en"|"ja"|"zh-CN"|"zh-TW", "phonetic": string}.`,
    needPhonetic
      ? `Set "phonetic" to accurate ${normLangBase(tl) === 'ja' ? 'Hepburn Romaji' : 'Pinyin with tone marks'} for the translated output.`
      : `Set "phonetic" to "".`
  ].filter(Boolean).join('\n');

  const modelsToTry = [model || 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastErr = null;

  for (const m of [...new Set(modelsToTry)]) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Gemini ${m} HTTP ${resp.status}: ${errBody.slice(0, 140)}`);
      }

      const json = await resp.json();
      const rawContent = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(rawContent);
      if (parsed?.translatedText) {
        return {
          translatedText: parsed.translatedText,
          detectedLang: parsed.detectedLang || detectScriptHint(text) || 'auto',
          phonetic: parsed.phonetic || '',
          engineUsed: 'gemini'
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Gemini translation failed');
}

/**
 * Core Orchestrator with Smart Auto-Pivot & Caching
 */
async function performTranslation(payload) {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const text = (payload.text || '').trim();
  if (!text) return { ok: false, error: 'EMPTY_TEXT' };

  const sourceLang = payload.sourceLang || stored.sourceLang || 'auto';
  let desiredTarget = payload.targetLang || stored.targetLang || 'en';
  const fallbackLang = payload.fallbackLang || stored.fallbackLang || 'vi';
  const autoPivot = payload.autoPivot ?? stored.autoPivot ?? true;
  const forceTarget = Boolean(payload.forceTarget);
  const engine = payload.engine || stored.engine || 'free';
  const tone = payload.tone || stored.tone || 'natural';
  const contextText = payload.contextText || '';
  const apiKey = (payload.geminiApiKey ?? stored.geminiApiKey ?? '').trim();
  const model = stored.geminiModel || 'gemini-2.5-flash';

  // Quick pre-pivot if script alone unambiguously matches desiredTarget
  let pivoted = false;
  const scriptHint = detectScriptHint(text);
  if (!forceTarget && sourceLang === 'auto' && autoPivot && scriptHint && normLangBase(scriptHint) === normLangBase(desiredTarget)) {
    desiredTarget = normLangBase(fallbackLang) !== normLangBase(desiredTarget)
      ? fallbackLang
      : (normLangBase(desiredTarget) === 'vi' ? 'en' : 'vi');
    pivoted = true;
  }

  const useGemini = engine === 'gemini' && apiKey.length > 10;
  const cacheKey = JSON.stringify([
    useGemini ? `gemini:${tone}` : 'free',
    sourceLang,
    desiredTarget,
    autoPivot && !forceTarget ? fallbackLang : '',
    text
  ]);

  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, ...cached, cached: true };
  }

  let result;
  let fallbackUsed = false;

  if (useGemini) {
    try {
      result = await translateWithGemini({
        text,
        sl: sourceLang,
        tl: desiredTarget,
        tone,
        contextText,
        apiKey,
        model
      });
    } catch (err) {
      fallbackUsed = true;
      result = await translateFreeWithFallback(text, sourceLang, desiredTarget);
    }
  } else {
    result = await translateFreeWithFallback(text, sourceLang, desiredTarget);
  }

  // Post-detection auto-pivot check (e.g., English vs unaccented Vietnamese)
  if (
    !forceTarget &&
    !pivoted &&
    sourceLang === 'auto' &&
    autoPivot &&
    result.detectedLang &&
    normLangBase(result.detectedLang) === normLangBase(desiredTarget)
  ) {
    const nextTarget = normLangBase(fallbackLang) !== normLangBase(desiredTarget)
      ? fallbackLang
      : (normLangBase(desiredTarget) === 'vi' ? 'en' : 'vi');
    desiredTarget = nextTarget;
    pivoted = true;

    if (useGemini && !fallbackUsed) {
      try {
        result = await translateWithGemini({
          text,
          sl: result.detectedLang,
          tl: desiredTarget,
          tone,
          contextText,
          apiKey,
          model
        });
      } catch {
        result = await translateFreeWithFallback(text, result.detectedLang, desiredTarget);
      }
    } else {
      result = await translateFreeWithFallback(text, result.detectedLang, desiredTarget);
    }
  }

  // Preserve leading/trailing whitespace shape of original segment when replacing inline
  const leadingMatch = (payload.rawText || '').match(/^\s*/)?.[0] || '';
  const trailingMatch = (payload.rawText || '').match(/\s*$/)?.[0] || '';

  const finalData = {
    translatedText: result.translatedText,
    formattedReplacement: `${leadingMatch}${result.translatedText.trim()}${trailingMatch}`,
    detectedLang: result.detectedLang,
    targetLang: desiredTarget,
    phonetic: result.phonetic || '',
    engineUsed: result.engineUsed,
    fallbackUsed,
    pivoted
  };

  setCache(cacheKey, finalData);
  return { ok: true, ...finalData };
}

async function translateFreeWithFallback(text, sl, tl) {
  try {
    return await translateGoogleGTX(text, sl, tl);
  } catch {
    return await translateMyMemory(text, sl, tl);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TRANSLATE') {
    performTranslation(message.payload || {})
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'TRANSLATE_ERROR' }));
    return true; // Async response
  }

  if (message?.type === 'TEST_GEMINI') {
    translateWithGemini({
      text: 'Xin chào, rất vui được làm việc cùng bạn!',
      sl: 'vi',
      tl: 'ja',
      tone: 'polite',
      contextText: '',
      apiKey: (message.apiKey || '').trim(),
      model: message.model || 'gemini-2.5-flash'
    })
      .then((res) => sendResponse({ ok: true, sample: res.translatedText, phonetic: res.phonetic }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || 'Kết nối Gemini thất bại' }));
    return true;
  }

  return false;
});
