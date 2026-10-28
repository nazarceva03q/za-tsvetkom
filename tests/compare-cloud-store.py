from pathlib import Path
import difflib
import hashlib

root = Path(__file__).resolve().parents[1]
supplied = Path('C:/Users/User/Downloads/store-current.txt').read_text(encoding='utf-8-sig').replace('\r\n', '\n').rstrip() + '\n'
local = (root / 'bot/src/store.js').read_text(encoding='utf-8').rstrip() + '\n'
begin = '// – Состояние диалога с конкретным пользователем'
end = 'async function clearSession(userId)'
def outside_session(source):
    return source[:source.index(begin)] + source[source.index(end):]
assert outside_session(supplied) == outside_session(local), 'Unexpected difference outside session changes'
assert 'SESSION_IDLE_MS' not in supplied
assert "sessions[userId] = session;" in supplied
target = root / 'docs/simplified/cloud-source-review'
target.mkdir(exist_ok=True)
(target / 'store-before-2026-10-25.js').write_text(supplied, encoding='utf-8')
(target / 'store-session-change.diff').write_text(''.join(difflib.unified_diff(supplied.splitlines(True),local.splitlines(True),fromfile='cloud/store.js',tofile='prepared/store.js')),encoding='utf-8')
print('PASS: supplied cloud store matches local outside the prepared session timeout patch.')
print('Cloud file SHA256: ' + hashlib.sha256(supplied.encode()).hexdigest())
print('Saved rollback source and reviewed diff; other cloud files are not verified.')
