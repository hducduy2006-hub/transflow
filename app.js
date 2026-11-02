(() => {
  const DEFAULT_WEB_SETTINGS = {
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
    tone: 'natural'
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem('transflow_settings_v1');
      return raw ? { ...DEFAULT_WEB_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_WEB_SETTINGS };
    } catch {
      return { ...DEFAULT_WEB_SETTINGS };
    }
  }

  function pushSettings(patch) {
    window.dispatchEvent(new CustomEvent('transflow:update-settings', { detail: patch }));
    syncWebControls({ ...getSettings(), ...patch });
  }

  // Elements
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const langPills = document.querySelectorAll('#webLangPills .pill-btn');
  const confirmSelect = document.getElementById('webConfirmSelect');
  const hintKeyBadge = document.getElementById('hintKeyBadge');
  const engineBadgeText = document.getElementById('engineBadgeText');

  const studioEditor = document.getElementById('mainStudioEditor');
  const charCounter = document.getElementById('charCounter');
  const clearEditorBtn = document.getElementById('clearEditorBtn');
  const copyAllEditorBtn = document.getElementById('copyAllEditorBtn');
  const sampleChips = document.querySelectorAll('.sample-chip');

  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const openAiModalBtn = document.getElementById('openAiModalBtn');
  const closeAiModalBtn = document.getElementById('closeAiModalBtn');
  const saveAiModalBtn = document.getElementById('saveAiModalBtn');
  const aiModalBackdrop = document.getElementById('aiModalBackdrop');
  const engineRadios = document.querySelectorAll('input[name="webEngine"]');
  const webGeminiFields = document.getElementById('webGeminiFields');
  const webToneSelect = document.getElementById('webToneSelect');
  const webGeminiKey = document.getElementById('webGeminiKey');
  const webAutoPivotCheck = document.getElementById('webAutoPivotCheck');
  const webPhoneticCheck = document.getElementById('webPhoneticCheck');

  const shareLinkBtn = document.getElementById('shareLinkBtn');
  const bookmarkletLink = document.getElementById('bookmarkletLink');
  const webToast = document.getElementById('webToast');

  let historyItems = [];

  function showToastMsg(msg) {
    webToast.textContent = msg;
    webToast.classList.remove('hidden');
    clearTimeout(showToastMsg._t);
    showToastMsg._t = setTimeout(() => webToast.classList.add('hidden'), 2800);
  }

  function normBase(code) {
    if (!code) return '';
    return code.toLowerCase().startsWith('zh') ? 'zh' : code.toLowerCase().split('-')[0];
  }

  function syncWebControls(s) {
    langPills.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lang === s.targetLang);
    });
    confirmSelect.value = s.confirmKey || 'Tab';
    hintKeyBadge.textContent = s.confirmKey === 'ButtonOnly' ? 'Nút Xác nhận' : s.confirmKey;

    const isAI = s.engine === 'gemini' && (s.geminiApiKey || '').trim().length > 10;
    engineBadgeText.textContent = isAI
      ? `✨ Gemini AI (${s.tone || 'natural'})`
      : '⚡ Dịch Miễn Phí (Dùng ngay)';
  }

  // Tabs
  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = `tab-${tab.dataset.tab}`;
      navTabs.forEach((t) => t.classList.toggle('active', t === tab));
      tabPanels.forEach((p) => p.classList.toggle('active', p.id === targetId));
    });
  });

  // Language Pills
  langPills.forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const cur = getSettings();
      const next = btn.dataset.lang;
      const patch = { targetLang: next };
      if (normBase(cur.targetLang) !== normBase(next)) {
        patch.fallbackLang = cur.targetLang === 'zh-TW' ? 'zh-CN' : cur.targetLang;
      }
      pushSettings(patch);
    });
  });

  confirmSelect.addEventListener('change', () => {
    pushSettings({ confirmKey: confirmSelect.value });
  });

  window.addEventListener('transflow:settings-updated', (e) => {
    if (e.detail) syncWebControls(e.detail);
  });

  // Studio Editor actions
  function updateCounter() {
    charCounter.textContent = `${(studioEditor.value || '').length} ký tự`;
  }
  studioEditor.addEventListener('input', updateCounter);

  clearEditorBtn.addEventListener('click', () => {
    studioEditor.value = '';
    updateCounter();
    studioEditor.focus();
    studioEditor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  copyAllEditorBtn.addEventListener('click', async () => {
    if (!studioEditor.value.trim()) {
      showToastMsg('Ô soạn thảo đang trống!');
      return;
    }
    try {
      await navigator.clipboard.writeText(studioEditor.value);
      showToastMsg('✓ Đã sao chép toàn bộ văn bản!');
    } catch {}
  });

  sampleChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const text = chip.dataset.sample || '';
      const targetLang = chip.dataset.target || 'en';
      pushSettings({ targetLang });
      studioEditor.value = text;
      updateCounter();
      studioEditor.focus();
      studioEditor.setSelectionRange(text.length, text.length);
      studioEditor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    });
  });

  // History tracking
  function renderHistory() {
    if (historyItems.length === 0) {
      historyList.innerHTML = `<div class="empty-state">Các câu bạn ấn Xác nhận chuyển ngữ sẽ lưu nhanh tại đây để tiện tra lại.</div>`;
      return;
    }
    historyList.innerHTML = historyItems.map((item, idx) => `
      <div class="history-item" data-idx="${idx}" title="Bấm để sao chép bản dịch">
        <div class="hi-src">${escapeHtml(item.sourceText.trim())}</div>
        <div class="hi-dst">→ ${escapeHtml(item.translatedText.trim())}</div>
        ${item.phonetic ? `<div class="hi-phonetic">📖 ${escapeHtml(item.phonetic)}</div>` : ''}
      </div>
    `).join('');

    historyList.querySelectorAll('.history-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const item = historyItems[Number(el.dataset.idx)];
        if (item) {
          await navigator.clipboard.writeText(item.translatedText.trim()).catch(() => {});
          showToastMsg('✓ Đã sao chép câu dịch vào bộ nhớ tạm!');
        }
      });
    });
  }

  window.addEventListener('transflow:committed', (e) => {
    if (!e.detail) return;
    updateCounter();
    historyItems.unshift(e.detail);
    if (historyItems.length > 25) historyItems.pop();
    renderHistory();
  });

  clearHistoryBtn.addEventListener('click', () => {
    historyItems = [];
    renderHistory();
  });

  // Sandbox Chat Simulation (Messenger & Zalo Web)
  function sendMockChat(kind) {
    const inputEl = document.getElementById(kind === 'messenger' ? 'messengerInput' : 'zaloInput');
    const threadEl = document.getElementById(kind === 'messenger' ? 'messengerThread' : 'zaloThread');
    if (!inputEl || !threadEl) return;

    const msg = (inputEl.innerText || '').trim();
    if (!msg) return;

    const row = document.createElement('div');
    row.className = 'msg-row outgoing';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg;
    row.appendChild(bubble);
    threadEl.appendChild(row);
    threadEl.scrollTop = threadEl.scrollHeight;

    inputEl.innerHTML = '';
    inputEl.focus();
  }

  ['messenger', 'zalo'].forEach((kind) => {
    const inputEl = document.getElementById(kind === 'messenger' ? 'messengerInput' : 'zaloInput');
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
        e.preventDefault();
        sendMockChat(kind);
      }
    });
  });

  document.querySelectorAll('[data-send-target]').forEach((btn) => {
    btn.addEventListener('click', () => sendMockChat(btn.dataset.sendTarget));
  });

  // Copyable code snippets (e.g. chrome://extensions)
  document.querySelectorAll('.copyable-code').forEach((el) => {
    el.addEventListener('click', async () => {
      const val = el.dataset.copy || el.textContent;
      await navigator.clipboard.writeText(val).catch(() => {});
      showToastMsg(`✓ Đã copy "${val}" — Dán lên thanh địa chỉ trình duyệt nhé!`);
    });
  });

  // Modal AI Settings
  function openAiModal() {
    const s = getSettings();
    engineRadios.forEach((r) => { r.checked = (r.value === s.engine); });
    webGeminiFields.style.opacity = s.engine === 'gemini' ? '1' : '0.55';
    webToneSelect.value = s.tone || 'natural';
    webGeminiKey.value = s.geminiApiKey || '';
    webAutoPivotCheck.checked = Boolean(s.autoPivot);
    webPhoneticCheck.checked = Boolean(s.showPhonetic);
    aiModalBackdrop.classList.remove('hidden');
  }

  engineRadios.forEach((r) => {
    r.addEventListener('change', () => {
      const sel = document.querySelector('input[name="webEngine"]:checked')?.value;
      webGeminiFields.style.opacity = sel === 'gemini' ? '1' : '0.55';
    });
  });

  openAiModalBtn.addEventListener('click', openAiModal);
  closeAiModalBtn.addEventListener('click', () => aiModalBackdrop.classList.add('hidden'));
  aiModalBackdrop.addEventListener('click', (e) => {
    if (e.target === aiModalBackdrop) aiModalBackdrop.classList.add('hidden');
  });

  saveAiModalBtn.addEventListener('click', () => {
    const selectedEngine = document.querySelector('input[name="webEngine"]:checked')?.value || 'free';
    pushSettings({
      engine: selectedEngine,
      tone: webToneSelect.value,
      geminiApiKey: webGeminiKey.value.trim(),
      autoPivot: webAutoPivotCheck.checked,
      showPhonetic: webPhoneticCheck.checked
    });
    aiModalBackdrop.classList.add('hidden');
    showToastMsg('✓ Đã cập nhật cấu hình dịch thuật!');
  });

  // Share link & Bookmarklet
  shareLinkBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToastMsg('🔗 Đã sao chép đường dẫn trang web để chia sẻ!');
    } catch {
      showToastMsg('Hãy copy địa chỉ URL trên trình duyệt để chia sẻ nhé!');
    }
  });

  if (bookmarkletLink) {
    try {
      const scriptUrl = new URL('translator-core.js', location.href).href;
      const code = `javascript:(function(){if(window.__TRANSFLOW_INITIALIZED__){alert('TransFlow đang hoạt động trên trang này rồi!');return;}var s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};document.head.appendChild(s);})();`;
      bookmarkletLink.setAttribute('href', code);
      bookmarkletLink.addEventListener('click', (e) => {
        e.preventDefault();
        showToastMsg('💡 Hãy nhấn giữ và KÉO nút cam này thả lên Thanh Dấu Trang (Bookmarks Bar) của trình duyệt!');
      });
    } catch {}
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  syncWebControls(getSettings());
})();
