import re

with open('src/components/features/ContradictionRadar.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove comments to avoid miscounting
content = re.sub(r'//.*', '', content)
content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

open_braces = content.count('{')
close_braces = content.count('}')
open_parens = content.count('(')
close_parens = content.count(')')
open_tags = len(re.findall(r'<[a-zA-Z][^>]*[^/]>', content))
close_tags = content.count('</')
self_closing = content.count('/>')

print(f"Braces: {{: {open_braces}, }}: {close_braces}")
print(f"Parens: (: {open_parens}, ): {close_parens}")
print(f"Opening Tags: {open_tags}")
print(f"Closing Tags: {close_tags}")
print(f"Self-closing Tags: {self_closing}")
print(f"Total Opening/Self: {open_tags + self_closing}")
print(f"Balance (Open - Close): {open_tags - close_tags}")
