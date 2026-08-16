path = '/Users/kelechidozie/Documents/kimi/workspace/kunoch-command-review/index.html'
with open(path, 'r') as f:
    lines = f.readlines()

# Find the last </body> line (should be near the end)
body_idx = None
for i in range(len(lines)-1, -1, -1):
    if lines[i].strip() == '</body>':
        body_idx = i
        break

if body_idx is not None:
    cfm = '''<!-- Confirmation sheet -->
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
    lines.insert(body_idx, cfm)
    with open(path, 'w') as f:
        f.writelines(lines)
    print('Inserted confirmation HTML at line', body_idx)
else:
    print('</body> not found')
