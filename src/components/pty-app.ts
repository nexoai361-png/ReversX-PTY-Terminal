import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { computePosition, flip, shift, offset } from '@floating-ui/dom';
import { Terminal } from 'xterm';

declare global {
  interface Window {
    Keyboard: any;
    NativeKeyboardFix: any;
  }
}

import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { get, set, del } from 'idb-keyval';
import Pickr from '@simonwep/pickr';
import '@simonwep/pickr/dist/themes/nano.min.css';

@customElement('pty-app')
export class PtyApp extends LitElement {
  createRenderRoot() {
    return this;
  }

  // Active view tab: 'setup' | 'terminal' | 'documentation' | 'welcome'
  @state() activeTab: string = 'welcome';

  // State variables for config form
  @state() host: string = '127.0.0.1';
  @state() port: string = '8022';
  @state() user: string = 'termux';
  @state() pass: string = '';
  @state() isPasswordVisible: boolean = false;

  // Select Dropdowns active state
  @state() appFontDropdownActive: boolean = false;
  @state() fontDropdownActive: boolean = false;
  @state() themeDropdownActive: boolean = false;
  @state() animationDropdownActive: boolean = false;
  @state() cursorStyleDropdownActive: boolean = false;

  // Preferences
  @state() appFont: string = '"Segoe UI", "Tahoma", "Geneva", "Verdana", sans-serif';
  @state() appFontLabel: string = "Segoe UI (Default)";
  @state() terminalFont: string = "'JetBrains Mono', monospace";
  @state() terminalFontLabel: string = "JetBrains Mono";
  @state() terminalTheme: string = "default";
  @state() terminalThemeLabel: string = "VS Code Dark";
  @state() terminalAnimation: string = "none";
  @state() terminalAnimationLabel: string = "None";
  @state() terminalCursorStyle: string = "block";
  @state() terminalCursorStyleLabel: string = "Blinking Block";
  @state() wordWrap: boolean = true;
  @state() terminalFontSize: number = 14;
  @state() terminalCustomFg: string = '#cccccc';
  @state() terminalCustomBg: string = '#1e1e1e';
  @state() customThemes: Array<{ value: string; label: string; background: string; foreground: string; cursor: string }> = [];
  @state() macros: Array<{ id: string; name: string; command: string }> = [];
  @state() macroError: string = '';
  @state() macrosCollapsed: boolean = false;
  @state() isCommandPaletteOpen: boolean = false;
  @state() commandQuery: string = '';
  @state() recentCommandIds: string[] = [];
  
  // Loading states (5 places)
  @state() isLoading: Record<string, boolean> = {
    terminal: true,
    macros: true,
    shortcuts: true,
    palette: true,
    statusbar: true
  };

  @state() throughput: number = 0;
  @state() sessionUptime: string = '00:00:00';
  private startTime: number = Date.now();
  private lastByteCount: number = 0;
  private totalBytes: number = 0;

  @state() shortcuts: Array<{ id: string; command: string; keys: string }> = [
    { id: 'search', command: 'Search Terminal', keys: 'Ctrl+F' },
    { id: 'copy', command: 'Copy Terminal', keys: 'Ctrl+C' }
  ];

  private commands = [
    { id: 'clear', label: 'Clear terminal', action: () => this.clearTerminal(), iconClass: 'codicon codicon-clear-all', shortcut: 'Ctrl + L' },
    { id: 'wordwrap', label: 'Toggle Word Wrap', action: () => this.toggleWordWrap(), iconClass: 'codicon codicon-word-wrap' },
    { id: 'logs', label: 'Download Logs', action: () => this.downloadLogs(), iconClass: 'codicon codicon-cloud-download' },
    { id: 'settings', label: 'Go to Settings', action: () => this.setView('setup'), iconClass: 'codicon codicon-settings' }
  ];

  toggleCommandPalette() {
    this.isCommandPaletteOpen = !this.isCommandPaletteOpen;
    if (this.isCommandPaletteOpen) {
      this.commandQuery = '';
      setTimeout(() => this.querySelector('#palette-input')?.focus(), 100);
    }
  }

  executeCommand(command: any) {
    command.action();
    this.isCommandPaletteOpen = false;
    
    // Update recent commands
    let recent = this.recentCommandIds.filter(id => id !== command.id);
    recent.unshift(command.id);
    this.recentCommandIds = recent.slice(0, 3); // Store last 3
    set('ssh_recent_commands', JSON.stringify(this.recentCommandIds));
  }

  // Status & Info
  @state() status: string = 'IDLE';
  @state() statusType: string = 'default';
  @state() labelInfo: string = 'NOT CONNECTED';
  @state() dimsText: string = '-- x --';

  // Battery Status
  @state() batteryLevel: string = '--%';
  @state() batteryIcon: string = '🔋';
  @state() batteryCharging: boolean = false;

  // Search/Find Bar state
  @state() searchActive: boolean = false;
  @state() searchValue: string = '';
  @state() searchCaseSensitive: boolean = false;
  @state() searchWholeWord: boolean = false;
  @state() searchRegex: boolean = false;
  @state() showScrollToBottom: boolean = false;
  @state() latency: number | null = null;

  // Termux extra keys state
  @state() ctrlActive: boolean = false;
  @state() altActive: boolean = false;
  @state() toolbarVisible: boolean = true;
  @state() palettePopupActive: boolean = false;
  @state() paletteSearchValue: string = '';
  @state() tooltipVisible: boolean = false;
  @state() tooltipText: string = '';
  @state() tooltipX: number = 0;
  @state() tooltipY: number = 0;
  private tooltipTimer: any = null;
  private toolbarHideTimer: any;

  private term!: Terminal;
  private fitAddon!: FitAddon;
  private webLinksAddon!: WebLinksAddon;
  private searchAddon!: SearchAddon;
  private ws: WebSocket | null = null;
  private heartbeatInterval: any = null;
  private pingInterval: any = null;
  private resizeObserver!: ResizeObserver;
  private _fgPicker: any = null;
  private _bgPicker: any = null;

  // Touch gesture tracker variables
  private touchStartX: number = 0;
  private touchStartY: number = 0;
  private touchStartTime: number = 0;
  private isTwoFinger: boolean = false;
  private initialTwoFingerY: number = 0;
  private initialTwoFingerX: number = 0;
  private twoFingerTriggered: boolean = false;

  private themes: Record<string, any> = {
    'default': { background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad' },
    'monokai': { background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f2' },
    'one-dark': { background: '#282c34', foreground: '#abb2bf', cursor: '#abb2bf' },
    'solarized-dark': { background: '#002b36', foreground: '#839496', cursor: '#839496' },
    'dracula': { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2' },
    'tokyo-night': { background: '#1a1b26', foreground: '#a9b1d6', cursor: '#c0caf5' },
    'nord': { background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9' },
    'gruvbox': { background: '#282828', foreground: '#ebdbb2', cursor: '#fe8019' },
    'catppuccin': { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc' },
    'cyberpunk': { background: '#120b29', foreground: '#f0e6ff', cursor: '#00f0ff' },
    'reversx': { background: '#09090B', foreground: '#F4F4F5', cursor: '#3B82F6' },
    'reversx-midnight': { background: '#18181B', foreground: '#F4F4F5', cursor: '#3B82F6' },
    'reversx-eco': { background: '#121614', foreground: '#D1DDD5', cursor: '#10B981' },
    'reversx-sepia': { background: '#171513', foreground: '#F0ECE1', cursor: '#D97706' },
    'reversx-slate': { background: '#13171C', foreground: '#E2E8F0', cursor: '#3B82F6' },
    'black-board': { background: '#0C1021', foreground: '#F8F8F2', cursor: '#F8F8F2' },
    'zenburn': { background: '#3F3F3F', foreground: '#DCDCCC', cursor: '#DCDCCC' },
    'base16-default-dark': { background: '#181818', foreground: '#d8d8d8', cursor: '#d8d8d8' },
    'reversx-dark-plus': { background: '#1a1a1c', foreground: '#dcdcdc', cursor: '#3B82F6' }
  };

  private fontsList = [
    { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
    { value: "'Fira Code', monospace", label: "Fira Code" },
    { value: "'Source Code Pro', monospace", label: "Source Code Pro" },
    { value: "'Roboto Mono', monospace", label: "Roboto Mono" },
    { value: "'Ubuntu Mono', monospace", label: "Ubuntu Mono" },
    { value: "'Inconsolata', monospace", label: "Inconsolata" },
    { value: "'Space Mono', monospace", label: "Space Mono" },
    { value: "'Anonymous Pro', monospace", label: "Anonymous Pro" },
    { value: "'Cascadia Code', 'Consolas', monospace", label: "Cascadia Code" },
    { value: "'Consolas', 'Monaco', monospace", label: "Consolas" }
  ];

  private appFontsList = [
    { value: '"Segoe UI", "Tahoma", "Geneva", "Verdana", sans-serif', label: "Segoe UI (Default)" },
    { value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', label: "System UI" },
    { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: "Helvetica Neue" },
    { value: 'Arial, sans-serif', label: "Arial" },
    { value: '"Times New Roman", Times, serif', label: "Times New Roman" },
    { value: 'Georgia, serif', label: "Georgia" },
    { value: '"Courier New", Courier, monospace', label: "Courier New" },
    { value: '"Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", "Lucida Sans", Arial, sans-serif', label: "Trebuchet MS" },
    { value: 'sans-serif', label: "Sans Serif" },
    { value: 'serif', label: "Serif" },
    { value: 'monospace', label: "Coding / Monospace" },
    { value: '"Inter", sans-serif', label: "Inter" },
    { value: '"Roboto", sans-serif', label: "Roboto" },
    { value: '"Open Sans", sans-serif', label: "Open Sans" },
    { value: '"Lato", sans-serif', label: "Lato" },
    { value: '"Ubuntu", sans-serif', label: "Ubuntu" },
    { value: '"Cabin", sans-serif', label: "Cabin" }
  ];

  private themesList = [
    { value: "default", label: "VS Code Dark" },
    { value: "monokai", label: "Monokai" },
    { value: "one-dark", label: "One Dark" },
    { value: "solarized-dark", label: "Solarized Dark" },
    { value: "dracula", label: "Dracula" },
    { value: "tokyo-night", label: "Tokyo Night" },
    { value: "nord", label: "Nord" },
    { value: "gruvbox", label: "Gruvbox Dark" },
    { value: "catppuccin", label: "Catppuccin Mocha" },
    { value: "cyberpunk", label: "Cyberpunk" },
    { value: "reversx", label: "ReversX" },
    { value: "reversx-midnight", label: "ReversX Midnight" },
    { value: "reversx-eco", label: "ReversX Eco Green" },
    { value: "reversx-sepia", label: "ReversX Soft Sepia" },
    { value: "reversx-slate", label: "ReversX Steel Slate" },
    { value: "black-board", label: "Black Board" },
    { value: "zenburn", label: "Zenburn" },
    { value: "base16-default-dark", label: "Base16 Default Dark" },
    { value: "reversx-dark-plus", label: "ReversX Dark+" }
  ];

  get allThemesList() {
    return [
      ...this.themesList,
      ...this.customThemes
    ];
  }

  private animationsList = [
    { value: "none", label: "None" },
    { value: "fade-in", label: "Subtle Fade In" },
    { value: "pulse-glow", label: "Terminal Pulse Glow" }
  ];

  private cursorStylesList = [
    { value: "block", label: "Blinking Block" },
    { value: "block-solid", label: "Solid Block" },
    { value: "underline", label: "Blinking Underline" },
    { value: "underline-solid", label: "Solid Underline" },
    { value: "bar", label: "Blinking Bar" },
    { value: "bar-solid", label: "Solid Bar" }
  ];

  async connectedCallback() {
    super.connectedCallback();
    
    const hasVisited = await get('hasVisited');
    if (!hasVisited) {
      this.activeTab = 'welcome';
      await set('hasVisited', 'true');
    }
    
    await this.loadPreferences();
    
    // Native keyboard tweaks
    document.addEventListener('deviceready', () => {
      if (window.Keyboard) {
        if (window.Keyboard.hideFormAccessoryBar) {
          window.Keyboard.hideFormAccessoryBar(true);
        }
        if (window.Keyboard.disableScrollingInShrinkView) {
          window.Keyboard.disableScrollingInShrinkView(true);
        }
      }
      
      // Native fix for focus and suggestions
      if (window.NativeKeyboardFix) {
        window.NativeKeyboardFix.initialize(
          (msg: string) => console.log(msg),
          (err: string) => console.error(err)
        );
        window.NativeKeyboardFix.disableSuggestions(
          (msg: string) => console.log(msg),
          (err: string) => console.error(err)
        );
      }
    }, false);
    
    const recentCmds = await get('ssh_recent_commands');
    this.recentCommandIds = JSON.parse(recentCmds || '[]');
    
    this.initSwipeGestures();
    this.initBatteryIndicator();

    window.addEventListener('click', (e) => {
      if (this.palettePopupActive) {
        const path = e.composedPath();
        const popup = this.shadowRoot?.querySelector('#toolbar-popup');
        const menuBtn = this.shadowRoot?.querySelector('#menu-btn');
        if (popup && !path.includes(popup) && menuBtn && !path.includes(menuBtn)) {
          this.palettePopupActive = false;
          this.paletteSearchValue = '';
        }
      }
    });

    // Turn off loading states after 1s
    setTimeout(() => {
        this.isLoading = { terminal: false, macros: false, shortcuts: false, palette: false, statusbar: false };
    }, 1000);

    setInterval(() => {
        // Calculate throughput (KB/s)
        const bytes = this.totalBytes - this.lastByteCount;
        this.throughput = Math.max(0, bytes / 1024);
        this.lastByteCount = this.totalBytes;

        // Calculate Uptime
        const diff = Math.floor((Date.now() - this.startTime) / 1000);
        const h = Math.floor(diff / 3600).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        this.sessionUptime = `${h}:${m}:${s}`;
    }, 1000);

    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('click', this.onWindowClick);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('click', this.onWindowClick);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.ws) this.ws.close();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      this.toggleCommandPalette();
    }
    if (e.key === 'Escape' && this.isCommandPaletteOpen) {
      this.isCommandPaletteOpen = false;
    }
  };

  firstUpdated() {
    this.initTerminal();
    this.tryAttachSession();
    this.initColorPickers();
    document.documentElement.style.setProperty('--font-ui', this.appFont);
  }

  private initTerminal() {
    const terminalDiv = this.querySelector('#terminal') as HTMLElement;
    if (!terminalDiv) return;

    const cursorStyleValue = this.terminalCursorStyle || 'block';
    const isBlinking = !cursorStyleValue.endsWith('-solid');
    const cleanCursorStyle = cursorStyleValue.replace('-solid', '') as 'block' | 'underline' | 'bar';

    const baseTheme = this.themes[this.terminalTheme] || this.themes['default'];
    const customTheme = {
      ...baseTheme,
      foreground: this.terminalCustomFg,
      background: this.terminalCustomBg,
      cursor: baseTheme.cursor || this.terminalCustomFg
    };

    this.term = new Terminal({
      cursorBlink: isBlinking,
      cursorStyle: cleanCursorStyle,
      convertEol: true,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      screenReaderMode: true,
      theme: customTheme,
      fontSize: this.terminalFontSize,
      fontFamily: this.terminalFont,
      letterSpacing: 0.5,
      lineHeight: 1.2,
      scrollback: 10000
    });

    this.fitAddon = new FitAddon();
    this.webLinksAddon = new WebLinksAddon();
    this.searchAddon = new SearchAddon();

    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.webLinksAddon);
    this.term.loadAddon(this.searchAddon);

    this.term.open(terminalDiv);
    this.setupTerminalInputFix();
    this.initDraggableSearchBar();

    const viewport = terminalDiv.querySelector('.xterm-viewport') as HTMLElement;
    if (viewport) {
      viewport.addEventListener('scroll', this.handleScroll);
    }

    this.term.onResize(size => {
      if (size.cols > 0 && size.rows > 0) {
        this.dimsText = `${size.cols} x ${size.rows}`;
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
        }
      }
    });

    this.term.onData(data => {
      this.resetToolbarTimer();
      let sendData = data;

      // Handle CTRL combinations (support both single chars and potential multi-byte from IME)
      if (this.ctrlActive && data.length > 0) {
        const firstChar = data[0].toLowerCase();
        if (firstChar >= 'a' && firstChar <= 'z') {
          sendData = String.fromCharCode(firstChar.charCodeAt(0) - 96);
          // If there's more data after the first char, append it (though usually onData is single char for keyboard)
          if (data.length > 1) sendData += data.substring(1);
        } else if (firstChar === ' ') {
          sendData = '\x00';
        } else if (firstChar === '[') {
          sendData = '\x1b';
        } else if (firstChar === '\\') {
          sendData = '\x1c';
        } else if (firstChar === ']') {
          sendData = '\x1d';
        } else if (firstChar === '^') {
          sendData = '\x1e';
        } else if (firstChar === '_') {
          sendData = '\x1f';
        }
        this.ctrlActive = false;
      }

      // Handle ALT combinations
      if (this.altActive && sendData.length > 0) {
        sendData = '\x1b' + sendData;
        this.altActive = false;
      }

      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'input', data: sendData }));
      }
    });

