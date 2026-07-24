(function () {
  'use strict';

  const STORAGE_KEY = 'replyTemplateState';
  const WRITE_LOCK_NAME = 'linkedin-connector-reply-template-state-write';
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
  const BUILTIN_TEMPLATE_IDS = new Set(
    DEFAULT_TEMPLATES.map((template) => template.id),
  );
  let writeQueue = Promise.resolve();

  function emptyState() {
    return {
      version: 1,
      overrides: {},
      customTemplates: [],
    };
  }

  function isRecord(value) {
    return value !== null
      && typeof value === 'object'
      && !Array.isArray(value);
  }

  function isNonBlankString(value) {
    return typeof value === 'string' && Boolean(value.trim());
  }

  function normalizeOverrides(overrides) {
    if (!isRecord(overrides)) {
      return {};
    }

    const normalized = {};
    for (const template of DEFAULT_TEMPLATES) {
      const body = overrides[template.id];
      if (
        Object.prototype.hasOwnProperty.call(overrides, template.id)
        && isNonBlankString(body)
      ) {
        normalized[template.id] = body;
      }
    }
    return normalized;
  }

  function normalizeCustomTemplates(customTemplates) {
    if (!Array.isArray(customTemplates)) {
      return [];
    }

    return customTemplates
      .filter((template) => (
        isRecord(template)
        && isNonBlankString(template.id)
        && isNonBlankString(template.title)
        && isNonBlankString(template.body)
      ))
      .map((template) => ({
        id: template.id,
        title: template.title,
        body: template.body,
        kind: 'custom',
      }));
  }

  function normalizeState(state) {
    if (!isRecord(state) || state.version !== 1) {
      return emptyState();
    }

    return {
      version: 1,
      overrides: normalizeOverrides(state.overrides),
      customTemplates: normalizeCustomTemplates(state.customTemplates),
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

  function withWriteLock(update) {
    if (
      typeof navigator !== 'undefined'
      && navigator.locks
      && typeof navigator.locks.request === 'function'
    ) {
      return navigator.locks.request(WRITE_LOCK_NAME, update);
    }

    const result = writeQueue.then(update, update);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
        if (!BUILTIN_TEMPLATE_IDS.has(templateId)) {
          throw new Error('Template not found');
        }
        if (!isNonBlankString(body)) {
          throw new Error('Template body is required');
        }

        await withWriteLock(async () => {
          const state = await readState();
          state.overrides[templateId] = body;
          await writeState(state);
        });
      },
    };
  }

  globalThis.ReplyTemplateStore = Object.freeze({
    DEFAULT_TEMPLATES,
    STORAGE_KEY,
    createStore,
  });
}());
