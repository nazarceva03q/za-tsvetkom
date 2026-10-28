from pathlib import Path
import difflib
import re

root = Path(__file__).resolve().parents[1]
target = root / 'docs/simplified/cloud-source-review'
target.mkdir(exist_ok=True)
sources = {
    'vkApi': '86d26567-4327-48c4-80bc-be3d9e941a86',
    'admin': '4b5b04e6-3217-4cbe-bad7-0b1f5d94ae52',
    'objectStorage': 'f7a9e9fd-3b16-4285-95f4-4b2619372a2e',
}
def normalize(text):
    text = text.lstrip('\ufeff').replace('\r\n','\n').strip()
    return re.sub(r'console\.(log|warn|error)\([^\n]*?\);', '/* diagnostic */', text)
for name, folder in sources.items():
    source = next((Path('C:/Users/User/.codex/attachments') / folder).glob('*.txt')).read_text(encoding='utf-8-sig')
    local = (root / 'bot/src' / (name + '.js')).read_text(encoding='utf-8')
    (target / (name + '-before-2026-10-25.js')).write_text(source, encoding='utf-8')
    diff = ''.join(difflib.unified_diff(source.splitlines(True),local.splitlines(True),fromfile='cloud/'+name,tofile='prepared/'+name))
    (target / (name + '-change.diff')).write_text(diff, encoding='utf-8')
    if normalize(source) == normalize(local):
        print(name + ': MATCH except diagnostic calls and surrounding whitespace')
    else:
        print(name + ': OTHER DIFFERENCES')
        print(''.join(difflib.unified_diff(normalize(source).splitlines(True),normalize(local).splitlines(True)))[:6000])