    // Persistent textarea configuration
    this.term.onRender(() => this.configureTerminalTextarea());
    this.term.textarea?.addEventListener('focus', () => this.configureTerminalTextarea());

    if (document.fonts) {
      document.fonts.ready.then(() => {
        setTimeout(() => this.triggerManualResize(), 500);
      });
    } else {
      setTimeout(() => this.triggerManualResize(), 500);
    }

    this.term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        if (e.type === 'keydown') this.openSearch();
        return false;
      }
      if (e.altKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        if (e.type === 'keydown') this.adjustFontSize(1);
        return false;
      }
      if (e.altKey && e.key === '-') {
        e.preventDefault();
        if (e.type === 'keydown') this.adjustFontSize(-1);
        return false;
      }
      return true;
    });

    const terminalContainer = this.querySelector('#terminal-container') as HTMLElement;
    if (terminalContainer) {
      this.resizeObserver = new ResizeObserver(() => {
        this.triggerManualResize();
      });
      this.resizeObserver.observe(terminalContainer);
    }

    // Apply word wrap styling
    this.applyWordWrapToDOM();
  }

  private setupTerminalInputFix() {
    this.configureTerminalTextarea();
    
    // Set up a mutation observer to keep attributes synced if xterm.js modifies them
    if (this.term.textarea) {
      const observer = new MutationObserver(() => this.configureTerminalTextarea());
      observer.observe(this.term.textarea, { attributes: true });
    }
  }

  private configureTerminalTextarea() {
    const textarea = this.term.textarea;
    if (textarea) {
      // Disabling all native mobile assistance
      textarea.setAttribute('autocorrect', 'off');
      textarea.setAttribute('autocapitalize', 'none');
      textarea.setAttribute('spellcheck', 'false');
      textarea.setAttribute('autocomplete', 'off');
      
      // Use "email" to more aggressively disable Gboard suggestions/autocorrect
      textarea.setAttribute('inputmode', 'email');
      textarea.setAttribute('enterkeyhint', 'enter');
      
      // Ensure it's not a password field which breaks some things, 
      // but keep it as a standard text input for the IME to work
      textarea.type = 'text';
    }
  }

  private defaultMacros = [
    { id: 'm1', name: 'Update System', command: 'pkg update && pkg upgrade' },
    { id: 'm2', name: 'List Files', command: 'ls -la' },
    { id: 'm3', name: 'Sys Info', command: 'uname -a && uptime' }
  ];

  private async loadPreferences() {
    const savedMacros = await get('ssh_macros');
    if (savedMacros) {
      try {
        this.macros = JSON.parse(savedMacros);
      } catch(e) {
        this.macros = [...this.defaultMacros];
      }
    } else {
      this.macros = [...this.defaultMacros];
    }

    const savedShortcuts = await get('ssh_shortcuts');
    if (savedShortcuts) {
      try {
        this.shortcuts = JSON.parse(savedShortcuts);
      } catch(e) {
        console.error("Failed parsing shortcuts", e);
      }
    }

    const savedCustomThemes = await get('ssh_custom_themes');
    if (savedCustomThemes) {
      try {
        this.customThemes = JSON.parse(savedCustomThemes);
        this.customThemes.forEach(t => {
          this.themes[t.value] = {
            background: t.background,
            foreground: t.foreground,
            cursor: t.cursor
          };
        });
        this.updateCustomThemesStylesheet();
      } catch(e) {
        console.error("Failed parsing custom themes", e);
      }
    }

    const saved = await get('ssh_prefs');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.host) this.host = data.host;
        if (data.port) this.port = data.port;
        if (data.user) this.user = data.user;
        
        if (data.appFont) {
          this.appFont = data.appFont;
          const found = this.appFontsList.find(f => f.value === data.appFont);
          if (found) {
            this.appFontLabel = found.label;
          }
          document.documentElement.style.setProperty('--font-ui', this.appFont);
        }

        if (data.terminalFont) {
          this.terminalFont = data.terminalFont;
          const found = this.fontsList.find(f => f.value === data.terminalFont);
          if (found) this.terminalFontLabel = found.label;
        }

        if (data.terminalTheme) {
          this.terminalTheme = data.terminalTheme;
          const found = this.allThemesList.find(t => t.value === data.terminalTheme);
          if (found) {
            this.terminalThemeLabel = found.label;
            this.applyThemeToBody(data.terminalTheme);
          }
        }

        if (typeof data.wordWrap === 'boolean') {
          this.wordWrap = data.wordWrap;
        }

        if (data.terminalAnimation) {
          this.terminalAnimation = data.terminalAnimation;
          const found = this.animationsList.find(a => a.value === data.terminalAnimation);
          if (found) this.terminalAnimationLabel = found.label;
        }

        if (data.terminalCursorStyle) {
          this.terminalCursorStyle = data.terminalCursorStyle;
          const found = this.cursorStylesList.find(c => c.value === data.terminalCursorStyle);
          if (found) this.terminalCursorStyleLabel = found.label;
        }

        if (data.terminalCustomFg) {
          this.terminalCustomFg = data.terminalCustomFg;
        } else if (data.terminalTheme && this.themes[data.terminalTheme]) {
          this.terminalCustomFg = this.themes[data.terminalTheme].foreground;
        }

        if (data.terminalCustomBg) {
          this.terminalCustomBg = data.terminalCustomBg;
        } else if (data.terminalTheme && this.themes[data.terminalTheme]) {
          this.terminalCustomBg = this.themes[data.terminalTheme].background;
        }
      } catch (e) {
        console.error("Failed parsing preferences", e);
      }
    }
  }

  private applyThemeToBody(themeId: string) {
    if (themeId === 'default') {
      document.body.removeAttribute('data-theme');
    } else {
      document.body.setAttribute('data-theme', themeId);
    }
  }

  private applyWordWrapToDOM() {
    const termElem = this.querySelector('#terminal') as HTMLElement;
    if (termElem) {
      termElem.classList.toggle('no-word-wrap', !this.wordWrap);
    }
    if (this.term) {
      try {
        (this.term.options as any).wordWrap = this.wordWrap;
      } catch(e) {}
    }
  }

  private scrollToBottom = () => {
    this.term.scrollToBottom();
    const container = this.querySelector('#terminal-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  private handleScroll = (e: Event) => {
    const el = e.target as HTMLElement;
    this.showScrollToBottom = el.scrollTop + el.clientHeight < el.scrollHeight - 100;
  };

  private onWindowResize = () => {
    this.triggerManualResize();
    this.clampSearchBarPosition();
  };

  private onWindowClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.custom-select')) {
      this.appFontDropdownActive = false;
      this.fontDropdownActive = false;
      this.themeDropdownActive = false;
      this.animationDropdownActive = false;
      this.cursorStyleDropdownActive = false;
    }
  };

  private triggerManualResize = () => {
    const container = this.querySelector('#terminal-container') as HTMLElement;
    const terminalDiv = this.querySelector('#terminal') as HTMLElement;
    if (!container || !terminalDiv || !this.term) return;

    try {
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
      this.fitAddon.fit();
      if (document.activeElement?.tagName !== 'INPUT') {
        this.term?.focus?.();
      }
    } catch (e) {
      console.warn("Resize fit failed:", e);
    }
  };

  private async tryAttachSession() {
    const saved = await get('ssh_active_session');
    if (!saved) return;

    try {
      const session = JSON.parse(saved);
      if (!session.id || !session.token) return;

      if (this.term) {
        this.term.write('\x1b[36m[SYSTEM] Attempting to resume previous session...\r\n\x1b[0m');
      }
      this.updateUIStatus('RESUMING', 'connecting');
      this.setView('terminal');

      this.initWSConnection(() => {
        this.ws?.send(JSON.stringify({
          type: 'attach',
          id: session.id,
          token: session.token
        }));
      });
    } catch (e) {
      await del('ssh_active_session');
    }
  }

  private initWSConnection(onOpenCallback?: () => void) {
    if (this.ws) {
      this.ws.close();
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}`);

    this.ws.onopen = () => {
      this.updateUIStatus('WS_OPEN', 'online');
      if (onOpenCallback) onOpenCallback();

      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = setInterval(() => {
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 25000);

      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'ping', sendTime: Date.now() }));
        }
      }, 3000);

      // Trigger immediate first ping
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ping', sendTime: Date.now() }));
      }
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'data') {
          if (this.term) {
            this.term.write(msg.data);
            this.totalBytes += new TextEncoder().encode(msg.data).length;
          }
        } else if (msg.type === 'pong') {
          this.latency = Date.now() - msg.sendTime;
        } else if (msg.type === 'status') {
          this.updateUIStatus(msg.data, msg.data === 'READY' ? 'online' : 'connecting');
          if (msg.data === 'READY') {
            if (this.term) this.term.write('\x1b[32m[SYSTEM] Channel Secure. Welcome to ReversX.\r\n\x1b[0m');
          }
        } else if (msg.type === 'session_info') {
          set('ssh_active_session', JSON.stringify(msg.data));
          this.labelInfo = `${this.user}@${this.host}`;
        } else if (msg.type === 'session_expired') {
          del('ssh_active_session');
          this.setView('setup');
          alert("Session has expired or server restarted.");
        } else if (msg.type === 'error') {
          if (this.term) this.term.write(`\r\n\x1b[31m[ENGINE_ERROR] ${msg.data}\x1b[0m\r\n`);
          this.updateUIStatus('ERROR', 'error');
        } else if (msg.type === 'banner') {
          if (this.term) this.term.write(`\r\n\x1b[33m${msg.data}\x1b[0m\r\n`);
        }
      } catch (err) {
        console.error("WebSocket message parse error", err);
      }
    };

    this.ws.onclose = () => {
      this.updateUIStatus('DISCONNECTED', 'error');
      if (this.term) this.term.write('\r\n\x1b[31m[SYSTEM] Connection terminated (or tab closed).\x1b[0m\r\n');
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      this.latency = null;
    };

    this.ws.onerror = () => {
      this.updateUIStatus('WS_ERROR', 'error');
      if (this.term) this.term.write('\r\n\x1b[31m[SYSTEM] WebSocket circuit failure.\x1b[0m\r\n');
    };
  }

  private updateUIStatus(status: string, type: string = 'default') {
    this.status = status;
    this.statusType = type;
  }

  setView(view: string) {
    this.activeTab = view;
    if (view === 'terminal') {
      setTimeout(() => {
        this.triggerManualResize();
        this.term?.focus?.();
      }, 50);
    }
  }

  scrollToBottom() {
    const container = this.querySelector('#terminal-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
      this.showScrollButton = false;
    }
  }

  onTerminalScroll() {
    const container = this.querySelector('#terminal-container') as HTMLElement;
    if (container) {
      this.showScrollButton = container.scrollHeight - container.scrollTop - container.clientHeight > 100;
    }
  }

  handleFontSizeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.terminalFontSize = Number(target.value);
    if (this.term) {
      this.term.options.fontSize = this.terminalFontSize;
      requestAnimationFrame(() => {
        this.triggerManualResize();
      });
    }
  }

  togglePassword() {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  toggleAppFontDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.fontDropdownActive = false;
    this.themeDropdownActive = false;
    this.animationDropdownActive = false;
    this.cursorStyleDropdownActive = false;
    this.appFontDropdownActive = !this.appFontDropdownActive;
  }

  selectAppFontOption(value: string, label: string) {
    this.appFont = value;
    this.appFontLabel = label;
    this.appFontDropdownActive = false;
    document.documentElement.style.setProperty('--font-ui', value);
    this.savePrefs();
  }

  toggleFontDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.appFontDropdownActive = false;
    this.themeDropdownActive = false;
    this.animationDropdownActive = false;
    this.cursorStyleDropdownActive = false;
    this.fontDropdownActive = !this.fontDropdownActive;
  }

  selectFontOption(value: string, label: string) {
    this.terminalFont = value;
    this.terminalFontLabel = label;
    this.fontDropdownActive = false;

    if (this.term) {
      this.term.options.fontFamily = value;
    }
    this.triggerManualResize();
    this.savePrefs();
  }

  toggleThemeDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.appFontDropdownActive = false;
    this.fontDropdownActive = false;
    this.animationDropdownActive = false;
    this.cursorStyleDropdownActive = false;
    this.themeDropdownActive = !this.themeDropdownActive;
  }

  selectThemeOption(value: string, label: string) {
    this.terminalTheme = value;
    this.terminalThemeLabel = label;
    this.themeDropdownActive = false;

    this.applyThemeToBody(value);

    const baseTheme = this.themes[value] || this.themes['default'];
    this.terminalCustomFg = baseTheme.foreground;
    this.terminalCustomBg = baseTheme.background;

    if (this.term) {
      this.term.options.theme = {
        ...baseTheme,
        foreground: this.terminalCustomFg,
        background: this.terminalCustomBg,
        cursor: baseTheme.cursor || this.terminalCustomFg
      };
    }

    if (this._fgPicker) {
      this._fgPicker.setColor(this.terminalCustomFg, true);
    }
    if (this._bgPicker) {
      this._bgPicker.setColor(this.terminalCustomBg, true);
    }

    this.savePrefs();
  }

  initColorPickers() {
    const fgBtn = this.querySelector('#custom-fg-color-btn');
    const bgBtn = this.querySelector('#custom-bg-color-btn');

    if (fgBtn && !this._fgPicker) {
      this._fgPicker = Pickr.create({
        el: fgBtn,
        theme: 'nano',
        default: this.terminalCustomFg,
        useAsButton: true,
        components: {
          preview: true,
          opacity: false,
          hue: true,
          interaction: {
            hex: true,
            input: true,
            save: true
          }
        }
      });

      const handleColorChange = (color: any) => {
        const hex = color.toHEXA().toString().slice(0, 7);
        this.terminalCustomFg = hex;
        if (this.term) {
          const baseTheme = this.themes[this.terminalTheme] || this.themes['default'];
          this.term.options.theme = {
            ...this.term.options.theme,
            foreground: hex,
            cursor: baseTheme.cursor || hex
          };
        }
        this.savePrefs();
        this.requestUpdate();
      };

      this._fgPicker.on('change', handleColorChange);
      this._fgPicker.on('save', handleColorChange);
    }

    if (bgBtn && !this._bgPicker) {
      this._bgPicker = Pickr.create({
        el: bgBtn,
        theme: 'nano',
        default: this.terminalCustomBg,
        useAsButton: true,
        components: {
          preview: true,
          opacity: false,
          hue: true,
          interaction: {
            hex: true,
            input: true,
            save: true
          }
        }
      });

      const handleColorChange = (color: any) => {
        const hex = color.toHEXA().toString().slice(0, 7);
        this.terminalCustomBg = hex;
        if (this.term) {
          this.term.options.theme = {
            ...this.term.options.theme,
            background: hex
          };
        }
        this.savePrefs();
        this.requestUpdate();
      };

      this._bgPicker.on('change', handleColorChange);
      this._bgPicker.on('save', handleColorChange);
    }
  }

  toggleAnimationDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.appFontDropdownActive = false;
    this.fontDropdownActive = false;
    this.themeDropdownActive = false;
    this.cursorStyleDropdownActive = false;
    this.animationDropdownActive = !this.animationDropdownActive;
  }

  selectAnimationOption(value: string, label: string) {
    this.terminalAnimation = value;
    this.terminalAnimationLabel = label;
    this.animationDropdownActive = false;

    this.savePrefs();
  }

  toggleCursorStyleDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.appFontDropdownActive = false;
    this.fontDropdownActive = false;
    this.themeDropdownActive = false;
    this.animationDropdownActive = false;
    this.cursorStyleDropdownActive = !this.cursorStyleDropdownActive;
  }

  selectCursorStyleOption(value: string, label: string) {
    this.terminalCursorStyle = value;
    this.terminalCursorStyleLabel = label;
    this.cursorStyleDropdownActive = false;

    if (this.term) {
      const isBlinking = !value.endsWith('-solid');
      const cleanCursorStyle = value.replace('-solid', '') as 'block' | 'underline' | 'bar';
      this.term.options.cursorStyle = cleanCursorStyle;
      this.term.options.cursorBlink = isBlinking;
    }

    this.savePrefs();
  }

  toggleWordWrap() {
    this.wordWrap = !this.wordWrap;
    this.applyWordWrapToDOM();
    this.savePrefs();
  }

  private async savePrefs() {
    const saved = await get('ssh_prefs');
    const currentPrefs = JSON.parse(saved || '{}');
    await set('ssh_prefs', JSON.stringify({
      ...currentPrefs,
      host: this.host,
      port: this.port,
      user: this.user,
      appFont: this.appFont,
      terminalFont: this.terminalFont,
      terminalTheme: this.terminalTheme,
      terminalAnimation: this.terminalAnimation,
      terminalCursorStyle: this.terminalCursorStyle,
      terminalCustomFg: this.terminalCustomFg,
      terminalCustomBg: this.terminalCustomBg,
      wordWrap: this.wordWrap
    }));
  }

  private updateCustomThemesStylesheet() {
    let styleEl = document.getElementById('user-custom-themes-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'user-custom-themes-style';
      document.head.appendChild(styleEl);
    }

    let css = '';
    this.customThemes.forEach(theme => {
      css += `
[data-theme="${theme.value}"] {
  --bg-main: ${theme.background};
  --bg-panel: color-mix(in srgb, ${theme.background} 92%, ${theme.foreground});
  --bg-card: color-mix(in srgb, ${theme.background} 88%, ${theme.foreground});
  --bg-header: ${theme.background};
  --border: color-mix(in srgb, ${theme.background} 85%, ${theme.foreground});
  --text-normal: ${theme.foreground};
  --text-bright: ${theme.foreground};
  --text-dim: color-mix(in srgb, ${theme.foreground} 60%, ${theme.background});
  --accent: #3B82F6;
  --accent-hover: #60a5fa;
  --input-bg: color-mix(in srgb, ${theme.background} 88%, ${theme.foreground});
  --input-border: color-mix(in srgb, ${theme.background} 85%, ${theme.foreground});
  --success: #22C55E;
  --warning: #F59E0B;
  --error: #EF4444;
}
`;
    });
    styleEl.textContent = css;
  }

  async saveAsCustomTheme() {
    const nameInput = this.querySelector('#new-theme-name') as HTMLInputElement;
    if (!nameInput) return;
    const label = nameInput.value.trim();
    if (!label) {
      alert("Please enter a theme name");
      return;
    }
    const value = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    // Check if theme name already exists (standard or custom)
    if (this.themes[value] || this.themesList.some(t => t.value === value)) {
      alert("A theme with this name already exists");
      return;
    }

    const newTheme = {
      value,
      label,
      background: this.terminalCustomBg,
      foreground: this.terminalCustomFg,
      cursor: this.terminalCustomFg
    };

    this.customThemes = [...this.customThemes, newTheme];
    this.themes[value] = {
      background: newTheme.background,
      foreground: newTheme.foreground,
      cursor: newTheme.cursor
    };

    await set('ssh_custom_themes', JSON.stringify(this.customThemes));
    
    // Auto select the newly created theme
    this.selectThemeOption(value, label);
    nameInput.value = '';
    
    // Dynamically inject/update custom styles
    this.updateCustomThemesStylesheet();
    this.requestUpdate();
  }

  async deleteCustomTheme(e: Event, value: string) {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this theme?")) return;
    
    this.customThemes = this.customThemes.filter(t => t.value !== value);
    delete this.themes[value];
    await set('ssh_custom_themes', JSON.stringify(this.customThemes));
    
    if (this.terminalTheme === value) {
      this.selectThemeOption('default', 'VS Code Dark');
    }
    
    this.updateCustomThemesStylesheet();
    this.requestUpdate();
  }

  async clearBrowsingSession() {
    if (confirm("This will permanently clear your session token on this device. Your terminal session will persist. Continue?")) {
      await del('ssh_active_session');
      this.disconnectSession();
      if (this.term) {
        this.term.reset();
        this.term.write('\x1b[33m[SYSTEM] Session info cleared. Form reset.\x1b[0m\r\n');
      }
    }
  }

  async saveMacros() {
    await set('ssh_macros', JSON.stringify(this.macros));
  }

  addMacro() {
    const nameInput = this.querySelector('#new-macro-name') as HTMLInputElement;
    const cmdInput = this.querySelector('#new-macro-cmd') as HTMLInputElement;
    if (!nameInput || !cmdInput) return;

    const name = nameInput.value.trim();
    const command = cmdInput.value.trim();

    if (!name || !command) {
      this.macroError = "Please enter both macro name and command";
      return;
    }

    this.macroError = "";

    const newMacro = {
      id: 'm-' + Date.now(),
      name,
      command
    };

    this.macros = [...this.macros, newMacro];
    this.saveMacros();

    nameInput.value = '';
    cmdInput.value = '';
    this.requestUpdate();
  }

  deleteMacro(id: string) {
    this.macros = this.macros.filter(m => m.id !== id);
    this.saveMacros();
    this.requestUpdate();
  }

  moveMacro(id: string, direction: 'up' | 'down') {
    const index = this.macros.findIndex(m => m.id === id);
    if (index === -1) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= this.macros.length) return;

    const newMacros = [...this.macros];
    const temp = newMacros[index];
    newMacros[index] = newMacros[newIndex];
    newMacros[newIndex] = temp;

    this.macros = newMacros;
    this.saveMacros();
    this.requestUpdate();
  }

  restoreDefaultMacros() {
    if (confirm("Restore default macros? This will reset all macros to the original list.")) {
      this.macros = [...this.defaultMacros];
      this.saveMacros();
      this.requestUpdate();
    }
  }

  runMacro(command: string) {
    let cmd = command;
    if (!cmd.endsWith('\n') && !cmd.endsWith('\r')) {
      cmd += '\r';
    }
    this.sendCmd(cmd);
  }

  async updateShortcut(id: string, keys: string) {
    this.shortcuts = this.shortcuts.map(s => s.id === id ? { ...s, keys } : s);
    await set('ssh_shortcuts', JSON.stringify(this.shortcuts));
  }

  handleShortcutKeydown(id: string, e: KeyboardEvent) {
    e.preventDefault();
    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Shift') {
      keys.push(e.key.toUpperCase());
    }
    const shortcutString = keys.join('+');
    this.updateShortcut(id, shortcutString);
  }

  async startSession() {
    if (!this.host || !this.user) {
      alert("Please fill in Host and Username");
      return;
    }

    await this.savePrefs();
    await del('ssh_active_session');

    if (this.ws) this.ws.close();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.setView('terminal');

    this.initWSConnection(() => {
      setTimeout(() => {
        this.triggerManualResize();
        this.ws?.send(JSON.stringify({
          type: 'init',
          host: this.host,
          port: this.port,
          username: this.user,
          password: this.pass,
          rows: this.term.rows,
          cols: this.term.cols
        }));
      }, 100);
    });
  }

  disconnectSession = () => {
    if (this.ws) this.ws.close();
    this.setView('setup');
  };

  copyTerminalText = () => {
    try {
      if (this.term) {
        this.term.selectAll();
        const selection = this.term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).then(() => {
            this.term?.clearSelection?.();
          });
        } else {
          alert("Terminal buffer is empty.");
        }
      }
    } catch (e) {
      console.error("Copy failed", e);
      alert("Copy failed. Please try manual selection.");
    }
  };

  pasteTerminalText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'input', data: text }));
      }
    } catch (e) {
      console.error("Paste failed", e);
      alert("Paste blocked. Use standard terminal shortcuts (Shift+Insert or Ctrl+V).");
    }
  };

  downloadLogs = () => {
    try {
      if (!this.term) return;
      
      const buffer = this.term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }
      const text = lines.join('\n');
      
      if (!text.trim()) {
        alert("Terminal buffer is empty.");
        return;
      }
      
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `terminal_session_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to download logs", e);
      alert("Failed to download logs.");
    }
  };

  adjustFontSize(delta: number) {
    if (!this.term) return;
    const currentSize = this.term.options.fontSize || 14;
    const newSize = Math.max(8, Math.min(30, currentSize + delta));
    this.term.options.fontSize = newSize;

    requestAnimationFrame(() => {
      this.triggerManualResize();
    });
  }

  toggleImmersive = () => {
    const bar = this.querySelector('.activity-bar') as HTMLElement;
    if (!bar) return;
    bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
    const views = this.querySelectorAll('.view') as NodeListOf<HTMLElement>;
    views.forEach(v => {
      v.style.height = bar.style.display === 'none' ? '100%' : 'calc(100% - 38px)';
    });
    this.triggerManualResize();
  };

  openSearch = async () => {
    this.searchActive = true;
    await this.updateComplete;
    const input = this.querySelector('#search-input') as HTMLInputElement;
    if (input) {
      this.clampSearchBarPosition();
      input.focus?.();
      input.select?.();
    }
  };

  closeSearch = () => {
    this.searchActive = false;
    this.searchValue = '';
    this.searchAddon.findNext('', this.getSearchOptions());
    this.term?.focus?.();
  };

  private getSearchOptions(incremental = false) {
    return {
      incremental,
      caseSensitive: this.searchCaseSensitive,
      wholeWord: this.searchWholeWord,
      regex: this.searchRegex,
      decorations: {
        matchBackground: '#ea5c0055',
        matchBorder: '#ea5c00',
        activeMatchBackground: '#f6b73c',
        activeMatchBorder: '#f6b73c',
        activeMatchColor: '#000000'
      }
    };
  }

  onSearchInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.searchValue = target.value;
    if (this.searchValue) {
      this.searchAddon.findNext(this.searchValue, this.getSearchOptions(true));
    } else {
      this.searchAddon.clearSelection();
    }
  };

  onSearchKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        this.searchAddon.findPrevious(this.searchValue, this.getSearchOptions());
      } else {
        this.searchAddon.findNext(this.searchValue, this.getSearchOptions());
      }
    } else if (e.key === 'Escape') {
      this.closeSearch();
    }
  };

  searchNext = () => {
    if (this.searchValue) {
      this.searchAddon.findNext(this.searchValue, this.getSearchOptions());
    }
  };

  searchPrev = () => {
    if (this.searchValue) {
      this.searchAddon.findPrevious(this.searchValue, this.getSearchOptions());
    }
  };

  toggleSearchCaseSensitive = () => {
    this.searchCaseSensitive = !this.searchCaseSensitive;
    if (this.searchValue) this.searchAddon.findNext(this.searchValue, this.getSearchOptions(true));
  };

  toggleSearchWholeWord = () => {
    this.searchWholeWord = !this.searchWholeWord;
    if (this.searchValue) this.searchAddon.findNext(this.searchValue, this.getSearchOptions(true));
  };

  toggleSearchRegex = () => {
    this.searchRegex = !this.searchRegex;
    if (this.searchValue) this.searchAddon.findNext(this.searchValue, this.getSearchOptions(true));
  };

  private handleToolbarPointerDown(e: UIEvent, key: string) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    this.sendToolbarKey(key);
    // Immediate and repeated focus to ensure keyboard stability
    if (this.term) {
      this.term.focus();
      this.configureTerminalTextarea();
    }
    setTimeout(() => {
      if (this.term) {
        this.term.focus();
        this.configureTerminalTextarea();
        if (window.NativeKeyboardFix) {
          window.NativeKeyboardFix.disableSuggestions(() => {}, () => {});
        }
      }
    }, 10);
  }

  private handleToolbarTogglePointerDown(e: UIEvent) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    this.toolbarVisible = !this.toolbarVisible;
    if (this.term) {
      this.term.focus();
      this.configureTerminalTextarea();
    }
    setTimeout(() => {
      if (this.term) {
        this.term.focus();
        this.configureTerminalTextarea();
        if (window.NativeKeyboardFix) {
          window.NativeKeyboardFix.disableSuggestions(() => {}, () => {});
        }
      }
    }, 10);
  }

  private handleCtrlAltTogglePointerDown(e: UIEvent, type: 'ctrl' | 'alt') {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    if (type === 'ctrl') {
      this.ctrlActive = !this.ctrlActive;
    } else {
      this.altActive = !this.altActive;
    }
    if (this.term) {
      this.term.focus();
      this.configureTerminalTextarea();
    }
    setTimeout(() => {
      if (this.term) {
        this.term.focus();
        this.configureTerminalTextarea();
        if (window.NativeKeyboardFix) {
          window.NativeKeyboardFix.disableSuggestions(() => {}, () => {});
        }
      }
    }, 10);
  }

  private handleMenuPointerDown(e: UIEvent) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    this.togglePalette();
    // If we're closing, return focus to terminal
    if (this.palettePopupActive) {
      setTimeout(() => {
        const input = document.getElementById('palette-search');
        if (input) input.focus();
      }, 50);
    } else {
      if (this.term) {
        this.term.focus();
        this.configureTerminalTextarea();
      }
      setTimeout(() => {
        if (this.term) {
          this.term.focus();
          this.configureTerminalTextarea();
        }
      }, 10);
    }
  }

  sendCmd = (cmd: string) => {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'input', data: cmd }));
    }
    this.term?.focus?.();
  };

  sendToolbarKey(key: string) {
    let code = '';
    if (key === 'ESC') code = '\x1b';
    else if (key === 'TAB') code = '\t';
    else if (key === '/') code = '/';
    else if (key === '-') code = '-';
    else if (key === '|') code = '|';
    else if (key === 'HOME') code = '\x1b[H';
    else if (key === 'END') code = '\x1b[F';
    else if (key === 'UP') code = '\x1b[A';
    else if (key === 'DOWN') code = '\x1b[B';
    else if (key === 'LEFT') code = '\x1b[D';
    else if (key === 'RIGHT') code = '\x1b[C';
    else if (key === 'PGUP') code = '\x1b[5~';
    else if (key === 'PGDN') code = '\x1b[6~';

    if (this.ctrlActive && code.length === 1) {
      const char = code.toLowerCase();
      if (char >= 'a' && char <= 'z') {
        code = String.fromCharCode(char.charCodeAt(0) - 96);
      } else if (char === ' ') {
        code = '\x00';
      } else if (char === '[') {
        code = '\x1b';
      } else if (char === '\\') {
        code = '\x1c';
      } else if (char === ']') {
        code = '\x1d';
      } else if (char === '^') {
        code = '\x1e';
      } else if (char === '_') {
        code = '\x1f';
      } else if (char === '/') {
        code = '\x1f';
      }
      this.ctrlActive = false;
    } else if (this.altActive && code.length === 1) {
      code = '\x1b' + code;
      this.altActive = false;
    } else {
      this.ctrlActive = false;
      this.altActive = false;
    }

    this.sendCmd(code);
    this.resetToolbarTimer();
  }

  resetToolbarTimer() {
    this.toolbarVisible = true;
    if (this.toolbarHideTimer) clearTimeout(this.toolbarHideTimer);
    this.toolbarHideTimer = setTimeout(() => {
      this.toolbarVisible = false;
    }, 5000);
  }

  getPaletteCommands() {
    const baseCommands = [
      { label: 'Command Palette', shortcut: 'Ctrl+Shift+P', desc: 'Opens the command search menu to quickly find and run actions.', action: () => this.toggleCommandPalette() },
      { label: 'Settings', shortcut: 'Ctrl+,', desc: 'Configure terminal themes, macros, and connection preferences.', action: () => this.setView('setup') },
      { label: 'Toggle Terminal', shortcut: 'Ctrl+`', desc: 'Switch visibility of the main terminal buffer.', action: () => this.setView('terminal') },
      { label: 'Documentation', shortcut: '', desc: 'View the user manual and keyboard shortcut guide.', action: () => this.setView('documentation') },
      { label: 'File Explorer', shortcut: 'Ctrl+Shift+E', desc: 'Browse and manage files in the current workspace.', action: () => {} },
      { label: 'Source Control', shortcut: 'Ctrl+Shift+G', desc: 'Manage git repositories and track changes.', action: () => {} },
      { label: 'Run and Debug', shortcut: 'Ctrl+Shift+D', desc: 'Launch and debug applications in the terminal.', action: () => {} },
      { label: 'Clear Console (Ctrl+L)', shortcut: '', desc: 'Clears the current terminal display buffer.', action: () => this.sendSpecial('CTRL_L') },
      { label: 'Interrupt Process (Ctrl+C)', shortcut: '', desc: 'Sends SIGINT to the active process to stop it.', action: () => this.sendSpecial('CTRL_C') },
      
      // Relocated from top toolbar
      { label: 'Copy Terminal Buffer', shortcut: '', desc: 'Copies the entire scrollback history to clipboard.', action: () => this.copyTerminalText() },
      { label: 'Paste from Clipboard', shortcut: '', desc: 'Inserts text from your device clipboard into terminal.', action: () => this.pasteTerminalText() },
      { label: 'Decrease Font Size', shortcut: 'Alt+-', desc: 'Makes the terminal text smaller for more density.', action: () => this.adjustFontSize(-1) },
      { label: 'Increase Font Size', shortcut: 'Alt++', desc: 'Makes the terminal text larger for better readability.', action: () => this.adjustFontSize(1) },
      { label: 'Refit Layout', shortcut: '', desc: 'Recalculates terminal dimensions to fit window exactly.', action: () => this.triggerManualResize() },
      { label: 'Toggle Fullscreen', shortcut: '', desc: 'Enables immersive mode to hide browser address bars.', action: () => this.toggleImmersive() },
      { label: 'Find in Terminal', shortcut: 'Ctrl+F', desc: 'Search for text patterns within the terminal buffer.', action: () => this.openSearch() },
      { label: 'Download Logs', shortcut: '', desc: 'Saves current session output as a .txt file.', action: () => this.downloadLogs() },
      { label: 'Send Escape Key', shortcut: '', desc: 'Sends the physical ESC key sequence to the host.', action: () => this.sendCmd('\x1b') },
      { label: 'Send Tab Key', shortcut: '', desc: 'Sends a TAB character for command completion.', action: () => this.sendCmd('\t') },
      { label: 'Show System Information', shortcut: '', desc: 'Displays server kernel version and uptime info.', action: () => this.sendCmd('uname -a && uptime\r') },
      { label: 'Exit Session', shortcut: '', desc: 'Closes the current SSH connection and logs out.', action: () => this.disconnectSession() },
    ];

    const macroCommands = this.macros.map(m => ({
      label: `Macro: ${m.name}`,
      shortcut: '',
      desc: `Executes pre-defined command: ${m.command}`,
      action: () => this.runMacro(m.command)
    }));

    return [...baseCommands, ...macroCommands];
  }

  togglePalette() {
    this.palettePopupActive = !this.palettePopupActive;
    this.tooltipVisible = false;
    if (this.palettePopupActive) {
      setTimeout(() => {
        const input = this.shadowRoot?.querySelector('#palette-search') as HTMLInputElement;
        input?.focus();
      }, 50);
    } else {
      this.paletteSearchValue = '';
      setTimeout(() => {
        this.term?.focus();
        this.configureTerminalTextarea();
      }, 50);
    }
  }

  onPaletteSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.paletteSearchValue = target.value;
  }

  getFilteredPaletteCommands() {
    const filter = this.paletteSearchValue.toLowerCase();
    return this.getPaletteCommands().filter(cmd => 
      cmd.label.toLowerCase().includes(filter) || 
      cmd.shortcut.toLowerCase().includes(filter)
    );
  }

  handlePaletteCommand(action: Function) {
    const isSearch = action.toString().includes('openSearch') || action.toString().includes('Search');
    action();
    this.palettePopupActive = false;
    this.paletteSearchValue = '';
    this.handleItemPointerUp();
    
    if (!isSearch) {
      if (this.term) {
        this.term.focus();
        this.configureTerminalTextarea();
      }
      setTimeout(() => {
        if (this.term) {
          this.term.focus();
          this.configureTerminalTextarea();
        }
      }, 50);
    }
  }

  isAndroid() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
  }

  handleItemPointerDown(e: PointerEvent, label: string, desc: string) {
    if (this.tooltipTimer) clearTimeout(this.tooltipTimer);
    
    // Capture necessary context before the timeout
    const target = e.currentTarget as HTMLElement;
    const fallbackX = e.clientX;
    const fallbackY = e.clientY - 60;

    this.tooltipTimer = setTimeout(async () => {
      this.tooltipText = desc || `Command: ${label}. Tap to execute or click × to dismiss.`;
      
      // Start with a reasonable fallback position near the touch point
      // to avoid the "off-screen" flash if positioning takes a moment
      this.tooltipX = Math.max(10, Math.min(fallbackX - 100, window.innerWidth - 250));
      this.tooltipY = Math.max(10, fallbackY);
      
      this.tooltipVisible = true;
      
      // Wait for rendering to complete so we can measure the tooltip
      await this.updateComplete;
      
      const tooltip = this.shadowRoot?.querySelector('.vscode-tooltip') as HTMLElement;
      if (tooltip && target) {
        try {
          const {x, y} = await computePosition(target, tooltip, {
            placement: 'top',
            strategy: 'fixed',
            middleware: [
              offset(12),
              flip(),
              shift({padding: 10})
            ],
          });
          
          this.tooltipX = x;
          this.tooltipY = y;
          this.requestUpdate();
        } catch (err) {
          console.warn('Floating UI failed, using fallback:', err);
        }
      }
    }, 900);
  }

  handleItemPointerUp() {
    if (this.tooltipTimer) clearTimeout(this.tooltipTimer);
    if (!this.isAndroid()) {
      this.tooltipVisible = false;
    }
  }

  closeTooltip(e: Event) {
    e.stopPropagation();
    this.tooltipVisible = false;
  }

  sendSpecial(key: string) {
    const keys: Record<string, string> = {
      'CTRL_C': '\x03',
      'CTRL_L': '\x0c',
      'CTRL_Z': '\x1a',
      'CTRL_D': '\x04'
    };
    if (keys[key]) {
      this.sendCmd(keys[key]);
      if (key === 'CTRL_L') {
        this.term?.clear?.();
      }
    }
  }

  private clampSearchBarPosition() {
    const bar = this.querySelector('#search-bar') as HTMLElement;
    if (!bar || bar.style.left === '' || bar.style.left === 'auto') return;
    const container = this.querySelector('#terminal-container') as HTMLElement;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();

    let currentLeft = parseFloat(bar.style.left) || 0;
    let currentTop = parseFloat(bar.style.top) || 0;

    const maxLeft = Math.max(0, containerRect.width - barRect.width);
    const maxTop = Math.max(0, containerRect.height - barRect.height);

    let clampedLeft = Math.max(0, Math.min(currentLeft, maxLeft));
    let clampedTop = Math.max(0, Math.min(currentTop, maxTop));

    bar.style.left = clampedLeft + 'px';
    bar.style.top = clampedTop + 'px';
  }

  private initDraggableSearchBar() {
    const bar = this.querySelector('#search-bar') as HTMLElement;
    if (!bar) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;

      isDragging = true;
      const container = this.querySelector('#terminal-container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();

      initialLeft = barRect.left - containerRect.left;
      initialTop = barRect.top - containerRect.top;

      startX = e.clientX;
      startY = e.clientY;

      bar.style.right = 'auto';
      bar.style.left = initialLeft + 'px';
      bar.style.top = initialTop + 'px';

      if (target.setPointerCapture) {
        try { target.setPointerCapture(e.pointerId); } catch(err) {}
      }

      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;

      const container = this.querySelector('#terminal-container') as HTMLElement;
      const containerRect = container.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = initialLeft + deltaX;
      let newTop = initialTop + deltaY;

      const maxLeft = Math.max(0, containerRect.width - barRect.width);
      const maxTop = Math.max(0, containerRect.height - barRect.height);

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      bar.style.left = newLeft + 'px';
      bar.style.top = newTop + 'px';
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      const target = e.target as HTMLElement;
      if (target && target.releasePointerCapture) {
        try { target.releasePointerCapture(e.pointerId); } catch(err) {}
      }
    };

    bar.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove as any);
    window.addEventListener('pointerup', onPointerUp as any);
    window.addEventListener('pointercancel', onPointerUp as any);
  }

  private initBatteryIndicator() {
    const nav = navigator as any;
    if (nav && 'getBattery' in nav) {
      nav.getBattery().then((battery: any) => {
        const updateBattery = () => {
          const levelPct = Math.round(battery.level * 100);
          this.batteryLevel = `${levelPct}%`;
          this.batteryCharging = battery.charging;
          
          let icon = '🔋';
          if (battery.charging) {
            icon = '⚡';
          } else if (levelPct <= 15) {
            icon = '🪫';
          }
          this.batteryIcon = icon;
        };

        updateBattery();

        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
      }).catch(() => {
        // Silent catch
      });
    }
  }

  private initSwipeGestures() {
    const tabsList = ['setup', 'terminal', 'documentation'];

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, button, select, textarea, #search-bar, .custom-select')) {
        return;
      }

      if (e.touches.length === 2) {
        this.isTwoFinger = true;
        this.twoFingerTriggered = false;
        this.initialTwoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.initialTwoFingerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      } else if (e.touches.length === 1) {
        this.isTwoFinger = false;
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
        this.touchStartTime = Date.now();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (this.isTwoFinger && e.touches.length === 2 && !this.twoFingerTriggered) {
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const deltaY = currentY - this.initialTwoFingerY;
        const deltaX = currentX - this.initialTwoFingerX;

        if (deltaY > 40 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
          this.twoFingerTriggered = true;
          const statusBar = this.querySelector('.status-bar') as HTMLElement;
          if (statusBar) {
            statusBar.style.display = 'flex';
            this.triggerManualResize();
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (this.isTwoFinger) {
        this.isTwoFinger = false;
        return;
      }

      if (!e.changedTouches || e.changedTouches.length !== 1) return;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const duration = Date.now() - this.touchStartTime;

      const deltaX = touchEndX - this.touchStartX;
      const deltaY = touchEndY - this.touchStartY;

      if (duration < 600 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
        const currentIndex = tabsList.indexOf(this.activeTab);

        if (deltaX < -50) {
          if (currentIndex < tabsList.length - 1) {
            this.setView(tabsList[currentIndex + 1]);
          }
        } else if (deltaX > 50) {
          if (currentIndex > 0) {
            this.setView(tabsList[currentIndex - 1]);
          }
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  private getAnimationClass() {
    if (this.terminalAnimation === 'fade-in') {
      return 'anim-fade-in';
    }
    if (this.terminalAnimation === 'pulse-glow') {
      return 'anim-pulse-glow';
    }
    return '';
  }

  private getBatteryStyle() {
    if (this.batteryCharging) {
      return 'color: #4caf50;';
    }
    const val = parseInt(this.batteryLevel);
    if (!isNaN(val) && val <= 15) {
      return 'color: #f44336;';
    }
    return 'color: rgba(255,255,255,0.85);';
  }

  render() {
    return html`
      <div class="activity-bar">
        <div class="tab ${this.activeTab === 'welcome' ? 'active' : ''}" @click="${() => this.setView('welcome')}">Welcome</div>
        <div class="tab ${this.activeTab === 'setup' ? 'active' : ''}" @click="${() => this.setView('setup')}">Config</div>
        <div class="tab ${this.activeTab === 'terminal' ? 'active' : ''}" @click="${() => this.setView('terminal')}">Terminal</div>
        <div class="tab ${this.activeTab === 'documentation' ? 'active' : ''}" @click="${() => this.setView('documentation')}">Documentation</div>
      </div>

      <!-- Welcome View -->
      <div id="welcome-view" class="view ${this.activeTab === 'welcome' ? 'active' : ''}">
        <div class="welcome-pane">
          <h1>Welcome to ReversX PTY Terminal</h1>
          <div class="welcome-grid">
            <div class="welcome-section">
              <h3>Start</h3>
              <div class="welcome-actions">
                <button style="font-family: 'Lato', sans-serif;" @click="${() => this.setView('setup')}">Configure Connection</button>
                <button style="font-family: 'Lato', sans-serif;" @click="${() => this.setView('terminal')}">Open Terminal</button>
              </div>
            </div>
            <div class="welcome-section">
              <h3>Tips</h3>
              <p>Scroll to navigate the terminal view.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Setup View -->
      <div id="setup-view" class="view ${this.activeTab === 'setup' ? 'active' : ''}">
        <div class="setup-pane">
          <div class="setup-form">
            <h2>Settings</h2>
            
            <div class="field">
              <label>Host</label>
              <div class="description">The hostname or IP address of the terminal server.</div>
              <input type="text" id="host" .value="${this.host}" @input="${(e: any) => this.host = e.target.value}" data-tooltip="Enter terminal server host or IP">
            </div>

            <div class="field">
              <label>Port</label>
              <div class="description">The communication port for connection (default is 8022 for Termux).</div>
              <input type="number" id="port" .value="${this.port}" @input="${(e: any) => this.port = e.target.value}" data-tooltip="Enter connection port (default 8022)">
            </div>

            <div class="field">
              <label>Username</label>
              <div class="description">The account name used for authentication.</div>
              <input type="text" id="user" .value="${this.user}" @input="${(e: any) => this.user = e.target.value}" data-tooltip="Enter username">
            </div>

            <div class="field">
              <label>Password</label>
              <div class="description">The password for the user account.</div>
              <div class="field-password">
                <input type="${this.isPasswordVisible ? 'text' : 'password'}" id="pass" placeholder="Password content" .value="${this.pass}" @input="${(e: any) => this.pass = e.target.value}" data-tooltip="Enter password">
                <button type="button" class="toggle-password" @click="${this.togglePassword}" title="Toggle Password" aria-label="Toggle Password">
                  ${this.isPasswordVisible ? html`
                    <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ` : html`
                    <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  `}
                </button>
              </div>
            </div>

            <div class="field">
              <label>App Font</label>
              <div class="description">Select the font family for the application UI.</div>
              <div class="custom-select" id="app-font-custom-select" data-tooltip="Select application font">
                <div class="select-trigger" style="font-family: ${this.appFont}" @click="${this.toggleAppFontDropdown}">${this.appFontLabel}</div>
                <div class="select-options ${this.appFontDropdownActive ? 'active' : ''}" id="app-font-options-list">
                  ${this.appFontsList.map(font => html`
                    <div class="select-option ${this.appFont === font.value ? 'selected' : ''}" style="font-family: ${font.value}" @click="${() => this.selectAppFontOption(font.value, font.label)}">${font.label}</div>
                  `)}
                </div>
              </div>
            </div>

            <div class="field">
              <label>Terminal Font</label>
              <div class="description">Select your preferred terminal font family.</div>
              <div class="custom-select" id="font-custom-select" data-tooltip="Select terminal font">
                <div class="select-trigger" style="font-family: ${this.terminalFont}" @click="${this.toggleFontDropdown}">${this.terminalFontLabel}</div>
                <div class="select-options ${this.fontDropdownActive ? 'active' : ''}" id="font-options-list">
                  ${this.fontsList.map(font => html`
                    <div class="select-option ${this.terminalFont === font.value ? 'selected' : ''}" style="font-family: ${font.value}" @click="${() => this.selectFontOption(font.value, font.label)}">${font.label}</div>
                  `)}
                </div>
              </div>
            </div>

            <div class="field">
              <label>Terminal Font Size (${this.terminalFontSize}px)</label>
              <div class="description">Smoothly adjust the terminal font size.</div>
              <input type="range" min="10" max="30" step="1" .value="${this.terminalFontSize}" @input="${this.handleFontSizeChange}" data-tooltip="Adjust terminal font size">
            </div>

            <div class="field">
              <label>Terminal Theme</label>
              <div class="description">Choose a visual theme for the terminal and interface.</div>
              <div class="custom-select" id="theme-custom-select" data-tooltip="Select terminal theme">
                <div class="select-trigger" @click="${this.toggleThemeDropdown}">${this.terminalThemeLabel}</div>
                <div class="select-options ${this.themeDropdownActive ? 'active' : ''}" id="theme-options-list">
                  ${this.allThemesList.map(theme => html`
                    <div class="select-option ${this.terminalTheme === theme.value ? 'selected' : ''}" @click="${() => this.selectThemeOption(theme.value, theme.label)}" style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px;">
                      <span>${theme.label}</span>
                      ${theme.value.startsWith('custom-') ? html`
                        <span @click="${(e: Event) => this.deleteCustomTheme(e, theme.value)}" style="color: var(--error, #EF4444); font-size: 14px; line-height: 1; padding: 4px 8px; cursor: pointer; transition: opacity 0.15s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">✕</span>
                      ` : ''}
                    </div>
                  `)}
                </div>
              </div>
            </div>

            <div class="field">
              <label data-tooltip="Configure custom keybindings">Keyboard Shortcuts</label>
              <div class="description">Configure your custom keyboard shortcuts.</div>
              <div class="shortcuts-list ${this.isLoading.shortcuts ? 'skeleton' : ''}">
                ${this.shortcuts.map(shortcut => html`
                  <div class="shortcut-item">
                    <span class="shortcut-command">${shortcut.command}</span>
                    <input type="text" .value="${shortcut.keys}" placeholder="Press keys..." @keydown="${(e: KeyboardEvent) => this.handleShortcutKeydown(shortcut.id, e)}" readonly>
                  </div>
                `)}
              </div>
            </div>

            <div class="field">
              <label>Custom Colors</label>
              <div class="description">Select custom primary colors and optionally save them as a custom theme.</div>
              <div style="display: flex; gap: 16px; align-items: center; margin-top: 8px;">
                <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
                  <span style="font-size: 11px; opacity: 0.8; font-weight: 500;">Foreground</span>
                  <div id="custom-fg-color-btn" style="display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--input-border, #3a3d41); border-radius: 0; background: var(--input-bg, #1e1e1e); cursor: pointer; color: var(--text-bright); font-size: 13px; font-family: var(--font-code, monospace); transition: background 0.15s, border-color 0.15s;">
                    <div style="width: 14px; height: 14px; border-radius: 0; background: ${this.terminalCustomFg}; border: 1px solid rgba(255,255,255,0.25);"></div>
                    <span style="flex: 1; text-transform: uppercase;">${this.terminalCustomFg}</span>
                  </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
                  <span style="font-size: 11px; opacity: 0.8; font-weight: 500;">Background</span>
                  <div id="custom-bg-color-btn" style="display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--input-border, #3a3d41); border-radius: 0; background: var(--input-bg, #1e1e1e); cursor: pointer; color: var(--text-bright); font-size: 13px; font-family: var(--font-code, monospace); transition: background 0.15s, border-color 0.15s;">
                    <div style="width: 14px; height: 14px; border-radius: 0; background: ${this.terminalCustomBg}; border: 1px solid rgba(255,255,255,0.25);"></div>
                    <span style="flex: 1; text-transform: uppercase;">${this.terminalCustomBg}</span>
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 8px; margin-top: 12px; align-items: center; width: 100%;">
                <input type="text" id="new-theme-name" placeholder="Theme Name (e.g., My Retro)" style="flex: 1; height: 36px; padding: 0 12px; border: 1px solid var(--input-border, #3a3d41); border-radius: 0; background: var(--input-bg, #1e1e1e); color: var(--text-bright); font-size: 13px; font-family: inherit; box-sizing: border-box;" />
                <button type="button" class="action-btn" style="height: 36px; padding: 0 16px; font-size: 12px; margin: 0; background: var(--accent); white-space: nowrap; border: none; border-radius: 0; cursor: pointer; color: #ffffff; font-weight: 500;" @click="${this.saveAsCustomTheme}">Save Theme</button>
              </div>
            </div>

            <div class="field">
              <label>Terminal Animation</label>
              <div class="description">Select an animation style for the terminal interface.</div>
              <div class="custom-select" id="animation-custom-select">
                <div class="select-trigger" @click="${this.toggleAnimationDropdown}">${this.terminalAnimationLabel}</div>
                <div class="select-options ${this.animationDropdownActive ? 'active' : ''}" id="animation-options-list">
                  ${this.animationsList.map(anim => html`
                    <div class="select-option ${this.terminalAnimation === anim.value ? 'selected' : ''}" @click="${() => this.selectAnimationOption(anim.value, anim.label)}">${anim.label}</div>
                  `)}
                </div>
              </div>
            </div>

            <div class="field">
              <label>Terminal Cursor Style</label>
              <div class="description">Choose a cursor style for the terminal.</div>
              <div class="custom-select" id="cursor-style-custom-select">
                <div class="select-trigger" @click="${this.toggleCursorStyleDropdown}">${this.terminalCursorStyleLabel}</div>
                <div class="select-options ${this.cursorStyleDropdownActive ? 'active' : ''}" id="cursor-style-options-list">
                  ${this.cursorStylesList.map(cursorStyle => html`
                    <div class="select-option ${this.terminalCursorStyle === cursorStyle.value ? 'selected' : ''}" @click="${() => this.selectCursorStyleOption(cursorStyle.value, cursorStyle.label)}">${cursorStyle.label}</div>
                  `)}
                </div>
              </div>
            </div>

            <div class="field">
              <label>Word Wrap</label>
              <div class="description">Toggle automatic line wrapping for long terminal text.</div>
              <button type="button" class="action-btn" style="background: ${this.wordWrap ? 'var(--accent)' : '#3a3d41'}" id="word-wrap-btn" @click="${this.toggleWordWrap}">Word Wrap: ${this.wordWrap ? 'ON' : 'OFF'}</button>
            </div>

            <div class="field ${this.isLoading.macros ? 'skeleton' : ''}" style="border-top: 1px solid var(--border); padding-top: 20px; margin-top: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <label style="margin: 0;">Macros</label>
                  <div class="macro-tooltip-wrapper">
                    <span style="display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; background: var(--bg-panel, #252526); border: 1px solid var(--border); font-size: 10px; color: var(--text-dim); cursor: help; font-weight: bold;">?</span>
                    <div class="macro-tooltip-content">
                      Macros are custom command shortcuts. Once defined, they appear as handy one-tap buttons on your terminal quick toolbar so you can execute complex commands instantly.
                    </div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <button type="button" @click="${() => this.macrosCollapsed = !this.macrosCollapsed}" style="background: var(--bg-card, #252526); border: 1px solid var(--border); color: var(--text-bright); font-size: 11px; font-family: var(--font-code, 'JetBrains Mono', monospace); cursor: pointer; padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500;">
                    <span>${this.macrosCollapsed ? '▶' : '▼'}</span>
                  </button>
                </div>
              </div>
              <div class="description" style="margin-bottom: 12px;">Define custom shell command aliases to run with a single tap from the Terminal toolbar. Drag-free sorting and inline run controls.</div>
              
              ${!this.macrosCollapsed ? html`
                <div class="macros-expanded-box" style="display: flex; flex-direction: column;">
                  <div style="border: 1px solid var(--border); background: var(--bg-panel); overflow: hidden;">
                    <!-- Headers -->
                    <div style="display: flex; border-bottom: 1px solid var(--border); background: var(--bg-header);">
                      <div style="flex: 1; padding: 6px 12px; font-size: 11px; font-weight: 600; color: var(--text-dim);">Item</div>
                      <div style="flex: 2; padding: 6px 12px; font-size: 11px; font-weight: 600; color: var(--text-dim); border-left: 1px solid var(--border);">Value</div>
                    </div>
                    
                    <!-- Existing Macros List -->
                    ${this.macros.length > 0 ? this.macros.map((m, idx) => html`
                      <div style="display: flex; border-bottom: 1px solid var(--border); align-items: stretch; background: var(--bg-main);">
                        <div style="flex: 1; padding: 6px 12px; font-size: 13px; color: var(--text-bright); display: flex; align-items: center;">${m.name}</div>
                        <div style="flex: 2; padding: 6px 12px; font-size: 13px; color: var(--text-bright); border-left: 1px solid var(--border); font-family: var(--font-code, monospace); display: flex; align-items: center; justify-content: space-between;">
                          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${m.command}</span>
                          <div style="display: flex; gap: 2px;">
                            <button type="button" @click="${() => this.runMacro(m.command)}" title="Test Run Macro" style="background: none; border: none; color: var(--text-bright); cursor: pointer; padding: 4px; font-size: 12px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='none'">▶</button>
                            <button type="button" @click="${() => this.moveMacro(m.id, 'up')}" ?disabled="${idx === 0}" title="Move Up" style="background: none; border: none; color: ${idx === 0 ? 'var(--border)' : 'var(--text-bright)'}; cursor: ${idx === 0 ? 'default' : 'pointer'}; padding: 4px; font-size: 12px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px;" onmouseover="if(${idx !== 0}) this.style.background='var(--border)'" onmouseout="this.style.background='none'">↑</button>
                            <button type="button" @click="${() => this.moveMacro(m.id, 'down')}" ?disabled="${idx === this.macros.length - 1}" title="Move Down" style="background: none; border: none; color: ${idx === this.macros.length - 1 ? 'var(--border)' : 'var(--text-bright)'}; cursor: ${idx === this.macros.length - 1 ? 'default' : 'pointer'}; padding: 4px; font-size: 12px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px;" onmouseover="if(${idx !== this.macros.length - 1}) this.style.background='var(--border)'" onmouseout="this.style.background='none'">↓</button>
                            <button type="button" @click="${() => this.deleteMacro(m.id)}" title="Delete" style="background: none; border: none; color: var(--text-bright); cursor: pointer; padding: 4px; font-size: 12px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='none'">✕</button>
                          </div>
                        </div>
                      </div>
                    `) : html`
                      <div style="padding: 12px; font-size: 12px; color: var(--text-dim); text-align: center; border-bottom: 1px solid var(--border); background: var(--bg-main);">No custom macros defined.</div>
                    `}

                    <!-- Add New Macro Form -->
                    <div style="display: flex; align-items: center; background: var(--bg-main); padding: 8px;">
                      <div style="display: flex; gap: 8px; width: 100%;">
                        <input type="text" id="new-macro-name" placeholder="Item" @keydown="${(e: KeyboardEvent) => e.key === 'Enter' && this.addMacro()}" style="flex: 1; height: 26px; padding: 0 8px; border: 1px solid var(--input-border, #3a3d41); background: var(--input-bg, #1e1e1e); color: var(--text-bright); font-size: 13px; font-family: inherit; box-sizing: border-box; outline: none; border-radius: 0;" />
                        <input type="text" id="new-macro-cmd" placeholder="Value" @keydown="${(e: KeyboardEvent) => e.key === 'Enter' && this.addMacro()}" style="flex: 2; height: 26px; padding: 0 8px; border: 1px solid var(--input-border, #3a3d41); background: var(--input-bg, #1e1e1e); color: var(--text-bright); font-size: 13px; font-family: var(--font-code, monospace); box-sizing: border-box; outline: none; border-radius: 0;" />
                        <button type="button" style="height: 26px; padding: 0 12px; font-size: 12px; background: var(--accent); border: none; color: #ffffff; cursor: pointer; border-radius: 0;" @click="${this.addMacro}">Add Item</button>
                      </div>
                    </div>
                  </div>
                  
                  ${this.macroError ? html`<div style="color: var(--error, #EF4444); font-size: 12px; font-weight: 500; margin-top: 8px;">${this.macroError}</div>` : ''}
                </div>
              ` : ''}
            </div>

            <div class="kb-help">
              <h3>Pro Shortcuts</h3>
              <div class="kb-row"><span class="kb-action">Open Find Bar</span><span class="kb-key">Ctrl + F</span></div>
              <div class="kb-row"><span class="kb-action">Clear Terminal</span><span class="kb-key">Ctrl + L</span></div>
              <div class="kb-row"><span class="kb-action">Interrupt Process</span><span class="kb-key">Ctrl + C</span></div>
              <div class="kb-row"><span class="kb-action">Decrease Font</span><span class="kb-key">Alt + [-]</span></div>
              <div class="kb-row"><span class="kb-action">Increase Font</span><span class="kb-key">Alt + [+]</span></div>
            </div>

            <div class="field">
              <label>Session: Management</label>
              <div class="description">Clear local session data if you encounter connection issues.</div>
              <button class="action-btn secondary" @click="${this.clearBrowsingSession}">Reset Local Link</button>
            </div>

            <div style="margin-top: 40px;">
              <button class="action-btn" style="border-radius: 8px; font-family: var(--font-code, 'JetBrains Mono', monospace);" @click="${this.startSession}">Connect Session</button>
            </div>

            <div class="guide">
              <b>Performance Tip:</b> To ensure work persists even after disconnection, use <b>tmux</b> or <b>screen</b> on your server. <br><br>
              <b>Auto-Resume:</b> We save your session token locally. If you refresh or close the tab, we will try to reconnect automatically!
            </div>
          </div>
        </div>
      </div>

      <!-- Documentation View -->
      <div id="doc-view" class="view ${this.activeTab === 'documentation' ? 'active' : ''}">
        <div class="setup-pane">
          <div class="setup-form" style="max-width: 800px;">
            <h2>Documentation & Android Guide</h2>
            
            <div class="doc-card">
              <div class="doc-badge">ANDROID OPTIMIZATION</div>
              <h3>How to Save PTY Terminal from Auto-Kill</h3>
              <p class="description" style="font-size: 13px; color: var(--text-normal); margin-bottom: 16px;">
                Android OS aggressively terminates background apps, web browser processes, and PTY/Termux sessions to free memory or save battery. Follow these step-by-step solutions to prevent Android from killing your terminal session:
              </p>

              <div class="doc-step">
                <div class="doc-step-num">1</div>
                <div>
                  <strong>Disable Battery Optimization (Unrestricted Battery)</strong>
                  <p class="description">Go to <code>Android Settings &gt; Apps &gt; Chrome / Browser</code> &gt; <code>Battery</code> &gt; select <strong>Unrestricted</strong> (or "Don't optimize"). This prevents the OS from suspending background socket connections when switching tabs or turning off the screen.</p>
                </div>
              </div>

              <div class="doc-step">
                <div class="doc-step-num">2</div>
                <div>
                  <strong>Lock App in Recent Apps Switcher</strong>
                  <p class="description">Open Android's Recent Apps / Overview screen, tap or long-press the browser icon on top of the preview card, and select <strong>Lock</strong> or <strong>Keep open</strong>. This protects the process from Android's RAM cleaner.</p>
                </div>
              </div>

              <div class="doc-step">
                <div class="doc-step-num">3</div>
                <div>
                  <strong>Termux Background Wake Lock (If Hosting locally on Termux)</strong>
                  <p class="description">If running your SSH host on Termux, execute <code>termux-wake-lock</code> in Termux shell, or tap <strong>Acquire Wake-Lock</strong> from the Termux notification bar. This keeps CPU awake during background execution.</p>
                </div>
              </div>

              <div class="doc-step">
                <div class="doc-step-num">4</div>
                <div>
                  <strong>Disable Android 12/13+ Phantom Process Killer</strong>
                  <p class="description">On Android 12/13+, Android kills child processes that consume excess CPU. Disable this restriction via ADB: <br>
                  <code>adb shell device_config put activity_manager max_phantom_processes 2147483647</code> or turn off "Child process restrictions" in Android Developer Options.</p>
                </div>
              </div>

              <div class="doc-step">
                <div class="doc-step-num">5</div>
                <div>
                  <strong>Always Use Tmux or Screen for Zero-Data-Loss Persistence</strong>
                  <p class="description">Launch <code>tmux</code> or <code>screen</code> on your server or Termux. Even if your phone loses cellular signal or Android kills the web browser tab, your remote terminal commands, build processes, and scripts keep running in background without interruption.</p>
                </div>
              </div>
            </div>

            <div class="doc-card">
              <div class="doc-badge" style="background: #e65100;">PRO TIPS</div>
              <h3>Terminal Productivity</h3>
              <p class="description" style="font-size: 13px; color: var(--text-normal); margin-bottom: 16px;">
                Enhance your workflow with these tips:
              </p>
              <div class="doc-step">
                <div class="doc-step-num">1</div>
                <div>
                  <strong>Use SSH Keys</strong>
                  <p class="description">For secure and password-less logins, use SSH keys (<code>ssh-keygen</code>) instead of passwords.</p>
                </div>
              </div>
              <div class="doc-step">
                <div class="doc-step-num">2</div>
                <div>
                  <strong>Copy/Paste</strong>
                  <p class="description">Use your browser's context menu to copy/paste directly into the terminal, or use Ctrl+Shift+C / Ctrl+Shift+V.</p>
                </div>
              </div>
            </div>

            <div class="doc-card">
              <div class="doc-badge" style="background: #1976d2;">CAPACITOR & GITHUB ACTIONS APK</div>
              <h3>Build Android APK on GitHub Actions</h3>
              <p class="description" style="font-size: 13px; color: var(--text-normal); margin-bottom: 16px;">
                This app is configured with Capacitor and includes an automated <code>.github/workflows/android-apk.yml</code> workflow.
              </p>

              <div class="doc-step">
                <div class="doc-step-num">1</div>
                <div>
                  <strong>Push Repository to GitHub</strong>
                  <p class="description">Push or export this project repository to your GitHub account.</p>
                </div>
              </div>

              <div class="doc-step">
                <div class="doc-step-num">2</div>
                <div>
                  <strong>Automatic GitHub Actions Build</strong>
                  <p class="description">GitHub Actions will automatically run the build workflow using Java 17 and Node 22 to generate your Android APK.</p>
                </div>
              </div>

              <div class="doc-step">
                <div class="doc-step-num">3</div>
                <div>
                  <strong>Download your APK</strong>
                  <p class="description">Go to the <strong>Actions</strong> tab in your GitHub repository, tap the latest workflow run, and download the <code>SSH-PTY-Terminal-debug</code> artifact containing your <code>app-debug.apk</code>.</p>
                </div>
              </div>
            </div>

            <div class="doc-card">
              <div class="doc-badge" style="background: #388e3c;">ANDROID TROUBLESHOOTING GUIDE</div>
              <h3>Fix Guide for Android Users</h3>

              <div class="doc-item">
                <h4>Draggable Floating Find Bar</h4>
                <p class="description">Tap and drag the <strong>⋮⋮ handle</strong> on the Find popup with your finger. You can position the search bar anywhere on screen. It is automatically constrained so it will never slide off the screen edges on mobile devices.</p>
              </div>

              <div class="doc-item">
                <h4>On-Screen Virtual Keyboard Issues & Fixes</h4>
                <p class="description">If Android soft keyboard auto-correct breaks terminal commands or adds trailing spaces, turn off text prediction for terminal inputs, or install <strong>Hacker's Keyboard</strong> or <strong>Unexpected Keyboard</strong> from Google Play Store for native Esc, Tab, Ctrl, and arrow key support.</p>
              </div>

              <div class="doc-item">
                <h4>Terminal Quick Toolbar Keys</h4>
                <p class="description">Use the top action toolbar in Terminal view to send <code>Ctrl+C</code> (Interrupt), <code>Clear</code> (Ctrl+L), <code>Esc</code>, and <code>Tab</code> with a single tap without needing complex mobile keyboard gestures.</p>
              </div>

              <div class="doc-item">
                <h4>Network Drops & Automatic Token Reconnection</h4>
                <p class="description">When toggling between Wi-Fi and 4G/5G mobile data, network addresses change. The terminal automatically uses local session token persistence to reconnect your PTY channel without losing your settings.</p>
              </div>

              <div class="doc-item">
                <h4>Word Wrap & Mobile Screen Density</h4>
                <p class="description">If long output lines stretch horizontally on mobile screens, enable <strong>Word Wrap</strong> in the Config tab, or tap <strong>A- / A+</strong> on the terminal toolbar to fit more text on narrow smartphone screens.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Terminal View -->
      <div id="terminal-view" class="view ${this.activeTab === 'terminal' ? 'active' : ''}">
        <div id="terminal-container" class="${this.getAnimationClass()} ${this.isLoading.terminal ? 'skeleton' : ''}">
          <div id="search-bar" class="${this.searchActive ? 'active' : ''}">
            <div class="drag-handle" id="search-drag-handle" title="Drag to move">⋮⋮</div>
            <div class="search-input-wrapper">
              <input type="text" id="search-input" placeholder="Find" .value="${this.searchValue}" @input="${this.onSearchInput}" @keydown="${this.onSearchKeyDown}">
              <div class="search-options">
                <button class="search-opt-btn ${this.searchCaseSensitive ? 'active' : ''}" @click="${this.toggleSearchCaseSensitive}" title="Match Case">
                  <span class="codicon codicon-case-sensitive"></span>
                </button>
                <button class="search-opt-btn ${this.searchWholeWord ? 'active' : ''}" @click="${this.toggleSearchWholeWord}" title="Match Whole Word">
                  <span class="codicon codicon-whole-word"></span>
                </button>
                <button class="search-opt-btn ${this.searchRegex ? 'active' : ''}" @click="${this.toggleSearchRegex}" title="Use Regular Expression">
                  <span class="codicon codicon-regex"></span>
                </button>
              </div>
            </div>
            <button class="search-btn" @click="${this.searchNext}" title="Next (Enter)">▼</button>
            <button class="search-btn" @click="${this.searchPrev}" title="Previous (Shift+Enter)">▲</button>
            <button class="search-btn" @click="${this.closeSearch}" title="Close (Esc)">✕</button>
          </div>
          <div id="terminal"></div>
          ${this.showScrollToBottom ? html`
            <button class="scroll-to-bottom-btn" @click="${this.scrollToBottom}">
              <span class="codicon codicon-chevron-down"></span> Scroll to bottom
            </button>
          ` : ''}
        </div>
        
        <button class="toolbar-toggle-btn" tabindex="-1" @pointerdown="${(e: PointerEvent) => this.handleToolbarTogglePointerDown(e)}" title="${this.toolbarVisible ? 'Hide Toolbar' : 'Show Toolbar'}">
          <span class="material-symbols-rounded">
            ${this.toolbarVisible ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
          </span>
        </button>

        <div class="vs-toolbar" style="display: ${this.toolbarVisible ? 'flex' : 'none'}">
          <!-- Popup Menu with Filterable Search & Shortcuts -->
          <div id="toolbar-popup" class="toolbar-popup ${this.palettePopupActive ? 'show' : ''}">
            <div class="popup-search-box">
              <input type="text" id="palette-search" class="popup-search-input" placeholder="Search commands..." autocomplete="off" .value="${this.paletteSearchValue}" @input="${this.onPaletteSearchInput}">
            </div>
            <div class="popup-items-list" id="popup-list">
              ${this.getFilteredPaletteCommands().map(cmd => html`
                <div class="popup-item" 
                  tabindex="-1"
                  @pointerdown="${(e: PointerEvent) => { e.preventDefault(); this.handleItemPointerDown(e, cmd.label, (cmd as any).desc || ''); this.handlePaletteCommand(cmd.action); }}"
                  @pointerup="${this.handleItemPointerUp}"
                  @pointerleave="${this.handleItemPointerUp}">
                  <span class="popup-label">${cmd.label}</span>
                  <span class="popup-shortcut">${cmd.shortcut}</span>
                </div>
              `)}
            </div>
          </div>

          <!-- Row 1 -->
          <div class="toolbar-row">
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'ESC')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'ESC')}">ESC</button>
            <button class="key" tabindex="-1" id="menu-btn" @pointerdown="${(e: UIEvent) => this.handleMenuPointerDown(e)}" @touchstart="${(e: UIEvent) => this.handleMenuPointerDown(e)}"><i class="fa-solid fa-bars"></i></button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarTogglePointerDown(e)}" @touchstart="${(e: UIEvent) => this.handleToolbarTogglePointerDown(e)}"><i class="fa-solid fa-arrows-up-down"></i></button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'HOME')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'HOME')}">HOME</button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'UP')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'UP')}"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'END')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'END')}">END</button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'PGUP')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'PGUP')}">PGUP</button>
          </div>

          <!-- Row 2 -->
          <div class="toolbar-row">
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'TAB')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'TAB')}"><i class="fa-solid fa-indent"></i></button>
            <button class="key ${this.ctrlActive ? 'active' : ''}" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleCtrlAltTogglePointerDown(e, 'ctrl')}" @touchstart="${(e: UIEvent) => this.handleCtrlAltTogglePointerDown(e, 'ctrl')}">CTRL</button>
            <button class="key ${this.altActive ? 'active' : ''}" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleCtrlAltTogglePointerDown(e, 'alt')}" @touchstart="${(e: UIEvent) => this.handleCtrlAltTogglePointerDown(e, 'alt')}">ALT</button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'LEFT')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'LEFT')}"><i class="fa-solid fa-arrow-left"></i></button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'DOWN')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'DOWN')}"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'RIGHT')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'RIGHT')}"><i class="fa-solid fa-arrow-right"></i></button>
            <button class="key" tabindex="-1" @pointerdown="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'PGDN')}" @touchstart="${(e: UIEvent) => this.handleToolbarPointerDown(e, 'PGDN')}">PGDN</button>
          </div>
        </div>
        
        <div class="toolbar-toggle-floating" style="display: ${this.toolbarVisible ? 'none' : 'flex'}">
          <button class="toolbar-toggle-btn" tabindex="-1" @pointerdown="${(e: PointerEvent) => this.handleToolbarTogglePointerDown(e)}">
            <span class="codicon codicon-chevron-up" style="font-size: 16px;"></span>
          </button>
        </div>

        <div class="status-bar ${this.isLoading.statusbar ? 'skeleton' : ''}">
          <div id="status-dot" class="status-dot ${this.statusType}"></div>
          <span class="codicon codicon-gear" style="margin-right: 4px;"></span> <span id="label-status">${this.status}</span>
          <span style="margin-left: 15px;" id="label-info">${this.labelInfo}</span>
          <span style="margin-left: 15px; display: inline-flex; align-items: center; gap: 4px; ${this.getBatteryStyle()}" id="battery-indicator" title="Battery Status">
            <span id="battery-icon">${this.batteryIcon}</span>
            <span id="battery-level">${this.batteryLevel}</span>
          </span>
          <span style="margin-left: 15px; display: inline-flex; align-items: center; gap: 4px;" id="ping-indicator" title="Network Latency (RTT)">
            <span class="codicon codicon-zap"></span>
            <span id="ping-time">${this.latency !== null ? `${this.latency}ms` : '--'}</span>
          </span>
          <span style="margin-left: 15px; display: inline-flex; align-items: center; gap: 4px;" title="Network Throughput">
            <span class="codicon codicon-graph"></span>
            ${this.throughput.toFixed(1)} KB/s
          </span>
          <span style="margin-left: 15px; display: inline-flex; align-items: center; gap: 4px;" title="Session Uptime">
            <span class="codicon codicon-watch"></span>
            ${this.sessionUptime}
          </span>
          <span style="margin-left: auto; color: rgba(255,255,255,0.7);" id="label-dims">${this.dimsText}</span>
        </div>
      </div>
      
      ${this.isCommandPaletteOpen ? html`
        <div class="command-palette-overlay" @click="${() => this.isCommandPaletteOpen = false}">
          <div class="command-palette ${this.isLoading.palette ? 'skeleton' : ''}" @click="${(e: Event) => e.stopPropagation()}">
            <div class="search-box">
              <svg viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/></svg>
              <input id="palette-input" class="palette-input" placeholder="Type a command or search..." .value="${this.commandQuery}" @input="${(e: any) => this.commandQuery = e.target.value}" autofocus>
            </div>
            <ul class="palette-list">
              ${this.recentCommandIds.length > 0 ? html`
                <li class="palette-group">Recent</li>
                ${this.recentCommandIds.map(id => this.commands.find(c => c.id === id)).filter(c => c && c.label.toLowerCase().includes(this.commandQuery.toLowerCase())).map(c => html`
                  <li class="palette-item" @click="${() => this.executeCommand(c)}">
                    <span class="${c.iconClass}"></span> <span class="palette-label">${c.label}</span>
                    ${c.shortcut ? html`<span class="shortcut">${c.shortcut}</span>` : ''}
                  </li>
                `)}
              <li class="palette-divider"></li>
              <li class="palette-group">All</li>
            ` : ''}
            ${this.commands.filter(c => c.label.toLowerCase().includes(this.commandQuery.toLowerCase())).map(c => html`
              <li class="palette-item" @click="${() => this.executeCommand(c)}">
                <span class="${c.iconClass}"></span> <span class="palette-label">${c.label}</span>
                ${c.shortcut ? html`<span class="shortcut">${c.shortcut}</span>` : ''}
              </li>
              ${c.id === 'settings' ? html`<li class="palette-divider"></li>` : ''}
            `)}
            </ul>
          </div>
        </div>
      ` : ''}

      ${this.tooltipVisible ? html`
        <div class="vscode-tooltip" style="left: ${this.tooltipX}px; top: ${this.tooltipY}px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>${this.tooltipText}</span>
            ${this.isAndroid() ? html`
              <button @click="${this.closeTooltip}" style="background: none; border: none; color: #fff; cursor: pointer; padding: 2px 4px; font-size: 14px; border-left: 1px solid #454545; margin-left: 4px;">✕</button>
            ` : ''}
          </div>
        </div>
      ` : ''}
    `;
  }
}
