import os
import re

directories = [
    'apps/host/src',
    'apps/foxy/src',
    'packages/ui/src',
    'packages/lib/src',
]

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace @/components/ with @alfanumrik/ui/
    new_content = re.sub(r'@/components/', r'@alfanumrik/ui/', content)
    # Replace @/lib/ with @alfanumrik/lib/
    new_content = re.sub(r'@/lib/', r'@alfanumrik/lib/', new_content)

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for d in directories:
    for root, dirs, files in os.walk(d):
        if 'node_modules' in root or '.next' in root:
            continue
        for file in files:
            if file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                process_file(os.path.join(root, file))
