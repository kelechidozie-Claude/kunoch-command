import sys

path = '/Users/kelechidozie/Documents/kimi/workspace/kunoch-command-review/index.html'
with open(path, 'r') as f:
    content = f.read()

# Task 2: replace backup-row block
old2 = '''    <div id="backup-row">
      <button class="bk-btn" onclick="exportData()">⭳ EXPORT DATA</button>
      <button class="bk-btn" onclick="document.getElementById('importfile').click()">⭱ IMPORT</button>
      <input type="file" id="importfile" accept=".json" style="display:none" onchange="importData(this)" />
    </div>
  </div>'''

new2 = '''    <div id="backup-row">
      <button class="bk-btn" onclick="exportData()">⭳ EXPORT DATA</button>
      <button class="bk-btn" onclick="document.getElementById('importfile').click()">⭱ IMPORT</button>
      <input type="file" id="importfile" accept=".json" style="display:none" onchange="importData(this)" />
    </div>
    <div id="sync-row" style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-top:1px solid var(--border)">
      <div id="sync-dot" style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);flex-shrink:0"></div>
      <div style="font-size:9px;letter-spacing:1px;color:var(--text-muted);flex:1">SYNC</div>
    </div>
    <div id="login-panel"></div>
  </div>'''

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('Task 2: replaced backup-row block')
else:
    print('Task 2: old string NOT FOUND')
    sys.exit(1)

# Task 1: replace task-fs line
old1 = '<div id="task-fs"><div id="task-fs-hdr"><span>Directive Editor</span><button onclick="toggleTaskFullscreen()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">×</button></div><textarea id="task-fs-ta"></textarea></div></body>'

new1 = '''<div id="task-fs"><div id="task-fs-hdr"><span>Directive Editor</span><button onclick="toggleTaskFullscreen()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">×</button></div><textarea id="task-fs-ta"></textarea></div></body>
<style>
#login-panel{border-top:1px solid var(--border)}
#sync-dot.spinning{animation:spin 1s linear infinite;background:var(--gold)!important}
@keyframes spin{to{transform:rotate(360deg)}}
</style>'''

if old1 in content:
    content = content.replace(old1, new1, 1)
    print('Task 1: replaced task-fs line')
else:
    print('Task 1: old string NOT FOUND')
    sys.exit(1)

with open(path, 'w') as f:
    f.write(content)

print('Done')
