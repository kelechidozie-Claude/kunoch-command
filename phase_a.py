import re

path = '/Users/kelechidozie/Documents/kimi/workspace/kunoch-command-review/index.html'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()

# ── Phase A: Quick Wins (remaining items) ─────────

# 1. Platform-aware run hint: detect Mac vs others — already done? check
old_hint = '<div id="task-hint">⌘ + ENTER TO RUN</div>'
if old_hint in s:
    s = s.replace(old_hint, '<div id="task-hint"><span id="run-hint-key">⌘</span> + ENTER TO RUN</div>')
    print("Fixed task hint")

# 2. Better processing spinner: replace ◌ character with CSS ring
old_proc = '<div id="proc-note"><span class="spin">◌</span>&nbsp; PROCESSING...</div>'
if old_proc in s:
    s = s.replace(old_proc, '<div id="proc-note"><span class="proc-ring"></span> PROCESSING...</div>')
    print("Fixed proc spinner")

# 5+6. Add confirmation sheet HTML before </body>
cfm_html = '''<!-- Confirmation sheet -->
<div id="cfm-backdrop">
  <div id="cfm-box">
    <div id="cfm-title">Confirm Import</div>
    <div id="cfm-msg">Replace current businesses and history?</div>
    <div id="cfm-row">
      <button class="mbtn mbtn-cancel" onclick="closeConfirm()">CANCEL</button>
      <button class="mbtn mbtn-save" onclick="doConfirm()">CONFIRM IMPORT</button>
    </div>
  </div>
</div>
'''
if '</body>\n</html>' in s and 'cfm-backdrop' not in s:
    s = s.replace('</body>\n</html>', cfm_html + '</body>\n</html>')
    print("Added confirmation HTML")

# Insert JS before the "Run button shows..." comment
js_insert = '''/* ── PLATFORM HINT ─────────────────────────────── */
(function(){
  var isMac=navigator.platform.toUpperCase().indexOf('MAC')>=0;
  var k=document.getElementById('run-hint-key');if(k)k.textContent=isMac?'⌘':'Ctrl';
})();

/* ── ESCAPE TO CLOSE ───────────────────────────── */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    document.getElementById('api-panel').classList.remove('open');
    closeBizMenu();
    closeConfirm();
  }
});

/* ── CONFIRMATION SHEET ────────────────────────── */
var confirmResolve=null;
function confirmSheet(msg,title){
  return new Promise(function(res){
    confirmResolve=res;
    document.getElementById('cfm-title').textContent=title||'Confirm';
    document.getElementById('cfm-msg').textContent=msg||'Are you sure?';
    document.getElementById('cfm-backdrop').classList.add('open');
  });
}
function closeConfirm(){document.getElementById('cfm-backdrop').classList.remove('open');if(confirmResolve){confirmResolve(false);confirmResolve=null;}}
function doConfirm(){document.getElementById('cfm-backdrop').classList.remove('open');if(confirmResolve){confirmResolve(true);confirmResolve=null;}}

'''

old_marker = '/* Run button shows the active business'
if old_marker in s and 'confirmSheet' not in s:
    idx = s.index(old_marker)
    s = s[:idx] + js_insert + s[idx:]
    print("Added JS helpers")

# Replace confirm() in importData with confirmSheet
old_import = """if(!confirm('Import backup from '+(data.exported||'unknown date')+'? This REPLACES current businesses and history on this device.'))return;"""
if old_import in s:
    s = s.replace(old_import, """var ok=await confirmSheet('Import backup from '+(data.exported||'unknown date')+'? This REPLACES current businesses and history on this device.','Import Backup');if(!ok)return;""")
    # Make importData async
    s = s.replace('function importData(input){', 'async function importData(input){')
    print("Fixed importData")

with open(path, 'w', encoding='utf-8') as f:
    f.write(s)

print("Phase A script complete")
