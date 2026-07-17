/**
 * Shared webview JS snippets for Session Preset editors.
 * Injected into backend-specific form scripts.
 */

/** Python package regex (no whitespace/shell metacharacters). */
export const PYTHON_PACKAGE_SPEC_PATTERN_SOURCE = '^[^\\s;&|`$()]+$';

/** Spark package regex — also forbids commas (server assert alignment). */
export const SPARK_PACKAGE_SPEC_PATTERN_SOURCE = '^[^\\s,;&|`$()]+$';

/** Client-side helpers for package list rows and KV editors with optional autocomplete. */
export function formSharedScript(): string {
  return `
    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function getUsedKeysInContainer(container, exceptInput) {
      const used = new Set();
      container.querySelectorAll('.kv-key').forEach((input) => {
        if (input !== exceptInput) {
          const key = input.value.trim();
          if (key) used.add(key);
        }
      });
      return used;
    }

    function attachKeyAutocomplete(keyInput, valueInput, keyWrap, suggestions, getUsedKeys) {
      const list = document.createElement('div');
      list.className = 'kv-suggestions';
      list.hidden = true;
      keyWrap.appendChild(list);
      let activeIndex = -1;

      function hideSuggestions() {
        list.hidden = true;
        list.innerHTML = '';
        activeIndex = -1;
      }

      function getMatches() {
        const query = keyInput.value.trim().toLowerCase();
        const usedKeys = getUsedKeys(keyInput);
        return suggestions.filter((suggestion) => {
          if (usedKeys.has(suggestion.key)) return false;
          if (!query) return true;
          return suggestion.key.toLowerCase().includes(query);
        }).slice(0, 12);
      }

      function setActiveIndex(index) {
        const buttons = list.querySelectorAll('.kv-suggestion');
        buttons.forEach((button, i) => button.classList.toggle('active', i === index));
        activeIndex = index;
        const active = buttons[index];
        if (active) active.scrollIntoView({ block: 'nearest' });
      }

      function selectSuggestion(suggestion) {
        keyInput.value = suggestion.key;
        if (suggestion.value && !valueInput.value.trim()) {
          valueInput.value = suggestion.value;
        }
        hideSuggestions();
        valueInput.focus();
      }

      function renderSuggestions() {
        const matches = getMatches();
        if (matches.length === 0) {
          hideSuggestions();
          return;
        }
        list.innerHTML = '';
        matches.forEach((suggestion, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'kv-suggestion';
          button.innerHTML =
            '<span class="kv-suggestion-key">' + escapeHtml(suggestion.key) + '</span>' +
            (suggestion.value ? '<span class="kv-suggestion-value">' + escapeHtml(suggestion.value) + '</span>' : '') +
            (suggestion.description ? '<span class="kv-suggestion-desc">' + escapeHtml(suggestion.description) + '</span>' : '');
          button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            selectSuggestion(suggestion);
          });
          button.addEventListener('mouseenter', () => setActiveIndex(index));
          list.appendChild(button);
        });
        list.hidden = false;
        activeIndex = -1;
      }

      keyInput.addEventListener('focus', renderSuggestions);
      keyInput.addEventListener('input', renderSuggestions);
      keyInput.addEventListener('keydown', (event) => {
        if (list.hidden) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') renderSuggestions();
          return;
        }
        const buttons = list.querySelectorAll('.kv-suggestion');
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex(Math.min(activeIndex + 1, buttons.length - 1));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex(Math.max(activeIndex - 1, 0));
        } else if (event.key === 'Enter' && activeIndex >= 0) {
          event.preventDefault();
          const match = getMatches()[activeIndex];
          if (match) selectSuggestion(match);
        } else if (event.key === 'Escape') {
          hideSuggestions();
        }
      });
      keyInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));
    }

    function addKvRow(container, options) {
      const {
        key = '',
        value = '',
        focusKey = false,
        keyPlaceholder = 'key',
        valuePlaceholder = 'value',
        suggestions,
        getUsedKeys,
      } = options;
      const row = document.createElement('div');
      row.className = 'kv-row';
      const keyWrap = document.createElement('div');
      keyWrap.className = 'kv-key-wrap';
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'kv-key';
      keyInput.placeholder = keyPlaceholder;
      keyInput.value = key;
      keyWrap.appendChild(keyInput);
      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'kv-value';
      valueInput.placeholder = valuePlaceholder;
      valueInput.value = value;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove entry';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();
      if (suggestions && getUsedKeys) {
        attachKeyAutocomplete(keyInput, valueInput, keyWrap, suggestions, getUsedKeys);
      }
      row.appendChild(keyWrap);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      container.appendChild(row);
      if (focusKey) keyInput.focus();
    }

    function renderKvRows(container, record, addRowFn) {
      container.innerHTML = '';
      const entries = Object.entries(record || {}).sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) {
        addRowFn('', '', false);
        return;
      }
      for (const [key, value] of entries) addRowFn(key, value, false);
    }

    function readKvMap(container, duplicateLabel) {
      const rows = container.querySelectorAll('.kv-row');
      const map = {};
      const duplicates = new Set();
      for (const row of rows) {
        const key = row.querySelector('.kv-key').value.trim();
        const value = row.querySelector('.kv-value').value.trim();
        if (!key) continue;
        if (Object.prototype.hasOwnProperty.call(map, key)) duplicates.add(key);
        map[key] = value;
      }
      if (duplicates.size > 0) {
        alert('Duplicate ' + duplicateLabel + ': ' + Array.from(duplicates).join(', '));
        return null;
      }
      return map;
    }

    function addPackageRow(container, inputClass, placeholder, spec, focus) {
      const row = document.createElement('div');
      row.className = 'package-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = inputClass;
      input.placeholder = placeholder;
      input.value = spec || '';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove package';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();
      row.appendChild(input);
      row.appendChild(removeBtn);
      container.appendChild(row);
      if (focus) input.focus();
    }

    function renderPackageRows(container, packages, addRowFn) {
      container.innerHTML = '';
      for (const spec of (Array.isArray(packages) ? packages.filter(Boolean) : [])) {
        addRowFn(spec, false);
      }
    }

    function readPackageSpecs(container, inputClass, pattern, invalidLabel) {
      const rows = container.querySelectorAll('.package-row');
      const packages = [];
      const seen = new Set();
      const invalid = [];
      for (const row of rows) {
        const spec = row.querySelector('.' + inputClass).value.trim();
        if (!spec) continue;
        if (!pattern.test(spec)) { invalid.push(spec); continue; }
        if (seen.has(spec)) continue;
        seen.add(spec);
        packages.push(spec);
      }
      if (invalid.length > 0) {
        alert('Invalid ' + invalidLabel + ': ' + invalid.join(', '));
        return null;
      }
      return packages;
    }
`;
}

