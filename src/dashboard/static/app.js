/**
 * CodeBot AI Dashboard — Frontend Application v2
 * Vanilla JS, zero dependencies. Professional DevOps UI.
 */

const App = {
  baseUrl: window.location.origin,
  sessionCount: 0,
  activityItems: [],
  toolLogItems: [],

  // ── Init ──
  init() {
    this.setupNavigation();
    this.checkHealth();
    this.navigateToHash();
    window.addEventListener('hashchange', () => this.navigateToHash());
    // Auto-refresh health every 30s
    setInterval(() => this.checkHealth(), 30000);
  },

  // ── Navigation ──
  setupNavigation() {
    document.querySelectorAll('.rail-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = link.dataset.section;
      });
    });
  },

  navigateToHash() {
    const hash = window.location.hash.replace('#', '') || 'sessions';
    this.showSection(hash);
  },

  showSection(name) {
    document.querySelectorAll('.rail-link').forEach(link =>
      link.classList.toggle('active', link.dataset.section === name)
    );
    document.querySelectorAll('.section').forEach(section =>
      section.classList.toggle('active', section.id === 'section-' + name)
    );
    switch (name) {
      case 'sessions': this.loadSessions(); break;
      case 'audit': this.loadAudit(); break;
      case 'metrics': this.loadMetrics(); break;
      case 'command': this.initCommand(); break;
    }
  },

  // ── Health + Status Bar ──
  async checkHealth() {
    const conn = document.getElementById('status-conn');
    try {
      const data = await this.fetch('/api/health');
      conn.className = 'status-connection ok';
      conn.querySelector('.conn-text').textContent = 'Connected';

      // Populate status bar
      const verEl = document.getElementById('status-ver-val');
      if (verEl) verEl.textContent = 'v' + data.version;

      const uptimeEl = document.getElementById('status-uptime-val');
      if (uptimeEl && data.uptime) uptimeEl.textContent = this.formatUptime(data.uptime);

      // Try to get additional status
      this.updateStatusBar();
    } catch {
      conn.className = 'status-connection error';
      conn.querySelector('.conn-text').textContent = 'Offline';
    }
  },

  async updateStatusBar() {
    try {
      const [status, summary] = await Promise.all([
        this.fetch('/api/command/status').catch(() => null),
        this.fetch('/api/metrics/summary').catch(() => null),
      ]);

      const modeEl = document.getElementById('status-mode-val');
      if (modeEl && status) {
        modeEl.textContent = status.available ? 'Connected' : 'Standalone';
        modeEl.className = 'status-value mode-badge ' + (status.available ? 'autonomous' : 'supervised');
      }

      const sessEl = document.getElementById('status-sessions-val');
      if (sessEl && summary) sessEl.textContent = String(summary.sessions || 0);
    } catch {}
  },

  formatUptime(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
    return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
  },

  // ── Sessions ──
  async loadSessions() {
    const container = document.getElementById('sessions-list');
    const detail = document.getElementById('session-detail');
    const stats = document.getElementById('session-stats');
    detail.style.display = 'none';
    container.style.display = '';
    container.innerHTML = this.renderLoading();

    try {
      const data = await this.fetch('/api/sessions?limit=50');
      this.sessionCount = data.total;

      stats.innerHTML = '<span class="stat-chip"><strong>' + data.total + '</strong> sessions</span>' +
        (data.hasMore ? '<span class="stat-chip">showing latest 50</span>' : '');

      if (data.sessions.length === 0) {
        container.innerHTML = this.renderEmpty('No sessions yet', 'Start a CodeBot session to see conversations here');
        return;
      }

      container.innerHTML = data.sessions.map(function(s) {
        var date = s.modifiedAt ? App.relativeTime(s.modifiedAt) : 'Unknown';
        var fullDate = s.modifiedAt ? new Date(s.modifiedAt).toLocaleString() : '';
        var shortId = s.id.substring(0, 12);
        return '<div class="card" onclick="App.loadSessionDetail(\'' + App.escapeHtml(s.id) + '\')">' +
          '<div class="card-top">' +
            '<span class="card-id">' + App.escapeHtml(shortId) + '</span>' +
            '<span class="card-size">' + App.formatBytes(s.sizeBytes) + '</span>' +
          '</div>' +
          '<div class="card-date" title="' + App.escapeHtml(fullDate) + '">' + App.escapeHtml(date) + '</div>' +
        '</div>';
      }).join('');
    } catch {
      container.innerHTML = this.renderEmpty('Error loading sessions', 'Check that the server is running');
    }
  },

  async loadSessionDetail(id) {
    const container = document.getElementById('sessions-list');
    const detail = document.getElementById('session-detail');
    container.style.display = 'none';
    detail.style.display = '';
    detail.innerHTML = this.renderLoading();

    try {
      const data = await this.fetch('/api/sessions/' + encodeURIComponent(id));
      var shortId = data.id.substring(0, 16);

      detail.innerHTML = '<div class="detail-top"><div>' +
        '<div class="detail-title">' + this.escapeHtml(shortId) + '...</div>' +
        '<div class="detail-meta"><span>' + data.messageCount + ' messages</span><span>' + data.toolCallCount + ' tool calls</span></div>' +
        '</div><button class="btn-back" onclick="App.loadSessions()">&larr; Back</button></div>' +
        '<div class="message-list">' +
          data.messages.map(function(m) {
            return '<div class="message ' + App.escapeHtml(m.role) + '">' +
              '<div class="message-role">' + App.escapeHtml(m.role) + '</div>' +
              '<div class="message-content">' + App.escapeHtml(App.truncate(App.extractContent(m), 600)) + '</div></div>';
          }).join('') +
        '</div>';
    } catch {
      detail.innerHTML = this.renderEmpty('Error loading session', '');
    }
  },

  // ── Audit ──
  async loadAudit() {
    const timeline = document.getElementById('audit-timeline');
    timeline.innerHTML = this.renderLoading();
    document.getElementById('btn-verify').onclick = () => this.verifyAudit();

    try {
      const data = await this.fetch('/api/audit?days=30');
      if (data.entries.length === 0) {
        timeline.innerHTML = this.renderEmpty('No audit entries', 'Tool executions will appear here');
        return;
      }

      timeline.innerHTML = data.entries.slice(-100).reverse().map(function(e) {
        return '<div class="timeline-entry ' + App.escapeHtml(e.action || '') + '">' +
          '<div class="timeline-dot"></div>' +
          '<div class="timeline-card">' +
            '<div class="timeline-tool">' + App.escapeHtml(e.tool || 'unknown') + '</div>' +
            '<div class="timeline-action">' + App.escapeHtml(e.action || '') + (e.reason ? ' — ' + App.escapeHtml(App.truncate(e.reason, 100)) : '') + '</div>' +
            '<div class="timeline-time">' + (e.timestamp ? App.relativeTime(e.timestamp) : '') + '</div>' +
          '</div></div>';
      }).join('');
    } catch {
      timeline.innerHTML = this.renderEmpty('Error loading audit trail', '');
    }
  },

  async verifyAudit() {
    const el = document.getElementById('verify-result');
    el.textContent = 'Verifying...';
    el.className = 'verify-badge';

    try {
      const data = await this.fetch('/api/audit/verify');
      if (data.chainIntegrity === 'verified') {
        el.textContent = '\u2713 Verified (' + data.valid + ' entries)';
        el.className = 'verify-badge verified';
      } else {
        el.textContent = '\u2717 Broken (' + data.invalid + ' invalid)';
        el.className = 'verify-badge broken';
      }
    } catch {
      el.textContent = 'Failed';
      el.className = 'verify-badge broken';
    }
  },

  // ── Metrics ──
  async loadMetrics() {
    const cards = document.getElementById('metrics-cards');
    const chart = document.getElementById('usage-chart');
    const breakdown = document.getElementById('tool-breakdown');
    cards.innerHTML = this.renderLoading();

    try {
      const results = await Promise.all([
        this.fetch('/api/metrics/summary'),
        this.fetch('/api/usage'),
      ]);
      var summary = results[0], usage = results[1];

      var toolCount = Object.keys(summary.toolUsage || {}).length;
      var actionCount = Object.keys(summary.actionBreakdown || {}).length;
      cards.innerHTML =
        '<div class="stat-card blue"><div class="stat-value">' + summary.sessions + '</div><div class="stat-label">Sessions</div></div>' +
        '<div class="stat-card cyan"><div class="stat-value">' + summary.auditEntries + '</div><div class="stat-label">Audit Events</div></div>' +
        '<div class="stat-card green"><div class="stat-value">' + toolCount + '</div><div class="stat-label">Tools Used</div></div>' +
        '<div class="stat-card yellow"><div class="stat-value">' + actionCount + '</div><div class="stat-label">Action Types</div></div>';

      // Bar chart
      if (usage.usage && usage.usage.length > 0) {
        var maxMsg = Math.max.apply(null, usage.usage.map(function(u) { return u.messageCount; }));
        if (maxMsg < 1) maxMsg = 1;
        chart.innerHTML = '<div class="chart-title">Recent Sessions</div><div class="bar-chart">' +
          usage.usage.map(function(u) {
            var h = Math.max(8, (u.messageCount / maxMsg) * 120);
            var label = u.sessionId.substring(0, 6);
            return '<div class="bar-wrapper"><span class="bar-value">' + u.messageCount + '</span>' +
              '<div class="bar" style="height:' + h + 'px" title="' + App.escapeHtml(u.sessionId) + '"></div>' +
              '<span class="bar-label">' + App.escapeHtml(label) + '</span></div>';
          }).join('') + '</div>';
      } else {
        chart.innerHTML = this.renderEmpty('No usage data', 'Run some sessions to see charts');
      }

      // Tool breakdown
      var tools = Object.entries(summary.toolUsage || {}).sort(function(a, b) { return b[1] - a[1]; });
      if (tools.length > 0) {
        var maxCount = tools[0][1];
        breakdown.innerHTML = '<div class="chart-title">Tool Usage</div>' +
          tools.slice(0, 15).map(function(pair) {
            return '<div class="breakdown-row">' +
              '<span class="breakdown-name">' + App.escapeHtml(pair[0]) + '</span>' +
              '<div class="breakdown-bar"><div class="breakdown-fill" style="width:' + (pair[1] / maxCount * 100).toFixed(1) + '%"></div></div>' +
              '<span class="breakdown-count">' + pair[1] + '</span></div>';
          }).join('');
      } else {
        breakdown.innerHTML = '';
      }
    } catch {
      cards.innerHTML = this.renderEmpty('Error loading metrics', '');
    }
  },

  // ── Command Center ──
  cmdInitialized: false,
  toolsData: null,
  terminalHistory: [],
  terminalHistoryIndex: -1,

  async initCommand() {
    var agentConnected = false;
    try {
      var status = await this.fetch('/api/command/status');
      agentConnected = status.available;
    } catch { /* standalone */ }

    document.getElementById('cmd-unavailable').style.display = 'none';
    document.getElementById('cmd-available').style.display = '';

    var statusEl = document.getElementById('cmd-status');
    if (statusEl) {
      statusEl.innerHTML = agentConnected
        ? '<span class="badge badge-ok">Agent Connected</span>'
        : '<span class="badge badge-warn">Standalone Mode</span>';
    }

    if (!agentConnected) {
      document.querySelectorAll('.cmd-tab').forEach(function(tab) {
        var t = tab.dataset.cmdTab;
        if (t === 'chat' || t === 'toolrunner') {
          tab.classList.add('disabled');
          tab.title = 'Requires agent \u2014 run codebot --dashboard';
        }
      });
      document.querySelectorAll('.cmd-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.cmd-panel').forEach(function(p) { p.classList.remove('active'); });
      var termTab = document.querySelector('.cmd-tab[data-cmd-tab="terminal"]');
      if (termTab) termTab.classList.add('active');
      var termPanel = document.getElementById('cmd-terminal');
      if (termPanel) termPanel.classList.add('active');
    }

    // Load recent activity for context panel
    this.loadActivityFeed();

    if (this.cmdInitialized) return;
    this.cmdInitialized = true;
    this.agentConnected = agentConnected;

    document.querySelectorAll('.cmd-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        if (tab.classList.contains('disabled')) return;
        document.querySelectorAll('.cmd-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.cmd-panel').forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('cmd-' + tab.dataset.cmdTab).classList.add('active');
      });
    });
    if (agentConnected) this.initChat();
    this.initQuickActions();
    this.initTerminal();
    if (agentConnected) this.initToolRunner();
  },

  // ── Activity Feed (Right Panel) ──
  async loadActivityFeed() {
    try {
      var data = await this.fetch('/api/audit?days=1');
      if (data.entries && data.entries.length > 0) {
        var recent = data.entries.slice(-20).reverse();
        this.activityItems = recent.map(function(e) {
          return {
            name: e.tool || 'unknown',
            action: e.action || '',
            time: e.timestamp,
            status: e.action === 'execute' ? 'success' : (e.action === 'error' ? 'error' : 'info')
          };
        });
        this.renderActivityFeed();
      }
    } catch {}
  },

  addActivityItem(name, status, time) {
    this.activityItems.unshift({ name: name, status: status, time: time || new Date().toISOString() });
    if (this.activityItems.length > 50) this.activityItems.pop();
    this.renderActivityFeed();
  },

  renderActivityFeed() {
    var feed = document.getElementById('activity-feed');
    var countEl = document.getElementById('activity-count');
    if (!feed) return;
    if (countEl) countEl.textContent = String(this.activityItems.length);

    if (this.activityItems.length === 0) {
      feed.innerHTML = '<div class="empty-state-sm">No activity yet</div>';
      return;
    }

    feed.innerHTML = this.activityItems.map(function(item) {
      return '<div class="activity-item">' +
        '<span class="activity-dot ' + App.escapeHtml(item.status) + '"></span>' +
        '<span class="activity-name">' + App.escapeHtml(item.name) + '</span>' +
        '<span class="activity-time">' + (item.time ? App.relativeTime(item.time) : '') + '</span>' +
      '</div>';
    }).join('');
  },

  // ── Tool Log (Right Panel) ──
  addToolLogEntry(name, args, result, duration, isError) {
    var entry = {
      id: 'tl-' + Date.now(),
      name: name,
      args: args,
      result: result,
      duration: duration,
      isError: isError,
      time: new Date().toISOString()
    };
    this.toolLogItems.unshift(entry);
    if (this.toolLogItems.length > 30) this.toolLogItems.pop();
    this.renderToolLog();
  },

  renderToolLog() {
    var log = document.getElementById('tool-log');
    if (!log) return;

    if (this.toolLogItems.length === 0) {
      log.innerHTML = '<div class="empty-state-sm">No tool calls yet</div>';
      return;
    }

    log.innerHTML = this.toolLogItems.map(function(entry) {
      var argsStr = '';
      if (entry.args && typeof entry.args === 'object') {
        argsStr = Object.keys(entry.args).map(function(k) {
          return k + ': ' + App.truncate(String(entry.args[k]), 40);
        }).join(', ');
      }
      var resultStr = entry.result ? App.truncate(String(entry.result), 200) : '';
      return '<div class="tool-log-entry" onclick="this.classList.toggle(\'expanded\')">' +
        '<div class="tool-log-header">' +
          '<span class="tool-log-name">' + App.escapeHtml(entry.name) + '</span>' +
          '<span class="risk-badge ' + App.getRiskClass(entry.name, entry.args) + '">' + App.getRiskLabel(entry.name, entry.args) + '</span>' +
          (entry.duration ? '<span class="tool-log-duration">' + entry.duration + 'ms</span>' : '') +
        '</div>' +
        (argsStr ? '<div class="tool-log-args">' + App.escapeHtml(argsStr) + '</div>' : '') +
        (resultStr ? '<div class="tool-log-detail">' + App.escapeHtml(resultStr) + '</div>' : '') +
      '</div>';
    }).join('');
  },

  // ── Risk Indicator ──
  getRiskLevel(toolName, args) {
    if (toolName !== 'execute') return 'low';
    var cmd = '';
    if (args && args.command) cmd = String(args.command).toLowerCase();
    if (!cmd) return 'low';

    // High risk patterns
    if (/rm\s+-rf|mkfs|format\s+[a-z]:|dd\s+if=|>\s*\/dev\//.test(cmd)) return 'high';
    // Medium risk patterns
    if (/\brm\b|\bsudo\b|\bchmod\b|\bchown\b|\bdocker\b|\bkill\b|\bpkill\b/.test(cmd)) return 'medium';
    return 'low';
  },

  getRiskClass(toolName, args) {
    return 'risk-' + this.getRiskLevel(toolName, args);
  },

  getRiskLabel(toolName, args) {
    var level = this.getRiskLevel(toolName, args);
    if (level === 'high') return 'HIGH';
    if (level === 'medium') return 'MED';
    return 'LOW';
  },

  // ── Chat ──
  initChat() {
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('chat-send');
    var send = function() {
      var msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      App.appendChatMessage('user', msg);
      App.streamChat(msg);
    };
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  },

  appendChatMessage(role, content) {
    var container = document.getElementById('chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + this.escapeHtml(role);

    var roleHtml = '<div class="chat-msg-role">' + this.escapeHtml(role) + '</div>';
    var contentHtml;
    if (role === 'assistant') {
      contentHtml = '<div class="chat-msg-content">' + this.renderMarkdown(content) + '</div>';
    } else {
      contentHtml = '<div class="chat-msg-content">' + this.escapeHtml(content) + '</div>';
    }
    div.innerHTML = roleHtml + contentHtml;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  },

  appendChatToolCall(name, args) {
    var container = document.getElementById('chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg tool-call';
    var argsStr = '';
    if (args && typeof args === 'object') {
      argsStr = Object.entries(args).map(function(pair) {
        return App.escapeHtml(pair[0]) + ': ' + App.escapeHtml(App.truncate(String(pair[1]), 80));
      }).join(', ');
    }

    var riskBadge = '<span class="risk-badge ' + this.getRiskClass(name, args) + '">' + this.getRiskLabel(name, args) + '</span>';
    div.innerHTML = '<div class="chat-tool-badge">tool: ' + this.escapeHtml(name) + ' ' + riskBadge + '</div>' +
      '<div class="chat-tool-args">' + argsStr + '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Add to activity feed and tool log
    this.addActivityItem(name, 'pending');
    this.addToolLogEntry(name, args, null, null, false);
  },

  async streamChat(message) {
    var container = document.getElementById('chat-messages');
    var assistantDiv = this.appendChatMessage('assistant', '');
    var contentEl = assistantDiv.querySelector('.chat-msg-content');
    var fullText = '';
    try {
      var res = await window.fetch(this.baseUrl + '/api/command/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message }),
      });
      if (!res.ok) { var errD = await res.json().catch(function(){ return {}; }); contentEl.textContent = 'Error: ' + (errD.error || 'HTTP ' + res.status); return; }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          var payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            var ev = JSON.parse(payload);
            if (ev.type === 'text') {
              fullText += ev.text || '';
              contentEl.innerHTML = App.renderMarkdown(fullText);
              container.scrollTop = container.scrollHeight;
            }
            else if (ev.type === 'tool_call' && ev.toolCall) {
              this.appendChatToolCall(ev.toolCall.name, ev.toolCall.args);
            }
            else if (ev.type === 'tool_result' && ev.toolResult) {
              // Update last tool log entry with result
              if (this.toolLogItems.length > 0) {
                this.toolLogItems[0].result = ev.toolResult.result || '';
                this.toolLogItems[0].duration = ev.toolResult.duration_ms;
                this.toolLogItems[0].isError = ev.toolResult.is_error;
                this.renderToolLog();
              }
              // Update activity
              this.addActivityItem(this.toolLogItems.length > 0 ? this.toolLogItems[0].name : 'tool',
                ev.toolResult.is_error ? 'error' : 'success');
            }
            else if (ev.type === 'error') {
              contentEl.innerHTML = App.renderMarkdown(fullText) + '<div class="cmd-error">[Error: ' + App.escapeHtml(ev.text || 'unknown') + ']</div>';
            }
          } catch(e) {}
        }
      }
      if (!fullText) contentEl.textContent = '(no response)';
    } catch (err) { contentEl.textContent = 'Error: ' + err.message; }
  },

  // ── Structured Markdown Rendering ──
  renderMarkdown(text) {
    if (!text) return '';
    var html = this.escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
      return '<pre><code>' + code + '</code></pre>';
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, function(match) {
      // Only wrap consecutive lis
      return match;
    });

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Line breaks (preserve newlines that aren't part of block elements)
    html = html.replace(/\n/g, '<br>');

    // Clean up: remove <br> right after block elements
    html = html.replace(/<\/pre><br>/g, '</pre>');
    html = html.replace(/<\/h2><br>/g, '</h2>');
    html = html.replace(/<\/h3><br>/g, '</h3>');
    html = html.replace(/<\/li><br>/g, '</li>');

    return html;
  },

  // ── Quick Actions ──
  initQuickActions() {
    document.querySelectorAll('.quick-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { App.runQuickAction(btn.dataset.action); });
    });
  },

  async runQuickAction(action) {
    var output = document.getElementById('quick-output');
    output.style.display = ''; output.textContent = 'Running...';
    this.addActivityItem(action, 'pending');

    try {
      var res = await window.fetch(this.baseUrl + '/api/command/quick-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action }),
      });
      if (!res.ok) { var errD = await res.json().catch(function(){ return {}; }); output.textContent = 'Error: ' + (errD.error || 'HTTP ' + res.status); return; }
      var reader = res.body.getReader(); var decoder = new TextDecoder();
      var buffer = '', fullText = ''; output.textContent = '';
      while (true) {
        var chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i]; if (!line.startsWith('data: ')) continue;
          var payload = line.slice(6); if (payload === '[DONE]') break;
          try { var ev = JSON.parse(payload);
            if (ev.type === 'text') { fullText += ev.text || ''; output.textContent = fullText; }
            else if (ev.type === 'stdout') { fullText += ev.text || ''; output.textContent = fullText; }
            else if (ev.type === 'stderr') { fullText += ev.text || ''; output.textContent = fullText; }
            else if (ev.type === 'tool_result' && ev.toolResult) { fullText += '\n' + (ev.toolResult.result || ''); output.textContent = fullText; }
          } catch(e) {}
        }
      }
      if (!fullText) output.textContent = '(no output)';
      this.addActivityItem(action, 'success');
    } catch (err) {
      output.textContent = 'Error: ' + err.message;
      this.addActivityItem(action, 'error');
    }
  },

  // ── Terminal ──
  initTerminal() {
    var input = document.getElementById('terminal-input');
    this.terminalHistory = []; this.terminalHistoryIndex = -1;
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var cmd = input.value.trim(); if (!cmd) return;
        App.terminalHistory.push(cmd); App.terminalHistoryIndex = App.terminalHistory.length;
        input.value = ''; App.runTerminalCommand(cmd);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); if (App.terminalHistoryIndex > 0) { App.terminalHistoryIndex--; input.value = App.terminalHistory[App.terminalHistoryIndex]; }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (App.terminalHistoryIndex < App.terminalHistory.length - 1) { App.terminalHistoryIndex++; input.value = App.terminalHistory[App.terminalHistoryIndex]; }
        else { App.terminalHistoryIndex = App.terminalHistory.length; input.value = ''; }
      }
    });
  },

  async runTerminalCommand(cmd) {
    var output = document.getElementById('terminal-output');
    var cmdLine = document.createElement('div');
    cmdLine.className = 'terminal-line cmd';
    cmdLine.textContent = '$ ' + cmd;
    output.appendChild(cmdLine);

    var resultBlock = document.createElement('div');
    resultBlock.className = 'terminal-line result';
    output.appendChild(resultBlock);
    output.scrollTop = output.scrollHeight;

    // Add risk badge for commands
    var riskLevel = this.getRiskLevel('execute', { command: cmd });
    if (riskLevel !== 'low') {
      var badge = document.createElement('span');
      badge.className = 'risk-badge risk-' + riskLevel;
      badge.textContent = riskLevel.toUpperCase();
      badge.style.marginLeft = '8px';
      cmdLine.appendChild(badge);
    }

    this.addActivityItem('$ ' + this.truncate(cmd, 30), 'pending');

    try {
      var res = await window.fetch(this.baseUrl + '/api/command/exec', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      if (!res.ok) { var errD = await res.json().catch(function(){ return {}; }); resultBlock.textContent = 'Error: ' + (errD.error || 'HTTP ' + res.status); resultBlock.classList.add('error'); return; }
      var reader = res.body.getReader(); var decoder = new TextDecoder(); var buffer = '';
      while (true) {
        var chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i]; if (!line.startsWith('data: ')) continue;
          var payload = line.slice(6); if (payload === '[DONE]') break;
          try { var ev = JSON.parse(payload);
            if (ev.type === 'stdout' || ev.type === 'stderr') { resultBlock.textContent += ev.text || ''; if (ev.type === 'stderr') resultBlock.classList.add('error'); }
            else if (ev.type === 'exit') {
              if (ev.code !== 0) { resultBlock.classList.add('error'); resultBlock.textContent += '\n[exit code: ' + ev.code + ']'; }
              this.addActivityItem('$ ' + App.truncate(cmd, 30), ev.code === 0 ? 'success' : 'error');
            }
          } catch(e) {}
        }
      }
    } catch (err) { resultBlock.textContent = 'Error: ' + err.message; resultBlock.classList.add('error'); }
    output.scrollTop = output.scrollHeight;
  },

  // ── Tool Runner ──
  initToolRunner() {
    this.loadToolList();
    document.getElementById('tool-select').addEventListener('change', function(e) { App.onToolSelected(e.target.value); });
    document.getElementById('tool-run-btn').addEventListener('click', function() { App.executeSelectedTool(); });
  },

  async loadToolList() {
    try {
      var data = await this.fetch('/api/command/tools');
      var select = document.getElementById('tool-select');
      this.toolsData = data.tools;
      var sorted = data.tools.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
      for (var i = 0; i < sorted.length; i++) {
        var opt = document.createElement('option');
        opt.value = sorted[i].name;
        opt.textContent = sorted[i].name;
        select.appendChild(opt);
      }
    } catch {}
  },

  onToolSelected(toolName) {
    var tool = null;
    if (this.toolsData) { for (var i = 0; i < this.toolsData.length; i++) { if (this.toolsData[i].name === toolName) { tool = this.toolsData[i]; break; } } }
    var descEl = document.getElementById('tool-description');
    var formEl = document.getElementById('tool-form');
    var runBtn = document.getElementById('tool-run-btn');
    var resultEl = document.getElementById('tool-result');
    resultEl.innerHTML = ''; resultEl.style.display = 'none';
    if (!tool) { descEl.textContent = ''; formEl.innerHTML = ''; runBtn.disabled = true; return; }
    descEl.textContent = tool.description; runBtn.disabled = false;
    var props = tool.parameters && tool.parameters.properties ? tool.parameters.properties : {};
    var required = tool.parameters && tool.parameters.required ? tool.parameters.required : [];
    var html = ''; var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], schema = props[key], isReq = required.indexOf(key) >= 0, desc = schema.description || '', type = schema.type || 'string';
      if (type === 'boolean') {
        html += '<div class="tool-field"><label class="tool-label"><input type="checkbox" name="' + this.escapeHtml(key) + '" class="tool-checkbox" />' + this.escapeHtml(key) + (isReq ? ' *' : '') + '</label><div class="tool-field-desc">' + this.escapeHtml(desc) + '</div></div>';
      } else {
        var it = type === 'number' ? 'number' : 'text';
        html += '<div class="tool-field"><label class="tool-label">' + this.escapeHtml(key) + (isReq ? ' *' : '') + '</label><input type="' + it + '" name="' + this.escapeHtml(key) + '" class="tool-input" placeholder="' + this.escapeHtml(desc) + '" /><div class="tool-field-desc">' + this.escapeHtml(desc) + '</div></div>';
      }
    }
    formEl.innerHTML = html;
  },

  async executeSelectedTool() {
    var toolName = document.getElementById('tool-select').value; if (!toolName) return;
    var tool = null;
    if (this.toolsData) { for (var i = 0; i < this.toolsData.length; i++) { if (this.toolsData[i].name === toolName) { tool = this.toolsData[i]; break; } } }
    if (!tool) return;
    var resultEl = document.getElementById('tool-result'); resultEl.style.display = ''; resultEl.innerHTML = this.renderLoading();
    var args = {}; var props = tool.parameters && tool.parameters.properties ? tool.parameters.properties : {}; var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], schema = props[key], input = document.querySelector('#tool-form [name="' + key + '"]');
      if (!input) continue;
      if (schema.type === 'boolean') { args[key] = input.checked; }
      else if (schema.type === 'number') { var v = input.value.trim(); if (v) args[key] = Number(v); }
      else { var v = input.value.trim(); if (v) args[key] = v; }
    }

    this.addActivityItem(toolName, 'pending');
    this.addToolLogEntry(toolName, args, null, null, false);

    try {
      var res = await window.fetch(this.baseUrl + '/api/command/tool/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, args: args })
      });
      var data = await res.json();
      if (data.is_error) {
        resultEl.innerHTML = '<div class="cmd-error">' + this.escapeHtml(data.result) + '</div>';
        this.addActivityItem(toolName, 'error');
      } else {
        resultEl.innerHTML = '<pre class="cmd-success">' + this.escapeHtml(data.result) + '</pre><div class="cmd-meta">' + data.duration_ms + 'ms</div>';
        this.addActivityItem(toolName, 'success');
      }
      // Update tool log
      if (this.toolLogItems.length > 0) {
        this.toolLogItems[0].result = data.result;
        this.toolLogItems[0].duration = data.duration_ms;
        this.toolLogItems[0].isError = data.is_error;
        this.renderToolLog();
      }
    } catch (err) {
      resultEl.innerHTML = '<div class="cmd-error">' + this.escapeHtml(err.message) + '</div>';
      this.addActivityItem(toolName, 'error');
    }
  },

  // ── Helpers ──
  async fetch(path) {
    var res = await window.fetch(this.baseUrl + path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  truncate(str, max) {
    if (!str || str.length <= max) return str || '';
    return str.substring(0, max) + '\u2026';
  },

  extractContent(msg) {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map(function(c) { return c.text || c.content || ''; }).join(' ');
    }
    return JSON.stringify(msg.content || '');
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  },

  relativeTime(iso) {
    var now = Date.now();
    var then = new Date(iso).getTime();
    var diff = Math.floor((now - then) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  },

  renderLoading() {
    return '<div class="loading-state"><div class="spinner"></div>Loading...</div>';
  },

  renderEmpty(title, desc) {
    return '<div class="empty-state"><div class="empty-title">' + this.escapeHtml(title) + '</div>' +
      (desc ? '<div class="empty-desc">' + this.escapeHtml(desc) + '</div>' : '') + '</div>';
  },
};

document.addEventListener('DOMContentLoaded', function() { App.init(); });
