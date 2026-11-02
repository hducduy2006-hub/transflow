const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: 'en',
  fallbackLang: 'vi',
  sourceLang: 'auto',
  autoPivot: true,
  confirmKey: 'Tab',
  defaultScope: 'segment',
  showPhonetic: true,
  engine: 'free',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  tone: 'natural',
  disabledHosts: []
};

let currentSettings = { ...DEFAULT_SETTINGS };
let activeHostname = '';

const enabledToggle = document.getElementById('enabledToggle');
const siteDot = document.getElementById('siteDot');
const currentHostText = document.getElementById('currentHostText');
const siteToggleBtn = document.getElementById('siteToggleBtn');
const langCards = document.querySelectorAll('.lang-card');
const fallbackLangSelect = document.getElementById('fallbackLangSelect');
const autoPivotToggle = document.getElementById('autoPivotToggle');
const confirmKeySelect = document.getElementById('confirmKeySelect');
const defaultScopeSelect = document.getElementById('defaultScopeSelect');
const showPhoneticToggle = document.getElementById('showPhoneticToggle');
const segBtns = document.querySelectorAll('.seg-btn');
const freeEngineNote = document.getElementById('freeEngineNote');
const geminiPanel = document.getElementById('geminiPanel');
const toneSelect = document.getElementById('toneSelect');
const geminiKeyInput = document.getElementById('geminiKeyInput');
const testKeyBtn = document.getElementById('testKeyBtn');
const keyStatus = document.getElementById('keyStatus');

function normLangBase(code) {
  if (!code) return '';
  const lower = code.toLowerCase();
  return lower.startsWith('zh') ? 'zh' : lower.split('-')[0];
}

async function init() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  currentSettings = { ...DEFAULT_SETTINGS, ...stored };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/i.test(tab.url)) {
      activeHostname = new URL(tab.url).hostname.toLowerCase();
    }
  } catch {}

  syncUI();
}

function syncUI() {
  enabledToggle.checked = Boolean(currentSettings.enabled);

  // Host bar
  const isHostPaused = activeHostname && (currentSettings.disabledHosts || []).includes(activeHostname);
  if (!currentSettings.enabled) {
    siteDot.classList.add('paused');
    currentHostText.textContent = 'Đang tạm tắt toàn cục (Alt+X để bật)';
    siteToggleBtn.style.display = 'none';
  } else if (activeHostname) {
    siteToggleBtn.style.display = 'inline-block';
    if (isHostPaused) {
      siteDot.classList.add('paused');
      currentHostText.textContent = `Đã tắt trên ${activeHostname}`;
      siteToggleBtn.textContent = 'Bật lại trang này';
    } else {
      siteDot.classList.remove('paused');
      currentHostText.textContent = `Đang bật trên ${activeHostname}`;
      siteToggleBtn.textContent = 'Tắt trang này';
    }
  } else {
    siteDot.classList.remove('paused');
    currentHostText.textContent = 'Sẵn sàng trên Messenger, Zalo, Gmail...';
    siteToggleBtn.style.display = 'none';
  }

  langCards.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === currentSettings.targetLang);
  });

  fallbackLangSelect.value = currentSettings.fallbackLang || 'vi';
  autoPivotToggle.checked = Boolean(currentSettings.autoPivot);
  confirmKeySelect.value = currentSettings.confirmKey || 'Tab';
  defaultScopeSelect.value = currentSettings.defaultScope || 'segment';
  showPhoneticToggle.checked = Boolean(currentSettings.showPhonetic);

  segBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.engine === currentSettings.engine);
  });

  if (currentSettings.engine === 'gemini') {
    freeEngineNote.classList.add('hidden');
    geminiPanel.classList.remove('hidden');
  } else {
    freeEngineNote.classList.remove('hidden');
    geminiPanel.classList.add('hidden');
  }

  toneSelect.value = currentSettings.tone || 'natural';
  geminiKeyInput.value = currentSettings.geminiApiKey || '';
}

async function updateSettings(patch) {
  currentSettings = { ...currentSettings, ...patch };
  await chrome.storage.sync.set(patch);
  syncUI();
}

enabledToggle.addEventListener('change', () => {
  updateSettings({ enabled: enabledToggle.checked });
});

siteToggleBtn.addEventListener('click', () => {
  if (!activeHostname) return;
  const list = new Set(currentSettings.disabledHosts || []);
  if (list.has(activeHostname)) list.delete(activeHostname);
  else list.add(activeHostname);
  updateSettings({ disabledHosts: [...list] });
});

langCards.forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextLang = btn.dataset.lang;
    const prevTarget = currentSettings.targetLang;
    const patch = { targetLang: nextLang };
    if (normLangBase(prevTarget) !== normLangBase(nextLang)) {
      patch.fallbackLang = prevTarget === 'zh-TW' ? 'zh-CN' : prevTarget;
    }
    updateSettings(patch);
  });
});

fallbackLangSelect.addEventListener('change', () => {
  updateSettings({ fallbackLang: fallbackLangSelect.value });
});

autoPivotToggle.addEventListener('change', () => {
  updateSettings({ autoPivot: autoPivotToggle.checked });
});

confirmKeySelect.addEventListener('change', () => {
  updateSettings({ confirmKey: confirmKeySelect.value });
});

defaultScopeSelect.addEventListener('change', () => {
  updateSettings({ defaultScope: defaultScopeSelect.value });
});

showPhoneticToggle.addEventListener('change', () => {
  updateSettings({ showPhonetic: showPhoneticToggle.checked });
});

segBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    updateSettings({ engine: btn.dataset.engine });
  });
});

toneSelect.addEventListener('change', () => {
  updateSettings({ tone: toneSelect.value });
});

let keySaveTimer = null;
geminiKeyInput.addEventListener('input', () => {
  clearTimeout(keySaveTimer);
  keySaveTimer = setTimeout(() => {
    updateSettings({ geminiApiKey: geminiKeyInput.value.trim() });
    keyStatus.textContent = 'Đã lưu API Key.';
    keyStatus.style.color = '#94a3b8';
  }, 300);
});

testKeyBtn.addEventListener('click', async () => {
  const apiKey = geminiKeyInput.value.trim();
  if (!apiKey) {
    keyStatus.textContent = '⚠ Vui lòng dán Gemini API Key trước khi kiểm tra.';
    keyStatus.style.color = '#fbbf24';
    return;
  }

  await updateSettings({ geminiApiKey: apiKey });
  testKeyBtn.disabled = true;
  testKeyBtn.textContent = 'Đang thử...';
  keyStatus.textContent = 'Đang kiểm tra kết nối Gemini AI...';
  keyStatus.style.color = '#38bdf8';

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'TEST_GEMINI',
      apiKey,
      model: currentSettings.geminiModel
    });
    if (res?.ok) {
      keyStatus.textContent = `✓ Kết nối thành công! Thử dịch: "${res.sample}"`;
      keyStatus.style.color = '#34d399';
    } else {
      keyStatus.textContent = `✕ Lỗi: ${res?.error || 'Key không hợp lệ'}`;
      keyStatus.style.color = '#f87171';
    }
  } catch (err) {
    keyStatus.textContent = `✕ Lỗi kết nối: ${err.message}`;
    keyStatus.style.color = '#f87171';
  } finally {
    testKeyBtn.disabled = false;
    testKeyBtn.textContent = 'Kiểm tra';
  }
});

init();