export function packageSectionsHtml(options?: {
  sparkHint?: string;
  pythonHint?: string;
}): string {
  const sparkHint =
    options?.sparkHint ??
    'Resolved from Maven and added to spark.jars.packages when the session starts.';
  const pythonHint =
    options?.pythonHint ??
    'Installed with pip when the session starts. Use one PyPI spec per row.';
  return `
  <section class="settings-group">
    <h2>Spark packages</h2>
    <div id="sparkPackageRows" class="package-list"></div>
    <button type="button" class="secondary" id="addSparkPackageRow">Add package</button>
    <p class="hint">${sparkHint}</p>
  </section>

  <section class="settings-group">
    <h2>Python packages</h2>
    <div id="pythonPackageRows" class="package-list"></div>
    <button type="button" class="secondary" id="addPythonPackageRow">Add package</button>
    <p class="hint">${pythonHint}</p>
  </section>`;
}

export function saveDeleteActionsHtml(): string {
  return `
  <div class="actions">
    <button type="button" id="saveBtn">Save preset</button>
    <button type="button" class="danger" id="deleteBtn">Delete preset</button>
  </div>`;
}

export function saveDeleteHandlersScript(): string {
  return `
    document.getElementById('saveBtn').onclick = () => {
      const preset = readForm();
      if (preset) vscode.postMessage({ type: 'save', preset });
    };
    document.getElementById('deleteBtn').onclick = () => {
      vscode.postMessage({ type: 'delete', id: current.id });
    };
`;
}
