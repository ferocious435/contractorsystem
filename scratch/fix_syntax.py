import re
import os

file_path = r'c:\Users\SergeyRaihshtat\Desktop\sergey\contractorsystem\contractorsystem\src\components\features\ContradictionRadar.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Fix 1: Missing brace in onClick handler
# The pattern is: onClick={() => generateContradictionPDF({ ... })}
# We look for the line ending in '})' inside an onClick block.
fixed_brace = False
for i, line in enumerate(lines):
    if 'generateContradictionPDF' in line and 'onClick' in line:
        # We are on the start line. Look ahead for '})'
        for j in range(i, i+10):
            if j < len(lines) and '})' in lines[j] and '})}' not in lines[j] and '>' not in lines[j]:
                print(f"Fixing missing brace at line {j+1}")
                lines[j] = lines[j].replace('})', '})}')
                fixed_brace = True
                break
        if fixed_brace:
            break

# Fix 2 was already applied if printed, but we can check again if it missed it
# Extra </div> around line 774 (index 773)
fixed_div = False
for i, line in enumerate(lines):
    if '</AnimatePresence>' in line:
        if i + 2 < len(lines) and '</div>' in lines[i+1] and '</motion.div>' in lines[i+2]:
            print(f"Removing extra </div> at line {i+2}")
            lines.pop(i+1)
            fixed_div = True
            break

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

if fixed_brace or fixed_div:
    print("Fixes applied successfully.")
else:
    print("No fixes were needed or patterns not found.")
