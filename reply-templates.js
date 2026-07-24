(function () {
  'use strict';

  const MODAL_ID = 'linkedin-reply-template-modal';
  const TITLE_ID = `${MODAL_ID}-title`;

  function errorMessage(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  function createActions({
    clipboard,
    close,
    render,
    setStatus,
    store,
  }) {
    return {
      async copy(body) {
        try {
          await clipboard.writeText(body);
          close();
          return true;
        } catch (error) {
          setStatus(
            errorMessage(error, 'Could not copy template'),
            'error',
          );
          return false;
        }
      },

      async save(id, body) {
        try {
          await store.saveBody(id, body);
          setStatus('Saved', 'success');
          return true;
        } catch (error) {
          setStatus(
            errorMessage(error, 'Could not save template'),
            'error',
          );
          return false;
        }
      },

      async add(title, body) {
        try {
          await store.addCustomTemplate(title, body);
          const templates = await store.getTemplates();
          render(templates);
          setStatus('Template added', 'success');
          return true;
        } catch (error) {
          setStatus(
            errorMessage(error, 'Could not add template'),
            'error',
          );
          return false;
        }
      },
    };
  }

  function createElement(doc, tagName, className, text) {
    const element = doc.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function createButton(doc, className, text) {
    const button = createElement(doc, 'button', className, text);
    button.type = 'button';
    return button;
  }

  function showDialog({
    doc = document,
    clipboard = navigator.clipboard,
    store = ReplyTemplateStore.createStore(),
  } = {}) {
    const existing = doc.getElementById(MODAL_ID);
    if (existing) {
      const firstTextarea = existing.querySelector('textarea');
      if (firstTextarea) {
        firstTextarea.focus();
      }
      return existing;
    }

    const backdrop = createElement(
      doc,
      'div',
      'reply-template-backdrop',
    );
    backdrop.id = MODAL_ID;

    const modal = createElement(doc, 'section', 'reply-template-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', TITLE_ID);

    const header = createElement(doc, 'header', 'reply-template-header');
    const title = createElement(
      doc,
      'h2',
      'reply-template-heading',
      'Reply Templates',
    );
    title.id = TITLE_ID;
    const closeButton = createButton(
      doc,
      'reply-template-close',
      '\u00d7',
    );
    closeButton.setAttribute('aria-label', 'Close reply templates');
    header.append(title, closeButton);

    const status = createElement(doc, 'p', 'reply-template-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const list = createElement(doc, 'div', 'reply-template-list');
    const addControls = createElement(
      doc,
      'div',
      'reply-template-add-controls',
    );
    const revealAddButton = createButton(
      doc,
      'reply-template-button reply-template-button--secondary',
      'Add template',
    );
    const addForm = createElement(
      doc,
      'form',
      'reply-template-add-form',
    );
    addForm.hidden = true;

    const nameLabel = createElement(
      doc,
      'label',
      'reply-template-field-label',
      'Template name',
    );
    const nameInput = createElement(
      doc,
      'input',
      'reply-template-input',
    );
    nameInput.type = 'text';
    nameInput.required = true;
    nameLabel.append(nameInput);

    const bodyLabel = createElement(
      doc,
      'label',
      'reply-template-field-label',
      'Template body',
    );
    const bodyInput = createElement(
      doc,
      'textarea',
      'reply-template-textarea reply-template-textarea--new',
    );
    bodyInput.required = true;
    bodyInput.rows = 5;
    bodyLabel.append(bodyInput);

    const addFormActions = createElement(
      doc,
      'div',
      'reply-template-form-actions',
    );
    const cancelAddButton = createButton(
      doc,
      'reply-template-button reply-template-button--secondary',
      'Cancel',
    );
    const submitAddButton = createButton(
      doc,
      'reply-template-button reply-template-button--primary',
      'Add',
    );
    submitAddButton.type = 'submit';
    addFormActions.append(cancelAddButton, submitAddButton);
    addForm.append(nameLabel, bodyLabel, addFormActions);
    addControls.append(revealAddButton, addForm);

    modal.append(header, status, list, addControls);
    backdrop.append(modal);

    let closed = false;

    function setStatus(message, type) {
      status.textContent = message;
      status.className = type
        ? `reply-template-status reply-template-status--${type}`
        : 'reply-template-status';
    }

    function close() {
      if (closed) {
        return;
      }
      closed = true;
      doc.removeEventListener('keydown', handleKeydown);
      backdrop.remove();
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        close();
      }
    }

    function runOnce(button, operation) {
      button.addEventListener('click', async () => {
        if (button.disabled) {
          return;
        }
        button.disabled = true;
        try {
          await operation();
        } finally {
          if (backdrop.isConnected) {
            button.disabled = false;
          }
        }
      });
    }

    let actions;

    function render(templates) {
      let firstTextarea = null;
      const templateElements = templates.map((template, index) => {
        const item = createElement(doc, 'section', 'reply-template-item');
        const itemTitleId = `${MODAL_ID}-template-${index}-title`;
        const itemTitle = createElement(
          doc,
          'h3',
          'reply-template-item-title',
          template.title,
        );
        itemTitle.id = itemTitleId;
        const textarea = createElement(
          doc,
          'textarea',
          'reply-template-textarea',
        );
        textarea.setAttribute('aria-labelledby', itemTitleId);
        textarea.value = template.body;
        textarea.rows = 7;
        if (index === 0) {
          firstTextarea = textarea;
        }

        const itemActions = createElement(
          doc,
          'div',
          'reply-template-item-actions',
        );
        const copyButton = createButton(
          doc,
          'reply-template-button reply-template-button--primary',
          'Copy',
        );
        const saveButton = createButton(
          doc,
          'reply-template-button reply-template-button--secondary',
          'Save',
        );

        runOnce(copyButton, () => actions.copy(textarea.value));
        runOnce(
          saveButton,
          () => actions.save(template.id, textarea.value),
        );
        itemActions.append(copyButton, saveButton);
        item.append(itemTitle, textarea, itemActions);
        return item;
      });

      list.replaceChildren(...templateElements);
      return firstTextarea;
    }

    actions = createActions({
      clipboard,
      close,
      render,
      setStatus,
      store,
    });

    function resetAddForm() {
      nameInput.value = '';
      bodyInput.value = '';
      addForm.hidden = true;
      revealAddButton.hidden = false;
    }

    revealAddButton.addEventListener('click', () => {
      revealAddButton.hidden = true;
      addForm.hidden = false;
      nameInput.focus();
    });
    cancelAddButton.addEventListener('click', resetAddForm);
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitAddButton.disabled) {
        return;
      }

      submitAddButton.disabled = true;
      try {
        const added = await actions.add(nameInput.value, bodyInput.value);
        if (added && backdrop.isConnected) {
          resetAddForm();
        }
      } finally {
        if (backdrop.isConnected) {
          submitAddButton.disabled = false;
        }
      }
    });

    closeButton.addEventListener('click', close);
    doc.addEventListener('keydown', handleKeydown);
    doc.body.append(backdrop);

    Promise.resolve()
      .then(() => store.getTemplates())
      .then((templates) => {
        if (!closed) {
          const firstTextarea = render(templates);
          if (firstTextarea) {
            firstTextarea.focus();
          }
        }
      })
      .catch((error) => {
        if (!closed) {
          setStatus(
            errorMessage(error, 'Could not load templates'),
            'error',
          );
        }
      });

    return backdrop;
  }

  globalThis.ReplyTemplates = Object.freeze({
    MODAL_ID,
    createActions,
    showDialog,
  });
}());
