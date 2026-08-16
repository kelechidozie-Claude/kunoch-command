path = '/Users/kelechidozie/Documents/kimi/workspace/kunoch-command-review/index.html'
with open(path, 'r') as f:
    s = f.read()

tail = '}\n</script>\n</body>\n</html>\n'
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

if tail in s and 'cfm-backdrop' not in s:
    s = s.replace(tail, '}\n</script>\n' + cfm + '</body>\n</html>\n')
    with open(path, 'w') as f:
        f.write(s)
    print('Added confirmation HTML')
else:
    print('Tail not found or already present')
    print('Has cfm-backdrop:', 'cfm-backdrop' in s)
