import type React from 'react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { emojiToken } from './EntryText';

export interface EntryEditorHandle {
  insertEmoji: (name: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minRows?: number;
  onModEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const TOKEN_PATTERN = ':emoji:([a-z0-9._-]+):';

function tokenRegex() {
  return new RegExp(TOKEN_PATTERN, 'gi');
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlFromText(text: string) {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(tokenRegex())) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index)).replace(/\n/g, '<br>');
    const name = match[1];
    html += `<img class="entry-inline-emoji" data-emoji="${escapeHtml(name)}" src="/api/emojis/${encodeURIComponent(name)}" alt="">`;
    last = index + match[0].length;
  }
  html += escapeHtml(text.slice(last)).replace(/\n/g, '<br>');
  return html;
}

function textFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'IMG' && el.dataset.emoji) return emojiToken(el.dataset.emoji);
  if (el.tagName === 'BR') return '\n';
  let out = '';
  el.childNodes.forEach((child) => { out += textFromNode(child); });
  if (el.tagName === 'DIV' || el.tagName === 'P') out += '\n';
  return out;
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selectionInside(el: HTMLElement) {
  const sel = window.getSelection();
  return !!sel?.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer);
}

function rangeInside(el: HTMLElement, range: Range | null) {
  return !!range && el.contains(range.commonAncestorContainer);
}

function nextNode(node: Node, root: Node): Node | null {
  if (node.firstChild) return node.firstChild;
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur.nextSibling) return cur.nextSibling;
    cur = cur.parentNode;
  }
  return null;
}

function nextStartsWithWhitespace(node: Node, root: HTMLElement) {
  let cur = nextNode(node, root);
  while (cur) {
    if (cur.nodeType === Node.TEXT_NODE) {
      const text = cur.textContent || '';
      if (text.length > 0) return /\s/.test(text[0]);
    } else if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'BR') return true;
      if (el.tagName === 'IMG') return false;
    }
    cur = nextNode(cur, root);
  }
  return false;
}

const EntryEditor = forwardRef<EntryEditorHandle, Props>(function EntryEditor(
  { value, onChange, placeholder, autoFocus, minRows = 3, onModEnter, onFocus, onBlur },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el || document.activeElement === el) return;
    el.innerHTML = htmlFromText(value);
    el.dataset.value = value;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = editorRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      placeCaretAtEnd(el);
    });
  }, [autoFocus]);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    const next = textFromNode(el).replace(/\n+$/g, '');
    el.dataset.value = next;
    el.classList.toggle('empty', next.length === 0);
    onChange(next);
    rememberSelection();
  }

  function rememberSelection() {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      lastRangeRef.current = range.cloneRange();
    }
  }

  function restoreInsertionRange() {
    const el = editorRef.current;
    if (!el) return null;
    const sel = window.getSelection();
    if (document.activeElement === el && selectionInside(el) && sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      lastRangeRef.current = range.cloneRange();
      return range;
    }
    if (rangeInside(el, lastRangeRef.current)) {
      const range = lastRangeRef.current!.cloneRange();
      el.focus({ preventScroll: true });
      sel?.removeAllRanges();
      sel?.addRange(range);
      return range;
    }
    el.focus({ preventScroll: true });
    placeCaretAtEnd(el);
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    lastRangeRef.current = range.cloneRange();
    return range;
  }

  function insertEmoji(name: string) {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const range = restoreInsertionRange();
    if (!sel || !range) return;
    range.deleteContents();
    const img = document.createElement('img');
    img.className = 'entry-inline-emoji';
    img.src = `/api/emojis/${encodeURIComponent(name)}`;
    img.alt = '';
    img.dataset.emoji = name;
    img.contentEditable = 'false';
    range.insertNode(img);
    if (nextStartsWithWhitespace(img, el)) {
      range.setStartAfter(img);
    } else {
      const space = document.createTextNode(' ');
      img.after(space);
      range.setStartAfter(space);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    lastRangeRef.current = range.cloneRange();
    emit();
  }

  useImperativeHandle(ref, () => ({
    insertEmoji,
    focus: () => editorRef.current?.focus(),
  }));

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onModEnter?.();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      emit();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    emit();
  }

  return (
    <div
      ref={editorRef}
      className={`entry-editor ${value ? '' : 'empty'}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      style={{ ['--min-rows' as any]: minRows }}
      onInput={emit}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onTouchEnd={rememberSelection}
      onFocus={onFocus}
      onBlur={() => {
        rememberSelection();
        onBlur?.();
      }}
    />
  );
});

export default EntryEditor;
