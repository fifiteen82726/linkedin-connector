(function () {
  'use strict';

  const STORAGE_KEY = 'replyTemplateState';
  const DEFAULT_TEMPLATES = Object.freeze([
    Object.freeze({
      id: 'referral-follow-up',
      title: 'Referral follow-up',
      body: `Yes, thank you so much for connecting with me. The job market is brutal now, I truly appreciate your time and support. I’m very interested in this position. I've attached my resume. Let me know if you need more info.

**Job - link**

First Name: Yi-Yun
Last Name: Liao
Email: yiyunliao0321@gmail.com
Phone: 929-313-3362`,
      kind: 'builtin',
    }),
  ]);

  function emptyState() {
    return {
      version: 1,
      overrides: {},
      customTemplates: [],
    };
  }

  function normalizeState(state) {
    const hasValidOverrides = state
      && typeof state.overrides === 'object'
      && state.overrides !== null
      && !Array.isArray(state.overrides)
      && Object.values(state.overrides).every(
        (body) => typeof body === 'string' && body.trim(),
      );
    if (
      !state
      || typeof state !== 'object'
      || Array.isArray(state)
      || state.version !== 1
      || !hasValidOverrides
      || !Array.isArray(state.customTemplates)
    ) {
      return emptyState();
    }

    return {
      version: 1,
      overrides: { ...state.overrides },
      customTemplates: [...state.customTemplates],
    };
  }

  function readState() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(STORAGE_KEY, (values) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(normalizeState(values && values[STORAGE_KEY]));
      });
    });
  }

  function writeState(state) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    });
  }

  function createStore() {
    return {
      async getTemplates() {
        const state = await readState();
        return DEFAULT_TEMPLATES.map((template) => ({
          ...template,
          body: Object.prototype.hasOwnProperty.call(
            state.overrides,
            template.id,
          )
            ? state.overrides[template.id]
            : template.body,
        }));
      },

      async saveBody(templateId, body) {
        if (typeof body !== 'string' || !body.trim()) {
          throw new Error('Template body is required');
        }

        const state = await readState();
        state.overrides[templateId] = body;
        await writeState(state);
      },
    };
  }

  globalThis.ReplyTemplateStore = Object.freeze({
    DEFAULT_TEMPLATES,
    STORAGE_KEY,
    createStore,
  });
}());
