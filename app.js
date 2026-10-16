(() => {
  'use strict';

  const STORAGE_KEY = 'jincang-inventory-v2';
  const DB_VERSION = 2;
  const CATEGORY_DEFINITIONS = [
    { id: 'gimbal', name: '手持云台', color: '#ef603c', icon: 'camera', defaults: ['大疆', '影石', '其他'] },
    { id: 'panorama', name: '全景运动相机', color: '#3e73f3', icon: 'camera', defaults: ['影石', 'GoPro', '大疆', '其他'] },
    { id: 'mirrorless', name: '微单相机', color: '#7659d8', icon: 'camera', defaults: ['佳能', '索尼', '尼康', '富士', '其他'] },
    { id: 'compact', name: '卡片相机', color: '#d9901c', icon: 'camera', defaults: ['佳能', '索尼', '松下', '其他'] },
    { id: 'ccd', name: 'CCD相机', color: '#2f9a63', icon: 'camera', defaults: ['佳能', '索尼', '尼康', '卡西欧', '其他'] },
    { id: 'tripod', name: '落地三脚架', color: '#d95050', icon: 'layers', defaults: ['富宝图', '曼富图', '思锐', '其他'] }
  ];

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = (prefix = 'ID') => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const pad = (value) => String(value).padStart(2, '0');

  function todayISO() {
    const date = new Date();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseISODate(value) {
    return new Date(`${value}T00:00:00`);
  }

  function formatDate(value, fallback = '—') {
    if (!value) return fallback;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseISODate(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  }

  function formatDateTime(value, fallback = '—') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function daysUntil(value) {
    if (!value) return null;
    const target = parseISODate(value);
    const today = parseISODate(todayISO());
    return Math.round((target - today) / 86400000);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function icon(name, className = '') {
    return `<svg class="${className}"><use href="#icon-${name}"></use></svg>`;
  }

  function validSN(value) {
    return /^[A-Za-z0-9]{5,32}$/.test(String(value || '').trim());
  }

  function normalizeSubcategoryName(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
  }

  function makeDefaultState() {
    const now = new Date().toISOString();
    return {
      version: DB_VERSION,
      updatedAt: now,
      categories: CATEGORY_DEFINITIONS.map((definition) => ({
        id: definition.id,
        name: definition.name,
        color: definition.color,
        icon: definition.icon,
        subcategories: definition.defaults.map((name) => ({
          id: uid('SUB'),
          name,
          createdAt: now,
          models: []
        }))
      }))
    };
  }

  function migrationCategoryFor(modelId, modelName = '') {
    const id = String(modelId || '').toLowerCase();
    const name = String(modelName || '').toLowerCase();
    if (id.includes('pocket') || name.includes('pocket') || name.includes('云台')) return { categoryId: 'gimbal', subcategory: '大疆' };
    if (id.includes('ace') || id.includes('insta360') || name.includes('影石') || name.includes('运动')) return { categoryId: 'panorama', subcategory: '影石' };
    if (id.includes('r50') || name.includes('微单') || name.includes('r50')) return { categoryId: 'mirrorless', subcategory: '佳能' };
    if (id.includes('g7x') || name.includes('g7x') || name.includes('卡片')) return { categoryId: 'compact', subcategory: '佳能' };
    if (id.includes('fy830') || name.includes('富宝图') || name.includes('三脚架')) return { categoryId: 'tripod', subcategory: '富宝图' };
    return { categoryId: 'mirrorless', subcategory: '其他' };
  }

  function migrateLegacyState(raw) {
    const state = makeDefaultState();
    const legacyModels = Array.isArray(raw.models) ? raw.models : [];
    const modelNameMap = new Map(legacyModels.map((model) => [model.id, model.name || model.shortName || '']));
    const cameras = Array.isArray(raw.cameras) ? raw.cameras : [];
    const now = new Date().toISOString();

    cameras.forEach((camera) => {
      const modelName = modelNameMap.get(camera.modelId) || camera.modelName || camera.modelId || '未命名机型';
      const destination = migrationCategoryFor(camera.modelId, modelName);
      const category = state.categories.find((item) => item.id === destination.categoryId);
      let subcategory = category.subcategories.find((item) => item.name === destination.subcategory);
      if (!subcategory) {
        subcategory = { id: uid('SUB'), name: destination.subcategory, createdAt: now, models: [] };
        category.subcategories.push(subcategory);
      }
      subcategory.models.push({
        id: camera.id || uid('MODEL'),
        modelName,
        sn: String(camera.sn || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
        condition: camera.condition || '',
        warrantyStatus: 'unknown',
        activationDate: '',
        warrantyEnd: '',
        refreshEnd: '',
        sold: Boolean(camera.sold),
        note: camera.note || '',
        importKey: '',
        createdAt: camera.createdAt || camera.inboundAt || now,
        updatedAt: camera.createdAt || now
      });
    });

    state.updatedAt = now;
    return state;
  }

  function normalizeModel(model, now) {
    return {
      id: model.id || uid('MODEL'),
      modelName: String(model.modelName || model.model || model.name || '').trim(),
      sn: String(model.sn || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
      condition: String(model.condition || '').trim(),
      warrantyStatus: ['yes', 'no', 'unknown'].includes(model.warrantyStatus) ? model.warrantyStatus : 'unknown',
      activationDate: String(model.activationDate || ''),
      warrantyEnd: String(model.warrantyEnd || ''),
      refreshEnd: String(model.refreshEnd || model.exchangeEnd || ''),
      sold: Boolean(model.sold),
      note: String(model.note || '').trim(),
      createdAt: model.createdAt || now,
      importKey: String(model.importKey || ''),
      updatedAt: model.updatedAt || model.createdAt || now
    };
  }

  function normalizeState(raw) {
    if (raw && Array.isArray(raw.cameras) && !Array.isArray(raw.categories)) return migrateLegacyState(raw);
    if (!raw || !Array.isArray(raw.categories)) return makeDefaultState();
    const now = new Date().toISOString();
    const state = { version: DB_VERSION, updatedAt: raw.updatedAt || now, categories: [] };
    CATEGORY_DEFINITIONS.forEach((definition) => {
      const existingCategory = raw.categories.find((item) => item.id === definition.id) || {};
      const subcategories = Array.isArray(existingCategory.subcategories) ? existingCategory.subcategories : [];
      const seenNames = new Set();
      const normalizedSubs = subcategories.map((subcategory) => {
        let name = String(subcategory.name || '').trim() || '未命名小类目';
        while (seenNames.has(name)) name += ' 2';
        seenNames.add(name);
        return {
          id: subcategory.id || uid('SUB'),
          name,
          createdAt: subcategory.createdAt || now,
          models: Array.isArray(subcategory.models) ? subcategory.models.map((model) => normalizeModel(model, now)) : []
        };
      });
      state.categories.push({ id: definition.id, name: definition.name, color: definition.color, icon: definition.icon, subcategories: normalizedSubs });
    });
    return state;
  }

  class InventoryManager {
    constructor() {
      this.state = this.loadLocalState();
      this.currentView = 'dashboard';
      this.filters = { search: '', category: '', subcategory: '', status: '' };
      this.collapsedCategories = new Set();
      this.collapsedSubcategories = new Set();
      this.confirmResolver = null;
      this.selectedModels = new Set();
      this.pendingMoveKeys = [];
      this.saveTimer = null;
      this.saveQueue = Promise.resolve();
      this.storageInfo = { online: false, writable: false, importReady: false, staticMode: false, dataFile: 'data/state.json', lastSavedAt: '', saving: false };
      this.bindEvents();
      this.populateFixedSelects();
      this.refreshClock();
      this.renderAll();
      this.initializeStorage().catch((error) => console.warn('初始化存储失败', error));
    }

    canUseFolderStorage() {
      return location.protocol === 'http:' || location.protocol === 'https:';
    }

    loadLocalState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeState(JSON.parse(raw)) : makeDefaultState();
      } catch (error) {
        console.warn('读取本地缓存失败', error);
        return makeDefaultState();
      }
    }

    cacheLocally() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (_) {}
    }

    async loadStaticState() {
      try {
        const staticResponse = await fetch('data/state.json', { cache: 'no-store' });
        if (!staticResponse.ok) return false;
        const staticState = await staticResponse.json();
        if (!staticState || !Array.isArray(staticState.categories)) return false;
        this.state = normalizeState(staticState);
        this.cacheLocally();
        this.storageInfo.online = false;
        this.storageInfo.writable = false;
        this.storageInfo.importReady = false;
        this.storageInfo.staticMode = true;
        this.renderAll();
        this.renderStorageStatus('static');
        this.toast('已进入在线展示模式', '库存数据来自 data/state.json，修改仅保存在当前浏览器。', 'warning');
        return true;
      } catch (_) {
        return false;
      }
    }
    async initializeStorage() {
      this.renderStorageStatus('connecting');
      if (!this.canUseFolderStorage()) {
        this.renderStorageStatus('offline');
        return false;
      }
      if (/\.github\.io$/i.test(location.hostname)) {
        const loaded = await this.loadStaticState();
        if (loaded) return false;
      }
      try {
        const healthResponse = await fetch('/api/health', { cache: 'no-store' });
        if (!healthResponse.ok) throw new Error('存储服务不可用');
        const health = await healthResponse.json();
        if (!health.ok || !health.writable) throw new Error('网站目录不可写');
        this.storageInfo.online = true;
        this.storageInfo.writable = true;
        this.storageInfo.importReady = Array.isArray(health.capabilities) && health.capabilities.includes('parse-document');
        this.storageInfo.dataFile = health.relativeStateFile || 'data/state.json';
        if (!this.storageInfo.importReady) this.toast('启动服务需要更新', '当前后台服务版本较旧，请关闭所有启动窗口后重新运行 start-website.bat。', 'warning');

        const stateResponse = await fetch('/api/state', { cache: 'no-store' });
        if (!stateResponse.ok) throw new Error('无法读取数据文件');
        const payload = await stateResponse.json();
        if (payload.exists && payload.state) {
          const wasLegacySchema = !Array.isArray(payload.state.categories);
          this.state = normalizeState(payload.state);
          this.storageInfo.lastSavedAt = payload.savedAt || this.state.updatedAt || '';
          if (wasLegacySchema) await this.saveState('迁移旧库存数据');
        } else {
          await this.saveState('初始化数据文件');
        }
        this.cacheLocally();
        this.renderAll();
        this.renderStorageStatus('saved');
        return true;
      } catch (error) {
        if (await this.loadStaticState()) return false;
        this.storageInfo.online = false;
        this.storageInfo.writable = false;
        this.renderStorageStatus('offline');
        this.toast('文件夹存储未连接', '当前修改会先保存在浏览器缓存中。', 'warning');
        console.warn(error);
        return false;
      }
    }

    saveState(reason = '') {
      this.state.updatedAt = new Date().toISOString();
      this.cacheLocally();
      this.renderStorageStatus('saving');
      if (!this.canUseFolderStorage() || !this.storageInfo.online) {
        this.renderStorageStatus(this.canUseFolderStorage() ? 'error' : 'offline');
        return Promise.resolve(false);
      }
      const snapshot = clone(this.state);
      const task = async () => {
        try {
          const response = await fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(snapshot),
            keepalive: true
          });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || '写入失败');
          this.storageInfo.online = true;
          this.storageInfo.lastSavedAt = result.savedAt || new Date().toISOString();
          this.renderStorageStatus('saved');
          if (reason) console.info('已保存：' + reason);
          return true;
        } catch (error) {
          this.storageInfo.online = false;
          this.renderStorageStatus('error');
          this.toast('保存失败', '数据已保留在浏览器缓存，请检查启动窗口是否仍在运行。', 'error');
          console.error(error);
          return false;
        }
      };
      const queued = this.saveQueue.catch(() => false).then(task);
      this.saveQueue = queued.catch(() => false);
      return queued;
    }

    scheduleSave(reason = '自动保存') {
      window.clearTimeout(this.saveTimer);
      this.renderStorageStatus('saving');
      this.saveTimer = window.setTimeout(() => this.saveState(reason), 450);
    }

    renderStorageStatus(status = '') {
      const online = this.storageInfo.online && this.storageInfo.writable;
      const staticMode = this.storageInfo.staticMode && !online;
      const card = qs('#storageCard');
      const title = qs('#storageTitle');
      const text = qs('#storageText');
      const indicator = qs('#saveIndicator');
      if (card) {
        card.classList.toggle('server-online', online);
        card.classList.toggle('server-offline', !online);
      }
      if (title) title.textContent = online ? '网站文件夹存储' : staticMode ? '在线展示模式' : '浏览器临时缓存';
      if (text) text.textContent = online ? this.storageInfo.dataFile : staticMode ? '数据只读 · 修改保存在浏览器' : '文件夹服务未连接';
      if (indicator) {
        indicator.className = 'save-indicator ' + (status === 'saving' ? 'saving' : status === 'saved' ? 'saved' : status === 'error' ? 'error' : '');
        indicator.querySelector('span').textContent = status === 'saving' ? '正在保存…' : status === 'saved' ? `已保存 ${formatDateTime(this.storageInfo.lastSavedAt).slice(11) || ''}` : status === 'error' ? '保存异常' : staticMode ? '在线展示模式' : '正在连接';
      }
    }
    refreshClock() {
      const now = new Date();
      const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      qs('#sidebarDate').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
      window.setTimeout(() => this.refreshClock(), 60000);
    }

    bindEvents() {
      qsa('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => this.switchView(button.dataset.view)));
      qsa('[data-go-view]').forEach((button) => button.addEventListener('click', () => this.switchView(button.dataset.goView)));
      document.addEventListener('click', (event) => this.handleClick(event));
      document.addEventListener('pointerdown', (event) => this.createRipple(event));
      document.addEventListener('input', (event) => this.handleInput(event));
      document.addEventListener('change', (event) => this.handleChange(event));

      qs('#subcategoryForm').addEventListener('submit', (event) => this.submitSubcategory(event));
      qs('#modelForm').addEventListener('submit', (event) => this.submitModel(event));
      qs('#moveModelForm').addEventListener('submit', (event) => this.submitMoveModels(event));
      qs('#githubSyncForm').addEventListener('submit', (event) => this.submitGitHubSync(event));
      qs('#copyModelForm').addEventListener('submit', (event) => this.submitCopyModel(event));
      qs('#moveTargetCategory').addEventListener('change', () => this.populateMoveSubcategories());
      qs('#moveTargetSubcategory').addEventListener('change', () => this.syncMoveNewSubcategory());
      qs('#documentFileInput').addEventListener('change', (event) => this.handleDocumentFile(event));
      qs('#modelCategory').addEventListener('change', () => this.populateModelSubcategories());
      qs('#inventorySearch').addEventListener('input', (event) => { this.filters.search = event.target.value.trim().toLowerCase(); this.renderInventory(); });
      qs('#categoryFilter').addEventListener('change', (event) => { this.filters.category = event.target.value; this.filters.subcategory = ''; this.populateSubcategoryFilter(); this.renderInventory(); });
      qs('#subcategoryFilter').addEventListener('change', (event) => { this.filters.subcategory = event.target.value; this.renderInventory(); });
      qs('#statusFilter').addEventListener('change', (event) => { this.filters.status = event.target.value; this.renderInventory(); });
      qs('#confirmOk').addEventListener('click', () => this.resolveConfirm(true));
      qs('#confirmCancel').addEventListener('click', () => this.resolveConfirm(false));
      qs('[data-confirm-cancel]').addEventListener('click', () => this.resolveConfirm(false));
      qs('#mobileMenuButton').addEventListener('click', () => qs('#sidebar').classList.toggle('open'));

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          const modal = qs('.modal.open');
          if (modal && modal.id !== 'confirmModal') this.closeModal(modal.id);
          if (qs('#confirmModal.open')) this.resolveConfirm(false);
        }
        if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && this.currentView === 'inventory') {
          event.preventDefault();
          qs('#inventorySearch').focus();
        }
      });

      window.addEventListener('beforeunload', () => {
        if (this.storageInfo.online && this.storageInfo.saving && navigator.sendBeacon) {
          navigator.sendBeacon('/api/state', new Blob([JSON.stringify(this.state)], { type: 'application/json' }));
        }
      });

      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try {
          this.state = normalizeState(JSON.parse(event.newValue));
          this.renderAll();
          this.toast('数据已同步', '检测到另一个页面更新了库存。');
        } catch (_) {}
      });
    }

    populateFixedSelects() {
      const options = this.state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
      qs('#categoryFilter').innerHTML = '<option value="">全部大类</option>' + options;
      qs('#subcategoryCategory').innerHTML = options;
      qs('#modelCategory').innerHTML = options;
      this.populateSubcategoryFilter();
      this.populateModelSubcategories();
    }

    populateSubcategoryFilter() {
      const categoryIds = this.filters.category ? [this.filters.category] : this.state.categories.map((category) => category.id);
      const options = [];
      categoryIds.forEach((categoryId) => {
        const category = this.getCategory(categoryId);
        if (!category) return;
        category.subcategories.forEach((subcategory) => {
          options.push(`<option value="${subcategory.id}">${escapeHtml(category.name)} / ${escapeHtml(subcategory.name)}</option>`);
        });
      });
      qs('#subcategoryFilter').innerHTML = '<option value="">全部小类目</option>' + options.join('');
      if (this.filters.subcategory && !options.some((option) => option.includes(`value="${this.filters.subcategory}"`))) this.filters.subcategory = '';
      qs('#subcategoryFilter').value = this.filters.subcategory;
    }

    populateModelSubcategories(selectedId = '') {
      const category = this.getCategory(qs('#modelCategory').value);
      const select = qs('#modelSubcategory');
      if (!category || !category.subcategories.length) {
        select.innerHTML = '<option value="">请先添加小类目</option>';
        return;
      }
      select.innerHTML = category.subcategories.map((subcategory) => `<option value="${subcategory.id}">${escapeHtml(subcategory.name)}</option>`).join('');
      if (selectedId && category.subcategories.some((item) => item.id === selectedId)) select.value = selectedId;
    }

    switchView(view) {
      this.currentView = view;
      qsa('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
      qsa('.view[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
      const meta = {
        dashboard: ['库存看板', '六大类库存与保修状态总览'],
        inventory: ['相机库存', '管理小类目与可编辑机型明细']
      };
      qs('#pageTitle').textContent = meta[view][0];
      qs('#pageSubtitle').textContent = meta[view][1];
      qs('#sidebar').classList.remove('open');
      if (view === 'inventory') this.renderInventory();
      if (view === 'dashboard') this.renderDashboard();
      const selectionBar = qs('#selectionBar');
      if (selectionBar) {
        if (view === 'inventory') this.updateBulkMoveState();
        else selectionBar.classList.add('hidden');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    getCategory(categoryId) {
      return this.state.categories.find((category) => category.id === categoryId);
    }

    getSubcategory(categoryId, subcategoryId) {
      const category = this.getCategory(categoryId);
      return category ? category.subcategories.find((subcategory) => subcategory.id === subcategoryId) : null;
    }

    getModelContext(categoryId, subcategoryId, modelId) {
      const category = this.getCategory(categoryId);
      if (!category) return null;
      const subcategory = category.subcategories.find((item) => item.id === subcategoryId);
      if (!subcategory) return null;
      const model = subcategory.models.find((item) => item.id === modelId);
      return model ? { category, subcategory, model } : null;
    }

    getAllModels() {
      const rows = [];
      this.state.categories.forEach((category) => {
        category.subcategories.forEach((subcategory) => {
          subcategory.models.forEach((model) => rows.push({ category, subcategory, model }));
        });
      });
      return rows;
    }

    closestExpiry(model) {
      const events = [];
      if (model.warrantyEnd) events.push({ type: '在保到期', date: model.warrantyEnd, days: daysUntil(model.warrantyEnd) });
      if (model.refreshEnd) events.push({ type: '随心换到期', date: model.refreshEnd, days: daysUntil(model.refreshEnd) });
      return events.sort((a, b) => a.days - b.days)[0] || null;
    }

    isExpiring(model) {
      const event = this.closestExpiry(model);
      return Boolean(event && event.days <= 90);
    }

    warrantyLabel(status) {
      return { yes: '在保', no: '不在保', unknown: '未知' }[status] || '未知';
    }

    renderAll() {
      this.renderChrome();
      this.renderDashboard();
      this.renderInventory();
    }

    renderChrome() {
      const total = this.getAllModels().length;
      qs('#navInventoryCount').textContent = String(total);
    }

    renderDashboard() {
      const rows = this.getAllModels();
      const total = rows.length;
      const sold = rows.filter((row) => row.model.sold).length;
      const inStock = total - sold;
      const warranty = rows.filter((row) => !row.model.sold && row.model.warrantyStatus === 'yes').length;
      const expiring = rows.filter((row) => !row.model.sold && this.isExpiring(row.model)).length;
      const refreshActive = rows.filter((row) => !row.model.sold && row.model.refreshEnd && daysUntil(row.model.refreshEnd) >= 0).length;
      const metrics = [
        { label: '设备总数', value: total, meta: `六大类 · ${this.state.categories.reduce((sum, category) => sum + category.subcategories.length, 0)} 个小类目`, icon: 'inventory', color: 'var(--blue)', soft: 'var(--blue-soft)' },
        { label: '库存中', value: inStock, meta: `已售出 ${sold} 台`, icon: 'check', color: 'var(--green)', soft: 'var(--green-soft)' },
        { label: '已售出', value: sold, meta: sold ? '仍保留库存记录' : '暂无售出设备', icon: 'lock', color: 'var(--red)', soft: 'var(--red-soft)' },
        { label: '在保设备', value: warranty, meta: `占比 ${total ? Math.round(warranty / total * 100) : 0}%`, icon: 'shield', color: 'var(--violet)', soft: 'var(--violet-soft)' },
        { label: '90天内到期', value: expiring, meta: '在保或随心换即将到期', icon: 'clock', color: 'var(--amber)', soft: 'var(--amber-soft)' },
        { label: '随心换有效', value: refreshActive, meta: '未到随心换到期日', icon: 'shield', color: 'var(--green)', soft: 'var(--green-soft)' }
      ];
      qs('#metricGrid').innerHTML = metrics.map((item) => `<article class="metric-card" style="--color:${item.color};--soft:${item.soft}">
        <div class="metric-top"><span class="metric-label">${item.label}</span><span class="metric-icon">${icon(item.icon)}</span></div>
        <div class="metric-value" data-count="${item.value}">0</div>
        <div class="metric-meta">${item.meta}</div>
      </article>`).join('');
      this.animateCounters(qs('#metricGrid'));

      qs('#categoryOverview').innerHTML = this.state.categories.map((category) => {
        const models = category.subcategories.flatMap((subcategory) => subcategory.models);
        const inStockCount = models.filter((model) => !model.sold).length;
        return `<article class="category-stat" style="--cat-color:${category.color}" data-go-category="${category.id}">
          <div class="category-icon">${icon(category.icon)}</div>
          <div class="category-stat-main"><strong>${escapeHtml(category.name)}</strong><span>${category.subcategories.length} 个小类目 · 在库 ${inStockCount}</span></div>
          <div class="category-stat-count"><strong>${models.length}</strong><span>台设备</span></div>
        </article>`;
      }).join('');

      const alerts = rows
        .filter((row) => !row.model.sold)
        .map((row) => ({ row, event: this.closestExpiry(row.model) }))
        .filter((item) => item.event && item.event.days <= 90)
        .sort((a, b) => a.event.days - b.event.days)
        .slice(0, 6);
      qs('#warrantyAlerts').innerHTML = alerts.length ? alerts.map(({ row, event }) => `<div class="alert-item ${event.days < 0 ? 'expired' : ''}">
        <div class="alert-icon">${icon(event.days < 0 ? 'alert' : 'clock')}</div>
        <div class="alert-main"><strong>${escapeHtml(row.model.modelName || '未命名机型')}</strong><span>${escapeHtml(row.category.name)} / ${escapeHtml(row.subcategory.name)} · ${event.type} · ${formatDate(event.date)}</span></div>
        <div class="alert-time">${event.days < 0 ? `已过期 ${Math.abs(event.days)} 天` : `${event.days} 天后`}</div>
      </div>`).join('') : '<div class="inline-empty">未来 90 天内没有保修或随心换到期项目</div>';

      const recent = [...rows].sort((a, b) => String(b.model.createdAt).localeCompare(String(a.model.createdAt))).slice(0, 6);
      qs('#recentModels').innerHTML = recent.length ? recent.map((row) => `<div class="recent-item">
        <div class="recent-thumb ${row.model.sold ? 'sold' : ''}">${icon(row.model.sold ? 'lock' : 'camera')}</div>
        <div class="recent-main"><strong>${escapeHtml(row.model.modelName || '未命名机型')}</strong><span>${escapeHtml(row.category.name)} / ${escapeHtml(row.subcategory.name)} · SN ${escapeHtml(row.model.sn || '—')}</span></div>
        <div class="recent-date">${formatDate(row.model.createdAt)}</div>
      </div>`).join('') : '<div class="inline-empty">还没有录入任何机型</div>';

      const noWarranty = rows.filter((row) => row.model.warrantyStatus === 'unknown').length;
      qs('#statusSummary').innerHTML = [
        ['设备总数', `${total} 台`], ['库存中', `${inStock} 台`], ['已售出', `${sold} 台`],
        ['明确在保', `${warranty} 台`], ['保修状态未知', `${noWarranty} 台`], ['最近保存', formatDateTime(this.state.updatedAt)]
      ].map(([label, value]) => `<div class="status-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
    }

    animateCounters(root) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      qsa('[data-count]', root).forEach((element) => {
        const target = Number(element.dataset.count || 0);
        if (reduce) { element.textContent = String(target); return; }
        const started = performance.now();
        const frame = (now) => {
          const progress = Math.min(1, (now - started) / 650);
          element.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    }

    renderInventory() {
      const search = this.filters.search;
      const activeFilter = Boolean(search || this.filters.category || this.filters.subcategory || this.filters.status);
      let visibleCount = 0;
      const blocks = [];

      this.state.categories.forEach((category) => {
        if (this.filters.category && this.filters.category !== category.id) return;
        const subBlocks = [];
        let categoryVisibleCount = 0;

        category.subcategories.forEach((subcategory) => {
          if (this.filters.subcategory && this.filters.subcategory !== subcategory.id) return;
          const models = subcategory.models.filter((model) => {
            const matchesSearch = !search || [model.modelName, model.sn, model.condition, model.note].join(' ').toLowerCase().includes(search);
            if (!matchesSearch) return false;
            if (!this.filters.status) return true;
            if (this.filters.status === 'stock') return !model.sold;
            if (this.filters.status === 'sold') return model.sold;
            if (this.filters.status === 'warranty') return model.warrantyStatus === 'yes';
            if (this.filters.status === 'expiring') return this.isExpiring(model);
            return true;
          });
          categoryVisibleCount += models.length;
          visibleCount += models.length;
          if (activeFilter && !models.length) return;

          const collapsed = this.collapsedSubcategories.has(subcategory.id);
          const tableRows = models.length ? models.map((model) => this.modelRowTemplate(category, subcategory, model)).join('') : '<tr><td colspan="11"><div class="inline-empty">这个小类目暂无符合条件的机型</div></td></tr>';
          subBlocks.push(`<section class="subcategory-block ${collapsed ? 'collapsed' : ''}">
            <div class="subcategory-head">
              <button class="subcategory-fold" data-action="collapse-subcategory" data-id="${subcategory.id}" aria-label="展开或收起">${icon('chevron')}</button>
              <label class="subcategory-name"><input data-role="subcategory-name" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" value="${escapeHtml(subcategory.name)}" maxlength="30" aria-label="小类目名称"></label>
              <span class="subcategory-count">${models.length} 台机型</span>
              <div class="subcategory-actions">
                <button class="mini-action primary" data-action="add-model" data-cat-id="${category.id}" data-sub-id="${subcategory.id}">${icon('plus')}添加机型</button>
                <button class="mini-action" data-action="edit-subcategory" data-cat-id="${category.id}" data-sub-id="${subcategory.id}">${icon('edit')}改名</button>
                <button class="mini-action danger" data-action="delete-subcategory" data-cat-id="${category.id}" data-sub-id="${subcategory.id}">${icon('trash')}删除</button>
              </div>
            </div>
            <div class="inventory-table-wrap">
              <table class="inventory-table">
                <thead><tr>
                  <th class="selection-cell"><input class="row-select" type="checkbox" id="selectAllVisible" title="选择当前可见的全部 SN"></th><th>型号</th><th>串码 SN</th><th>成色</th><th>是否在保</th><th>激活时间</th><th>在保到期时间</th><th>随心换 / 无忧换到期</th><th>是否已出售</th><th>备注</th><th style="text-align:right">操作</th>
                </tr></thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>
          </section>`);
        });

        if (activeFilter && !categoryVisibleCount && category.subcategories.length) return;
        const categoryModelCount = category.subcategories.reduce((sum, subcategory) => sum + subcategory.models.length, 0);
        const collapsed = this.collapsedCategories.has(category.id);
        const emptySubcategory = !category.subcategories.length ? `<div class="empty-category"><span>这个大类还没有小类目，请先添加一个小类目。</span><button class="mini-action primary" data-action="add-subcategory" data-cat-id="${category.id}">${icon('plus')}添加小类目</button></div>` : '';
        blocks.push(`<article class="category-block ${collapsed ? 'collapsed' : ''}" style="--cat-color:${category.color}">
          <header class="category-head">
            <div class="category-head-icon">${icon(category.icon)}</div>
            <div class="category-head-main"><strong>${escapeHtml(category.name)}</strong><span>${category.subcategories.length} 个小类目 · ${categoryModelCount} 台机型</span></div>
            <div class="category-head-actions">
              <button class="mini-action primary" data-action="add-subcategory" data-cat-id="${category.id}">${icon('plus')}新增小类目</button>
              <button class="collapse-button" data-action="collapse-category" data-id="${category.id}" aria-label="展开或收起">${icon('chevron')}</button>
            </div>
          </header>
          ${emptySubcategory}
          <div class="subcategory-list">${subBlocks.join('') || '<div class="inline-empty">没有符合当前筛选条件的小类目</div>'}</div>
        </article>`);
      });

      qs('#inventoryCount').textContent = `共 ${visibleCount} 台机型`;
      qs('#inventoryTree').innerHTML = blocks.length ? blocks.join('') : '<div class="inline-empty" style="padding:70px 20px">没有找到符合条件的库存，请调整筛选或新增机型。</div>';
      const visibleCheckboxes = qsa('[data-role="select-model"]');
      const selectAll = qs('#selectAllVisible');
      if (selectAll) {
        selectAll.checked = visibleCheckboxes.length > 0 && visibleCheckboxes.every((checkbox) => checkbox.checked);
        selectAll.indeterminate = visibleCheckboxes.some((checkbox) => checkbox.checked) && !selectAll.checked;
      }
      this.updateBulkMoveState();
    }

    selectionKey(categoryId, subcategoryId, modelId) {
      return `${categoryId}|${subcategoryId}|${modelId}`;
    }

    modelRowTemplate(category, subcategory, model) {
      const snInvalid = model.sn && !validSN(model.sn);
      const key = this.selectionKey(category.id, subcategory.id, model.id);
      const selected = this.selectedModels.has(key);
      return `<tr data-model-row="${model.id}">
        <td class="selection-cell"><input class="row-select" type="checkbox" data-role="select-model" data-key="${key}" ${selected ? 'checked' : ''}></td>
        <td><input data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="modelName" value="${escapeHtml(model.modelName)}" maxlength="60"></td>
        <td><input class="${snInvalid ? 'invalid' : ''} ${!model.sn ? 'pending' : ''}" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="sn" value="${escapeHtml(model.sn)}" maxlength="32" spellcheck="false" placeholder="${!model.sn ? '待补录 SN' : ''}" title="仅限字母或数字，建议约15位"></td>
        <td><input data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="condition" value="${escapeHtml(model.condition)}" maxlength="30"></td>
        <td><select data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="warrantyStatus">
          <option value="unknown" ${model.warrantyStatus === 'unknown' ? 'selected' : ''}>未知</option>
          <option value="yes" ${model.warrantyStatus === 'yes' ? 'selected' : ''}>在保</option>
          <option value="no" ${model.warrantyStatus === 'no' ? 'selected' : ''}>不在保</option>
        </select></td>
        <td><input type="date" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="activationDate" value="${escapeHtml(model.activationDate)}"></td>
        <td><input type="date" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="warrantyEnd" value="${escapeHtml(model.warrantyEnd)}"></td>
        <td><input type="date" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="refreshEnd" value="${escapeHtml(model.refreshEnd)}"></td>
        <td><label class="sold-switch"><input type="checkbox" data-role="sold" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" ${model.sold ? 'checked' : ''}><span class="switch-track"></span><span class="sold-label">${model.sold ? '已售出' : '在库'}</span></label></td>
        <td><input data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-model-id="${model.id}" data-field="note" value="${escapeHtml(model.note)}" maxlength="500"></td>
        <td><div class="model-actions">
          <button class="icon-mini" data-action="move-model" data-key="${key}" title="移动到其他类目">${icon('move')}</button>
          <button class="icon-mini danger" data-action="delete-model" data-cat-id="${category.id}" data-sub-id="${subcategory.id}" data-id="${model.id}" title="删除机型">${icon('trash')}</button>
        </div></td>
      </tr>`;
    }
    handleInput(event) {
      const target = event.target;
      if (target.matches('[data-role="subcategory-name"]')) {
        if (!target.value.trim()) return;
        const subcategory = this.getSubcategory(target.dataset.catId, target.dataset.subId);
        if (subcategory) { subcategory.name = target.value; this.scheduleSave('修改小类目名称'); }
        return;
      }
      const field = target.dataset.field;
      if (!field) return;
      const context = this.getModelContext(target.dataset.catId, target.dataset.subId, target.dataset.modelId);
      if (!context) return;
      if (field === 'modelName' && !target.value.trim()) {
        target.classList.add('invalid');
        return;
      }
      if (field !== 'modelName') target.classList.remove('invalid');
      if (field === 'sn') {
        target.value = target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const hasValue = Boolean(target.value);
        const valid = !hasValue || validSN(target.value);
        target.classList.toggle('pending', !hasValue);
        target.classList.toggle('invalid', hasValue && !valid);
        if (!valid) return;
      }
      context.model[field] = target.value;
      context.model.updatedAt = new Date().toISOString();
      this.scheduleSave('编辑机型');
    }

    handleChange(event) {
      const target = event.target;
      if (target.id === 'selectAllVisible') {
        qsa('[data-role="select-model"]').forEach((checkbox) => {
          checkbox.checked = target.checked;
          if (target.checked) this.selectedModels.add(checkbox.dataset.key);
          else this.selectedModels.delete(checkbox.dataset.key);
        });
        this.updateBulkMoveState();
        return;
      }
      if (target.matches('[data-role="select-model"]')) {
        if (target.checked) this.selectedModels.add(target.dataset.key);
        else this.selectedModels.delete(target.dataset.key);
        this.updateBulkMoveState();
        return;
      }
      if (target.matches('[data-role="sold"]')) {
        const context = this.getModelContext(target.dataset.catId, target.dataset.subId, target.dataset.modelId);
        if (context) {
          context.model.sold = target.checked;
          context.model.updatedAt = new Date().toISOString();
          const label = target.closest('.sold-switch').querySelector('.sold-label');
          label.textContent = target.checked ? '已售出' : '在库';
          this.scheduleSave('修改出售状态');
        }
        return;
      }
      if (target.matches('[data-role="subcategory-name"]')) {
        const subcategory = this.getSubcategory(target.dataset.catId, target.dataset.subId);
        if (!subcategory) return;
        const name = target.value.trim();
        if (!name) {
          target.value = subcategory.name;
          this.toast('名称不能为空', '小类目名称必须填写。', 'error');
          return;
        }
        if (subcategory.name !== name && this.getCategory(target.dataset.catId).subcategories.some((item) => item.id !== subcategory.id && item.name === name)) {
          target.value = subcategory.name;
          this.toast('小类目重复', '同一个大类下不能有重名小类目。', 'error');
          return;
        }
        subcategory.name = name;
        this.scheduleSave('重命名小类目');
        return;
      }
      const field = target.dataset.field;
      if (!field) return;
      const context = this.getModelContext(target.dataset.catId, target.dataset.subId, target.dataset.modelId);
      if (!context) return;
      if (field === 'modelName' && !target.value.trim()) {
        target.value = context.model.modelName;
        target.classList.remove('invalid');
        this.toast('型号不能为空', '已恢复为上一次保存的型号。', 'error');
        return;
      }
      if (field === 'sn') {
        const value = target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (value && !validSN(value)) {
          target.value = context.model.sn;
          target.classList.remove('invalid');
          this.toast('SN 格式不正确', '串码只能是字母或数字，长度为 5-32 位，已恢复上一次保存值。', 'error');
          return;
        }
        target.value = value;
        target.classList.toggle('pending', !value);
        target.classList.remove('invalid');
      }
      context.model[field] = target.value;
      context.model.updatedAt = new Date().toISOString();
      this.scheduleSave('编辑机型');
    }

    toggleCategory(categoryId) {
      if (this.collapsedCategories.has(categoryId)) this.collapsedCategories.delete(categoryId);
      else this.collapsedCategories.add(categoryId);
      const category = this.getCategory(categoryId);
      const block = qs(`.category-block [data-action="collapse-category"][data-id="${categoryId}"]`)?.closest('.category-block');
      if (block) block.classList.toggle('collapsed', this.collapsedCategories.has(categoryId));
    }

    toggleSubcategory(subcategoryId) {
      if (this.collapsedSubcategories.has(subcategoryId)) this.collapsedSubcategories.delete(subcategoryId);
      else this.collapsedSubcategories.add(subcategoryId);
      const button = qs(`[data-action="collapse-subcategory"][data-id="${subcategoryId}"]`);
      const block = button ? button.closest('.subcategory-block') : null;
      if (block) block.classList.toggle('collapsed', this.collapsedSubcategories.has(subcategoryId));
    }

    openSubcategoryModal(categoryId = '', subcategoryId = '') {
      const form = qs('#subcategoryForm');
      form.reset();
      const editing = Boolean(subcategoryId);
      qs('#subcategoryModalTitle').textContent = editing ? '编辑小类目' : '新增小类目';
      qs('#subcategoryForm [name="subcategoryId"]').value = subcategoryId || '';
      const categorySelect = qs('#subcategoryCategory');
      const targetCategory = categoryId || (this.filters.category || this.state.categories[0].id);
      categorySelect.value = targetCategory;
      if (editing) {
        const subcategory = this.getSubcategory(categoryId, subcategoryId);
        if (subcategory) form.elements.name.value = subcategory.name;
      }
      this.openModal('subcategoryModal');
    }

    async submitSubcategory(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const categoryId = String(data.get('categoryId') || '');
      const subcategoryId = String(data.get('subcategoryId') || '');
      const name = String(data.get('name') || '').trim();
      const category = this.getCategory(categoryId);
      if (!category) return this.toast('大类不存在', '请重新选择所属大类。', 'error');
      if (!name) return this.toast('名称不能为空', '请填写小类目名称。', 'error');
      const duplicate = category.subcategories.some((item) => item.id !== subcategoryId && item.name.toLowerCase() === name.toLowerCase());
      if (duplicate) return this.toast('小类目重复', '同一个大类下不能有重名小类目。', 'error');

      if (subcategoryId) {
        const subcategory = category.subcategories.find((item) => item.id === subcategoryId);
        if (!subcategory) return this.toast('小类目不存在', '请刷新页面后重试。', 'error');
        subcategory.name = name;
      } else {
        category.subcategories.push({ id: uid('SUB'), name, createdAt: new Date().toISOString(), models: [] });
      }
      await this.saveState('保存小类目');
      this.closeModal('subcategoryModal');
      this.populateFixedSelects();
      this.renderAll();
      this.toast('小类目已保存', `${category.name} / ${name}`);
    }

    openModelModal(categoryId = '', subcategoryId = '') {
      const form = qs('#modelForm');
      form.reset();
      qs('#modelModalTitle').textContent = '新增机型';
      qs('#modelForm [name="modelId"]').value = '';
      const categorySelect = qs('#modelCategory');
      const targetCategory = categoryId || (this.filters.category || this.state.categories[0].id);
      categorySelect.value = targetCategory;
      this.populateModelSubcategories(subcategoryId);
      this.openModal('modelModal');
    }

    async submitModel(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const categoryId = String(data.get('categoryId') || '');
      const subcategoryId = String(data.get('subcategoryId') || '');
      const modelId = String(data.get('modelId') || '');
      const modelName = String(data.get('modelName') || '').trim();
      const sn = String(data.get('sn') || '').trim().toUpperCase();
      const category = this.getCategory(categoryId);
      const subcategory = this.getSubcategory(categoryId, subcategoryId);
      if (!category || !subcategory) return this.toast('请选择小类目', '新增机型前需要先创建并选择小类目。', 'error');
      if (!modelName) return this.toast('型号不能为空', '请填写机型型号。', 'error');
      if (sn && !validSN(sn)) return this.toast('SN 格式不正确', '串码只能是字母或数字，长度为 5-32 位。', 'error');
      const duplicate = sn && this.getAllModels().some((row) => row.model.id !== modelId && row.model.sn && row.model.sn.toUpperCase() === sn);
      if (duplicate) return this.toast('SN 已存在', '每台设备的串码必须唯一。', 'error');

      const now = new Date().toISOString();
      const payload = {
        id: modelId || uid('MODEL'),
        modelName,
        sn,
        condition: String(data.get('condition') || '').trim(),
        warrantyStatus: String(data.get('warrantyStatus') || 'unknown'),
        activationDate: String(data.get('activationDate') || ''),
        warrantyEnd: String(data.get('warrantyEnd') || ''),
        refreshEnd: String(data.get('refreshEnd') || ''),
        sold: String(data.get('sold') || 'false') === 'true',
        note: String(data.get('note') || '').trim(),
        createdAt: now,
        updatedAt: now
      };

      if (modelId) {
        const existing = this.getModelContext(categoryId, subcategoryId, modelId);
        if (!existing) return this.toast('机型不存在', '请刷新页面后重试。', 'error');
        Object.assign(existing.model, payload, { createdAt: existing.model.createdAt || now });
      } else {
        subcategory.models.push(payload);
      }
      await this.saveState('保存机型');
      this.closeModal('modelModal');
      form.reset();
      this.renderAll();
      this.toast('机型已保存', `${category.name} / ${subcategory.name} · ${modelName}`);
    }

    async deleteModel(categoryId, subcategoryId, modelId) {
      const context = this.getModelContext(categoryId, subcategoryId, modelId);
      if (!context) return;
      const confirmed = await this.confirmAction({
        title: '删除这个机型？',
        message: `${context.model.modelName || '未命名机型'}\nSN：${context.model.sn || '未填写'}\n删除后无法撤销。`,
        okText: '确认删除'
      });
      if (!confirmed) return;
      this.selectedModels.delete(this.selectionKey(categoryId, subcategoryId, modelId));
      context.subcategory.models = context.subcategory.models.filter((model) => model.id !== modelId);
      await this.saveState('删除机型');
      this.renderAll();
      this.toast('机型已删除', context.model.sn || context.model.modelName);
    }

    async deleteSubcategory(categoryId, subcategoryId) {
      const category = this.getCategory(categoryId);
      const subcategory = this.getSubcategory(categoryId, subcategoryId);
      if (!category || !subcategory) return;
      const confirmed = await this.confirmAction({
        title: '删除这个小类目？',
        message: `${category.name} / ${subcategory.name}\n其中包含 ${subcategory.models.length} 台机型，删除后无法撤销。`,
        okText: '确认删除'
      });
      if (!confirmed) return;
      [...this.selectedModels].forEach((key) => { if (key.startsWith(categoryId + '|' + subcategoryId + '|')) this.selectedModels.delete(key); });
      category.subcategories = category.subcategories.filter((item) => item.id !== subcategoryId);
      await this.saveState('删除小类目');
      this.populateFixedSelects();
      this.renderAll();
      this.toast('小类目已删除', subcategory.name);
    }

    confirmAction(options = {}) {
      return new Promise((resolve) => {
        this.confirmResolver = resolve;
        qs('#confirmTitle').textContent = options.title || '确认操作';
        qs('#confirmMessage').textContent = options.message || '确认继续吗？';
        qs('#confirmOk').textContent = options.okText || '确认删除';
        this.openModal('confirmModal');
      });
    }

    resolveConfirm(result) {
      this.closeModal('confirmModal');
      if (this.confirmResolver) {
        const resolve = this.confirmResolver;
        this.confirmResolver = null;
      this.selectedModels = new Set();
      this.pendingMoveKeys = [];
        resolve(result);
      }
    }

    openModal(id) {
      const modal = qs(`#${id}`);
      if (!modal) return;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    closeModal(id) {
      const modal = qs(`#${id}`);
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if (!qs('.modal.open')) document.body.style.overflow = '';
    }

    toast(title, message = '', type = 'success') {
      const element = document.createElement('div');
      element.className = `toast ${type}`;
      const iconName = type === 'error' || type === 'warning' ? 'alert' : 'check';
      element.innerHTML = `<div class="toast-icon">${icon(iconName)}</div><div><strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}</div>`;
      qs('#toastRegion').appendChild(element);
      window.setTimeout(() => element.remove(), 3600);
    }

    createRipple(event) {
      const target = event.target.closest('.btn, .mini-action, .nav-item, .icon-button, .icon-mini, .collapse-button, .subcategory-fold');
      if (!target || target.disabled) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.1;
      const ripple = document.createElement('span');
      ripple.className = 'ui-ripple';
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      target.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 650);
    }

    async handleDocumentFile(event) {
      const input = event.currentTarget;
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!this.canUseFolderStorage()) {
        this.toast('当前不是服务模式', '请关闭本页面，双击 start-website.bat，等待浏览器打开正确网址后再导入。', 'error');
        return;
      }
      if (this.storageInfo.staticMode) {
        this.toast('在线展示模式不支持导入', 'GitHub Pages 只能展示库存；Excel / Word 导入和数据写入请在本地通过 start-website.bat 使用。', 'warning');
        return;
      }
      if (!this.storageInfo.importReady) {
        this.toast('导入服务未就绪', '请关闭所有启动窗口，重新双击 start-website.bat 后再试。', 'error');
        return;
      }
      if (file.size > 30 * 1024 * 1024) {
        this.toast('文件过大', '单个导入文件请控制在 30MB 以内。', 'error');
        return;
      }
      this.setImportBusy(true, file.name);
      try {
        const buffer = await file.arrayBuffer();
        const contentBase64 = this.arrayBufferToBase64(buffer);
        const response = await fetch('/api/parse-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ filename: file.name, contentBase64 })
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('后台服务版本过旧，请重新运行 start-website.bat');
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '文档解析失败');
        const summary = this.importParsedRecords(payload.records || []);
        await this.saveState('导入 Excel / Word');
        this.renderAll();
        this.renderImportReport(file.name, payload, summary);
        this.switchView('inventory');
        this.toast('文档导入完成', `新增 ${summary.imported} 台，更新 ${summary.updated} 台，待补录 ${summary.pending} 台，跳过 ${summary.skipped} 条`);
      } catch (error) {
        this.toast('导入失败', error.message || '无法识别文件内容。', 'error');
        this.renderImportReport(file.name, { format: 'unknown', warnings: [error.message] }, { imported: 0, updated: 0, skipped: 0, total: 0, errors: [error.message] });
      } finally {
        this.setImportBusy(false);
      }
    }

    arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    }

    setImportBusy(busy, filename = '') {
      qsa('[data-action="import-document"]').forEach((button) => {
        button.disabled = busy;
        const label = button.querySelector('span');
        if (label) label.textContent = busy ? `正在识别${filename ? '：' + filename : '…'}` : '导入 Excel / Word';
      });
      const indicator = qs('#saveIndicator');
      if (busy && indicator) {
        indicator.className = 'save-indicator saving';
        indicator.querySelector('span').textContent = '正在识别文档…';
      }
    }

    importParsedRecords(records) {
      const summary = { total: records.length, imported: 0, updated: 0, skipped: 0, pending: 0, errors: [] };
      const now = new Date().toISOString();
      records.forEach((record, index) => {
        const sn = String(record.sn || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const modelName = String(record.modelName || '').trim();
        const importKey = String(record.importKey || `${record.source || 'document'}:${index + 1}`);
        if (sn && !validSN(sn)) {
          summary.skipped += 1;
          summary.errors.push(`第 ${index + 1} 条记录 SN 格式不正确${modelName ? '：' + modelName : ''}`);
          return;
        }
        if (!sn && !modelName) {
          summary.skipped += 1;
          summary.errors.push(`第 ${index + 1} 条记录没有型号和 SN，无法同步。`);
          return;
        }
        let category = this.getCategory(record.categoryId) || this.getCategory('mirrorless');
        const subcategoryName = String(record.subcategoryName || '其他').trim() || '其他';
        let subcategory = category.subcategories.find((item) => normalizeSubcategoryName(item.name) === normalizeSubcategoryName(subcategoryName));
        if (!subcategory) {
          subcategory = { id: uid('SUB'), name: subcategoryName, createdAt: now, models: [] };
          category.subcategories.push(subcategory);
        } else if (subcategory.name !== subcategoryName) {
          subcategory.name = subcategoryName;
        }
        const existingRow = sn
          ? this.getAllModels().find((row) => row.model.sn && row.model.sn.toUpperCase() === sn)
          : this.getAllModels().find((row) => row.model.importKey && row.model.importKey === importKey);
        if (existingRow) {
          const model = existingRow.model;
          if (modelName) model.modelName = modelName;
          if (record.condition) model.condition = record.condition;
          if (record.warrantyStatus && record.warrantyStatus !== 'unknown') model.warrantyStatus = record.warrantyStatus;
          if (record.activationDate) model.activationDate = record.activationDate;
          if (record.warrantyEnd) model.warrantyEnd = record.warrantyEnd;
          if (record.refreshEnd) model.refreshEnd = record.refreshEnd;
          if (record.sold !== null && record.sold !== undefined) model.sold = Boolean(record.sold);
          if (record.note) model.note = record.note;
          if (sn) model.sn = sn;
          model.importKey = importKey;
          model.updatedAt = now;
          if (existingRow.category.id !== category.id || existingRow.subcategory.id !== subcategory.id) {
            existingRow.subcategory.models = existingRow.subcategory.models.filter((item) => item.id !== model.id);
            subcategory.models.push(model);
          }
          summary.updated += 1;
          if (!sn) summary.pending += 1;
        } else {
          subcategory.models.push({
            id: uid('MODEL'),
            modelName: modelName || '未命名机型',
            sn,
            condition: record.condition || '',
            warrantyStatus: record.warrantyStatus || 'unknown',
            activationDate: record.activationDate || '',
            warrantyEnd: record.warrantyEnd || '',
            refreshEnd: record.refreshEnd || '',
            sold: record.sold === true,
            note: record.note || '',
            importKey,
            createdAt: now,
            updatedAt: now
          });
          summary.imported += 1;
          if (!sn) summary.pending += 1;
        }
      });
      this.cacheLocally();
      return summary;
    }
    renderImportReport(filename, payload, summary) {
      const report = qs('#importReport');
      if (!report) return;
      const warnings = [...(payload.warnings || []), ...(summary.errors || [])].filter(Boolean).slice(0, 10);
      report.classList.remove('hidden');
      report.innerHTML = `<div class="import-report-head">
        <div class="import-report-icon">${icon('check')}</div>
        <div class="import-report-title"><strong>导入完成：${escapeHtml(filename)}</strong><span>识别格式 ${escapeHtml(String(payload.format || '未知').toUpperCase())}，共读取 ${summary.total} 条机型记录</span></div>
        <button class="icon-button" data-action="close-import-report" aria-label="关闭导入报告">${icon('close')}</button>
      </div>
      <div class="import-report-stats">
        <div><span>新增</span><strong>${summary.imported}</strong></div>
        <div><span>更新</span><strong>${summary.updated}</strong></div>
        <div><span>待补录</span><strong>${summary.pending || 0}</strong></div>
        <div><span>跳过</span><strong>${summary.skipped}</strong></div>
        <div><span>警告</span><strong>${warnings.length}</strong></div>
      </div>
      ${warnings.length ? `<div class="import-report-warnings"><strong>需要核对的内容</strong>${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join('')}</div>` : '<div class="import-report-ok">所有识别到的记录都已直接写入库存文件。</div>'}`;
    }
    openGitHubSync() {
      const savedToken = localStorage.getItem('hubei-shigan-github-token') || sessionStorage.getItem('hubei-shigan-github-token') || '';
      qs('#githubToken').value = savedToken;
      qs('#githubRememberToken').checked = Boolean(localStorage.getItem('hubei-shigan-github-token'));
      this.openModal('githubSyncModal');
    }

    async submitGitHubSync(event) {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const token = String(formData.get('token') || '').trim();
      const remember = formData.get('remember') === 'on';
      if (!token) return this.toast('Token 不能为空', '请填写具有 Contents 读写权限的 GitHub Token。', 'error');
      if (remember) {
        localStorage.setItem('hubei-shigan-github-token', token);
        sessionStorage.removeItem('hubei-shigan-github-token');
      } else {
        sessionStorage.setItem('hubei-shigan-github-token', token);
        localStorage.removeItem('hubei-shigan-github-token');
      }

      const owner = 'zaiandz';
      const repo = 'kc';
      const branch = 'main';
      const path = 'data/state.json';
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
      const headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      };
      this.setImportBusy(true, 'GitHub');
      try {
        const metaResponse = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers, cache: 'no-store' });
        let sha = '';
        if (metaResponse.status === 200) {
          const meta = await metaResponse.json();
          sha = meta.sha || '';
        } else if (metaResponse.status !== 404) {
          const error = await metaResponse.json().catch(() => ({}));
          throw new Error(error.message || `读取 GitHub 数据失败（${metaResponse.status}）`);
        }

        const json = JSON.stringify(this.state, null, 2);
        const bytes = new TextEncoder().encode(json);
        const content = this.arrayBufferToBase64(bytes.buffer);
        const message = `Update inventory data ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
        const body = { message, content, branch };
        if (sha) body.sha = sha;
        const putResponse = await fetch(apiUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body)
        });
        const result = await putResponse.json().catch(() => ({}));
        if (!putResponse.ok || !result.content) throw new Error(result.message || `提交 GitHub 失败（${putResponse.status}）`);
        this.closeModal('githubSyncModal');
        this.toast('已保存到 GitHub', 'data/state.json 已提交，GitHub Pages 将自动重新部署。');
        if (result.commit && result.commit.html_url) window.open(result.commit.html_url, '_blank', 'noopener');
      } catch (error) {
        this.toast('GitHub 保存失败', error.message || '请检查 Token 权限和网络连接。', 'error');
      } finally {
        this.setImportBusy(false);
      }
    }
    openCopyModal() {
      if (this.selectedModels.size !== 1) {
        this.toast('请只勾选一个机型', '复制同型号功能一次只能处理一个机型。', 'warning');
        return;
      }
      const key = [...this.selectedModels][0];
      const [categoryId, subcategoryId, modelId] = key.split('|');
      const context = this.getModelContext(categoryId, subcategoryId, modelId);
      if (!context) {
        this.toast('机型不存在', '请刷新页面后重试。', 'error');
        return;
      }
      this.pendingCopyKey = key;
      qs('#copyQuantity').value = '1';
      qs('#copySummary').innerHTML = `<strong>将复制以下机型的型号</strong><div class="move-list"><span>${escapeHtml(context.model.modelName || '未命名机型')} · 来源：${escapeHtml(context.category.name)} / ${escapeHtml(context.subcategory.name)}</span></div><div class="move-current">新记录仅保留型号，SN、成色、在保、激活时间、随心换、售出状态和备注全部为空，可一次复制多条。</div>`;
      qs('#copyCategoryName').value = context.category.name;
      const select = qs('#copyTargetSubcategory');
      select.innerHTML = context.category.subcategories.map((subcategory) => `<option value="${subcategory.id}">${escapeHtml(subcategory.name)}</option>`).join('');
      if (context.category.subcategories.some((subcategory) => subcategory.id === context.subcategory.id)) select.value = context.subcategory.id;
      this.openModal('copyModelModal');
    }

    async submitCopyModel(event) {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const key = String(this.pendingCopyKey || '');
      const [categoryId, subcategoryId, modelId] = key.split('|');
      const context = this.getModelContext(categoryId, subcategoryId, modelId);
      if (!context) return this.toast('源机型不存在', '请重新选择需要复制的机型。', 'error');
      const targetSubcategory = context.category.subcategories.find((subcategory) => subcategory.id === String(formData.get('targetSubcategory') || ''));
      if (!targetSubcategory) return this.toast('目标小类目不存在', '请重新选择同类目下的小类目。', 'error');
      const requested = Number(formData.get('quantity') || 1);
      const quantity = Math.max(1, Math.min(100, Number.isFinite(requested) ? Math.trunc(requested) : 1));
      const now = new Date().toISOString();
      const copied = [];
      for (let index = 0; index < quantity; index += 1) {
        const newModel = {
          id: uid('MODEL'),
          modelName: context.model.modelName || '未命名机型',
          sn: '',
          condition: '',
          warrantyStatus: 'unknown',
          activationDate: '',
          warrantyEnd: '',
          refreshEnd: '',
          sold: false,
          note: '',
          importKey: '',
          createdAt: now,
          updatedAt: now
        };
        targetSubcategory.models.push(newModel);
        copied.push(newModel);
      }
      this.selectedModels.clear();
      this.pendingCopyKey = '';
      await this.saveState('复制同型号机型');
      this.closeModal('copyModelModal');
      this.renderAll();
      this.updateBulkMoveState();
      window.setTimeout(() => {
        const input = qs(`[data-model-row="${copied[0].id}"] [data-field="sn"]`);
        if (input) input.focus();
      }, 120);
      this.toast('复制完成', `已复制 ${quantity} 条 ${copied[0].modelName}，请填写 SN 和其他信息。`);
    }
    async deleteSelectedModels() {
      const keys = [...this.selectedModels];
      const contexts = keys.map((key) => {
        const [categoryId, subcategoryId, modelId] = key.split('|');
        const context = this.getModelContext(categoryId, subcategoryId, modelId);
        return context ? { key, categoryId, subcategoryId, modelId, context } : null;
      }).filter(Boolean);
      if (!contexts.length) {
        this.toast('没有选择 SN', '请先勾选需要删除的机型。', 'warning');
        return;
      }
      const preview = contexts.slice(0, 5).map(({ context }) => `${context.model.sn || '待补录'} · ${context.model.modelName || '未命名机型'}`).join('\n');
      const confirmed = await this.confirmAction({
        title: `确认批量删除 ${contexts.length} 条机型？`,
        message: `${preview}${contexts.length > 5 ? `\n……以及另外 ${contexts.length - 5} 条` : ''}\n\n删除后无法撤销。`,
        okText: '确认批量删除'
      });
      if (!confirmed) return;
      const grouped = new Map();
      contexts.forEach(({ categoryId, subcategoryId, modelId }) => {
        const groupKey = categoryId + '|' + subcategoryId;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { categoryId, subcategoryId, ids: new Set() });
        grouped.get(groupKey).ids.add(modelId);
      });
      let deleted = 0;
      grouped.forEach(({ categoryId, subcategoryId, ids }) => {
        const subcategory = this.getSubcategory(categoryId, subcategoryId);
        if (!subcategory) return;
        const before = subcategory.models.length;
        subcategory.models = subcategory.models.filter((model) => !ids.has(model.id));
        deleted += before - subcategory.models.length;
      });
      this.selectedModels.clear();
      this.pendingMoveKeys = [];
      await this.saveState('批量删除机型');
      this.closeModal('confirmModal');
      this.renderAll();
      this.updateBulkMoveState();
      this.toast('批量删除完成', `已删除 ${deleted} 条机型`);
    }
    updateBulkMoveState() {
      const count = this.selectedModels.size;
      const bar = qs('#selectionBar');
      const countElement = qs('#selectionCount');
      if (bar) bar.classList.toggle('hidden', count === 0);
      if (countElement) countElement.textContent = String(count);
      const copyButton = qs('#copySelectedButton');
      if (copyButton) {
        copyButton.disabled = count !== 1;
        copyButton.title = count === 1 ? '复制当前机型的型号' : '请只勾选一个机型后再复制';
      }
      qsa('[data-model-row]').forEach((row) => {
        const checkbox = row.querySelector('[data-role="select-model"]');
        row.classList.toggle('selected-row', Boolean(checkbox && checkbox.checked));
      });
      const visibleCheckboxes = qsa('[data-role="select-model"]');
      const selectAll = qs('#selectAllVisible');
      if (selectAll) {
        selectAll.checked = visibleCheckboxes.length > 0 && visibleCheckboxes.every((checkbox) => checkbox.checked);
        selectAll.indeterminate = visibleCheckboxes.some((checkbox) => checkbox.checked) && !selectAll.checked;
      }
    }
    openMoveModal(keys = []) {
      const validKeys = keys.filter((key) => {
        const [categoryId, subcategoryId, modelId] = String(key).split('|');
        return Boolean(this.getModelContext(categoryId, subcategoryId, modelId));
      });
      if (!validKeys.length) {
        this.toast('没有选择 SN', '请先勾选需要移动的机型。', 'warning');
        return;
      }
      this.pendingMoveKeys = validKeys;
      const rows = validKeys.map((key) => {
        const [categoryId, subcategoryId, modelId] = key.split('|');
        const context = this.getModelContext(categoryId, subcategoryId, modelId);
        return { context, categoryId, subcategoryId, modelId };
      });
      qs('#moveSummary').innerHTML = `<strong>准备移动 ${rows.length} 条 SN</strong><div class="move-list">${rows.map(({ context }) => `<span>${escapeHtml(context.model.sn || '无 SN')} · ${escapeHtml(context.model.modelName || '未命名机型')}</span>`).join('')}</div><div class="move-current">当前位置：${escapeHtml(rows[0].context.category.name)} / ${escapeHtml(rows[0].context.subcategory.name)}${rows.length > 1 ? ' 等' : ''}</div>`;
      const categorySelect = qs('#moveTargetCategory');
      categorySelect.innerHTML = this.state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
      const sameCategory = rows.every((row) => row.categoryId === rows[0].categoryId);
      categorySelect.value = sameCategory ? rows[0].categoryId : this.state.categories[0].id;
      this.populateMoveSubcategories();
      this.openModal('moveModelModal');
    }

    populateMoveSubcategories() {
      const category = this.getCategory(qs('#moveTargetCategory').value);
      const select = qs('#moveTargetSubcategory');
      if (!category) return;
      select.innerHTML = category.subcategories.map((subcategory) => `<option value="${subcategory.id}">${escapeHtml(subcategory.name)}</option>`).join('') + '<option value="__new__">＋ 新建小类目</option>';
      this.syncMoveNewSubcategory();
    }

    syncMoveNewSubcategory() {
      const isNew = qs('#moveTargetSubcategory').value === '__new__';
      qs('#moveNewSubcategoryField').classList.toggle('hidden', !isNew);
      qs('#moveNewSubcategory').required = isNew;
      if (isNew) setTimeout(() => qs('#moveNewSubcategory').focus(), 50);
    }

    async submitMoveModels(event) {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const targetCategory = this.getCategory(String(data.get('targetCategory') || ''));
      if (!targetCategory) return this.toast('目标大类不存在', '请重新选择目标大类。', 'error');
      let targetSubcategory = null;
      const targetSubcategoryId = String(data.get('targetSubcategory') || '');
      if (targetSubcategoryId === '__new__') {
        const name = String(data.get('newSubcategory') || '').trim();
        if (!name) return this.toast('名称不能为空', '请填写新小类目名称。', 'error');
        targetSubcategory = targetCategory.subcategories.find((item) => normalizeSubcategoryName(item.name) === normalizeSubcategoryName(name));
        if (!targetSubcategory) {
          targetSubcategory = { id: uid('SUB'), name, createdAt: new Date().toISOString(), models: [] };
          targetCategory.subcategories.push(targetSubcategory);
        }
      } else {
        targetSubcategory = targetCategory.subcategories.find((item) => item.id === targetSubcategoryId);
      }
      if (!targetSubcategory) return this.toast('目标小类目不存在', '请重新选择目标小类目。', 'error');

      const now = new Date().toISOString();
      let moved = 0;
      let skipped = 0;
      this.pendingMoveKeys.forEach((key) => {
        const [categoryId, subcategoryId, modelId] = key.split('|');
        const context = this.getModelContext(categoryId, subcategoryId, modelId);
        if (!context) { skipped += 1; return; }
        if (context.category.id === targetCategory.id && context.subcategory.id === targetSubcategory.id) { skipped += 1; return; }
        context.subcategory.models = context.subcategory.models.filter((model) => model.id !== modelId);
        context.model.updatedAt = now;
        targetSubcategory.models.push(context.model);
        moved += 1;
      });

      if (!moved) {
        this.toast('没有移动任何 SN', skipped ? '目标位置与当前位置相同。' : '请重新选择。', 'warning');
        return;
      }
      this.selectedModels.clear();
      this.pendingMoveKeys = [];
      await this.saveState('移动 SN 到其他类目');
      this.closeModal('moveModelModal');
      this.renderAll();
      this.updateBulkMoveState();
      this.toast('移动完成', `已移动 ${moved} 条 SN 到 ${targetCategory.name} / ${targetSubcategory.name}`);
    }
    handleClick(event) {
      const close = event.target.closest('[data-close-modal]');
      if (close) {
        const modal = close.closest('.modal');
        if (modal) this.closeModal(modal.id);
        return;
      }
      const soldSwitch = event.target.closest('.sold-switch');
      if (soldSwitch) return;
      const actionElement = event.target.closest('[data-action]');
      if (actionElement) {
        const action = actionElement.dataset.action;
        const categoryId = actionElement.dataset.catId || '';
        const subcategoryId = actionElement.dataset.subId || '';
        const id = actionElement.dataset.id || '';
        if (action === 'add-subcategory') this.openSubcategoryModal(categoryId);
        else if (action === 'edit-subcategory') this.openSubcategoryModal(categoryId, subcategoryId);
        else if (action === 'delete-subcategory') this.deleteSubcategory(categoryId, subcategoryId);
        else if (action === 'add-model') this.openModelModal(categoryId, subcategoryId);
        else if (action === 'delete-model') this.deleteModel(categoryId, subcategoryId, id);
        else if (action === 'move-model') this.openMoveModal([actionElement.dataset.key]);
        else if (action === 'move-selected') this.openMoveModal([...this.selectedModels]);
        else if (action === 'delete-selected') this.deleteSelectedModels();
        else if (action === 'copy-selected') this.openCopyModal();
        else if (action === 'open-github-sync') this.openGitHubSync();
        else if (action === 'open-github-token') window.open('https://github.com/settings/personal-access-tokens/new','_blank','noopener');
        else if (action === 'clear-selection') {
          this.selectedModels.clear();
          qsa('[data-role="select-model"]').forEach((checkbox) => { checkbox.checked = false; });
          this.updateBulkMoveState();
        }
        else if (action === 'collapse-category') this.toggleCategory(id);
        else if (action === 'collapse-subcategory') this.toggleSubcategory(id);
        else if (action === 'expand-all') { this.collapsedCategories.clear(); this.collapsedSubcategories.clear(); this.renderInventory(); }
        else if (action === 'import-document') qs('#documentFileInput').click();
        else if (action === 'close-import-report') qs('#importReport').classList.add('hidden');
        else if (action === 'collapse-all') {
          this.state.categories.forEach((category) => {
            this.collapsedCategories.add(category.id);
            category.subcategories.forEach((subcategory) => this.collapsedSubcategories.add(subcategory.id));
          });
          this.renderInventory();
        }
        return;
      }
      const categoryLink = event.target.closest('[data-go-category]');
      if (categoryLink) {
        this.filters.category = categoryLink.dataset.goCategory;
        this.filters.subcategory = '';
        qs('#categoryFilter').value = this.filters.category;
        this.populateSubcategoryFilter();
        this.switchView('inventory');
      }
    }
  }

  window.inventoryManager = new InventoryManager();
})();
































